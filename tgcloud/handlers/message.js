// handlers/message.js — every ordinary message (private chats and groups).
//
// Order of gates:
//   1. subscription to the required channel (admins skip it)
//   2. agent onboarding (BASE_URL → API_KEY), private chats only
//   3. commands
//   4. the actual AI question

import { BOT_USERNAME } from '../lib/config.js';
import { addModel, clearOnboard, getAgent, getModel, listModels, removeModel, setModel, setOnboard, ONBOARD } from '../lib/users.js';
import { clearHistory, touchChat } from '../lib/repo.js';
import { answerQuestion, regenerate } from '../lib/chatflow.js';
import { isSubscribed } from '../lib/subscription.js';
import { handleOnboarding } from '../lib/onboarding.js';
import { sendChatAction, sendRich } from '../lib/telegram.js';
import {
  addModelPrompt,
  agentBrokenMarkdown,
  askBaseUrlMarkdown,
  deleteModelPicker,
  helpMarkdown,
  modelChangedMarkdown,
  modelInPrivateMarkdown,
  modelPicker,
  newDialogMarkdown,
  setupInPrivateMarkdown,
  subscribeGateMarkdown,
  welcomeRich,
} from '../lib/rich.js';
import { friendlyError } from '../lib/errors.js';

const BOT_LOWER = BOT_USERNAME.toLowerCase();

async function modelListMarkdown(userId) {
  const models = await listModels(userId);
  return models.map((m) => `- \`${m.id}\``).join('\n');
}

