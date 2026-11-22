import { categories, choices, subjects, type ExamForm, type Item, type TextItem } from '../corpus/catalog'
import { stubReply, type StubPrompt } from '../ai/stub'
import type { Attempt, Session } from '../study/store'
import { Layout } from './layout'

export function itemUrl(sessionId: string, position: number) {
  return `/sessions/${sessionId}/items/${position}`
}

export function nextUnanswered(exam: ExamForm, attempts: Attempt[]) {
  const answered = new Set(attempts.map(attempt => attempt.position))
  return exam.items.find(item => !answered.has(item.number))
}

function SessionProgress({ exam, item, session, attempts }: { exam: ExamForm; item: Item; session?: Session; attempts: Attempt[] }) {
  const byNumber = new Map(attempts.map(attempt => [attempt.position, attempt]))
  const correct = attempts.filter(attempt => attempt.correct).length
  const status = (attempt?: Attempt) => !attempt ? '未回答' : attempt.correct ? '正解' : '不正解'
  return <aside class="study-aside" aria-label="この演習の進捗">
    <section class="progress-panel">
      <h2>この演習の進捗</h2>
      <div class="progress-count"><strong>{attempts.length}</strong><span> / {exam.questionCount} 問</span></div>
      <progress max={exam.questionCount} value={attempts.length} aria-label="回答済みの問題数" />
      <div class="progress-footer"><span>正解 <b>{correct}</b> 問</span><span>正答率 <b>{attempts.length ? `${Math.round(correct / attempts.length * 100)}%` : '—'}</b></span></div>
    </section>
    <section class="panel map">
      <h2>問題一覧</h2>
      <ol class="question-grid">
        {exam.items.map(({ number }) => {
          const entry = byNumber.get(number)
          const className = entry ? entry.correct ? 'correct' : 'wrong' : ''
          const label = `問${number}、${status(entry)}`
          const active = number === item.number
          return <li key={number}>
            {session
              ? <a class={className} href={itemUrl(session.id, number)} aria-current={active ? 'step' : undefined} aria-label={label}>{number}</a>
              : <span aria-current={active ? 'step' : undefined} aria-label={label}>{number}</span>}
          </li>
        })}
      </ol>
      <p class="map-legend">
        <span><i class="legend-current" />表示中</span><span><i class="legend-correct" />正解</span><span><i class="legend-wrong" />不正解</span>
      </p>
    </section>
  </aside>
}

function Source({ exam, item, answered }: { exam: ExamForm; item: Item; answered: boolean }) {
  return <footer class="source">
    <p>出典　{exam.officialTitle} 問{item.number}（IPA）</p>
    {item.format === 'text' && <p>問題文と選択肢は、記号・改行などの表記を整えて掲載しています。</p>}
    <div class="source-links">
      {item.format === 'text' && <a href={`${exam.questions.url}#page=${item.page}`} target="_blank" rel="noopener noreferrer">原題 PDF（{item.page}ページ）</a>}
      {answered && <a href={exam.answers.url} target="_blank" rel="noopener noreferrer">公式解答 PDF</a>}
    </div>
  </footer>
}

function QuestionBody({ exam, item }: { exam: ExamForm; item: TextItem }) {
  const figure = item.figure
  const figureUrl = figure && `/questions/${exam.version}/${figure.path}`
  return <>
    <p class="prompt">{item.prompt}</p>
    {item.detail && <pre class="question-detail">{item.detail}</pre>}
    {figure && <figure class="question-figure">
      <a href={figureUrl} target="_blank" rel="noopener noreferrer" aria-label="原題の図表を拡大（別タブ）">
        <img src={figureUrl} alt="原題の図表。内容は下に記載。" width={figure.width} height={figure.height} loading="lazy" />
      </a>
      <figcaption>{figure.caption} <a href={figureUrl} target="_blank" rel="noopener noreferrer">図表を拡大</a></figcaption>
    </figure>}
  </>
}

function AnswerForm({ exam, item, session }: { exam: ExamForm; item: Item; session?: Session }) {
  const clientId = crypto.randomUUID()
  return <form method="post" action={session ? `${itemUrl(session.id, item.number)}/answer` : '/sessions'}>
    <input type="hidden" name="clientAttemptId" value={clientId} />
    {!session && <>
      <input type="hidden" name="clientSessionId" value={clientId} />
      <input type="hidden" name="formId" value={exam.id} />
    </>}
    <fieldset class={item.format === 'booklet' ? 'choices booklet-choices' : 'choices'}>
      <legend>選択肢</legend>
      {choices.map((choice, index) => <label class="choice" key={choice}>
        <input type="radio" name="choice" value={choice} required />
        <span class="choice-key">{choice}</span>{item.format === 'text' && <span>{item.options[index]}</span>}
      </label>)}
    </fieldset>
    <div class="answer-actions">
      <label class="confidence">自信度 <select name="confidence">
        <option value="">未入力</option><option value="sure">自信あり</option><option value="unsure">自信なし</option>
      </select></label>
      <button type="submit">回答する</button>
    </div>
  </form>
}

