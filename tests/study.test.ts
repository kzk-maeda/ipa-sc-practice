import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { choices, defaultExam, exams, getExam, getItem, getItemById, grade, subjectCategories } from '../src/corpus/catalog'
import { summarize } from '../src/study/progress'
import { unclassified, type Attempt } from '../src/study/store'

test('the catalog covers 33 A-1 editions and 17 SC A-2 editions with separate, sourced question IDs', () => {
  assert.equal(exams.length, 50)
  assert.equal(new Set(exams.map(exam => exam.id)).size, 50)
  assert.equal(new Set(exams.flatMap(exam => exam.items.map(item => item.id))).size, 1415)
  const a1 = exams.filter(exam => exam.subject === 'A-1')
  const a2 = exams.filter(exam => exam.subject === 'A-2')
  assert.equal(a1.length, 33)
  assert.equal(a2.length, 17)
  assert.deepEqual(a2.filter(exam => exam.year === 2020).map(exam => exam.period), ['10月'])
  const periods = (year: number) => a1.filter(exam => exam.year === year).map(exam => exam.period).sort()
  assert.deepEqual(periods(2011), ['特別', '秋期'].sort())
  assert.deepEqual(periods(2020), ['10月'])
  assert.match(getExam('a1:2019:spring')!.officialTitle, /^平成31年度/)
  assert.match(getExam('a1:2019:autumn')!.officialTitle, /^令和元年度/)
  assert.equal(getExam('a1:2026:spring'), undefined)
  assert.equal(getExam('a2:2026:spring'), undefined)
  assert.equal(getExam('a2:2016:autumn'), undefined)
  assert.match(getExam('a2:2019:spring')!.officialTitle, /^平成31年度/)
  assert.match(getExam('a2:2019:autumn')!.officialTitle, /^令和元年度/)
  assert.equal(getExam('a2:2025:autumn')?.items[0].correct, 'ウ')
  assert.equal(getExam('a2:2020:october')?.items[24].page, 16)
  assert.equal(getExam('a1:2011:special')?.items[0].page, 3)
  assert.equal(getExam('a1:2020:october')?.items[29].page, 15)
  assert.equal(getExam('a1:2009:spring')?.items[13].page, 8)
  assert.equal(getExam(defaultExam.id, 'missing-revision'), undefined)

  for (const exam of exams) {
    const a2 = exam.subject === 'A-2'
    assert.equal(exam.items.length, a2 ? 25 : 30)
    assert.equal(exam.questionCount, exam.items.length)
    assert.equal(exam.durationMinutes, a2 ? 40 : 50)
    if (a2) assert.match(exam.questions.url, /_sc_am2_qs\.pdf$/)
    assert.match(exam.questions.url, /^https:\/\/www\.ipa\.go\.jp\//)
    assert.match(exam.questions.sha256, /^[0-9a-f]{64}$/)
    assert.match(exam.answers.sha256, /^[0-9a-f]{64}$/)
    for (const [index, item] of exam.items.entries()) {
      assert.equal(item.format, exam.format)
      assert.equal(item.number, index + 1)
      assert.equal(getItem(exam, item.number), item)
      assert.ok(Number.isInteger(item.page) && item.page >= 3)
      if (index > 0) assert.ok(item.page >= exam.items[index - 1].page)
      assert.equal(getItemById(item.id)?.form, exam)
      assert.equal(choices.filter(choice => grade(item, choice)).length, 1)
      if (item.format !== 'text') continue
      assert.ok(item.page >= (a2 ? 3 : 4) && item.page <= 16)
      assert.ok(Object.hasOwn(subjectCategories[exam.subject], item.category))
      assert.equal(item.options.length, 4)
      assert.ok(item.options.every(Boolean))
      assert.ok(item.prompt && item.explanation)
      if (item.figure) {
        assert.ok(item.figure.caption)
        assert.ok(existsSync(new URL(`../public/questions/${exam.version}/${item.figure.path}`, import.meta.url)))
      }
    }
  }
  assert.deepEqual(exams.filter(exam => exam.format === 'text').map(exam => exam.id), ['a1:2025:autumn', 'a1:2025:spring', 'a2:2025:autumn'])
  for (const position of [0, -1, 1.5, 31, NaN, Infinity]) assert.equal(getItem(defaultExam, position), undefined)
})

function attempt(position: number, correct: 0 | 1, confidence: Attempt['confidence'] = null): Attempt {
  const item = defaultExam.items[position - 1]
  return {
    session_id: 'test', position, item_id: item.id, item_group: item.group,
    category: item.format === 'text' ? item.category : unclassified, choice: 'ア', confidence, correct,
    client_attempt_id: String(position), answered_at: '2025-04-20T00:00:00.000Z',
  }
}

test('a wrong answer and an unsure correct one give a weakness score of 0.5 across three groups', () => {
  const evidence = [attempt(1, 0), attempt(2, 1, 'unsure'), attempt(3, 1)]
  const theory = summarize(evidence, new Set([evidence[0].item_group]), 'A-1').find(c => c.key === 'theory')!
  assert.equal(theory.sampleSize, 3)
  assert.equal(theory.score, 0.5)
  assert.equal(theory.status, '要対策')
  assert.equal(theory.marked, 1)
})

test('a sparse category is labelled data-insufficient', () => {
  const theory = summarize([attempt(1, 0)], new Set(), 'A-1').find(c => c.key === 'theory')!
  assert.equal(theory.sampleSize, 1)
  assert.equal(theory.status, 'データ不足')
})

test('booklet-only attempts do not affect category samples', () => {
  const summaries = summarize([{ ...attempt(1, 0), category: unclassified }], new Set(), 'A-2')
  assert.ok(summaries.every(category => category.sampleSize === 0))
})
