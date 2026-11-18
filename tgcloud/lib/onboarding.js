// The agent-setup dialogue: BASE_URL → API_KEY → models.
//
// A user in the middle of onboarding has `users.onboard` set, and their next
// plain text is consumed here instead of reaching the AI. Any slash-command
// clears the step first, so /cancel and /help always work.

import { api } from 'sdk';
import { DEFAULT_MODEL } from './config.js';
import { normalizeBaseUrl, validateAgent } from './agent.js';
import {
  ONBOARD,
  addModel,
  clearOnboard,
  getAgent,
  getModel,
  getUser,
  listModels,
  setAgent,
  setBaseUrl,
  setOnboard,
} from './users.js';
import {
  agentReadyMarkdown,
  askApiKeyMarkdown,
  modelChangedMarkdown,
  modelPicker,
  onboardingErrorMarkdown,
} from './rich.js';

/** Delete the user's message so a pasted secret does not stay in the chat. */
async function deleteUserMessage(message) {
  try {
    await api.deleteMessage({ chat_id: message.chat.id, message_id: message.message_id });
  } catch {
    // No permission or already gone — nothing to do; the key is never echoed.
  }
}

/**
 * Consume the message if it answers an onboarding step.
 * @param {object} message Telegram Message
 * @param {(rich: object) => Promise<unknown>} reply
 * @returns {Promise<boolean>} true when the message was handled
 */
export async function handleOnboarding(message, reply) {
  const userId = message.from?.id;
  if (!userId) return false;

  const user = await getUser(userId);
  const step = user?.onboard;
  if (!step) return false;

  const text = String(message.text ?? message.caption ?? '').trim();

  // Commands fall through so /cancel and /help are never swallowed.
  if (!text || text.startsWith('/')) {
    await clearOnboard(userId);
    return false;
  }

  if (step === ONBOARD.URL) {
    const baseUrl = normalizeBaseUrl(text);
    if (!baseUrl) {
      await reply({
        markdown: onboardingErrorMarkdown('Это не похоже на URL. Пример: `https://api.openai.com/v1`'),
      });
      return true;
    }

    await setBaseUrl(userId, baseUrl);
    await setOnboard(userId, ONBOARD.KEY);
    await reply({ markdown: askApiKeyMarkdown(baseUrl) });
    return true;
  }

  if (step === ONBOARD.KEY) {
    await deleteUserMessage(message);

    const baseUrl = normalizeBaseUrl(user?.baseUrl ?? '');
    if (!baseUrl) {
      await setOnboard(userId, ONBOARD.URL);
      await reply({ markdown: onboardingErrorMarkdown('Я потерял адрес шлюза. Пришли BASE_URL заново.') });
      return true;
    }

    const result = await validateAgent(baseUrl, text, DEFAULT_MODEL);
    if (!result.ok) {
      await reply({ markdown: onboardingErrorMarkdown(result.error) });
      return true;
    }

    await setAgent(userId, { baseUrl: result.baseUrl, apiKey: text, models: result.models });
    await reply({ markdown: agentReadyMarkdown(result.baseUrl, result.models) });
    await reply(modelPicker(await listModels(userId), await getModel(userId)));
    return true;
  }

  if (step === ONBOARD.MODEL_ADD) {
    await clearOnboard(userId);
    const added = await addModel(userId, text);

    if (!added.ok) {
      await reply({ markdown: onboardingErrorMarkdown(added.error) });
      return true;
    }

    // Adding a model does not switch to it — the user picks it in the list.
    await reply({ markdown: modelChangedMarkdown(await getModel(userId)) });
    await reply(modelPicker(await listModels(userId), await getModel(userId)));
    return true;
  }

  // Unknown step (e.g. left over from an older build) — drop it and continue.
  await clearOnboard(userId);
  return false;
}

/** True when the user still needs to finish (or redo) agent setup. */
export async function needsAgent(message) {
  const userId = message.from?.id;
  if (!userId) return false;
  return !(await getAgent(userId));
}