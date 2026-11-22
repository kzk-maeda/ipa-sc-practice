import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startLocalBooklets } from './local-booklets.mjs'

const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
// Sites preview forwards Vite's flags. Wrangler uses --ip and binds its explicitly configured port.
const args = process.argv.slice(2)
  .filter(arg => arg !== '--strictPort')
  .map(arg => arg.replace(/^--host(?==|$)/, '--ip'))
const booklets = await startLocalBooklets()
const worker = spawn(process.execPath, [
  wrangler, 'dev', '--env', 'local', '--local', ...args, '--var', `LOCAL_BOOKLET_PORT:${booklets.port}`,
], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS ?? 'false' },
})

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => worker.kill(signal))
worker.on('error', error => { console.error(error.message) })
worker.on('close', code => {
  process.exitCode = code ?? 0
  void booklets.close()
})
