// Generates an answer with streaming drafts (private chats) and sends the
// final result as a Telegram rich message.

import { complete, completeStream } from './ai.js';
import { SYSTEM_PROMPT } from './config.js';
import { answerMarkdown } from './rich.js';
import { sendChatAction, sendDraft, sendRich } from './telegram.js';

const DRAFT_INTERVAL_MS = 1100;

export async function generate({ chatId, chatType, messages, model, agent, replyTo, threadId }) {
  const payload = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];
  const canStream = chatType === 'private';

  let answer = '';

  if (canStream) {
    const draftId = (Date.now() % 2147483647) || 1;
    let lastDraftAt = 0;
    let draftInFlight = false;

    // Instant "Thinking…" placeholder.
    void sendDraft(chatId, draftId, '<tg-thinking>Думаю…</tg-thinking>', threadId);

    try {
      answer = await completeStream(payload, model, agent, (partial) => {
        const now = Date.now();
        if (draftInFlight || now - lastDraftAt < DRAFT_INTERVAL_MS) return;
        lastDraftAt = now;
        draftInFlight = true;
        sendDraft(chatId, draftId, partial, threadId).finally(() => {
          draftInFlight = false;
        });
      });
    } catch (err) {
      console.warn('streaming failed, falling back to buffered:', err?.message ?? err);
      answer = '';
    }
  } else {
    await sendChatAction(chatId, 'typing', threadId);
  }

  if (!answer.trim()) {
    answer = await complete(payload, model, agent);
  }

  console.log(`ai answer: ${answer.length} chars (${model})`);

  await sendRich(chatId, { markdown: answerMarkdown(answer, { model }) }, { replyTo, threadId });

  return answer.trim();
}