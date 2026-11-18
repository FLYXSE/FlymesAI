// Builders for Telegram rich messages (markdown + embedded buttons).
//
// Premium emoji come from lib/emoji.js; the plain glyph is used inside tables
// and anywhere a custom emoji cannot render, so nothing breaks visually.

import { BOT_USERNAME, CHANNEL_URL, MAX_ANSWER_CHARS, MODEL_IDS } from './config.js';
import { md, plain, block } from './emoji.js';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function callbackButton(text, data, style) {
  return `<tg-button type="callback_data"${style ? ` style="${style}"` : ''} data="${esc(data)}">${text}</tg-button>`;
}

export function urlButton(text, url, style) {
  return `<tg-button type="url"${style ? ` style="${style}"` : ''} url="${esc(url)}">${text}</tg-button>`;
}

export function copyButton(text, value, style) {
  return `<tg-button type="copy_text"${style ? ` style="${style}"` : ''} text="${esc(value)}">${text}</tg-button>`;
}

export function buttonRow(buttons, align = 'left') {
  if (!buttons.length) return '';
  return `<tg-button-row align="${align}">${buttons.join('')}</tg-button-row>`;
}

function chatButtons() {
  return buttonRow([
    callbackButton(`${md('refresh')} Ещё вариант`, 'retry'),
    callbackButton(`${md('sparkles')} Новый диалог`, 'new', 'primary'),
    callbackButton(`${md('settings')} Модель`, 'models'),
  ]);
}

function guestButtons(question) {
  const query =
    String(question ?? '')
      .replace(new RegExp(`@${BOT_USERNAME}`, 'gi'), ' ')
      .replace(/\s+/g, ' ')
      .trim() || `@${BOT_USERNAME}`;
  return [
    '---',
    buttonRow([urlButton(`${md('book')} README.md`, CHANNEL_URL, 'success')], 'center'),
    buttonRow([copyButton(`${md('pin')} Запрос`, query.slice(0, 256), 'primary')], 'center'),
  ].join('\n\n');
}

function clamp(text) {
  const clean = String(text ?? '').trim();
  if (clean.length <= MAX_ANSWER_CHARS) return clean;
  return `${clean.slice(0, MAX_ANSWER_CHARS - 20)}\n\n… _(ответ обрезан)_`;
}

const groupDigits = (value) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function formatDuration(ms) {
  const value = Math.max(0, Math.round(Number(ms) || 0));
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s (${groupDigits(value)} ms)`;
}

/** "model · provider" + a line with time, speed and tokens. */
export function guestStatsMarkdown({ model, requestedModel, provider, elapsedMs, completionTokens, reasoningTokens, tokensPerSecond }) {
  const name =
    requestedModel && requestedModel !== model ? `\`${requestedModel}\` → \`${model}\`` : `\`${model}\``;
  const head = [name];
  if (provider) head.push(`**${provider}**`);

  const bits = [];
  if (Number.isFinite(elapsedMs)) bits.push(`${md('stopwatch')} ${formatDuration(elapsedMs)}`);
  if (Number.isFinite(tokensPerSecond) && tokensPerSecond > 0) {
    bits.push(`${md('bolt')} ${tokensPerSecond.toFixed(1)} tok/s`);
  }
  if (Number.isFinite(completionTokens) && completionTokens > 0) {
    const reasoning =
      Number.isFinite(reasoningTokens) && reasoningTokens > 0 ? ` (${groupDigits(reasoningTokens)} reasoning)` : '';
    bits.push(`${groupDigits(completionTokens)} tok${reasoning}`);
  }

  return bits.length ? `${head.join(' · ')}\n${bits.join(' · ')}` : head.join(' · ');
}

/** Rich message for an AI answer in a normal bot chat. */
export function answerMarkdown(text, { model, guest = false, question = '', stats, userId } = {}) {
  const body = clamp(text) || '_Пустой ответ. Попробуй переформулировать вопрос._';
  if (guest) {
    const meta = stats ? guestStatsMarkdown(stats) : '';
    // Divider between the answer and the stats, and another one before the
    // buttons (guestButtons() starts with its own divider).
    return `${body}${meta ? `\n\n---\n\n${meta}` : ''}\n\n${guestButtons(question)}`;
  }
  const footer = model ? `\n\n${esc(model)} · /help` : '';
  return `${body}\n\n${chatButtons()}${footer}`;
}

