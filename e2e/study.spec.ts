import { expect, test } from '@playwright/test'
import source from '../src/corpus/2025-spring-source.json' with { type: 'json' }
import a2Sources from '../src/corpus/a2-sources.json' with { type: 'json' }

test('WebKit renders the fresh first question and completes the 30-question form without JavaScript', async ({ page }) => {
  const initial = await page.goto('/')
  expect(await initial?.text()).toContain('単調に増加する連続関数')
  await expect(page.getByRole('heading', { name: '2025年 春期' })).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(4)
  await expect(page.getByText('公式正答', { exact: false })).toHaveCount(0)

  for (const [index, officialAnswer] of source.answers.choices.entries()) {
    await expect(page.locator('#question-title')).toContainText(String(index + 1).padStart(2, '0'))
    if (index === 2) {
      const zoom = page.getByRole('link', { name: '図表を拡大', exact: true })
      await expect(zoom).toBeVisible()
      const figure = await page.request.get((await zoom.getAttribute('href'))!)
      expect(figure.headers()['content-type']).toContain('image/webp')
      expect((await figure.body()).length).toBeGreaterThan(1000)
    }
    const choice = index === 0 ? 'イ' : officialAnswer
    const radio = page.getByRole('radio', { name: new RegExp(`^${choice}`) })
    if (index === 0) {
      await radio.focus()
      await page.keyboard.press('Space')
      await expect(radio).toBeChecked()
    } else {
      await radio.check()
    }
    if (index === 1) await page.getByLabel('自信度').selectOption('unsure')
    await page.getByRole('button', { name: '回答する' }).click()
    await expect(page.locator('#result-title')).toHaveText(index === 0 ? '不正解' : '正解')
    await expect(page.locator('.result-summary')).toContainText(`公式正答 ${officialAnswer}`)

    if (index === 0) {
      await page.getByRole('button', { name: 'なぜこの選択肢？' }).click()
      await expect(page.locator('.ai-answer')).toContainText('10 回で終了')
      await page.getByRole('button', { name: '要復習にする' }).click()
      await expect(page.getByRole('button', { name: '要復習を解除' })).toBeVisible()
      await page.goto('/catalog')
      await page.getByRole('link', { name: '続きから' }).click()
      continue
    }
    if (index < 29) await page.getByRole('link', { name: '次の問題' }).click()
  }

  await page.getByRole('link', { name: '演習結果を見る' }).click()
  await expect(page.getByRole('heading', { name: '演習結果' })).toBeVisible()
  await expect(page.locator('.stat').nth(0)).toContainText('30 / 30 問')
  await expect(page.locator('.stat').nth(1)).toContainText('29 問')
  await page.getByRole('link', { name: '学習記録を見る' }).click()
  await page.getByRole('link', { name: /基礎理論・アルゴリズム/ }).click()
  await expect(page.getByText('要対策', { exact: true })).toBeVisible()
  await expect(page.locator('#answers li')).toHaveCount(3)
  await expect(page.locator('#answers').getByText('要復習', { exact: true })).toBeVisible()
  await expect(page.locator('#answers').getByText('自信なし', { exact: true })).toBeVisible()
})

