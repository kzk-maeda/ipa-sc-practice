import type { AiPanel } from '../ai/ask'
import { historyLimit, maxQuestionLength } from '../ai/config'
import { stubReply } from '../ai/stub'
import type { TextItem } from '../corpus/catalog'

export function AiSection({ ai, item, url }: { ai: AiPanel; item: TextItem; url: string }) {
  return <section id="ai" class="ai-section" aria-labelledby="ai-title">
    <div class="ai-heading">
      <h3 id="ai-title">AIに聞く</h3>
      <span>{ai.mode === 'stub' ? 'ローカルスタブ' : 'AIによる補足解説'}</span>
    </div>
    {ai.mode === 'stub' ? <>
      <form method="post" action={`${url}/ai`} class="ai-prompts">
        <button class="secondary" type="submit" name="prompt" value="reason">なぜこの選択肢？</button>
        <button class="secondary" type="submit" name="prompt" value="approach">解き方の考え方</button>
      </form>
      {ai.hint && <p class="ai-answer">{stubReply(item, ai.hint)}</p>}
    </> : <>
      <ol class="ai-turns" data-ai-turns={historyLimit} aria-label="この問題のAI会話">
        {ai.turns.map(turn => <li class="ai-turn">
          <p><b>あなた</b> {turn.question}</p>
          <p class="ai-answer">{turn.answer}</p>
        </li>)}
      </ol>
      <p class="ai-answer" data-ai-live hidden></p>
      <p class="ai-status" role="status">{ai.notice}</p>
      <form data-ai-form method="post" action={`${url}/ai`} enctype="multipart/form-data">
        <input type="hidden" name="clientRequestId" value={crypto.randomUUID()} />
        <fieldset>
          <label for="ai-question">質問</label>
          <textarea id="ai-question" name="question" rows={3} maxlength={maxQuestionLength} required></textarea>
          <div class="ai-prompts">
            <button type="submit">質問する</button>
            <button class="secondary" type="submit" name="prompt" value="reason" formnovalidate>なぜこの選択肢？</button>
            <button class="secondary" type="submit" name="prompt" value="approach" formnovalidate>解き方の考え方</button>
            <button class="secondary" type="submit" name="prompt" value="alternatives" formnovalidate>ほかの選択肢との違い</button>
          </div>
        </fieldset>
      </form>
      <form data-ai-clear method="post" action={`${url}/ai/clear`} hidden={!ai.turns.length}>
        <button type="submit" class="secondary">この問題の会話を削除</button>
      </form>
      <script src="/ai.js" defer></script>
    </>}
  </section>
}
