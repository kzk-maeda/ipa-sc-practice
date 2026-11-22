import { getDocument, GlobalWorkerOptions } from '/vendor/pdfjs/pdf.min.mjs'

GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'

const preview = document.querySelector('[data-booklet]')
if (preview) {
  const canvas = preview.querySelector('canvas')
  const message = preview.querySelector('[role=status]')
  const controls = preview.querySelector('[data-pdf-controls]')
  const previous = controls.querySelector('[data-previous]')
  const next = controls.querySelector('[data-next]')
  const pageLabel = controls.querySelector('[data-page-label]')
  let page = Number(preview.dataset.page)
  let pdf

  async function render() {
    previous.disabled = next.disabled = true
    message.textContent = '問題冊子を読み込み中…'
    try {
      const source = await pdf.getPage(page)
      const viewport = source.getViewport({ scale: 2.3 })
      canvas.width = viewport.width
      canvas.height = viewport.height
      await source.render({ canvas, viewport }).promise
      canvas.hidden = false
      canvas.setAttribute('aria-label', `公式問題冊子 PDFの${page}ページ目`)
      pageLabel.textContent = `${page} / ${pdf.numPages}ページ`
      message.textContent = ''
      previous.disabled = page <= 1
      next.disabled = page >= pdf.numPages
    } catch {
      message.textContent = '表示できませんでした。「IPAの原本を開く」から確認できます。'
    }
  }

  previous.addEventListener('click', () => { page--; void render() })
  next.addEventListener('click', () => { page++; void render() })
  try {
    pdf = await getDocument({ url: preview.dataset.booklet, isEvalSupported: false, disableRange: true }).promise
    controls.hidden = false
    await render()
  } catch {
    message.textContent = '表示できませんでした。「IPAの原本を開く」から確認できます。'
  }
}
