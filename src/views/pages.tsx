import { categories, getItemById, subjects, type ExamForm, type Subject } from '../corpus/catalog'
import { progressRules, summarize } from '../study/progress'
import { unclassified, type Attempt, type Session, type progressData } from '../study/store'
import { Layout } from './layout'
import { itemUrl, nextUnanswered } from './study'

function SubjectLinks({ subject, page, year }: { subject: Subject; page: 'catalog' | 'progress'; year?: number }) {
  return <nav class="inline-actions subject-nav" aria-label="科目">
    {Object.entries(subjects).map(([key, { slug, label }]) => (
      <a key={slug} class={key === subject ? 'button' : 'button secondary'} aria-current={key === subject ? 'page' : undefined}
        href={`/${page}?subject=${slug}${year ? `&year=${year}` : ''}`}>{key} {label}</a>
    ))}
  </nav>
}

export function CatalogPage({ sessions, subject, forms, year }: {
  sessions: Session[]; subject: Subject; forms: ExamForm[]; year: number
}) {
  const { label, slug } = subjects[subject]
  const years = [...new Set(forms.map(exam => exam.year))]
  const selected = forms.filter(exam => exam.year === year)
  const reviewed = forms.filter(exam => exam.format === 'text').length
  return <Layout title={`${label}の年度・期`} active="catalog" subject={subject}>
    <header class="page-heading"><div><h1>年度・期から選ぶ</h1><p>IPAの公式過去問 {years.at(-1)}〜{years[0]}年</p></div></header>
    <SubjectLinks {...{ subject, year }} page="catalog" />
    <section class="panel list-panel">
      <div class="section-name"><h2>{subject} <span>{label}</span></h2><span class="muted">本文・解説つき {reviewed}回 ・ 公式冊子で演習 {forms.length - reviewed}回</span></div>
      <form action="/catalog" method="get" class="catalog-filter">
        <input type="hidden" name="subject" value={slug} />
        <label class="confidence">年度 <select name="year">
          {years.map(value => <option key={value} value={String(value)} selected={value === year}>{value}年</option>)}
        </select></label>
        <button class="secondary" type="submit">表示</button>
      </form>
      <ul class="catalog-list">
        {selected.map(exam => {
          const session = sessions.find(candidate => candidate.form_id === exam.id && candidate.corpus_version === exam.version)
          return <li class="catalog-row" key={exam.id}>
            <div>
              <h3>{exam.year}年 {exam.period}</h3>
              <p>全{exam.questionCount}問 ・ {exam.format === 'text' ? '本文・解説つき' : '公式冊子で演習'}</p>
            </div>
            <div class="inline-actions">
              {session && <a class="button secondary" href={`/sessions/${session.id}`}>続きから</a>}
              <form action="/sessions" method="post">
                <input type="hidden" name="formId" value={exam.id} />
                <input type="hidden" name="clientSessionId" value={crypto.randomUUID()} />
                <button type="submit">{session ? '新しく始める' : '演習を始める'}</button>
              </form>
            </div>
          </li>
        })}
      </ul>
      <p class="catalog-source"><a href={selected[0].indexUrl} target="_blank" rel="noopener noreferrer">{year}年のIPA掲載資料</a></p>
    </section>
  </Layout>
}

const jst = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' })

function History({ attempts, marks }: { attempts: Attempt[]; marks: Set<string> }) {
  if (!attempts.length) return <p class="muted no-history">回答すると、ここに学習記録が表示されます。</p>
  return <ul class="history">
    {attempts.map(attempt => {
      const entry = getItemById(attempt.item_id)
      const edition = entry ? `${entry.form.year}年 ${entry.form.period}` : 'A-1'
      const category = attempt.category === unclassified ? '公式冊子で演習' : categories[attempt.category].label
      const title = entry?.item.format === 'text' ? entry.item.title : undefined
      return <li key={`${attempt.session_id}:${attempt.position}`}>
        <div><a href={`${itemUrl(attempt.session_id, attempt.position)}#result`}>{edition} ・ 問{attempt.position}{title && ` ${title}`}</a>
          <span class="muted">{category} ・ <time datetime={attempt.answered_at}>{jst.format(new Date(attempt.answered_at))}</time></span></div>
        <div class="history-status">
          <span class={`pill ${attempt.correct ? 'correct' : 'wrong'}`}>{attempt.correct ? '正解' : '不正解'}</span>
          {attempt.confidence === 'unsure' && <span class="pill">自信なし</span>}
          {marks.has(attempt.item_group) && <span class="pill">要復習</span>}
        </div>
      </li>
    })}
  </ul>
}

