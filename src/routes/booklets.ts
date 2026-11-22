import { Hono } from 'hono'
import type { AppEnv } from '../auth/access'
import { getExam } from '../corpus/catalog'

const maxSize = 4_000_000
const booklets = new Hono<AppEnv>()

async function readPdf(response: Response) {
  if (!response.ok || !response.body || Number(response.headers.get('Content-Length')) > maxSize) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxSize) return null
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const pdf = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    pdf.set(chunk, offset)
    offset += chunk.byteLength
  }
  return pdf
}

booklets.get('/booklets/:form/:version', async c => {
  const exam = getExam(c.req.param('form'), c.req.param('version'))
  if (!exam) return c.notFound()
  const localPort = c.env.APP_ENV === 'local' ? Number(c.env.LOCAL_BOOKLET_PORT) : 0
  const url = localPort > 0 ? `http://127.0.0.1:${localPort}/booklets/${exam.id}/${exam.version}` : exam.questions.url
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    const pdf = await readPdf(response)
    if (pdf) {
      const digest = await crypto.subtle.digest('SHA-256', pdf)
      const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (sha256 === exam.questions.sha256) {
        c.header('Content-Type', 'application/pdf')
        c.header('Content-Disposition', 'inline')
        c.header('Content-Security-Policy', "frame-ancestors 'self'")
        c.header('Cache-Control', 'private, max-age=86400')
        return c.body(pdf)
      }
    }
  } catch (error) {
    console.warn('Official booklet fetch failed', exam.id, error instanceof Error ? error.name : '')
  }
  return c.text('問題冊子を取得できませんでした。IPAの原本を開いてください。', 502)
})

export { booklets }
