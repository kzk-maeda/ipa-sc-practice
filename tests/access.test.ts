import assert from 'node:assert/strict'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose'
import type { AppEnv } from '../src/auth/access'
import { app } from '../src/index'

test('the cloud Worker checks Access before serving assets or selecting a learner', async t => {
  const hostname = 'practice-staging.example.com'
  const origin = `https://${hostname}`
  const issuer = 'https://test-team.cloudflareaccess.com'
  const audience = 'a'.repeat(64)
  const trusted = await generateKeyPair('RS256')
  const forged = await generateKeyPair('RS256')
  const jwk = await exportJWK(trusted.publicKey)
  const fetchKeys = t.mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(String(url), `${issuer}/cdn-cgi/access/certs`)
    return Response.json({ keys: [{ ...jwk, kid: 'access-key', alg: 'RS256' }] })
  })

  const userIds: string[] = []
  const env: AppEnv['Bindings'] = {
    APP_ENV: 'cloudflare',
    APP_HOSTNAME: hostname,
    CF_ACCESS_ISSUER: issuer,
    CF_ACCESS_AUD: audience,
    ASSETS: { fetch: async () => new Response('styles') },
    DB: {
      prepare: () => ({
        bind: (user: string) => {
          userIds.push(user)
          return { all: async () => ({ results: [] }) }
        },
      }),
    } as unknown as D1Database,
  }

  const token = (claims: JWTPayload = {}, key = trusted.privateKey) =>
    new SignJWT({ iss: issuer, aud: [audience], sub: 'learner-one', exp: Math.floor(Date.now() / 1000) + 60, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'access-key' })
      .sign(key)

  const request = async (url: string, assertion?: string, bindings = env) =>
    app.request(url, { headers: assertion ? { 'Cf-Access-Jwt-Assertion': assertion } : {} }, bindings)

  const asset = `${origin}/styles.css`
  assert.equal((await request(asset, undefined, { ...env, CF_ACCESS_AUD: undefined })).status, 503)
  assert.equal((await request(asset)).status, 403)
  assert.equal((await request('https://other.example.com/styles.css', await token())).status, 403)
  assert.equal(fetchKeys.mock.callCount(), 0)

  for (const assertion of [
    await token({ aud: ['wrong'] }),
    await token({ iss: 'https://another-team.cloudflareaccess.com' }),
    await token({ exp: 1 }),
    await token({ exp: undefined }),
    await token({ sub: undefined }),
    await token({}, forged.privateKey),
  ]) {
    assert.equal((await request(asset, assertion)).status, 403)
  }

  assert.equal(await (await request(asset, await token())).text(), 'styles')
  const catalog = `${origin}/catalog`
  assert.equal((await request(catalog, await token())).status, 200)
  assert.equal((await request(catalog, await token({ sub: 'learner-two' }))).status, 200)
  assert.equal((await request(catalog, await token())).status, 200)
  assert.equal((await request('http://localhost/catalog', undefined, { ...env, APP_ENV: 'local' })).status, 200)
  assert.match(userIds[0], /^access:[a-f0-9]{64}$/)
  assert.match(userIds[1], /^access:[a-f0-9]{64}$/)
  assert.notEqual(userIds[0], userIds[1])
  assert.equal(userIds[0], userIds[2])
  assert.equal(userIds[3], 'local-learner')
})
