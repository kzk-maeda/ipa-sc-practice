import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'jsonc-parser'

const environment = process.argv[2]
if (!['staging', 'production'].includes(environment)) {
  console.error('使用方法: npm run cloudflare:config -- staging|production')
  process.exit(1)
}

const repo = new URL('../', import.meta.url)
const baseConfig = new URL('wrangler.jsonc', repo)
const target = new URL(`wrangler.${environment}.generated.json`, repo)
const temporary = new URL(`wrangler.${environment}.generated.json.${process.pid}.tmp`, repo)

try {
  const overrides = JSON.parse(execFileSync('terraform', ['-chdir=infra/cloudflare', 'output', '-json', 'wrangler_config'], {
    cwd: fileURLToPath(repo),
    env: { ...process.env, TF_WORKSPACE: environment },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }))

  if (overrides.name !== `ipa-sc-practice-${environment}` || overrides.vars?.APP_ENV !== 'cloudflare') {
    throw new Error('対象環境のTerraform出力を確認してください。')
  }

  const errors = []
  const config = parse(readFileSync(baseConfig, 'utf8'), errors)
  if (errors.length || !config?.main) throw new Error('wrangler.jsoncを読み取れません。')
  delete config.env
  writeFileSync(temporary, JSON.stringify({ ...config, ...overrides }, null, 2) + '\n')
  renameSync(temporary, target)
  console.log(fileURLToPath(target))
} catch (error) {
  console.error(`Wrangler設定を生成できませんでした。 ${error.message}`)
  process.exitCode = 1
} finally {
  rmSync(temporary, { force: true })
}
