const form = document.querySelector('[data-ai-form]')
if (form) {
  const fieldset = form.querySelector('fieldset')
  const requestId = form.querySelector('[name=clientRequestId]')
  const status = document.querySelector('.ai-status')
  const turns = document.querySelector('[data-ai-turns]')
  const live = document.querySelector('[data-ai-live]')
  const clear = document.querySelector('[data-ai-clear]')
  let lastSubmission

  function addTurn(reply) {
    const entry = document.createElement('li')
    entry.className = 'ai-turn'
    const question = document.createElement('p')
    const label = document.createElement('b')
    label.textContent = 'あなた'
    question.append(label, ` ${reply.question}`)
    const answer = document.createElement('p')
    answer.className = 'ai-answer'
    answer.textContent = reply.answer
    entry.append(question, answer)
    turns.append(entry)
    while (turns.children.length > Number(turns.dataset.aiTurns)) turns.firstElementChild.remove()
    clear.hidden = false
  }

  async function readReply(response) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) throw new Error('AIの通信が中断されました。もう一度お試しください。')
        buffer += decoder.decode(value, { stream: true })
        let boundary
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const lines = buffer.slice(0, boundary.index).split(/\r?\n/)
          buffer = buffer.slice(boundary.index + boundary[0].length)
          const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
          const data = lines.find(line => line.startsWith('data:'))?.slice(5)
          if (!event || !data) continue
          const reply = JSON.parse(data)
          if (event === 'delta') live.append(reply.text)
          if (event === 'done') return reply
          if (event === 'error') throw Object.assign(new Error(reply.error), { code: reply.code })
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (fieldset.disabled) return
    const payload = new FormData(form)
    if (event.submitter?.name) payload.set(event.submitter.name, event.submitter.value)
    const submission = payload.get('prompt') || payload.get('question').trim()
    if (lastSubmission !== undefined && submission !== lastSubmission) requestId.value = crypto.randomUUID()
    lastSubmission = submission
    payload.set('clientRequestId', requestId.value)
    fieldset.disabled = true
    live.textContent = ''
    live.hidden = false
    status.textContent = 'AIが回答しています…'
    try {
      const response = await fetch(form.action, {
        method: 'POST', headers: { Accept: 'text/event-stream, application/json' }, body: payload,
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw Object.assign(new Error(error.error || 'AIに質問できませんでした。'), { code: error.code })
      }
      const reply = await readReply(response)
      addTurn(reply)
      form.reset()
      requestId.value = crypto.randomUUID()
      status.textContent = reply.incomplete ? '回答が出力上限に達しました。' : '回答が届きました。'
    } catch (error) {
      if (['provider', 'gone', 'conflict'].includes(error.code)) requestId.value = crypto.randomUUID()
      status.textContent = error.message || 'AIに質問できませんでした。'
    } finally {
      live.hidden = true
      fieldset.disabled = false
    }
  })
}
