// handlers/callback_query.js — buttons embedded in rich messages.

import { api } from 'sdk';
import { ONBOARD, clearOnboard, getModel, listModels, removeModel, setModel, setOnboard } from '../lib/users.js';
import { clearHistory } from '../lib/repo.js';
import { regenerate } from '../lib/chatflow.js';
import { isSubscribed } from '../lib/subscription.js';
import {
  addModelPrompt,
  askBaseUrlMarkdown,
  deleteModelPicker,
  helpMarkdown,
  modelChangedMarkdown,
  modelInPrivateMarkdown,
  modelPicker,
  newDialogMarkdown,
  subscribeGateMarkdown,
  welcomeRich,
} from '../lib/rich.js';
import { sendRich } from '../lib/telegram.js';
import { friendlyError } from '../lib/errors.js';

export default async function (query) {
  const message = query.message;
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type ?? 'private';
  const threadId = message?.message_thread_id;
  const data = query.data ?? '';
  const userId = query.from?.id;

  if (!userId) {
    await api.answerCallbackQuery({ callback_query_id: query.id }).catch(() => {});
    return;
  }

  const reply = (rich, extra = {}) => {
    if (!chatId) return Promise.resolve();
    return sendRich(chatId, rich, { threadId, ...extra });
  };

  const edit = async (rich) => {
    if (!chatId || !message?.message_id) return reply(rich);
    try {
      await api.editMessageText({
        chat_id: chatId,
        message_id: message.message_id,
        rich_message: rich,
      });
    } catch {
      await reply(rich);
    }
  };

  const toast = (text, alert = false) =>
    api
      .answerCallbackQuery({
        callback_query_id: query.id,
        ...(text ? { text } : {}),
        ...(alert ? { show_alert: true } : {}),
      })
      .catch(() => {});

  try {
    // ── Subscription: re-check on demand ───────────────────────────────────
    if (data === 'sub:check') {
      if (await isSubscribed(userId, { force: true })) {
        await toast('Подписка подтверждена');
        await reply(welcomeRich());
        return;
      }
      await toast('Пока не вижу подписку', true);
      await edit({ markdown: subscribeGateMarkdown() });
      return;
    }

    // Everything past this point needs the subscription.
    if (!(await isSubscribed(userId))) {
      await toast('Сначала подпишись на канал', true);
      await reply({ markdown: subscribeGateMarkdown() });
      return;
    }

    // ── Onboarding ─────────────────────────────────────────────────────────
    if (data === 'onb:url') {
      if (chatType !== 'private') {
        await toast('Настройка — в личке');
        return;
      }
      await setOnboard(userId, ONBOARD.URL);
      await toast();
      await reply({ markdown: askBaseUrlMarkdown() });
      return;
    }

    if (data === 'onb:cancel') {
      await clearOnboard(userId);
      await toast('Отменено');
      await reply(welcomeRich());
      return;
    }

    // ── Model group (private chat only) ────────────────────────────────────
    const isModelAction = data === 'models' || data.startsWith('m');
    if (isModelAction && chatType !== 'private') {
      await toast('Модель меняется только в личке');
      await reply({ markdown: modelInPrivateMarkdown() });
      return;
    }

    if (data.startsWith('m:')) {
      const requested = data.slice(2);
      const models = await listModels(userId);
      const model = models.find((m) => m.id === requested);

      if (!model) {
        await toast('Модель уже удалена из списка', true);
        await edit(modelPicker(models, await getModel(userId)));
        return;
      }

      await setModel(userId, model.id);
      await toast(`Модель: ${model.label}`);
      await edit(modelPicker(models, model.id));
      return;
    }

    if (data.startsWith('md:')) {
      const removed = await removeModel(userId, data.slice(3));

      if (!removed.ok) {
        await toast(removed.error.replace(/[`*_]/g, ''), true);
        return;
      }

      await toast(`Удалено: ${removed.id}`);
      await edit(deleteModelPicker(await listModels(userId), await getModel(userId)));
      return;
    }

    await toast();

    switch (data) {
      case 'new':
        await clearHistory(chatId);
        await reply({ markdown: newDialogMarkdown() });
        return;

      case 'help':
        await reply({ markdown: helpMarkdown(await listModels(userId)) });
        return;

      case 'models':
        await edit(modelPicker(await listModels(userId), await getModel(userId)));
        return;

      case 'mD':
        await edit(deleteModelPicker(await listModels(userId), await getModel(userId)));
        return;

      case 'mA':
        await setOnboard(userId, ONBOARD.MODEL_ADD);
        await reply(addModelPrompt());
        return;

      case 'mX':
        await clearOnboard(userId);
        await reply({ markdown: modelChangedMarkdown(await getModel(userId)) });
        return;

      case 'retry': {
        const answer = await regenerate({ chatId, chatType, threadId, userId });
        if (!answer) {
          await reply({ markdown: '_Пока нечего повторять — сначала задай вопрос._' });
        }
        return;
      }

      case 'welcome':
        await reply(welcomeRich());
        return;

      default:
        return;
    }
  } catch (error) {
    console.error('callback handler failed:', error);
    await reply({ markdown: friendlyError(error) }).catch(() => {});
  }
}