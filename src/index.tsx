import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { accessSettings, accessUser, type AppEnv } from './auth/access'
import { pruneAi } from './ai/store'
import { booklets } from './routes/booklets'
import { pageError, study } from './routes/study'

const app = new Hono<AppEnv>()

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; frame-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  if (c.env.APP_ENV === 'local') {
    c.set('userId', 'local-learner')
  } else {
    const settings = c.env.APP_ENV === 'cloudflare' && accessSettings(c.env)
    if (!settings) return pageError(c, 503, 'Cloudflare Accessの設定を確認してください。')
    const token = c.req.header('Cf-Access-Jwt-Assertion')
    if (!token || new URL(c.req.url).origin !== settings.origin) {
      return pageError(c, 403, 'Cloudflare Accessで認証してください。')
    }
    const user = await accessUser(token, settings.issuer, settings.audience)
    if (!user) return pageError(c, 403, 'Cloudflare Accessの認証情報を確認できません。')
    c.set('userId', user)
  }
  await next()
})
app.use('*', csrf())
app.use('*', bodyLimit({
  maxSize: 8192,
  onError: c => pageError(c, 413, '送信データのサイズが上限を超えています。'),
}))

app.get('/ai.js', c => c.env.ASSETS.fetch(c.req.raw))
app.get('/booklet.js', c => c.env.ASSETS.fetch(c.req.raw))
app.get('/vendor/pdfjs/*', c => c.env.ASSETS.fetch(c.req.raw))
app.get('/styles.css', c => c.env.ASSETS.fetch(c.req.raw))
app.get('/questions/*', c => c.env.ASSETS.fetch(c.req.raw))
app.route('/', booklets)
app.route('/', study)
app.notFound(c => pageError(c, 404, '演習または問題のURLを確認してください。'))
app.onError((error, c) => {
  if (error instanceof HTTPException && error.status === 403) {
    return pageError(c, 403, 'アプリの画面から操作してください。')
  }
  console.error('Study request failed', error.name)
  return pageError(c, 500, 'データを読み込めませんでした。D1の初期化を確認してください。')
})

export { app }
export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: AppEnv['Bindings'], context: ExecutionContext) {
    context.waitUntil(pruneAi(env.DB, event.scheduledTime))
  },
}
