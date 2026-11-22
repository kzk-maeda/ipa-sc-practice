import assert from 'node:assert/strict'
import test from 'node:test'
import { getExam } from '../src/corpus/catalog'
import { booklets } from '../src/routes/booklets'

test('the booklet route delegates local downloads, checks integrity, and uses IPA on Cloudflare', async t => {
  const exam = getExam('a2:2025:spring')!
  const path = `/booklets/${exam.id}/${exam.version}`
  const localBindings = { APP_ENV: 'local', LOCAL_BOOKLET_PORT: '18787' }
  const download = t.mock.method(globalThis, 'fetch', async () => new Response('%PDF-1.4 wrong file'))

  const local = await booklets.request(path, {}, localBindings)
  assert.equal(local.status, 502)
  assert.equal(download.mock.calls[0].arguments[0], `http://127.0.0.1:18787${path}`)

  const cloud = await booklets.request(path, {}, { ...localBindings, APP_ENV: 'cloudflare' })
  assert.equal(cloud.status, 502)
  assert.equal(download.mock.calls[1].arguments[0], exam.questions.url)

  assert.equal((await booklets.request(`/booklets/${exam.id}/unknown-version`, {}, localBindings)).status, 404)
  assert.equal(download.mock.callCount(), 2)
})
