import { responseTimeoutMs, type OpenAIConfig } from './config'
import { costMicros, explain } from './responses'
import { finishRequest, type AiTurn, type Thread } from './store'

export const aiMessages = {
  invalid: '1,500文字以内の質問を入力してください。',
  config: 'AIの設定を確認してください。',
  quota: 'AIの利用枠に達したか、別の質問に回答中です。時間をおいてお試しください。',
  pending: 'この質問に回答中です。時間をおいてお試しください。',
  conflict: '同じ送信IDで異なる質問を送れません。画面を開き直してください。',
  gone: 'この応答は再表示できません。新しい質問として送信してください。',
  provider: 'AIの応答を受け取れませんでした。時間をおいてお試しください。',
  storage: 'AIの応答を保存できませんでした。再度お試しください。',
} as const
export type AiProblem = keyof typeof aiMessages
export type AiReply = AiTurn & { incomplete?: boolean }

export type AiPanel =
  | { mode: 'stub'; hint?: import('./stub').StubPrompt }
  | { mode: 'openai'; turns: AiTurn[]; notice?: string }

export async function completeQuestion(
  db: D1Database, thread: Thread, id: string, question: string, input: string, reserve: number,
  config: OpenAIConfig, requestSignal: AbortSignal, onDelta?: (delta: string) => Promise<void>,
): Promise<{ reply: AiReply } | { problem: 'provider' | 'storage' }> {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(responseTimeoutMs)])
  let result: Awaited<ReturnType<typeof explain>>
  try {
    result = await explain(config, input, signal, onDelta)
  } catch {
    try {
      const saved = await finishRequest(db, thread.userId, id, Date.now(), null, null, reserve)
      return { problem: saved ? 'provider' : 'storage' }
    } catch {
      // An expired lease still retains its reservation for this month's budget.
      return { problem: 'storage' }
    }
  }

  const reply = { question, answer: result.answer, incomplete: result.incomplete }
  const micros = result.usage ? costMicros(config, result.usage) : reserve
  try {
    const saved = await finishRequest(db, thread.userId, id, Date.now(), reply, result.usage, micros)
    return saved ? { reply } : { problem: 'storage' }
  } catch {
    return { problem: 'storage' }
  }
}
