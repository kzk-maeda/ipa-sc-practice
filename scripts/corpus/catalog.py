"""Discover IPA morning exam booklets and verify the numbered official answer keys."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import unicodedata
from urllib.parse import urljoin, urlsplit
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SITE = "https://www.ipa.go.jp"
INDEX = SITE + "/shiken/mondai-kaiotu/"
PERIODS = {"春期": "spring", "秋期": "autumn", "特別": "special", "10月": "october"}
SEASON_HEADING = re.compile(r"((?:平成|令和)(?:元|[0-9]+)年度)\s*(春期|秋期|特別|10月)試験")


@dataclass(frozen=True)
class Subject:
    code: str
    official_title: str
    pdf_suffix: str
    start_year: int
    question_count: int
    duration_minutes: int
    version_prefix: str


SUBJECTS = {
    "a1": Subject("A-1", "高度試験共通 午前Ⅰ", "_koudo_am1", 2009, 30, 50, ""),
    "a2": Subject("A-2", "情報処理安全確保支援士試験 午前Ⅱ", "_sc_am2", 2017, 25, 40, "a2-"),
}


class ExamPage(HTMLParser):
    """The heading names the exam. Repeated PDF links within it share that exam."""

    def __init__(self, booklet_pattern):
        super().__init__()
        self.booklet_pattern = booklet_pattern
        self.links = set()
        self.terms = {}
        self.heading = None
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag == "h3":
            self.heading = []
        if tag == "a":
            href = dict(attrs).get("href") or ""
            if href:
                self.links.add(href)
            if self.current and (match := self.booklet_pattern.search(href)):
                self.terms[self.current][match[1]].add(href)

    def handle_data(self, text):
        if self.heading is not None:
            self.heading.append(text)

    def handle_endtag(self, tag):
        if tag != "h3" or self.heading is None:
            return
        match = SEASON_HEADING.search(unicodedata.normalize("NFKC", "".join(self.heading)))
        self.heading = None
        self.current = match.groups() if match else None
        if self.current:
            self.terms.setdefault(self.current, {"qs": set(), "ans": set()})


def get(url, cache, refresh):
    if not url.startswith(INDEX):
        raise ValueError(f"IPAの資料URLを確認できません: {url}")
    cache.mkdir(parents=True, exist_ok=True)
    name = urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1] + (".html" if url == INDEX else "")
    path = cache / name
    if refresh or not path.is_file():
        with urllib.request.urlopen(url, timeout=35) as response:
            if not response.geturl().startswith(INDEX):
                raise ValueError(f"IPAの資料URLを確認できません: {response.geturl()}")
            data = response.read()
        path.write_bytes(data)
    return path.read_bytes()


def discover(subject, cache, refresh):
    years = range(subject.start_year, 2026)
    booklet_pattern = re.compile(re.escape(subject.pdf_suffix) + r"_(qs|ans)\.pdf$", re.IGNORECASE)
    index = ExamPage(booklet_pattern)
    index.feed(get(INDEX, cache, refresh).decode())
    year_links = {}
    for href in index.links:
        url = urljoin(INDEX, href)
        if url.startswith(INDEX) and (match := re.fullmatch(r"(20\d{2})[hr]\d{2}\.html", url.removeprefix(INDEX))):
            year = int(match[1])
            if year in years:
                year_links.setdefault(year, set()).add(url)
    if set(year_links) != set(years) or any(len(links) != 1 for links in year_links.values()):
        raise ValueError(f"IPA年度一覧に{subject.start_year}〜2025年の一意な年度ページがありません。")

    def find_year(entry):
        year, links = entry
        url = next(iter(links))
        page = ExamPage(booklet_pattern)
        page.feed(get(url, cache, refresh).decode())
        forms = []
        for (era, period), pair in page.terms.items():
            if not pair["qs"] and not pair["ans"]:
                continue
            if any(len(urls) != 1 for urls in pair.values()):
                raise ValueError(f"{year}年{period}: 問題冊子と解答が一意に対応しません。")
            forms.append((year, era, period, url, *(urljoin(url, next(iter(pair[key]))) for key in ("qs", "ans"))))
        expected = {2011: {"特別", "秋期"}, 2020: {"10月"}}.get(year, {"春期", "秋期"})
        if len(forms) != len(expected) or {form[2] for form in forms} != expected:
            raise ValueError(f"{year}年: 年度ページの期名が想定と一致しません。")
        return forms

    with ThreadPoolExecutor(max_workers=8) as workers:
        return [form for year in workers.map(find_year, sorted(year_links.items(), reverse=True)) for form in year]


def answer_choices(data, count, scanned_keys):
    text = subprocess.check_output(["pdftotext", "-layout", "-", "-"], input=data).decode()
    text = unicodedata.normalize("NFKC", text)
    if not text.strip():
        # This edition is image-only. Accept the checked transcription for this exact PDF.
        scanned = scanned_keys.get(hashlib.sha256(data).hexdigest())
        if scanned and re.fullmatch(f"[アイウエ]{{{count}}}", scanned["choices"]):
            return list(scanned["choices"])
    cell = r"問[ \t]*(\d+)[ \t]+([アイウエ])"
    row = re.compile(r"[ \t]*(?:問[ \t]*\d+[ \t]+[アイウエ][ \t]*){1,3}")
    key = [pair for line in text.splitlines() if row.fullmatch(line) for pair in re.findall(cell, line)]
    numbered = sorted((int(number), choice) for number, choice in key)
    if [number for number, _ in numbered] != list(range(1, count + 1)):
        raise ValueError(f"公式解答から問1〜{count}の一意な正答を抽出できません。")
    return [choice for _, choice in numbered]


def question_pages(url, digest, subject, page_ranges):
    name = urlsplit(url).path.rsplit("/", 1)[-1].removesuffix(subject.pdf_suffix + "_qs.pdf")
    reviewed = page_ranges.get(name)
    if not reviewed or reviewed["sha256"] != digest:
        raise ValueError("問題冊子のSHA-256が確認済みのページ位置と一致しません。")
    counts = reviewed["counts"]
    if any(not isinstance(count, int) or count <= 0 for count in counts) or sum(counts) != subject.question_count:
        raise ValueError("ページ位置が問番号の総数と一致しません。")
    return [page for page, count in enumerate(counts, reviewed["firstPage"]) for _ in range(count)]


def verify_form(form, subject, slug, page_ranges, scanned_keys, cache, refresh):
    year, era, period, index_url, questions_url, answers_url = form
    try:
        questions = get(questions_url, cache, refresh)
        answers = get(answers_url, cache, refresh)
        if not questions.startswith(b"%PDF-"):
            raise ValueError("問題冊子がPDFではありません。")
        key = answer_choices(answers, subject.question_count, scanned_keys)
        questions_hash = hashlib.sha256(questions).hexdigest()
        pages = question_pages(questions_url, questions_hash, subject, page_ranges)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise ValueError(f"{year}年{period}: {error}") from error
    return {
        "id": f"{slug}:{year}:{PERIODS[period]}",
        "version": f"{subject.version_prefix}{year}-{PERIODS[period]}-v1",
        "subject": subject.code,
        "year": year,
        "period": period,
        "officialTitle": f"{era} {period} {subject.official_title}",
        "durationMinutes": subject.duration_minutes,
        "questionCount": len(key),
        "indexUrl": index_url,
        "questions": {"url": questions_url, "sha256": questions_hash},
        "pages": pages,
        "answers": {"url": answers_url, "sha256": hashlib.sha256(answers).hexdigest(), "choices": key},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subject", choices=SUBJECTS, default="a1")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/ipa")
    parser.add_argument("--refresh", action="store_true", help="再取得して照合する")
    parser.add_argument("--write", action="store_true", help="照合済みのマニフェストを生成する")
    args = parser.parse_args()
    slug = args.subject
    subject = SUBJECTS[slug]
    target = ROOT / f"src/corpus/{slug}-sources.json"
    page_ranges_path = Path(__file__).with_name(f"{slug}-page-ranges.json")
    scanned_keys_path = Path(__file__).with_name(f"{slug}-scanned-keys.json")
    page_ranges = json.loads(page_ranges_path.read_text(encoding="utf-8"))
    scanned_keys = json.loads(scanned_keys_path.read_text(encoding="utf-8")) if scanned_keys_path.exists() else {}
    forms = discover(subject, args.cache, args.refresh)

    def verify(form):
        return verify_form(form, subject, slug, page_ranges, scanned_keys, args.cache, args.refresh)
    with ThreadPoolExecutor(max_workers=8) as workers:
        manifest = list(workers.map(verify, forms))
    for source in manifest:
        print(f"{source['year']}年 {source['period']}: 公式正答 {source['questionCount']}/{subject.question_count}・問番号のPDFページ確認")
    generated = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    if args.write:
        if target.is_file():
            current = {source["id"]: source for source in json.loads(target.read_text(encoding="utf-8"))}
            for source in manifest:
                previous = current.get(source["id"])
                if previous and previous["answers"] != source["answers"]:
                    raise SystemExit(f"{source['id']}: 公式解答に差分があります。採点と版の更新を確認してください。")
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(generated, encoding="utf-8")
        temporary.replace(target)
    elif target.read_text(encoding="utf-8") != generated:
        raise SystemExit("保存済みマニフェストと公式資料に差分があります。更新を確認してください。")
    print(f"合計 {len(manifest)}回・公式正答 {sum(row['questionCount'] for row in manifest)}問")


if __name__ == "__main__":
    main()
