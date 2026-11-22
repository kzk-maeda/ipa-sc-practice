import { Hono, type Context } from 'hono'
import type { AppEnv } from '../auth/access'
import { choices, defaultExam, exams, getExam, getItem, parseSubject, type Choice } from '../corpus/catalog'
import { stubReply, type StubPrompt } from '../ai/stub'
import {
  createSession, isMarked, latestSessions, openSession, progressData, saveAttempt,
  sessionAttempts, setMark, type Submission,
} from '../study/store'
import { ErrorPage } from '../views/layout'
import { CatalogPage, ProgressPage, SummaryPage } from '../views/pages'
import { itemUrl, nextUnanswered, StudyPage } from '../views/study'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const study = new Hono<AppEnv>()

function jsonRequested(c: Context<AppEnv>) {
  return c.req.header('Accept')?.includes('application/json')
}

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    if (c.req.header('Content-Type')?.startsWith('application/json')) {
      const value: unknown = await c.req.json()
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
    }
    return await c.req.parseBody({ all: true })
  } catch {
    return {}
  }
}

export function pageError(c: Context<AppEnv>, status: 400 | 403 | 404 | 409 | 413 | 500 | 503, message: string) {
  if (jsonRequested(c)) return c.json({ error: message }, status)
  return c.html(<ErrorPage title={status === 404 ? 'ページが見つかりません' : '処理を完了できませんでした'} message={message} />, status)
}

function readSubmission(data: Record<string, unknown>): Submission | null {
  const { choice, confidence, clientAttemptId } = data
  if (!choices.includes(choice as Choice) || typeof clientAttemptId !== 'string' || !uuid.test(clientAttemptId)) return null
  if (confidence != null && confidence !== '' && confidence !== 'sure' && confidence !== 'unsure') return null
  return { choice: choice as Choice, confidence: confidence || null, clientAttemptId }
}

async function findSession(db: D1Database, user: string, id: string) {
  if (!uuid.test(id)) return null
  const session = await openSession(db, user, id)
  const exam = session && getExam(session.form_id, session.corpus_version)
  return session && exam ? { session, exam } : null
}

function parsePrompt(value: unknown): StubPrompt | undefined {
  if (value === 'reason' || value === 'approach') return value
}

study.get('/', async c => {
  const sessions = await latestSessions(c.env.DB, c.get('userId'))
  const session = sessions.find(candidate => getExam(candidate.form_id, candidate.corpus_version))
  if (session) return c.redirect(`/sessions/${session.id}`)
  return c.html(<StudyPage exam={defaultExam} item={defaultExam.items[0]} attempts={[]} />)
})

study.get('/catalog', async c => {
  const subject = parseSubject(c.req.query('subject'))
  const forms = exams.filter(exam => exam.subject === subject)
  const requested = Number(c.req.query('year'))
  const year = forms.some(exam => exam.year === requested) ? requested : forms[0].year
  const sessions = await latestSessions(c.env.DB, c.get('userId'))
  return c.html(<CatalogPage {...{ sessions, subject, forms, year }} />)
})

study.get('/sessions/:id', async c => {
  const saved = await findSession(c.env.DB, c.get('userId'), c.req.param('id'))
  if (!saved) return c.notFound()
  const { session, exam } = saved
  const attempts = await sessionAttempts(c.env.DB, c.get('userId'), session.id)
  const next = nextUnanswered(exam, attempts)
  return c.redirect(next ? itemUrl(session.id, next.number) : `/sessions/${session.id}/summary`)
})

study.post('/sessions', async c => {
  const data = await body(c)
  const id = data.clientSessionId
  const exam = getExam(data.formId)
  if (typeof id !== 'string' || !uuid.test(id) || !exam) {
    return pageError(c, 400, '年度・期を選び直してから演習を始めてください。')
  }
  const initial = data.choice === undefined ? undefined : readSubmission(data)
  if (initial === null) return pageError(c, 400, '選択肢と自信度を確認してください。')
  const result = await createSession(c.env.DB, c.get('userId'), id, exam, initial)
  if (!result) return pageError(c, 409, 'この操作と異なる内容が保存されています。演習を開き直してください。')
  const location = itemUrl(id, 1)
  if (jsonRequested(c)) return c.json({ sessionId: id, location, ...(typeof result === 'object' ? { attempt: result } : {}) })
  return c.redirect(initial ? `${location}#result` : location, 303)
})