test('D1 protects fixed answers from stale writes and retains one latest sample per question', async ({ request, baseURL }) => {
  const headers = { Accept: 'application/json', Origin: baseURL! }
  const startSession = async () => {
    const id = crypto.randomUUID()
    const response = await request.post('/sessions', { headers, data: { formId: source.id, clientSessionId: id } })
    expect(response.ok()).toBe(true)
    return id
  }
  const sameId = crypto.randomUUID()
  const firstAnswer = { clientSessionId: sameId, choice: 'イ', clientAttemptId: crypto.randomUUID() }
  const firstForm = await request.post('/sessions', { headers, data: { ...firstAnswer, formId: source.id } })
  expect(firstForm.ok()).toBe(true)
  const changedForm = await request.post('/sessions', { headers, data: { ...firstAnswer, formId: 'a1:2025:autumn' } })
  expect(changedForm.status()).toBe(409)

  const previous = await startSession()
  for (const [position, choice, confidence] of [[1, 'イ', null], [2, 'イ', 'unsure'], [3, 'ウ', null]]) {
    const response = await request.post(`/sessions/${previous}/items/${position}/answer`, {
      headers, data: { choice, confidence, clientAttemptId: crypto.randomUUID() },
    })
    expect(response.ok()).toBe(true)
  }
  const id = await startSession()
  const conflictingStart = await request.post('/sessions', {
    headers, data: { formId: source.id, clientSessionId: id, choice: 'ア', clientAttemptId: crypto.randomUUID() },
  })
  expect(conflictingStart.status()).toBe(409)
  const path = `/sessions/${id}/items/1`
  const before = await request.get(`${path}?hint=reason`)
  expect(await before.text()).not.toContain('10 回で終了')
  const premature = await request.post(`${path}/ai`, { headers, data: { prompt: 'reason' } })
  expect(premature.status()).toBe(403)

  const data = { choice: 'ア', clientAttemptId: crypto.randomUUID() }
  const requestAnswer = (answer: typeof data) => request.post(`${path}/answer`, { headers, data: answer })
  const [first, retry] = await Promise.all([requestAnswer(data), requestAnswer(data)])
  expect(first.ok()).toBe(true)
  expect(await retry.json()).toEqual(await first.json())
  expect((await requestAnswer({ ...data, choice: 'イ' })).status()).toBe(409)
  expect((await requestAnswer({ ...data, clientAttemptId: crypto.randomUUID() })).status()).toBe(409)
  expect((await request.post(`/sessions/${id}/items/2/answer`, { headers, data })).status()).toBe(409)

  const foreign = await request.post(`/sessions/${id}/items/2/answer`, {
    headers: { Origin: 'https://example.com' }, form: { ...data, clientAttemptId: crypto.randomUUID() },
  })
  expect(foreign.status()).toBe(403)
  const latest = await request.get('/progress?category=theory')
  const text = await latest.text()
  expect(text).toContain('3 問')
  expect(text).toContain('誤答 0 ・ 自信なしの正解 1')
  expect(text).toContain('安定')
})

