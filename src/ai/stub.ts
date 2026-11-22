import { choices, type TextItem } from '../corpus/catalog'

export type StubPrompt = 'reason' | 'approach'

export function stubReply(item: TextItem, prompt: StubPrompt) {
  if (prompt === 'reason') return item.explanation
  const correctText = item.options[choices.indexOf(item.correct)]
  return `問題文が求める条件を拾い、各選択肢と照らし合わせます。公式正答の「${item.correct}」は「${correctText}」です。\n\n${item.explanation}`
}
