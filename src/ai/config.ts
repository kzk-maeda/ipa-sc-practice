export const maxQuestionLength = 1500
export const maxOutputTokens = 800
export const historyLimit = 6
export const responseTimeoutMs = 35_000
export const leaseMs = responseTimeoutMs + 45_000

export const presetQuestions = {
  reason: '公式正答が正しい理由を説明してください。',
  approach: 'この問題の解き方を順に説明してください。計算問題なら途中式も示してください。',
  alternatives: 'ほかの選択肢が適切でない理由をそれぞれ説明してください。',
} as const

export type AiBindings = {
  AI_MODE?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  AI_DAILY_LIMIT?: string
  AI_MONTHLY_BUDGET_USD?: string
  AI_INPUT_USD_PER_MILLION?: string
  AI_OUTPUT_USD_PER_MILLION?: string
}

export type OpenAIConfig = {
  apiKey: string
  model: string
  dailyLimit: number
  monthlyBudgetMicros: number
  inputRate: number
  outputRate: number
}

function positive(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : NaN
}

export function openAIConfig(env: AiBindings): OpenAIConfig | null {
  if (env.AI_MODE !== 'openai' || !env.OPENAI_API_KEY?.trim()) return null
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'
  const defaultPricing = model === 'gpt-4.1-mini'
  const inputRate = positive(env.AI_INPUT_USD_PER_MILLION, defaultPricing ? 0.4 : NaN)
  const outputRate = positive(env.AI_OUTPUT_USD_PER_MILLION, defaultPricing ? 1.6 : NaN)
  const dailyLimit = positive(env.AI_DAILY_LIMIT, 20)
  const monthlyBudgetMicros = Math.floor(positive(env.AI_MONTHLY_BUDGET_USD, 5) * 1_000_000)
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate) || !Number.isSafeInteger(dailyLimit) ||
    !Number.isSafeInteger(monthlyBudgetMicros) || monthlyBudgetMicros < 1) return null
  return { apiKey: env.OPENAI_API_KEY.trim(), model, inputRate, outputRate, dailyLimit, monthlyBudgetMicros }
}

export function questionText(input: Record<string, unknown>) {
  if (typeof input.prompt === 'string' && Object.hasOwn(presetQuestions, input.prompt)) {
    return presetQuestions[input.prompt as keyof typeof presetQuestions]
  }
  if (typeof input.question !== 'string') return null
  const question = input.question.trim()
  return question && [...question].length <= maxQuestionLength ? question : null
}