function AnswerResult({ exam, item, attempt, session, attempts, marked, hint, aiEnabled }: {
  exam: ExamForm
  item: Item
  attempt: Attempt
  session: Session
  attempts: Attempt[]
  marked: boolean
  hint?: StubPrompt
  aiEnabled: boolean
}) {
  const url = itemUrl(session.id, item.number)
  const unresolved = nextUnanswered(exam, attempts)
  const next = item.number + 1
  return <>
    {item.format === 'text' && <div class="choices readonly" aria-label="確定済みの選択肢">
      <h3>選択肢</h3>
      <ul>
        {choices.map((choice, index) => <li class={choice === item.correct ? 'answer-correct' : choice === attempt.choice ? 'answer-wrong' : ''} key={choice}>
          <span class="choice-key">{choice}</span><span>{item.options[index]}{choice === attempt.choice && <small>あなたの回答</small>}</span>
          {choice === item.correct && <span class="option-status">正答</span>}
        </li>)}
      </ul>
    </div>}
    <section id="result" class={`result ${attempt.correct ? 'correct' : 'wrong'}`} aria-labelledby="result-title">
      <div class="result-summary">
        <h3 id="result-title">{attempt.correct ? '正解' : '不正解'}</h3>
        <span>公式正答 <b>{item.correct}</b> ・ あなたの回答 <b>{attempt.choice}</b></span>
      </div>
      {item.format === 'text' && <><h4>解説</h4><p>{item.explanation}</p></>}
      <div class="result-actions">
        <form method="post" action={`${url}/review`}>
          <input type="hidden" name="marked" value={marked ? '0' : '1'} />
          <button class="secondary" type="submit">{marked ? '要復習を解除' : '要復習にする'}</button>
        </form>
        {next <= exam.questionCount
          ? <a class="button" href={itemUrl(session.id, next)}>次の問題</a>
          : unresolved ? <a class="button" href={itemUrl(session.id, unresolved.number)}>未回答の問題へ</a>
          : <a class="button" href={`/sessions/${session.id}/summary`}>演習結果を見る</a>}
      </div>
    </section>
    {aiEnabled && item.format === 'text' && <section id="ai" class="ai-section" aria-labelledby="ai-title">
      <div class="ai-heading"><h3 id="ai-title">AIに聞く</h3><span>ローカルスタブ</span></div>
      <form method="post" action={`${url}/ai`} class="ai-prompts">
        <button class="secondary" type="submit" name="prompt" value="reason">なぜこの選択肢？</button>
        <button class="secondary" type="submit" name="prompt" value="approach">解き方の考え方</button>
      </form>
      {hint && <p class="ai-answer">{stubReply(item, hint)}</p>}
    </section>}
  </>
}

export function StudyPage({ exam, item, session, attempts, marked = false, hint, aiEnabled = false }: {
  exam: ExamForm
  item: Item
  session?: Session
  attempts: Attempt[]
  marked?: boolean
  hint?: StubPrompt
  aiEnabled?: boolean
}) {
  const attempt = attempts.find(answer => answer.position === item.number)
  const heading = `${exam.year}年 ${exam.period}`
  const { label, slug, examName } = subjects[exam.subject]
  return <Layout title={`問${item.number} | ${heading} ${label}`} active="study" subject={exam.subject}>
    <header class="page-heading">
      <div><p class="eyebrow">{exam.subject} <span>/</span> {label}</p><h1>{heading}</h1><p>{examName} ・ 全{exam.questionCount}問</p></div>
      <a class="button secondary" href={`/catalog?subject=${slug}&year=${exam.year}`}>年度・期を選ぶ</a>
    </header>
    <div class="study-layout">
      <article class="panel question" aria-labelledby="question-title">
        <header class="question-header">
          <h2 id="question-title"><span>問</span> {String(item.number).padStart(2, '0')}<small> / {exam.questionCount}</small></h2>
          <span class="category">{item.format === 'text' ? categories[item.category].label : '公式冊子で演習'}</span>
        </header>
        <div class="question-inner">
          {item.format === 'text' ? <QuestionBody exam={exam} item={item} /> : <section class="booklet-prompt" aria-label="公式問題冊子">
            <p>IPAの問題冊子（PDFの{item.page}ページ目）で問{item.number}を読み、ア〜エの記号を選んでください。</p>
            <a class="button secondary" href={`${exam.questions.url}#page=${item.page}`} target="_blank" rel="noopener noreferrer">公式問題冊子を開く（PDF・別タブ）</a>
          </section>}
          {attempt && session ? <AnswerResult {...{ exam, item, attempt, session, attempts, marked, hint, aiEnabled }} />
            : <AnswerForm exam={exam} item={item} session={session} />}
        </div>
        <Source exam={exam} item={item} answered={Boolean(attempt)} />
      </article>
      <SessionProgress {...{ exam, item, session, attempts }} />
    </div>
  </Layout>
}
