import { once } from 'node:events'
import { createServer } from 'node:http'
import { pipeline } from 'node:stream/promises'
import tls from 'node:tls'
import { EnvHttpProxyAgent, fetch } from 'undici'
import a1Sources from '../src/corpus/a1-sources.json' with { type: 'json' }
import a2Sources from '../src/corpus/a2-sources.json' with { type: 'json' }

const host = '127.0.0.1'
const sources = new Map([...a1Sources, ...a2Sources].map(exam => [
  `/booklets/${exam.id}/${exam.version}`, exam.questions.url,
]))

export async function startLocalBooklets() {
  const ca = tls.getCACertificates && [...tls.getCACertificates('default'), ...tls.getCACertificates('system')]
  const certs = ca ? { ca } : undefined
  const dispatcher = new EnvHttpProxyAgent({ connect: certs, requestTls: certs, proxyTls: certs })
  let authority
  const server = createServer(async (request, reply) => {
    const url = sources.get(request.url)
    if (request.method !== 'GET' || request.headers.host !== authority || !url) {
      reply.writeHead(404).end()
      return
    }

    const disconnected = new AbortController()
    reply.once('close', () => disconnected.abort())
    try {
      const response = await fetch(url, {
        dispatcher,
        redirect: 'manual',
        signal: AbortSignal.any([disconnected.signal, AbortSignal.timeout(15_000)]),
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        console.warn(`IPA booklet request failed: HTTP ${response.status} (${url})`)
        reply.writeHead(502).end()
        return
      }
      reply.setHeader('Content-Type', 'application/pdf')
      await pipeline(response.body, reply)
    } catch (error) {
      if (disconnected.signal.aborted) return
      console.warn(`IPA booklet request failed: ${error.cause?.code ?? error.name} (${url})`)
      if (!reply.headersSent) reply.writeHead(502).end()
    }
  })

  server.listen(0, host)
  await once(server, 'listening')
  const { port } = server.address()
  authority = `${host}:${port}`
  return {
    port,
    close() {
      server.close()
      server.closeAllConnections()
      return dispatcher.destroy()
    },
  }
}
