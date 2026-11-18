// Small wrappers around the Bot API with graceful fallbacks.

import { api } from 'sdk';
import { plainText } from './rich.js';

export async function sendChatAction(chatId, action = 'typing', threadId) {
  try {
    await api.sendChatAction({
      chat_id: chatId,
      action,
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
  } catch {
    // Typing indicators are cosmetic — never fail the handler because of them.
  }
}

/**
 * Send a rich message. If the chat/client rejects rich messages, fall back to
 * a plain-text message so the user still gets an answer.
 */
export async function sendRich(chatId, richMessage, { replyTo, threadId } = {}) {
  const reply_parameters = replyTo
    ? { message_id: replyTo, allow_sending_without_reply: true }
    : undefined;

  try {
    return await api.sendRichMessage({
      chat_id: chatId,
      rich_message: richMessage,
      ...(reply_parameters ? { reply_parameters } : {}),
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
  } catch (err) {
    console.warn('sendRichMessage failed:', err?.description ?? err?.message ?? err);
    return api.sendMessage({
      chat_id: chatId,
      text: plainText(richMessage) || '…',
      ...(reply_parameters ? { reply_parameters } : {}),
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
  }
}

/** Fire-and-forget streaming draft (private chats only). */
export async function sendDraft(chatId, draftId, markdown, threadId) {
  try {
    await api.sendRichMessageDraft({
      chat_id: chatId,
      draft_id: draftId,
      rich_message: { markdown },
      ...(threadId ? { message_thread_id: threadId } : {}),
    });
  } catch {
    // Drafts are a preview; the final message is what matters.
  }
}
