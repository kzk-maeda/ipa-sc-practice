import { createRemoteJWKSet, jwtVerify } from 'jose'

export type AppEnv = {
  Bindings: {
    DB: D1Database
    ASSETS: Pick<Fetcher, 'fetch'>
    APP_ENV?: string
    AI_MODE?: string
    APP_HOSTNAME?: string
    CF_ACCESS_ISSUER?: string
    CF_ACCESS_AUD?: string
  }
  Variables: { userId: string }
}

const issuerPattern = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/
const audiencePattern = /^[a-f0-9]{64}$/
const issuers = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function accessSettings(env: AppEnv['Bindings']) {
  const { APP_HOSTNAME: hostname, CF_ACCESS_ISSUER: issuer, CF_ACCESS_AUD: audience } = env
  if (!hostname || !issuer || !issuerPattern.test(issuer) || !audience || !audiencePattern.test(audience)) return null
  return { origin: `https://${hostname}`, issuer, audience }
}

export async function accessUser(token: string, issuer: string, audience: string) {
  try {
    let keys = issuers.get(issuer)
    if (!keys) {
      keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer))
      issuers.set(issuer, keys)
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub'],
    })
    if (typeof payload.sub !== 'string' || !payload.sub) return null

    const identity = new TextEncoder().encode(JSON.stringify([issuer, payload.sub]))
    const digest = await crypto.subtle.digest('SHA-256', identity)
    const userId = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    return `access:${userId}`
  } catch {
    return null
  }
}