// ── Subscription gate ────────────────────────────────────────────────────────

/** Shown when the user has not subscribed to the required channel yet. */
export function subscribeGateMarkdown() {
  return `## ${md('lock')} Нужна подписка

Чтобы пользоваться ботом, подпишись на канал **README.md**.

1. Открой канал: ${md('channel')} [@FLYXSE_README](${CHANNEL_URL})
2. Нажми «Подписаться».
3. Вернись сюда и нажми кнопку ниже — я проверю ещё раз.

${buttonRow([urlButton(`${md('channel')} Открыть канал`, CHANNEL_URL, 'primary')], 'center')}

${buttonRow([callbackButton(`${md('check')} Я подписался`, 'sub:check', 'success')], 'center')}`;
}

/** Toast after a successful re-check. */
export const SUBSCRIBED_TOAST = 'Подписка подтверждена';

// ── Onboarding: agent setup ─────────────────────────────────────────────────

/** Step 1 — ask for the gateway URL. */
export function askBaseUrlMarkdown() {
  return `## ${md('magic')} Настроим агента

Бот работает на **твоём** AI-ключе: запросы идут напрямую на твой шлюз, а ключ хранится у меня в зашифрованном виде.

**Шаг 1 из 2 — адрес API.**

Пришли BASE_URL своего шлюза одним сообщением. Обычно он оканчивается на \`/v1\`:

\`\`\`
https://api.openai.com/v1
https://openrouter.ai/api/v1
http://localhost:11434/v1
\`\`\`

${buttonRow([callbackButton(`${md('cross')} Отмена`, 'onb:cancel')], 'left')}`;
}

/** Step 2 — ask for the key. */
export function askApiKeyMarkdown(baseUrl) {
  return `## ${md('key')} Шаг 2 из 2 — ключ

Шлюз: \`${esc(baseUrl)}\`

Теперь пришли **API-ключ** одним сообщением.

${md('shield')} Ключ шифруется и сохраняется только для тебя.
${md('trash')} Твоё сообщение с ключом я сразу удалю из чата.

${buttonRow([callbackButton(`${md('cross')} Отмена`, 'onb:cancel')], 'left')}`;
}

/** The agent answered — show what it reported. */
export function agentReadyMarkdown(baseUrl, models) {
  return `## ${md('party')} Агент подключён

${md('check')} Шлюз \`${esc(baseUrl)}\` ответил.
${md('puzzle')} Моделей доступно: **${models.length}**

Выбери модель кнопкой ниже — или сразу задай вопрос.

${buttonRow([callbackButton(`${md('settings')} Выбрать модель`, 'models', 'primary')], 'left')}`;
}

/** A retryable onboarding failure. */
export function onboardingErrorMarkdown(error) {
  return `## ${md('warning')} Не получилось

${esc(error)}

Пришли значение ещё раз — или нажми «Отмена».

${buttonRow([callbackButton(`${md('cross')} Отмена`, 'onb:cancel')], 'left')}`;
}

/** Agent configured but the gateway rejects the key now (401/404/…). */
export function agentBrokenMarkdown(reason) {
  return `## ${md('ban')} Агент не отвечает

${esc(reason)}

Ключ или адрес могли измениться. Пройди настройку заново.

${buttonRow([callbackButton(`${md('settings')} Настроить заново`, 'onb:url', 'primary')], 'left')}`;
}

