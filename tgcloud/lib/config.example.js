// Template for tgcloud/lib/config.js — copy it and fill in your own values:
//
//   cp tgcloud/lib/config.example.js tgcloud/lib/config.js
//
// config.js is git-ignored because everything in it is bundled into the
// deployed modules, so any secret here ships with the bot.

export const BOT_USERNAME = 'YourBotName';

// Channel shown on the "README.md" button and required for access.
export const CHANNEL_USERNAME = 'your_channel';
export const CHANNEL_URL = `https://t.me/${CHANNEL_USERNAME}`;

// Channel shown on the "README.md" button under guest answers.
export const README_CHANNEL = CHANNEL_URL;

// Admins: bypass the subscription gate and keep their own agent.
export const ADMIN_IDS = [123456789];

// How long a subscription check is trusted (ms). A forced check always refetches.
export const SUBSCRIPTION_TTL_MS = 5 * 60 * 1000;

// Master secret for encrypting users' API keys at rest (AES-256-GCM).
// Rotating it makes every stored key unreadable — users would re-enter them.
// Generate one: openssl rand -hex 24
// WARNING: changing it makes every stored user API key unreadable.
export const MASTER_SECRET = 'CHANGE_ME_48_HEX_CHARS';

// Seed agent for admins, so the bot keeps working without onboarding.
export const AI_BASE_URL = 'https://api.example.com/v1';
export const AI_API_KEY = 'REPLACE_WITH_YOUR_API_KEY';

export const DEFAULT_MODEL = 'deepseek-v4.1-flash';

// Model list used before a user's agent has reported its own /models.
export const MODELS = [
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
  { id: 'glm-5.3', label: 'GLM 5.3' },
];

export const MODEL_IDS = MODELS.map((m) => m.id);

// Model ids are passed straight to the AI provider and into callback data
// (64-byte limit), so keep them tame and short.
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,59}$/;

// A BASE_URL must be an absolute https URL. http stays allowed for local
// gateways (Ollama, LM Studio, …) reached through a tunnel.
export const BASE_URL_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s]*)?$/;

export const SYSTEM_PROMPT = `Ты — [AI] FLYMES, умный и дружелюбный ассистент внутри Telegram.

Правила:
- Отвечай на языке пользователя. Если он пишет по-русски — отвечай по-русски.
- Форматируй ответ в GitHub Flavored Markdown: заголовки, списки, таблицы, цитаты, блоки кода с указанием языка.
- Для формул используй LaTeX: $inline$ и $$block$$.
- Будь полезным и конкретным. Не начинай каждый ответ с представления.
- Не выдумывай факты. Если не знаешь — честно скажи и предложи, как проверить.
- Не добавляй в конце ответа кнопки, ссылки на бота и служебные подписи — интерфейс добавит их сам.
- Не упоминай, что ты языковая модель или что тебя вызвали через API.`;

// How many previous messages (user + assistant) are sent back to the model.
export const HISTORY_MESSAGES = 24;

// Rough character budget for the history sent to the model.
export const HISTORY_CHARS = 24000;

// Telegram rich messages allow up to 32768 characters.
export const MAX_ANSWER_CHARS = 30000;

export const AI_MAX_TOKENS = 6000;