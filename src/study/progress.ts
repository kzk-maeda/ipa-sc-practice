import { subjectCategories, type Category, type Subject } from '../corpus/catalog'
import type { Attempt } from './store'

export const progressRules = { days: 90, maxPerCategory: 20, minSamples: 3, threshold: 0.4 } as const

export function summarize(attempts: Attempt[], marks: ReadonlySet<string>, subject: Subject) {
  return Object.entries(subjectCategories[subject]).map(([key, category]) => {
    const evidence = attempts.filter(attempt => attempt.category === key)
    const wrong = evidence.filter(attempt => !attempt.correct).length
    const unsure = evidence.filter(attempt => attempt.correct && attempt.confidence === 'unsure').length
    const sampleSize = evidence.length
    const score = (wrong + 0.5 * unsure) / (sampleSize || 1)
    return {
      key: key as Category, ...category, evidence, wrong, unsure, sampleSize, score: sampleSize ? score : null,
      marked: evidence.filter(attempt => marks.has(attempt.item_group)).length,
      status: sampleSize < progressRules.minSamples ? 'データ不足' :
        score >= progressRules.threshold ? '要対策' : '安定',
    }
  })
}
