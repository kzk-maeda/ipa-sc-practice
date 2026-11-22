import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import test from 'node:test'
import { type AppEnv } from '../src/auth/access'
import { pruneAi, reserveRequest } from '../src/ai/store'
import { openAIConfig } from '../src/ai/config'
import { app } from '../src/index'

function database() {
  const sqlite = new DatabaseSync(':memory:')
  for (const migration of ['0001_study', '0002_session_initial_attempt', '0003_ai_requests']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}.sql`, import.meta.url), 'utf8'))
  }
  const prepare = (sql: string, values: SQLInputValue[] = []) => ({
    bind: (...bound: SQLInputValue[]) => prepare(sql, bound),
    get: () => sqlite.prepare(sql).get(...values) ?? null,
    rows: () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  })
  const db = {
    prepare: (sql: string) => {
      const statement = prepare(sql)
      return {
        ...statement,
        bind: (...values: SQLInputValue[]) => {
          const bound = prepare(sql, values)
          return { ...bound, first: bound.get, all: bound.rows, sql }
        },
      }
    },
    batch: async (statements: Array<ReturnType<typeof prepare> & { sql: string }>) => {
      sqlite.exec('BEGIN')
      try {
        const results = statements.map(statement => statement.sql.trimStart().startsWith('SELECT') ? statement.rows() : statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
  return { sqlite, db }
}

const origin = 'http://localhost'
const sessionId = 'aa17250f-b890-4475-9b01-57c765c15df1'
const path = `/sessions/${sessionId}/items/1`
const settings = { APP_ENV: 'local', AI_MODE: 'openai', OPENAI_API_KEY: 'test-only' }

function seed(sqlite: DatabaseSync, id = sessionId, user = 'local-learner', booklet = false) {
  const form = booklet ? 'a2:2020:october' : 'a1:2025:spring'
  const version = booklet ? 'a2-2020-october-v1' : '2025-spring-v1'
  sqlite.prepare('INSERT INTO study_sessions (id, user_id, form_id, corpus_version, started_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, user, form, version, '2026-11-22T00:00:00Z')
}

function upstream(text = '<script>学習メモ</script>') {
  const records = [
    { type: 'response.output_text.delta', delta: text.slice(0, 9) },
    { type: 'response.output_text.delta', delta: text.slice(9) },
    { type: 'response.completed', response: { usage: { input_tokens: 37, output_tokens: 12 } } },
  ]
  const bytes = new TextEncoder().encode(records.map(record => `data: ${JSON.stringify(record)}\r\n\r\n`).join(''))
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
      controller.close()
    },
  }))
}

test('Responses API is gated by the submitted answer, streams and replays, and stores scoped context', async t => {
  const { sqlite, db } = database()
  t.after(() => sqlite.close())
  seed(sqlite)
  const foreign = crypto.randomUUID()
  const booklet = crypto.randomUUID()
  seed(sqlite, foreign, 'different-learner')
  seed(sqlite, booklet, 'local-learner', true)

  const requests: Record<string, unknown>[] = []
  let fail = false
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    const expected = new Headers(init.headers)
    assert.equal(expected.get('authorization'), 'Bearer test-only')
    assert.equal(init.redirect, 'manual')
    requests.push(JSON.parse(String(init.body)))
    return fail ? new Response('', { status: 503 }) : upstream()
  })

  const env: AppEnv['Bindings'] = { ...settings, DB: db, ASSETS: { fetch: async () => new Response() } }
  const post = (url: string, input: unknown = {}, accept = 'application/json') =>
    app.request(origin + url, {
      method: 'POST', headers: { Origin: origin, Accept: accept, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }, env)
  const id = crypto.randomUUID()
  const request = { clientRequestId: id, question: '途中の計算を教えてください。' }
  assert.equal((await post(path + '/ai', request)).status, 403)
  assert.equal((await post(`/sessions/${foreign}/items/1/ai`, request)).status, 404)
  assert.equal((await post(`/sessions/${booklet}/items/1/ai`, request)).status, 404)
  assert.equal(requests.length, 0)
  assert.equal((await post(path + '/answer', { choice: 'イ', clientAttemptId: crypto.randomUUID() })).status, 200)
  assert.equal((await post(path + '/ai', { ...request, question: 'あ'.repeat(1501) })).status, 400)

  const stream = await post(path + '/ai', request, 'text/event-stream')
  assert.equal(stream.headers.get('Cache-Control'), 'private, no-store')
  assert.match(stream.headers.get('Content-Type')!, /text\/event-stream/)
  const streamed = await stream.text()
  assert.match(streamed, /event: delta/)
  assert.match(streamed, /event: done/)
  assert.equal(requests[0].store, false)
  assert.equal(requests[0].model, 'gpt-4.1-mini')
  assert.equal(requests[0].max_output_tokens, 800)
  assert.equal(requests[0].tools, undefined)
  assert.doesNotMatch(String(requests[0].input), /local-learner/)
  const details = JSON.parse(String(requests[0].input))
  assert.equal(details.教材.公式正答, 'ア')
  assert.equal(details.教材.利用者の回答, 'イ')
  assert.equal(details.質問, request.question)
  assert.deepEqual(details.直近の会話, [])
  const accounting = sqlite.prepare('SELECT state, input_tokens, output_tokens, charged_micros, reserved_micros FROM ai_requests WHERE id = ?').get(id)!
  assert.equal(accounting.state, 'complete')
  assert.equal(accounting.input_tokens, 37)
  assert.equal(accounting.output_tokens, 12)
  assert.ok(Number(accounting.charged_micros) < Number(accounting.reserved_micros))

  const replay = await post(path + '/ai', request)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json() as { answer: string }).answer, '<script>学習メモ</script>')
  assert.equal(requests.length, 1)
  assert.equal((await post(path + '/ai', { ...request, question: '別の質問' })).status, 409)

  const follow = { clientRequestId: crypto.randomUUID(), prompt: 'reason' }
  assert.equal((await post(path + '/ai', follow)).status, 200)
  assert.equal(JSON.parse(String(requests[1].input)).直近の会話[0].質問, request.question)
  const page = await app.request(origin + path, {}, env)
  assert.match(await page.text(), /&lt;script&gt;学習メモ&lt;\/script&gt;/)

  fail = true
  assert.equal((await post(path + '/ai', { clientRequestId: crypto.randomUUID(), prompt: 'approach' })).status, 502)
  const failed = sqlite.prepare("SELECT charged_micros, reserved_micros FROM ai_requests WHERE state = 'failed'").get()!
  assert.equal(failed.charged_micros, failed.reserved_micros)
  assert.equal((await post(path + '/ai/clear')).status, 200)
  assert.equal((await post(path + '/ai', request)).status, 409)
  assert.equal(sqlite.prepare('SELECT COUNT(question) AS n FROM ai_requests').get()!.n, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM attempts').get()!.n, 1)
})

test('reservations enforce one request at a time, a JST daily limit and a shared monthly budget', async t => {
  const { sqlite, db } = database()
  t.after(() => sqlite.close())
  const start = Date.parse('2026-11-30T14:57:00Z')
  const config = openAIConfig({ ...settings, AI_DAILY_LIMIT: '1', AI_MONTHLY_BUDGET_USD: '0.01' })!
  const reserve = (userId: string, now: number, micros = 6000) => reserveRequest(db, {
    userId, now, sessionId, position: 1, reserve: micros, id: crypto.randomUUID(), hash: 'test', promptVersion: 1,
  }, config)
  assert.deepEqual(await Promise.all([reserve('one', start), reserve('one', start)]), [true, false])
  assert.equal(await reserve('one', start + 120_000, 1000), false)
  assert.equal(await reserve('two', start, 5000), false)
  assert.equal(await reserve('two', start, 4000), true)
  assert.equal(await reserve('one', start + 180_000), true)

  sqlite.prepare("UPDATE ai_requests SET state = 'complete', question = '質問', answer = '回答', finished_at = ?")
    .run(start)
  await pruneAi(db, start + 30 * 86_400_000)
  assert.equal(sqlite.prepare('SELECT COUNT(question) AS n FROM ai_requests').get()!.n, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_requests').get()!.n, 3)
})
