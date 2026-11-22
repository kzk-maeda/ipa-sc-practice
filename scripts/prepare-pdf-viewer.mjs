import { copyFileSync, mkdirSync, statSync } from 'node:fs'

const source = new URL('../node_modules/pdfjs-dist/', import.meta.url)
const destination = new URL('../public/vendor/pdfjs/', import.meta.url)
mkdirSync(destination, { recursive: true })
for (const path of ['legacy/build/pdf.min.mjs', 'legacy/build/pdf.worker.min.mjs', 'LICENSE']) {
  const input = new URL(path, source)
  const output = new URL(path.split('/').at(-1), destination)
  const current = statSync(output, { throwIfNoEntry: false })
  const latest = statSync(input)
  if (!current || current.size !== latest.size || current.mtimeMs < latest.mtimeMs) copyFileSync(input, output)
}
