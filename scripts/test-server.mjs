import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const persistence = mkdtempSync(join(tmpdir(), 'ipa-sc-e2e-'))
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
const setup = spawnSync(process.execPath, [
  wrangler, 'd1', 'migrations', 'apply', 'DB', '--env', 'local', '--local', '--persist-to', persistence,
], { env, stdio: ['ignore', 'inherit', 'inherit'] })
if (setup.status !== 0) {
  rmSync(persistence, { recursive: true, force: true })
  process.exit(setup.status ?? 1)
}

const server = spawn(process.execPath, [
  wrangler, 'dev', '--env', 'local', '--ip', '127.0.0.1', '--port', '8788', '--persist-to', persistence,
], { env, stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal))
server.on('close', code => {
  rmSync(persistence, { recursive: true, force: true })
  process.exitCode = code ?? 0
})
