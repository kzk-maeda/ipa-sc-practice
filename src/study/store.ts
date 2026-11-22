import { grade, subjects, type Choice, type Item, type Category, type ExamForm, type Subject } from '../corpus/catalog'
import { progressRules } from './progress'

export const unclassified = 'unclassified'
export type Confidence = 'sure' | 'unsure'
export type Session = { id: string; form_id: string; corpus_version: string; initial_attempt_id: string | null }
export type Attempt = {
  session_id: string
  position: number
  item_id: string
  item_group: string
  category: Category | typeof unclassified
  choice: Choice
  confidence: Confidence | null
  correct: 0 | 1
  client_attempt_id: string
  answered_at: string
}
export type Submission = { choice: Choice; confidence: Confidence | null; clientAttemptId: string }

export function openSession(db: D1Database, user: string, id: string) {
  return db.prepare('SELECT id, form_id, corpus_version, initial_attempt_id FROM study_sessions WHERE user_id = ? AND id = ?')
    .bind(user, id).first<Session>()
}

export async function latestSessions(db: D1Database, user: string) {
  const { results } = await db.prepare(`
    WITH ranked AS (
      SELECT id, form_id, corpus_version, initial_attempt_id, started_at, rowid AS sequence,
        ROW_NUMBER() OVER (PARTITION BY form_id, corpus_version ORDER BY started_at DESC, rowid DESC) AS session_rank
      FROM study_sessions WHERE user_id = ?
    )
    SELECT id, form_id, corpus_version, initial_attempt_id FROM ranked
    WHERE session_rank = 1 ORDER BY started_at DESC, sequence DESC`).bind(user).all<Session>()
  return results
}

function sessionInsert(db: D1Database, user: string, id: string, exam: ExamForm, now: string, initialAttemptId: string | null) {
  return db.prepare(`
    INSERT INTO study_sessions (id, user_id, form_id, corpus_version, started_at, initial_attempt_id)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, user, exam.id, exam.version, now, initialAttemptId)
}

function attemptInsert(db: D1Database, user: string, session: string, exam: ExamForm, item: Item, data: Submission, now: string, starting = false) {
  return db.prepare(`
    INSERT INTO attempts (
      session_id, position, item_id, item_group, category, choice, confidence, correct, client_attempt_id, answered_at
    )
    SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM study_sessions
    WHERE id = ? AND user_id = ? AND form_id = ? AND corpus_version = ?
      AND (? = 0 OR initial_attempt_id = ?)
    ON CONFLICT DO NOTHING`)
    .bind(item.number, item.id, item.group, item.format === 'text' ? item.category : unclassified, data.choice, data.confidence,
      Number(grade(item, data.choice)), data.clientAttemptId, now, session, user, exam.id, exam.version, Number(starting), data.clientAttemptId)
}

async function matchingAttempt(db: D1Database, user: string, session: string, item: Item, data: Submission) {
  const attempt = await db.prepare(`
    SELECT a.* FROM attempts a JOIN study_sessions s ON s.id = a.session_id
    WHERE s.user_id = ? AND s.id = ? AND a.position = ?`)
    .bind(user, session, item.number).first<Attempt>()
  if (attempt?.client_attempt_id === data.clientAttemptId &&
    attempt.choice === data.choice && attempt.confidence === data.confidence) return attempt
  return null
}

export async function createSession(db: D1Database, user: string, id: string, exam: ExamForm, initial?: Submission) {
  const now = new Date().toISOString()
  const create = sessionInsert(db, user, id, exam, now, initial?.clientAttemptId ?? null)
  if (!initial) {
    await create.run()
    const session = await openSession(db, user, id)
    return session?.form_id === exam.id && session.corpus_version === exam.version && session.initial_attempt_id === null
  }
  const item = exam.items[0]
  await db.batch([create, attemptInsert(db, user, id, exam, item, initial, now, true)])
  const session = await openSession(db, user, id)
  if (session?.form_id !== exam.id || session.corpus_version !== exam.version ||
      session.initial_attempt_id !== initial.clientAttemptId) return null
  return matchingAttempt(db, user, id, item, initial)
}

export async function saveAttempt(db: D1Database, user: string, session: string, exam: ExamForm, item: Item, data: Submission) {
  await attemptInsert(db, user, session, exam, item, data, new Date().toISOString()).run()
  return matchingAttempt(db, user, session, item, data)
}

export async function sessionAttempts(db: D1Database, user: string, session: string) {
  const { results } = await db.prepare(`
    SELECT a.* FROM attempts a JOIN study_sessions s ON s.id = a.session_id
    WHERE s.user_id = ? AND s.id = ? ORDER BY a.position`).bind(user, session).all<Attempt>()
  return results
}

export async function progressData(db: D1Database, user: string, subject: Subject) {
  const cutoff = new Date(Date.now() - progressRules.days * 86_400_000).toISOString()
  const subjectPattern = `${subjects[subject].slug}:*`
  const attempts = 'FROM attempts a JOIN study_sessions s ON s.id = a.session_id WHERE s.user_id = ? AND s.form_id GLOB ?'
  const [evidence, history, totals, marks] = await db.batch([
    db.prepare(`
      WITH latest AS (
        SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.category, a.item_group ORDER BY a.answered_at DESC, a.rowid DESC) AS answer_rank
        ${attempts} AND a.answered_at >= ? AND a.category <> ?
      ), samples AS (
        SELECT latest.*, ROW_NUMBER() OVER (PARTITION BY category ORDER BY answered_at DESC, session_id DESC, position DESC) AS sample_rank
        FROM latest WHERE answer_rank = 1
      )
      SELECT * FROM samples WHERE sample_rank <= ? ORDER BY answered_at DESC, session_id DESC, position DESC`)
      .bind(user, subjectPattern, cutoff, unclassified, progressRules.maxPerCategory),
    db.prepare(`SELECT a.* ${attempts} ORDER BY a.answered_at DESC, a.rowid DESC LIMIT 30`).bind(user, subjectPattern),
    db.prepare(`SELECT COUNT(*) AS answered, COALESCE(SUM(a.correct), 0) AS correct ${attempts} AND a.answered_at >= ?`)
      .bind(user, subjectPattern, cutoff),
    db.prepare('SELECT item_group FROM review_marks WHERE user_id = ? AND item_group GLOB ?').bind(user, subjectPattern),
  ])
  return {
    evidence: evidence.results as Attempt[],
    history: history.results as Attempt[],
    stats: totals.results[0] as { answered: number; correct: number },
    marks: new Set((marks.results as { item_group: string }[]).map(row => row.item_group)),
  }
}

export async function isMarked(db: D1Database, user: string, group: string) {
  return Boolean(await db.prepare('SELECT 1 FROM review_marks WHERE user_id = ? AND item_group = ?').bind(user, group).first())
}

export async function setMark(db: D1Database, user: string, group: string, marked: boolean) {
  const sql = marked ? 'INSERT OR IGNORE INTO review_marks (user_id, item_group) VALUES (?, ?)' :
    'DELETE FROM review_marks WHERE user_id = ? AND item_group = ?'
  await db.prepare(sql).bind(user, group).run()
}