test('the year catalog starts an older official booklet, grades it, and preserves its own resume and history', async ({ page }) => {
  await page.route('**/booklets/**', route => route.fulfill({ status: 204 }))
  await page.goto('/catalog')
  await page.getByLabel('年度').selectOption('2011')
  await page.getByRole('button', { name: '表示', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2011年 秋期' })).toBeVisible()
  const special = page.locator('.catalog-row').filter({ has: page.getByRole('heading', { name: '2011年 特別' }) })
  await special.getByRole('button', { name: '演習を始める' }).click()
  await expect(page.getByRole('heading', { name: '2011年 特別' })).toBeVisible()
  const booklet = page.getByRole('link', { name: 'IPAの原本を開く' })
  await expect(booklet).toHaveAttribute('href', /2011h23tokubetsu_koudo_am1_qs\.pdf#page=3$/)
  await expect(booklet).not.toHaveAttribute('target', '_blank')
  await expect(page.locator('#question-booklet iframe')).toHaveAttribute('src', /\/booklets\/[^#]+#page=3&view=FitH$/)
  await expect(page.getByText('公式正答', { exact: false })).toHaveCount(0)
  const firstQuestion = page.url()
  await page.getByRole('radio', { name: 'エ', exact: true }).check()
  await page.getByRole('button', { name: '回答する' }).click()
  await expect(page.locator('.result-summary')).toContainText('あなたの回答 エ')
  await expect(page.locator('.result-summary')).toContainText('公式正答 ア')
  await expect(page.getByRole('heading', { name: 'AIに聞く' })).toHaveCount(0)
  await page.getByRole('button', { name: '要復習にする' }).click()
  await page.getByRole('link', { name: '年度・期を選ぶ' }).click()
  await special.getByRole('link', { name: '続きから' }).click()
  await expect(page).toHaveURL(firstQuestion.replace(/1$/, '2'))
  await page.getByRole('link', { name: '学習記録' }).click()
  await expect(page.getByRole('link', { name: '2011年 特別 ・ 問1' })).toHaveAttribute('href', /\/items\/1#result$/)

  await page.goto('/catalog?year=2020')
  await expect(page.locator('.catalog-row')).toHaveCount(1)
  await page.getByRole('button', { name: '演習を始める' }).click()
  await expect(page.getByRole('heading', { name: '2020年 10月' })).toBeVisible()
  await expect(booklet).toHaveAttribute('href', /2020r02o_koudo_am1_qs\.pdf#page=3$/)
  await page.getByRole('link', { name: '問30、未回答' }).click()
  await expect(booklet).toHaveAttribute('href', /2020r02o_koudo_am1_qs\.pdf#page=15$/)
})

test('the 2025 autumn set displays its own text, official score, explanation and figures', async ({ page }) => {
  await page.goto('/catalog?year=2025')
  const autumn = page.locator('.catalog-row').filter({ has: page.getByRole('heading', { name: '2025年 秋期' }) })
  await autumn.getByRole('button', { name: '演習を始める' }).click()
  await expect(page.getByRole('heading', { name: '2025年 秋期' })).toBeVisible()
  await expect(page.locator('.prompt')).toContainText('M/M/1')
  await page.getByRole('radio', { name: /^イ.*50$/ }).check()
  await page.getByRole('button', { name: '回答する' }).click()
  await expect(page.locator('#result-title')).toHaveText('正解')
  await expect(page.locator('#result')).toContainText('ρ ≥ 0.5')
  await page.getByRole('link', { name: '問6、未回答' }).click()
  const zoom = page.getByRole('link', { name: '図表を拡大', exact: true })
  const asset = await page.request.get((await zoom.getAttribute('href'))!)
  expect(asset.headers()['content-type']).toContain('image/webp')
  expect((await asset.body()).length).toBeGreaterThan(1000)
})

test('A-2 supports a complete 25-question session and keeps progress separate from A-1', async ({ page }) => {
  await page.goto('/progress')
  const a1Answered = (await page.locator('.stat strong').first().textContent())!
  await page.getByRole('link', { name: '年度・期', exact: true }).click()
  await page.getByRole('link', { name: 'A-2 午前Ⅱ' }).click()
  await expect(page.getByRole('heading', { name: 'A-2 午前Ⅱ' })).toBeVisible()
  const autumn = page.locator('.catalog-row').filter({ has: page.getByRole('heading', { name: '2025年 秋期' }) })
  await autumn.getByRole('button', { name: '演習を始める' }).click()
  await expect(page.locator('.eyebrow')).toContainText('午前Ⅱ')
  await expect(page.locator('.prompt')).toContainText('CRYPTREC')
  await expect(page.getByText('公式正答', { exact: false })).toHaveCount(0)
  await expect(page.locator('.question-grid li')).toHaveCount(25)

  const { answers } = a2Sources.find(exam => exam.id === 'a2:2025:autumn')!
  for (const [i, officialAnswer] of answers.choices.entries()) {
    await expect(page.locator('#question-title')).toContainText(String(i + 1).padStart(2, '0'))
    if (i === 21) {
      const zoom = page.getByRole('link', { name: '図表を拡大', exact: true })
      const figure = await page.request.get((await zoom.getAttribute('href'))!)
      expect(figure.headers()['content-type']).toContain('image/webp')
      expect((await figure.body()).length).toBeGreaterThan(1000)
    }
    const choice = i === 0 ? 'イ' : officialAnswer
    await page.getByRole('radio', { name: new RegExp(`^${choice}`) }).check()
    await page.getByRole('button', { name: '回答する' }).click()
    await expect(page.locator('.result-summary')).toContainText(`公式正答 ${officialAnswer}`)
    if (i === 0) await page.getByRole('button', { name: '要復習にする' }).click()
    if (i < 24) await page.getByRole('link', { name: '次の問題' }).click()
  }

  await page.getByRole('link', { name: '演習結果を見る' }).click()
  await expect(page.locator('.stat').nth(0)).toContainText('25 / 25 問')
  await expect(page.locator('.stat').nth(1)).toContainText('24 問')
  await page.getByRole('link', { name: '学習記録を見る' }).click()
  await expect(page).toHaveURL(/\/progress\?subject=a2$/)
  await expect(page.locator('.stat').nth(0)).toContainText('25 問')
  await expect(page.locator('.stat').nth(2)).toContainText('1 問')
  await page.getByRole('link', { name: /認証・暗号/ }).click()
  await expect(page.locator('#answers')).toContainText('CRYPTREC')
  await expect(page.locator('#answers').getByText('要復習', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'A-1 午前Ⅰ' }).click()
  await expect(page.locator('.stat strong').first()).toHaveText(a1Answered)
  await expect(page.getByRole('link', { name: /認証・暗号/ })).toHaveCount(0)
})

test('the A-2 catalog opens and resumes the official 2020 October booklet', async ({ page }) => {
  await page.route('**/booklets/**', route => route.fulfill({ status: 204 }))
  await page.goto('/catalog?subject=a2&year=2009')
  await expect(page.getByLabel('年度')).toHaveValue('2025')
  await page.getByLabel('年度').selectOption('2020')
  await page.getByRole('button', { name: '表示', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2020年 10月' })).toBeVisible()
  await expect(page.locator('.catalog-row')).toHaveCount(1)
  await page.getByRole('button', { name: '演習を始める' }).click()
  const booklet = page.getByRole('link', { name: 'IPAの原本を開く' })
  await expect(booklet).toHaveAttribute('href', /2020r02o_sc_am2_qs\.pdf#page=3$/)
  const saved = page.url()
  const { answers } = a2Sources.find(exam => exam.id === 'a2:2020:october')!
  await page.getByRole('radio', { name: answers.choices[0], exact: true }).check()
  await page.getByRole('button', { name: '回答する' }).click()
  await expect(page.locator('#result-title')).toHaveText('正解')

  await page.getByRole('link', { name: '年度・期を選ぶ' }).click()
  await expect(page.getByLabel('年度')).toHaveValue('2020')
  await page.getByRole('link', { name: '続きから' }).click()
  await expect(page).toHaveURL(saved.replace(/1$/, '2'))
  await page.getByRole('link', { name: '問25、未回答' }).click()
  await expect(booklet).toHaveAttribute('href', /2020r02o_sc_am2_qs\.pdf#page=16$/)
})

test.describe('inline problem PDF', () => {
  test.use({ javaScriptEnabled: true, viewport: { width: 1200, height: 900 }, isMobile: false, hasTouch: false })

  test('shows the selected page beside the choices and stacks them on a narrow screen', async ({ page, context }) => {
    const drawing = '0.3 g 40 40 120 150 re f\n'
    const sheet = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Contents 6 0 R >>'
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
      sheet, sheet, sheet,
      `<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`,
    ]
    let pdf = '%PDF-1.4\n'
    const offsets = objects.map((object, index) => {
      const offset = pdf.length
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
      return String(offset).padStart(10, '0')
    })
    const xref = pdf.length
    pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.map(offset => `${offset} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    await page.route('**/booklets/**', route => route.fulfill({ contentType: 'application/pdf', body: pdf }))

    await page.goto('/catalog?subject=a2&year=2017')
    await page.getByRole('button', { name: '演習を始める' }).first().click()
    const preview = page.getByRole('region', { name: '公式問題冊子' })
    const choices = page.getByRole('group', { name: '選択肢' })
    await expect(preview.getByRole('img', { name: '公式問題冊子 PDFの3ページ目' })).toBeVisible()
    await expect(preview.getByText('3 / 3ページ')).toBeVisible()
    const desktopPreview = (await preview.boundingBox())!
    expect(desktopPreview.x + desktopPreview.width).toBeLessThan((await choices.boundingBox())!.x)
    await page.getByRole('radio', { name: 'ア', exact: true }).check()
    await preview.getByRole('button', { name: '前のページ' }).click()
    await expect(preview.getByRole('img', { name: '公式問題冊子 PDFの2ページ目' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'ア', exact: true })).toBeChecked()
    await preview.getByRole('button', { name: '次のページ' }).click()
    await expect(preview.getByText('3 / 3ページ')).toBeVisible()
    expect(context.pages()).toHaveLength(1)

    await page.setViewportSize({ width: 390, height: 844 })
    const mobilePreview = (await preview.boundingBox())!
    expect(mobilePreview.y + mobilePreview.height).toBeLessThan((await choices.boundingBox())!.y)
    await page.getByRole('button', { name: '回答する' }).click()
    await expect(page.locator('#result-title')).toBeVisible()

    await page.goto('/catalog?year=2025')
    await page.locator('.catalog-row').first().getByRole('button', { name: /始める/ }).click()
    await page.getByRole('link', { name: /原題 PDF（/ }).click()
    await expect(preview).toBeVisible()
    await expect(page.locator('#question-title')).toBeVisible()
    expect(context.pages()).toHaveLength(1)
    await page.getByRole('link', { name: '原題 PDFを閉じる' }).click()
    await expect(preview).toHaveCount(0)
  })
})