function parseCommand(text) {
  const match = /^\/([a-z0-9_]+)(?:@([a-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== BOT_LOWER) return null;
  return { name: match[1].toLowerCase(), args: (match[3] ?? '').trim() };
}

export default async function (message, ctx) {
  const chatId = message.chat?.id;
  const userId = message.from?.id;
  if (!chatId || !userId) return;

  const chatType = message.chat.type ?? 'private';
  const threadId = message.message_thread_id;
  const replyTo = message.message_id;
  const isPrivate = chatType === 'private';

  const reply = (rich, extra = {}) => sendRich(chatId, rich, { replyTo, threadId, ...extra });

  try {
    await touchChat(message);

    const text = (message.text ?? message.caption ?? '').trim();

    // ── 1. Subscription gate ────────────────────────────────────────────────
    if (!(await isSubscribed(userId))) {
      // In a group a gate message would be spam; the author gets it in private.
      if (isPrivate) await reply({ markdown: subscribeGateMarkdown() });
      return;
    }

    // ── 2. Onboarding ───────────────────────────────────────────────────────
    // Only private chats: a group must not see (or swallow) someone's key.
    if (isPrivate && (await handleOnboarding(message, reply))) return;

    if (!text) {
      await reply({
        markdown: '_Пока я понимаю только текст и подписи к медиа. Напиши вопрос словами — и я отвечу._',
      });
      return;
    }

    const command = parseCommand(text);

    // ── 3. Commands ─────────────────────────────────────────────────────────
    if (command) {
      switch (command.name) {
        case 'start':
          if (command.args.toLowerCase().startsWith('model') && isPrivate) {
            await reply(modelPicker(await listModels(userId), await getModel(userId)));
            return;
          }
          if (command.args.toLowerCase().startsWith('setup') && isPrivate) {
            await setOnboard(userId, ONBOARD.URL);
            await reply({ markdown: askBaseUrlMarkdown() });
            return;
          }
          if (!(await getAgent(userId))) {
            await setOnboard(userId, ONBOARD.URL);
            await reply({ markdown: askBaseUrlMarkdown() });
            return;
          }
          await reply(welcomeRich());
          return;

        case 'help':
          await reply({ markdown: helpMarkdown(await listModels(userId)) });
          return;

        case 'agent':
          if (!isPrivate) {
            await reply({ markdown: modelInPrivateMarkdown() });
            return;
          }
          await setOnboard(userId, ONBOARD.URL);
          await reply({ markdown: askBaseUrlMarkdown() });
          return;

        case 'new':
        case 'reset':
        case 'clear':
          await clearHistory(chatId);
          await reply({ markdown: newDialogMarkdown() });
          return;

        case 'model': {
          if (!isPrivate) {
            await reply({ markdown: modelInPrivateMarkdown() });
            return;
          }

          const [sub, ...rest] = command.args.split(/\s+/).filter(Boolean);
          const action = (sub ?? '').toLowerCase();
          const arg = rest.join(' ').trim();

          if (action === 'add') {
            if (!arg) {
              await setOnboard(userId, ONBOARD.MODEL_ADD);
              await reply(addModelPrompt());
              return;
            }

            const added = await addModel(userId, arg);
            if (!added.ok) {
              await reply({ markdown: `⚠️ ${added.error}\n\n${await modelListMarkdown(userId)}` });
              return;
            }

            await reply({ markdown: modelChangedMarkdown(await getModel(userId)) });
            return;
          }

          if (action === 'del' || action === 'delete' || action === 'remove') {
            if (!arg) {
              await reply(deleteModelPicker(await listModels(userId), await getModel(userId)));
              return;
            }

            const removed = await removeModel(userId, arg);
            if (!removed.ok) {
              await reply({ markdown: `⚠️ ${removed.error}\n\n${await modelListMarkdown(userId)}` });
              return;
            }

            await reply({
              markdown: `🗑 Модель \`${removed.id}\` убрана из списка.\n\n${await modelListMarkdown(userId)}`,
            });
            return;
          }

          if (!action) {
            await reply(modelPicker(await listModels(userId), await getModel(userId)));
            return;
          }

          const models = await listModels(userId);
          const exact = models.find((m) => m.id.toLowerCase() === action);
          const fuzzy = models.find((m) => m.id.toLowerCase().includes(action));
          const model = exact ?? fuzzy;

          if (!model) {
            await reply({
              markdown: `Не знаю модель \`${action.slice(0, 40)}\`.\n\n${await modelListMarkdown(userId)}`,
            });
            return;
          }

          await setModel(userId, model.id);
          await reply({ markdown: modelChangedMarkdown(model.id) });
          return;
        }

        case 'cancel':
          await clearOnboard(userId);
          await reply({ markdown: `Ок, отменил.\n\n${await modelListMarkdown(userId)}` });
          return;

        case 'retry': {
          await sendChatAction(chatId, 'typing', threadId);
          const answer = await regenerate({ chatId, chatType, threadId, replyTo, userId });
          if (!answer) {
            await reply({ markdown: '_Пока нечего повторять — сначала задай вопрос._' });
          }
          return;
        }

        case 'id':
          await reply({
            markdown: `**Chat:** \`${chatId}\`\n**Type:** \`${chatType}\`\n**User:** \`${userId}\``,
          });
          return;

        default:
          await reply({
            markdown: `Неизвестная команда \`/${command.name}\`. Список команд — /help.`,
          });
          return;
      }
    }

    // ── 4. AI question ──────────────────────────────────────────────────────
    // In a group, an unconfigured author is told where to finish setup.
    const agent = await getAgent(userId);
    if (!agent) {
      await reply({ markdown: isPrivate ? askBaseUrlMarkdown() : setupInPrivateMarkdown() });
      if (isPrivate) await setOnboard(userId, ONBOARD.URL);
      return;
    }

    const author = message.from?.first_name ?? message.from?.username ?? 'user';
    await sendChatAction(chatId, 'typing', threadId);
    await answerQuestion({ chatId, chatType, threadId, replyTo, text, author, userId });
  } catch (error) {
    console.error('message handler failed:', error);

    const raw = String(error?.message ?? '');
    // A rejected key is the one error worth a dedicated screen.
    if (/401|403|unauthori[sz]ed|invalid.*key|authentication/i.test(raw)) {
      if (isPrivate) await reply({ markdown: agentBrokenMarkdown('Шлюз не принял твой ключ (401).') }).catch(() => {});
      return;
    }

    await reply({ markdown: friendlyError(error) }).catch(() => {});
  }
}