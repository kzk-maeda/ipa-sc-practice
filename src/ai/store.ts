import { historyLimit, leaseMs, type OpenAIConfig } from './config'

const contentLifetime = 30 * 86_400_000
const usageLifetime = 90 * 86_400_000

export type Thread = { userId: string; sessionId: string; position: number }
export type AiTurn = { question: string; answer: string }
export type Usage = { input: number; output: number }
type Reservation = Thread & {
  id: string
  hash: string
  now: number
  reserve: number
  promptVersion: number
}

function periods(now: number) {
  const day = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10)
  return { day, month: day.slice(0, 7) }
}

export async function hashQuestion(thread: Thread, question: string) {
  const payload = new TextEncoder().encode(JSON.stringify([thread.sessionId, thread.position, question]))
  const digest = await crypto.subtle.digest('SHA-256', payload)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function previousRequest(db: D1Database, userId: string, id: string, now: number) {
  return db.prepare(`
    SELECT payload_hash, state, lease_until,
      CASE WHEN finished_at > ? THEN question END AS question,
      CASE WHEN finished_at > ? THEN answer END AS answer
    FROM ai_requests WHERE user_id = ? AND id = ?`)
    .bind(now - contentLifetime, now - contentLifetime, userId, id)
    .first<{ payload_hash: string; state: 'pending' | 'complete' | 'failed'; lease_until: number; question: string | null; answer: string | null }>()
}

export async function recentTurns(db: D1Database, thread: Thread, now: number) {
  const { results } = await db.prepare(`
    SELECT question, answer FROM ai_requests
    WHERE user_id = ? AND session_id = ? AND position = ? AND finished_at > ? AND question IS NOT NULL
    ORDER BY finished_at DESC, rowid DESC LIMIT ?`)
    .bind(thread.userId, thread.sessionId, thread.position, now - contentLifetime, historyLimit).all<AiTurn>()
  return results.reverse()
}

export async function reserveRequest(db: D1Database, request: Reservation, config: OpenAIConfig) {
  const { userId, sessionId, position, id, hash, now, reserve, promptVersion } = request
  const { day, month } = periods(now)
  // D1 serializes this write, including the checks, across simultaneous requests.
  const { meta } = await db.prepare(`
    INSERT INTO ai_requests (
      user_id, id, session_id, position, payload_hash, model, prompt_version, state,
      started_at, lease_until, day, month, reserved_micros
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM ai_requests WHERE user_id = ? AND state = 'pending' AND lease_until > ?
    )
    AND (SELECT COUNT(*) FROM ai_requests WHERE user_id = ? AND day = ?) < ?
    AND (SELECT COALESCE(SUM(COALESCE(charged_micros, reserved_micros)), 0) FROM ai_requests WHERE month = ?) + ? <= ?
    ON CONFLICT(user_id, id) DO NOTHING`)
    .bind(userId, id, sessionId, position, hash, config.model, promptVersion, now, now + leaseMs, day, month, reserve,
      userId, now, userId, day, config.dailyLimit, month, reserve, config.monthlyBudgetMicros).run()
  return meta.changes === 1
}

export async function finishRequest(
  db: D1Database, userId: string, id: string, now: number, result: AiTurn | null, usage: Usage | null, micros: number,
) {
  const { meta } = await db.prepare(`
    UPDATE ai_requests SET state = ?, finished_at = ?, question = ?, answer = ?,
      input_tokens = ?, output_tokens = ?, charged_micros = ?
    WHERE user_id = ? AND id = ? AND state = 'pending' AND lease_until > ?`)
    .bind(result ? 'complete' : 'failed', now, result?.question ?? null, result?.answer ?? null,
      usage?.input ?? null, usage?.output ?? null, micros, userId, id, now).run()
  return meta.changes === 1
}

export async function clearThread(db: D1Database, thread: Thread, now: number) {
  const { userId, sessionId, position } = thread
  const selector = 'user_id = ? AND session_id = ? AND position = ?'
  const [active] = await db.batch([
    db.prepare(`SELECT 1 FROM ai_requests WHERE ${selector} AND state = 'pending' AND lease_until > ? LIMIT 1`)
      .bind(userId, sessionId, position, now),
    db.prepare(`UPDATE ai_requests SET question = NULL, answer = NULL
      WHERE ${selector} AND question IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ai_requests WHERE ${selector} AND state = 'pending' AND lease_until > ?)`)
      .bind(userId, sessionId, position, userId, sessionId, position, now),
  ])
  return active.results.length === 0
}

export async function pruneAi(db: D1Database, now: number) {
  await db.batch([
    db.prepare('DELETE FROM ai_requests WHERE started_at <= ?').bind(now - usageLifetime),
    db.prepare('UPDATE ai_requests SET question = NULL, answer = NULL WHERE finished_at <= ? AND question IS NOT NULL')
      .bind(now - contentLifetime),
  ])
}