study.get('/sessions/:id/items/:position', async c => {
  const { id, position } = c.req.param()
  const saved = await findSession(c.env.DB, c.get('userId'), id)
  const item = saved && getItem(saved.exam, Number(position))
  if (!item || !saved) return c.notFound()
  const { session, exam } = saved
  const attempts = await sessionAttempts(c.env.DB, c.get('userId'), id)
  const answered = attempts.some(attempt => attempt.position === item.number)
  const marked = answered && await isMarked(c.env.DB, c.get('userId'), item.group)
  const aiEnabled = item.format === 'text' && c.env.AI_MODE === 'stub'
  const hint = aiEnabled && answered ? parsePrompt(c.req.query('hint')) : undefined
  return c.html(<StudyPage {...{ exam, item, session, attempts, marked, hint, aiEnabled }} />)
})

study.post('/sessions/:id/items/:position/answer', async c => {
  const { id, position } = c.req.param()
  const saved = await findSession(c.env.DB, c.get('userId'), id)
  const item = saved && getItem(saved.exam, Number(position))
  if (!item || !saved) return c.notFound()
  const data = readSubmission(await body(c))
  if (!data) return pageError(c, 400, '選択肢と自信度を確認してください。')
  const attempt = await saveAttempt(c.env.DB, c.get('userId'), id, saved.exam, item, data)
  if (!attempt) return pageError(c, 409, 'この問題には確定済みの回答があります。')
  if (jsonRequested(c)) return c.json({ attempt, officialAnswer: item.correct, explanation: item.format === 'text' ? item.explanation : null })
  return c.redirect(`${itemUrl(id, item.number)}#result`, 303)
})

study.post('/sessions/:id/items/:position/review', async c => {
  const { id, position } = c.req.param()
  const saved = await findSession(c.env.DB, c.get('userId'), id)
  const item = saved && getItem(saved.exam, Number(position))
  if (!item || !saved) return c.notFound()
  const attempts = await sessionAttempts(c.env.DB, c.get('userId'), id)
  if (!attempts.some(attempt => attempt.position === item.number)) return pageError(c, 403, '回答を確定してから要復習を設定できます。')
  const { marked } = await body(c)
  if (marked !== '1' && marked !== '0') return pageError(c, 400, '要復習の設定を確認してください。')
  await setMark(c.env.DB, c.get('userId'), item.group, marked === '1')
  if (jsonRequested(c)) return c.json({ marked: marked === '1' })
  return c.redirect(`${itemUrl(id, item.number)}#result`, 303)
})

study.post('/sessions/:id/items/:position/ai', async c => {
  const { id, position } = c.req.param()
  if (c.env.AI_MODE !== 'stub') return c.notFound()
  const saved = await findSession(c.env.DB, c.get('userId'), id)
  const item = saved && getItem(saved.exam, Number(position))
  if (!item || item.format !== 'text') return c.notFound()
  const attempts = await sessionAttempts(c.env.DB, c.get('userId'), id)
  if (!attempts.some(attempt => attempt.position === item.number)) return pageError(c, 403, '回答を確定してから質問できます。')
  const prompt = parsePrompt((await body(c)).prompt)
  if (!prompt) return pageError(c, 400, '質問を選び直してください。')
  if (jsonRequested(c)) return c.json({ mode: 'stub', text: stubReply(item, prompt) })
  return c.redirect(`${itemUrl(id, item.number)}?hint=${prompt}#ai`, 303)
})

study.get('/sessions/:id/summary', async c => {
  const saved = await findSession(c.env.DB, c.get('userId'), c.req.param('id'))
  if (!saved) return c.notFound()
  const { session, exam } = saved
  const attempts = await sessionAttempts(c.env.DB, c.get('userId'), session.id)
  return c.html(<SummaryPage exam={exam} session={session} attempts={attempts} />)
})

study.get('/progress', async c => {
  const subject = parseSubject(c.req.query('subject'))
  const data = await progressData(c.env.DB, c.get('userId'), subject)
  return c.html(<ProgressPage data={data} subject={subject} filter={c.req.query('category')} />)
})

export { study }
