"""Verify the reviewed 2025 answer keys and rebuild the reviewed figure crops."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request

import fitz
from PIL import Image

from catalog import answer_choices

ROOT = Path(__file__).resolve().parents[2]
SPRING = json.loads((ROOT / "src/corpus/2025-spring-source.json").read_text(encoding="utf-8"))
A1_AUTUMN = next(source for source in json.loads((ROOT / "src/corpus/a1-sources.json").read_text(encoding="utf-8"))
              if source["id"] == "a1:2025:autumn")
A2_AUTUMN = next(source for source in json.loads((ROOT / "src/corpus/a2-sources.json").read_text(encoding="utf-8"))
                 if source["id"] == "a2:2025:autumn")

# One-based PDF page, then the rectangle in the booklet's 1432×2026 scan.
SPRING_FIGURES = {
    3: (5, (558, 351, 927, 594)),
    4: (5, (408, 1079, 1030, 1252)),
    7: (7, (188, 586, 1178, 934)),
    15: (11, (258, 920, 1205, 1237)),
    25: (15, (190, 456, 1305, 732)),
}


A1_AUTUMN_FIGURES = {
    6: (6, (260, 390, 1190, 666)),
    14: (9, (188, 1168, 568, 1494)),
    27: (15, (238, 304, 1214, 695)),
    29: (16, (383, 389, 1054, 563)),
}


A2_AUTUMN_FIGURES = {
    22: (10, (528, 893, 829, 1142)),
    24: (11, (205, 1198, 1295, 1408)),
}


def download_verified(source):
    with urllib.request.urlopen(source["url"], timeout=30) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != source["sha256"]:
        raise SystemExit(f"公式 PDF のハッシュが変わりました。原資料の再確認が必要です: {source['url']}")
    return data


def verify_answers(source):
    pdf = download_verified(source["answers"])
    expected = source["answers"]["choices"]
    if answer_choices(pdf, len(expected), {}) != expected:
        raise SystemExit("公式解答と収録した正答が一致しません。")
    print(f"公式正答: {len(expected)}/{len(expected)} 問一致")


def rebuild_figures(source, figures):
    target = ROOT / "public" / "questions" / source["version"]
    target.mkdir(parents=True, exist_ok=True)
    with fitz.open(stream=download_verified(source["questions"]), filetype="pdf") as booklet:
        for question, (page, box) in figures.items():
            images = booklet[page - 1].get_images()
            if len(images) != 1:
                raise SystemExit(f"PDF {page} ページ目の画像構成が一致しません。")
            scan = booklet.extract_image(images[0][0])["image"]
            with Image.open(io.BytesIO(scan)) as image:
                if image.size != (1432, 2026):
                    raise SystemExit(f"PDF {page} ページ目の画像寸法が一致しません。")
                image.crop(box).save(target / f"{question:02}.webp", lossless=True)
    print(f"原図: {len(figures)} 点生成")


if __name__ == "__main__":
    for source, figures in [(SPRING, SPRING_FIGURES), (A1_AUTUMN, A1_AUTUMN_FIGURES), (A2_AUTUMN, A2_AUTUMN_FIGURES)]:
        print(source["officialTitle"])
        verify_answers(source)
        rebuild_figures(source, figures)