/** Shown in a group when the author has no agent yet. */
export function setupInPrivateMarkdown() {
  return `## ${md('magic')} Сначала настрой агента

Каждый работает на своём AI-ключе, поэтому настройка живёт в личном чате.

${buttonRow(
    [urlButton(`${md('speech')} Открыть личку`, `https://t.me/${BOT_USERNAME}?start=setup`, 'primary')],
    'center',
  )}`;
}

// ── Main menu ────────────────────────────────────────────────────────────────

/** Welcome screen, built with explicit blocks (RichBlockButtons). */
export function welcomeRich() {
  return {
    blocks: [
      {
        type: 'heading',
        size: 1,
        text: [block('sparkles'), ' [AI] FLYMES'],
      },
      {
        type: 'paragraph',
        text: [
          'Привет! Я AI-ассистент на базе ',
          { type: 'bold', text: 'твоего AI-ключа' },
          '. Пиши вопрос — отвечу с таблицами, списками, кодом и формулами.',
        ],
      },
      { type: 'divider' },
      {
        type: 'paragraph',
        text: [
          'Меня можно позвать в любой чат: упомяни ',
          { type: 'code', text: `@${BOT_USERNAME}` },
          ' — и я отвечу прямо там, даже не состоя в чате.',
        ],
      },
      {
        type: 'buttons',
        buttons: [
          { text: [block('sparkles'), ' Новый диалог'], callback_data: 'new', style: 'primary' },
          { text: [block('question'), ' Что я умею'], callback_data: 'help' },
          { text: [block('settings'), ' Выбрать модель'], callback_data: 'models' },
        ],
        align: 'left',
      },
      { type: 'footer', text: 'Telegram Serverless · Rich messages · Guest mode' },
    ],
  };
}

/** Confirmation after /new. */
export function newDialogMarkdown() {
  return `${md('sparkles')} **Новый диалог начат.**\n\nКонтекст очищен — спрашивай что угодно.\n\n${chatButtons()}`;
}

/** Confirmation after switching the model. */
export function modelChangedMarkdown(model) {
  return `${md('check')} Модель для тебя: \`${esc(model)}\`.\n\n${chatButtons()}`;
}

/** Help text (rich markdown). */
export function helpMarkdown(models = []) {
  const list = models.length ? models : MODEL_IDS.map((id) => ({ id, label: id }));

  // Tables need plain glyphs: a custom emoji inside a cell is not guaranteed
  // to render, and would unbalance the layout if it did not.
  return `## ${md('robot')} Что я умею

- Отвечаю на любые вопросы и держу контекст диалога.
- Работаю на **твоём** шлюзе: BASE_URL и ключ ты задаёшь сам.
- Оформляю ответы как **rich messages**: заголовки, списки, таблицы, код, формулы LaTeX.
- Работаю в личке, в группах и в **guest mode** — по упоминанию \`@${BOT_USERNAME}\` в любом чате.

## ${md('keyboard')} Команды

| Команда | Действие |
|:--|:--|
| \`/new\` | Начать новый диалог (очистить контекст) |
| \`/retry\` | Сгенерировать ответ заново |
| \`/model\` | Показать и сменить модель |
| \`/model add <id>\` | Добавить модель в список |
| \`/model del <id>\` | Убрать модель из списка |
| \`/agent\` | Перенастроить BASE_URL и ключ |
| \`/help\` | Это сообщение |

## ${md('puzzle')} Твои модели

${list.map((m) => `- \`${esc(m.id)}\`${m.label && m.label !== m.id ? ` — ${esc(m.label)}` : ''}`).join('\n') || '_список пуст_'}

${plain('star')} Список свой у каждого: кнопка **${plain('settings')} Модель** или \`/model add <id>\` / \`/model del <id>\`.

${chatButtons()}`;
}

/** Split buttons into rows of two. */
function rowsOfTwo(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  return rows;
}

/** Model picker built with blocks + RichBlockButtons rows. */
export function modelPicker(models, current) {
  const buttons = models.map((m) => ({
    text: [
      m.id === current ? block('check') : '',
      m.id === current ? ' ' : '',
      m.label && m.label !== m.id ? m.label : m.id,
    ].filter(Boolean),
    callback_data: `m:${m.id}`,
    ...(m.id === current ? { style: 'primary' } : {}),
  }));

  return {
    blocks: [
      { type: 'heading', size: 2, text: [block('settings'), ' Модель AI'] },
      {
        type: 'paragraph',
        text: ['Сейчас выбрана ', { type: 'code', text: current }, `. В списке: ${models.length}.`],
      },
      ...rowsOfTwo(buttons).map((row) => ({ type: 'buttons', buttons: row, align: 'left' })),
      {
        type: 'buttons',
        buttons: [
          { text: [block('add'), ' Добавить модель'], callback_data: 'mA' },
          { text: [block('trash'), ' Удалить модель'], callback_data: 'mD' },
        ],
        align: 'left',
      },
      {
        type: 'paragraph',
        text: [{ type: 'italic', text: 'Модель запоминается отдельно для каждого пользователя.' }],
      },
    ],
  };
}

