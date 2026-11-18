// The two conversation flows shared by the message and callback handlers.

import { addMessage, dropLastAssistant, getHistory } from './repo.js';
import { getAgent, getModel } from './users.js';
import { generate } from './generate.js';

/**
 * Store the user's message, answer it, and store the answer.
 * `userId` owns the agent and the model; `chatId` owns the history.
 */
export async function answerQuestion({ chatId, chatType, threadId, replyTo, text, author, userId }) {
  const content = chatType === 'private' ? text : `[${author ?? 'user'}]: ${text}`;

  await addMessage(chatId, 'user', content);

  const history = await getHistory(chatId);
  const [model, agent] = await Promise.all([getModel(userId), getAgent(userId)]);

  const answer = await generate({ chatId, chatType, messages: history, model, agent, replyTo, threadId });

  await addMessage(chatId, 'assistant', answer);
  return answer;
}

/** Drop the last answer and regenerate it from the existing history. */
export async function regenerate({ chatId, chatType, threadId, replyTo, userId }) {
  await dropLastAssistant(chatId);

  const history = await getHistory(chatId);
  if (!history.length || history[history.length - 1].role !== 'user') return null;

  const [model, agent] = await Promise.all([getModel(userId), getAgent(userId)]);
  const answer = await generate({ chatId, chatType, messages: history, model, agent, replyTo, threadId });

  await addMessage(chatId, 'assistant', answer);
  return answer;
}