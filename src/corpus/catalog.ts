import spring from './2025-spring-source.json'
import autumnItems from './2025-autumn-items'
import springItems from './2025-spring-items'
import a1Sources from './a1-sources.json'
import a2Sources from './a2-sources.json'
import a2AutumnItems from './a2-2025-autumn-items'

export const choices = ['ア', 'イ', 'ウ', 'エ'] as const
export type Choice = typeof choices[number]

export const subjects = {
  'A-1': { slug: 'a1', label: '午前Ⅰ', examName: '高度試験共通' },
  'A-2': { slug: 'a2', label: '午前Ⅱ', examName: '情報処理安全確保支援士試験' },
} as const
export type Subject = keyof typeof subjects

export function parseSubject(slug: string | undefined): Subject {
  return slug === subjects['A-2'].slug ? 'A-2' : 'A-1'
}

const a1Categories = {
  theory: { label: '基礎理論・アルゴリズム', field: 'テクノロジ系' },
  systems: { label: 'コンピュータシステム', field: 'テクノロジ系' },
  database: { label: 'データベース', field: 'テクノロジ系' },
  network: { label: 'ネットワーク', field: 'テクノロジ系' },
  security: { label: 'セキュリティ', field: 'テクノロジ系' },
  development: { label: 'システム開発', field: 'テクノロジ系' },
  project: { label: 'プロジェクト管理', field: 'マネジメント系' },
  service: { label: 'サービス管理', field: 'マネジメント系' },
  audit: { label: 'システム監査', field: 'マネジメント系' },
  strategy: { label: '経営・システム戦略', field: 'ストラテジ系' },
  business: { label: 'ビジネスインダストリ', field: 'ストラテジ系' },
  legal: { label: '企業活動・法務', field: 'ストラテジ系' },
} as const
const a2Categories = {
  auth_crypto: { label: '認証・暗号', field: 'セキュリティ' },
  network_defense: { label: 'ネットワーク・防御', field: 'テクノロジ系' },
  secure_development: { label: 'セキュア開発', field: 'テクノロジ系' },
  incident_response: { label: '監視・インシデント対応', field: 'セキュリティ' },
  security_operations: { label: 'システム運用・可用性', field: 'マネジメント系' },
  governance: { label: 'ガバナンス・監査・法務', field: 'マネジメント系' },
} as const

export const categories = { ...a1Categories, ...a2Categories }
export const subjectCategories = { 'A-1': a1Categories, 'A-2': a2Categories }
export type Category = keyof typeof categories

export type ItemContent = {
  number: number
  page: number
  category: Category
  title: string
  prompt: string
  detail?: string
  options: [string, string, string, string]
  explanation: string
  figure?: { path: string; caption: string; width?: number; height?: number }
}

type ItemBase = {
  id: string
  group: string
  number: number
  page: number
  correct: Choice
}

export type TextItem = ItemBase & ItemContent & { format: 'text' }
type BookletItem = ItemBase & { format: 'booklet' }
export type Item = TextItem | BookletItem

type ExamSource = Omit<typeof spring, 'subject'> & { subject: Subject }
export type ExamForm = ExamSource & { items: Item[]; format: Item['format'] }

const reviewedContent = new Map<string, ItemContent[]>([
  [spring.id, springItems],
  ['a1:2025:autumn', autumnItems],
  ['a2:2025:autumn', a2AutumnItems],
])

export const exams: ExamForm[] = [...a1Sources, ...a2Sources].map(source => {
  const subject = parseSubject(source.id.split(':')[0])
  if (source.subject !== subject) throw new Error(`Invalid exam subject ${source.id}`)
  const bibliography = source.id === spring.id ? spring : source
  const reviewed = reviewedContent.get(source.id)
  const items = bibliography.answers.choices.map((choice, index): Item => {
    const number = index + 1
    const id = `${source.id}:${number}`
    const base = { id, group: id, number, page: source.pages[index], correct: choice as Choice }
    if (!reviewed) return { ...base, format: 'booklet' }
    const text = reviewed[index]
    if (!text || text.number !== number || text.page !== base.page || !Object.hasOwn(subjectCategories[subject], text.category)) {
      throw new Error(`Invalid reviewed question ${id}`)
    }
    return { ...text, ...base, format: 'text' }
  })
  return { ...bibliography, subject, items, format: reviewed ? 'text' : 'booklet' }
})

const formsById = new Map(exams.map(form => [form.id, form]))
const byItemId = new Map(exams.flatMap(form => form.items.map(item => [item.id, { form, item }] as const)))

export const defaultExam = formsById.get(spring.id)!

export function getExam(id: unknown, version?: string) {
  const form = typeof id === 'string' ? formsById.get(id) : undefined
  return form && (version === undefined || form.version === version) ? form : undefined
}

export function getItem(form: ExamForm, number: number) {
  return Number.isSafeInteger(number) && number >= 1 ? form.items[number - 1] : undefined
}

export function getItemById(id: string) {
  return byItemId.get(id)
}

export function grade(item: Item, selected: Choice) {
  return item.correct === selected
}