/** Ask the owner to type a model id. */
export function addModelPrompt() {
  return {
    blocks: [
      { type: 'heading', size: 2, text: [block('add'), ' Добавить модель'] },
      {
        type: 'paragraph',
        text: [
          'Отправь ',
          { type: 'bold', text: 'id модели' },
          ' одним сообщением — например, ',
          { type: 'code', text: 'deepseek-v4.1-flash' },
          '.',
        ],
      },
      {
        type: 'paragraph',
        text: [{ type: 'italic', text: 'Разрешены латиница, цифры и символы . _ : / - (до 60 знаков).' }],
      },
      { type: 'buttons', buttons: [{ text: [block('cross'), ' Отмена'], callback_data: 'mX' }], align: 'center' },
    ],
  };
}

/** List of models with a "remove" button for each of them. */
export function deleteModelPicker(models, current) {
  const buttons = models.map((m) => ({
    text: [block('trash'), ' ', m.label && m.label !== m.id ? m.label : m.id],
    callback_data: `md:${m.id}`,
  }));

  return {
    blocks: [
      { type: 'heading', size: 2, text: [block('trash'), ' Удалить модель'] },
      {
        type: 'paragraph',
        text: [
          { type: 'italic', text: 'Нажми, чтобы убрать модель из списка. Текущая модель: ' },
          { type: 'code', text: current },
          { type: 'italic', text: '.' },
        ],
      },
      ...rowsOfTwo(buttons).map((row) => ({ type: 'buttons', buttons: row, align: 'left' })),
      { type: 'buttons', buttons: [{ text: [block('arrowLeft'), ' Назад'], callback_data: 'models' }], align: 'left' },
    ],
  };
}

/** Shown when a model button is pressed outside a private chat. */
export function modelInPrivateMarkdown() {
  return `## ${md('settings')} Модель меняется в личке

Список моделей и переключение доступны только в личном чате со мной.

${buttonRow(
    [urlButton(`${md('speech')} Открыть личку`, `https://t.me/${BOT_USERNAME}?start=model`, 'primary')],
    'center',
  )}`;
}

export function plainText(rich) {
  if (rich?.markdown) {
    return String(rich.markdown)
      .replace(/!\[[^\]]*\]\(tg:\/\/emoji\?id=\d+\)/g, '')
      .replace(/<tg-button-row[\s\S]*?<\/tg-button-row>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*|__|~~|`{1,3}/g, '')
      .trim();
  }
  if (rich?.html) return String(rich.html).replace(/<[^>]+>/g, '').trim();
  if (Array.isArray(rich?.blocks)) return blocksToText(rich.blocks).trim();
  return '…';
}

function blocksToText(blocks) {
  return blocks.map(blockToText).filter(Boolean).join('\n');
}

function blockToText(block) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'footer':
    case 'pre':
    case 'mathematical_expression':
      return richTextToString(block.text);
    case 'divider':
      return '———';
    case 'buttons':
      return (block.buttons ?? []).map((b) => richTextToString(b.text)).join(' · ');
    default:
      if (Array.isArray(block.items)) {
        return block.items.map((item) => blockToText(item)).filter(Boolean).join('\n');
      }
      return '';
  }
}

function richTextToString(text) {
  if (text == null) return '';
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) return text.map(richTextToString).join('');
  if (text.type === 'custom_emoji') return text.alternative_text ?? '';
  if (text.type === 'button') return richTextToString(text.button?.text);
  return richTextToString(text.text ?? '');
}