// handlers/guest_message.js — Guest Mode.
//
// When someone mentions @FlymesAI in a chat the bot isn't a member of,
// Telegram delivers a `guest_message` update. The bot gets exactly one reply,
// posted into that chat via answerGuestQuery().
//
// Each asker is answered with *their own* agent (BASE_URL + key + model);
// guest mode has no chat of its own, so no history is used.

import { api } from 'sdk';
import { completeDetailed } from '../lib/ai.js';
import { BOT_USERNAME, DEFAULT_MODEL, SYSTEM_PROMPT } from '../lib/config.js';
import { getAgent, getModel } from '../lib/users.js';
import { isSubscribed } from '../lib/subscription.js';
import { providerFor } from '../lib/provider.js';
import { answerMarkdown } from '../lib/rich.js';
import { friendlyError } from '../lib/errors.js';

function cleanText(value) {
  return String(value ?? '')
    .replace(new RegExp(`@${BOT_USERNAME}`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function noSetupMarkdown() {
  return [
    `Привет! Я **${BOT_USERNAME}** — AI-ассистент.`,
    '',
    `Чтобы я мог ответить здесь, настрой агента в личке: пришли BASE_URL и свой API-ключ.`,
    '',
    `[Открыть личку](https://t.me/${BOT_USERNAME})`,
  ].join('\n');
}

function noSubscriptionMarkdown() {
  return [
    `Привет! Я **${BOT_USERNAME}** — AI-ассистент.`,
    '',
    `Чтобы я отвечал, подпишись на канал и настрой агента в личке.`,
    '',
    `[Открыть личку](https://t.me/${BOT_USERNAME})`,
  ].join('\n');
}

export default async function (message) {
  const queryId = message?.guest_query_id;
  if (!queryId) return;

  const userId = message.from?.id;
  const question = cleanText(message.text ?? message.caption ?? '');
  const context =
    message.reply_to_message?.text ??
    message.reply_to_message?.caption ??
    message.quote?.text ??
    '';

  let answer;
  let stats;

  if (!userId) {
    answer = noSubscriptionMarkdown();
  } else if (!(await isSubscribed(userId))) {
    answer = noSubscriptionMarkdown();
  } else if (!(await getAgent(userId))) {
    answer = noSetupMarkdown();
  } else if (!question) {
    answer = `Привет! Я **${BOT_USERNAME}** — AI-ассистент.\n\nУпомяни меня вместе с вопросом, например: \`@${BOT_USERNAME} объясни квантовую запутанность\`. Я отвечу прямо в этом чате.`;
  } else {
    const userContent = context
      ? `Сообщение, на которое ответили:\n"""\n${cleanText(context).slice(0, 4000)}\n"""\n\nВопрос:\n${question}`
      : question;

    try {
      const [agent, model] = await Promise.all([getAgent(userId), getModel(userId)]);

      const result = await completeDetailed(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        model || DEFAULT_MODEL,
        agent,
        3000,
      );

      answer = result.text;

      const completionTokens = result.usage?.completion_tokens;
      const reasoningTokens = result.usage?.completion_tokens_details?.reasoning_tokens;

      stats = {
        model: result.model,
        requestedModel: model,
        provider: providerFor(result.model),
        elapsedMs: result.elapsedMs,
        completionTokens,
        reasoningTokens,
        tokensPerSecond:
          Number.isFinite(completionTokens) && result.elapsedMs > 0
            ? completionTokens / (result.elapsedMs / 1000)
            : null,
      };
    } catch (error) {
      console.error('guest AI failed:', error);
      answer = friendlyError(error);
    }
  }

  const markdown = answerMarkdown(answer, {
    guest: true,
    question: question || cleanText(context),
    stats,
  });

  if (stats) {
    const used = stats.requestedModel !== stats.model ? `${stats.requestedModel} → ${stats.model}` : stats.model;
    console.log(
      `guest answer: ${String(answer).length} chars · ${used} (${stats.provider}) · ` +
        `${stats.elapsedMs} ms · ${stats.tokensPerSecond ? stats.tokensPerSecond.toFixed(1) : '?'} tok/s · ` +
        `${stats.completionTokens ?? '?'} tok`,
    );
  }

  try {
    await api.answerGuestQuery({
      guest_query_id: queryId,
      result: {
        type: 'article',
        id: `g${Date.now().toString(36)}`,
        title: question ? question.slice(0, 60) : 'AI FLYMES',
        input_message_content: {
          rich_message: { markdown },
        },
      },
    });
  } catch (error) {
    console.error('answerGuestQuery failed:', error?.description ?? error?.message ?? error);
  }
}