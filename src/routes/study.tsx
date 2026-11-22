import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { aiMessages, completeQuestion, type AiPanel, type AiProblem, type AiReply } from '../ai/ask'
import { openAIConfig, questionText } from '../ai/config'
import { buildInput, estimatedCost, promptVersion } from '../ai/responses'
import { clearThread, hashQuestion, previousRequest, recentTurns, reserveRequest, type Thread } from '../ai/store'
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
  return c.html(<StudyPage exam={defaultExam} item={defaultExam.items[0]} attempts={[]} showPdf={c.req.query('booklet') === '1'} />)
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
  let ai: AiPanel | undefined
  if (answered && item.format === 'text') {
    if (c.env.AI_MODE === 'stub') ai = { mode: 'stub', hint: parsePrompt(c.req.query('hint')) }
    if (openAIConfig(c.env)) {
      const thread = { userId: c.get('userId'), sessionId: id, position: item.number }
      const problem = c.req.query('ai_error')
      const notice = problem && Object.hasOwn(aiMessages, problem) ? aiMessages[problem as AiProblem] : undefined
      ai = { mode: 'openai', turns: await recentTurns(c.env.DB, thread, Date.now()).catch(() => []), notice }
    }
  }
  return c.html(<StudyPage {...{ exam, item, session, attempts, marked, ai }} showPdf={c.req.query('booklet') === '1'} />)
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

function aiError(c: Context<AppEnv>, url: string, problem: AiProblem, status: 400 | 409 | 429 | 502 | 503) {
  if (jsonRequested(c) || c.req.header('Accept')?.includes('text/event-stream')) {
    return c.json({ error: aiMessages[problem], code: problem }, status)
  }
  return c.redirect(`${url}?ai_error=${problem}#ai`, 303)
}

function aiSuccess(c: Context<AppEnv>, url: string, reply: AiReply) {
  return jsonRequested(c) ? c.json({ mode: 'openai', ...reply }) : c.redirect(`${url}#ai`, 303)
}

function privateAiStream(c: Context<AppEnv>, callback: Parameters<typeof streamSSE>[1]) {
  const response = streamSSE(c, callback)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

async function aiTarget(c: Context<AppEnv>, id: string, position: number) {
  const userId = c.get('userId')
  const saved = await findSession(c.env.DB, userId, id)
  const item = saved && getItem(saved.exam, position)
  if (!saved || item?.format !== 'text') return null
  const attempts = await sessionAttempts(c.env.DB, userId, id)
  const attempt = attempts.find(candidate => candidate.position === position)
  const thread: Thread = { userId, sessionId: id, position }
  return { ...saved, item, attempt, thread, url: itemUrl(id, position) }
}

study.post('/sessions/:id/items/:position/ai', async c => {
  if (c.env.AI_MODE !== 'stub' && c.env.AI_MODE !== 'openai') return c.notFound()
  const target = await aiTarget(c, c.req.param('id'), Number(c.req.param('position')))
  if (!target) return c.notFound()
  const { exam, item, url, thread, attempt } = target
  if (!attempt) return pageError(c, 403, '回答を確定してから質問できます。')
  const data = await body(c)
  if (c.env.AI_MODE === 'stub') {
    const prompt = parsePrompt(data.prompt)
    if (!prompt) return pageError(c, 400, '質問を選び直してください。')
    if (jsonRequested(c)) return c.json({ mode: 'stub', text: stubReply(item, prompt) })
    return c.redirect(`${url}?hint=${prompt}#ai`, 303)
  }

  const config = openAIConfig(c.env)
  if (!config) return aiError(c, url, 'config', 503)
  const question = questionText(data)
  const requestId = data.clientRequestId
  if (!question || typeof requestId !== 'string' || !uuid.test(requestId)) return aiError(c, url, 'invalid', 400)
  const db = c.env.DB
  const useStream = c.req.header('Accept')?.includes('text/event-stream')
  const hash = await hashQuestion(thread, question)
  const replay = (previous: NonNullable<Awaited<ReturnType<typeof previousRequest>>>) => {
    if (previous.payload_hash !== hash) return aiError(c, url, 'conflict', 409)
    if (previous.state === 'pending' && previous.lease_until > Date.now()) return aiError(c, url, 'pending', 409)
    if (!previous.question || !previous.answer) return aiError(c, url, 'gone', 409)
    const reply = { question: previous.question, answer: previous.answer }
    return useStream ? privateAiStream(c, stream => stream.writeSSE({ event: 'done', data: JSON.stringify(reply) })) :
      aiSuccess(c, url, reply)
  }

  let input: string
  let reserve: number
  try {
    const previous = await previousRequest(db, thread.userId, requestId, Date.now())
    if (previous) return replay(previous)
    input = buildInput(exam, item, attempt.choice, await recentTurns(db, thread, Date.now()), question)
    reserve = estimatedCost(config, input)
    const reserved = await reserveRequest(db, { ...thread, id: requestId, hash, now: Date.now(), reserve, promptVersion }, config)
    if (!reserved) {
      const raced = await previousRequest(db, thread.userId, requestId, Date.now())
      return raced ? replay(raced) : aiError(c, url, 'quota', 429)
    }
  } catch {
    return aiError(c, url, 'storage', 503)
  }

  if (!useStream) {
    const result = await completeQuestion(db, thread, requestId, question, input, reserve, config, c.req.raw.signal)
    return 'reply' in result ? aiSuccess(c, url, result.reply) :
      aiError(c, url, result.problem, result.problem === 'provider' ? 502 : 503)
  }

  return privateAiStream(c, async stream => {
    const controller = new AbortController()
    stream.onAbort(() => controller.abort())
    const signal = AbortSignal.any([c.req.raw.signal, controller.signal])
    const result = await completeQuestion(db, thread, requestId, question, input, reserve, config, signal,
      text => stream.writeSSE({ event: 'delta', data: JSON.stringify({ text }) }))
    if (!stream.aborted) await stream.writeSSE('reply' in result
      ? { event: 'done', data: JSON.stringify(result.reply) }
      : { event: 'error', data: JSON.stringify({ code: result.problem, error: aiMessages[result.problem] }) })
  })
})

study.post('/sessions/:id/items/:position/ai/clear', async c => {
  if (!openAIConfig(c.env)) return c.notFound()
  const target = await aiTarget(c, c.req.param('id'), Number(c.req.param('position')))
  if (!target) return c.notFound()
  if (!target.attempt) return pageError(c, 403, '回答を確定してから会話を削除できます。')
  if (!await clearThread(c.env.DB, target.thread, Date.now())) return aiError(c, target.url, 'pending', 409)
  return jsonRequested(c) ? c.json({ deleted: true }) : c.redirect(`${target.url}#ai`, 303)
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
