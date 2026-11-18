// Database helpers for chats and conversation history.
//
// History stays keyed by chat (a group shares one context), while the model and
// agent belong to the user — see lib/users.js.

import { db } from 'sdk';
import { eq, and, desc, sql } from 'sdk/db';
import { chats, messages } from '../schema.js';
import { HISTORY_CHARS, HISTORY_MESSAGES } from './config.js';

/** Create or refresh the chat row. */
export async function touchChat(message) {
  const chat = message.chat;
  const values = {
    id: chat.id,
    type: chat.type ?? 'private',
    title: chat.title ?? null,
    username: chat.username ?? null,
  };

  await db
    .insert(chats)
    .values(values)
    .onConflictDoUpdate({
      target: chats.id,
      set: {
        type: values.type,
        title: values.title,
        username: values.username,
        lastSeen: sql`(unixepoch())`,
      },
    })
    .run();
}

export async function addMessage(chatId, role, content) {
  await db.insert(messages).values({ chatId, role, content }).run();
}

/** Last N messages, oldest first, trimmed to a rough character budget. */
export async function getHistory(chatId) {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.id))
    .limit(HISTORY_MESSAGES)
    .all();

  const picked = [];
  let budget = HISTORY_CHARS;

  for (const row of rows) {
    if (budget <= 0) break;
    const content = row.content.length > budget ? row.content.slice(row.content.length - budget) : row.content;
    picked.push({ role: row.role, content });
    budget -= content.length;
  }

  return picked.reverse();
}

export async function clearHistory(chatId) {
  await db.delete(messages).where(eq(messages.chatId, chatId)).run();
}

/** Remove the most recent assistant answer (used by /retry). */
export async function dropLastAssistant(chatId) {
  const row = await db
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant')))
    .orderBy(desc(messages.id))
    .limit(1)
    .get();

  if (row) await db.delete(messages).where(eq(messages.id, row.id)).run();
  return row ?? null;
}

export async function lastMessage(chatId) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.id))
    .limit(1)
    .get();
}