import { table, integer, text, index, sql } from 'sdk/db';

// One row per Telegram user. Holds the user's own AI agent: the gateway they
// talk to, their (encrypted) key, and the models they may pick from.
export const users = table('users', {
  id: integer('id').primaryKey(),
  username: text('username'),
  firstName: text('first_name'),
  // Agent. `baseUrl` is the OpenAI-compatible root, e.g. https://api.x/v1.
  // `apiKey` is never stored in plain text: see lib/crypto.js.
  baseUrl: text('base_url'),
  apiKey: text('api_key'),
  // JSON array of model ids this user can pick from, and the active one.
  models: text('models'),
  model: text('model'),
  // Subscription cache for the required channel.
  subscribed: integer('subscribed'),
  subCheckedAt: integer('sub_checked_at', { mode: 'timestamp' }),
  // Which onboarding step is waiting for a text reply: url | key | model | null.
  onboard: text('onboard'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// One row per chat the bot has talked in. Keeps metadata used for logging.
export const chats = table('chats', {
  id: integer('id').primaryKey(),
  type: text('type'),
  title: text('title'),
  username: text('username'),
  // Was the per-chat model before models became per-user. Dropped on migrate.
  model: text('model').deprecated('models are per user now (users.model)'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Conversation history, per chat. Roles: "user" | "assistant".
export const messages = table(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: integer('chat_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  },
  (t) => ({
    chatIdx: index('idx_messages_chat').on(t.chatId),
  }),
);

// Small key/value store for short-lived UI state
// (e.g. "waiting for a model id" in this chat).
export const settings = table('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});