export function ProgressPage({ data, subject, filter }: { data: Awaited<ReturnType<typeof progressData>>; subject: Subject; filter?: string }) {
  const { label, slug } = subjects[subject]
  const summaries = summarize(data.evidence, data.marks, subject)
  const selected = summaries.find(category => category.key === filter)
  const { answered, correct } = data.stats
  return <Layout title={`${label}の学習記録`} active="progress" subject={subject}>
    <header class="page-heading"><div><p class="eyebrow">{subject} <span>/</span> {label}</p><h1>学習記録</h1><p>直近{progressRules.days}日間の成績と、カテゴリごとの回答を確認できます。</p></div>
      <a class="button secondary" href={`/catalog?subject=${slug}`}>年度・期を選ぶ</a></header>
    <SubjectLinks subject={subject} page="progress" />
    <div class="stat-grid">
      <div class="panel stat"><span>採点件数</span><strong>{answered}<small> 問</small></strong></div>
      <div class="panel stat"><span>正答率</span><strong>{answered ? `${Math.round(correct / answered * 100)}%` : '—'}</strong></div>
      <div class="panel stat"><span>要復習にした問題</span><strong>{data.marks.size}<small> 問</small></strong></div>
    </div>
    <section class="panel list-panel spaced">
      <div class="section-name"><h2>カテゴリ別の弱点</h2>{selected && <a href={`/progress?subject=${slug}`}>すべて表示</a>}</div>
      <p class="list-note">本文・解説つきの設問を対象に、同じ設問の最新の回答1件で集計します。{progressRules.minSamples}問未満のカテゴリは「データ不足」です。</p>
      <ul class="category-list">
        {(selected ? [selected] : summaries).map(category => <li key={category.key}>
          <a href={`/progress?subject=${slug}&category=${category.key}#answers`}><span>{category.label}<small>{category.field}</small></span></a>
          <span class="category-counts">{category.sampleSize} 問 <small>誤答 {category.wrong} ・ 自信なしの正解 {category.unsure} ・ 要復習 {category.marked}</small></span>
          <span class={`pill ${category.status === '要対策' ? 'wrong' : ''}`}>{category.status}</span>
        </li>)}
      </ul>
    </section>
    <section class="panel list-panel spaced" id="answers">
      <div class="section-name"><h2>{selected ? `${selected.label}の集計対象` : '最近の回答'}</h2></div>
      <History attempts={selected?.evidence ?? data.history} marks={data.marks} />
    </section>
  </Layout>
}

export function SummaryPage({ exam, session, attempts }: { exam: ExamForm; session: Session; attempts: Attempt[] }) {
  const correct = attempts.filter(attempt => attempt.correct).length
  const next = nextUnanswered(exam, attempts)
  const { label, slug, examName } = subjects[exam.subject]
  return <Layout title="演習結果" active="study" subject={exam.subject}>
    <header class="page-heading"><div><p class="eyebrow">{exam.subject} <span>/</span> {label}</p><h1>演習結果</h1><p>{exam.year}年 {exam.period} ・ {examName}</p></div></header>
    <div class="stat-grid">
      <div class="panel stat"><span>回答数</span><strong>{attempts.length}<small> / {exam.questionCount} 問</small></strong></div>
      <div class="panel stat"><span>正解数</span><strong>{correct}<small> 問</small></strong></div>
      <div class="panel stat"><span>正答率</span><strong>{attempts.length ? `${Math.round(correct / attempts.length * 100)}%` : '—'}</strong></div>
    </div>
    <div class="inline-actions spaced">
      {next && <a class="button" href={itemUrl(session.id, next.number)}>未回答の問題へ</a>}
      <a class="button secondary" href={`/progress?subject=${slug}`}>学習記録を見る</a>
      <a class="button secondary" href={`/catalog?subject=${slug}&year=${exam.year}`}>年度・期へ戻る</a>
    </div>
  </Layout>
}
