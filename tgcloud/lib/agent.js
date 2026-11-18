// The user's own AI agent: a BASE_URL + API_KEY for an OpenAI-compatible
// gateway. Everything here is pure I/O — no database access.

import { fetch } from 'sdk';
import { BASE_URL_RE } from './config.js';

const PROBE_TIMEOUT_MS = 15000;

const trimEnd = (value) => String(value ?? '').replace(/\/+$/, '');

/**
 * Normalise what a user typed into a gateway root:
 *   https://api.x/v1/          → https://api.x/v1
 *   https://api.x/v1/chat/completions → https://api.x/v1
 */
export function normalizeBaseUrl(raw) {
  let url = trimEnd(String(raw ?? '').trim());
  if (!url) return null;

  // Accept a bare host ("api.x/v1") — assume https.
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  url = trimEnd(url);
  url = url.replace(/\/chat\/completions$/i, '');
  url = trimEnd(url);
  // A trailing "/v1" is part of the root, but some users paste just the host.
  if (!BASE_URL_RE.test(url)) return null;

  return url;
}

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function getModels(baseUrl, apiKey) {
  const res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey) });
  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error?.message ?? '';
    } catch {
      // Non-JSON error body — the status is enough.
    }
    return { ok: false, status: res.status, detail };
  }

  const data = await res.json();
  const ids = (data?.data ?? data?.models ?? [])
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter((id) => typeof id === 'string' && id);

  return { ok: true, models: ids };
}

/**
 * Some gateways don't implement /models. Fall back to the cheapest possible
 * completion: it proves the URL and key work, which is what onboarding needs.
 */
async function probeChat(baseUrl, apiKey, model) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    }),
  });

  if (res.ok) return { ok: true, models: [model] };

  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message ?? '';
  } catch {
    // ignore
  }
  return { ok: false, status: res.status, detail };
}

function explain(status, detail) {
  const text = String(detail ?? '').toLowerCase();

  if (status === 401 || status === 403 || /unauthori[sz]ed|invalid.*key|authentication/.test(text)) {
    return 'Ключ не подошёл: шлюз ответил 401. Проверь API-ключ и попробуй снова.';
  }
  if (status === 404) {
    return 'По этому адресу нет API. Обычно BASE_URL оканчивается на `/v1` — проверь.';
  }
  if (status === 429) {
    return 'Шлюз ответил 429 (слишком много запросов или кончилась квота). Проверь лимиты.';
  }
  if (status >= 500) {
    return `Шлюз ответил ${status}. Похоже, проблема на его стороне — попробуй позже.`;
  }
  return `Шлюз ответил ${status}${detail ? `: ${detail.slice(0, 160)}` : ''}.`;
}

/**
 * Check a BASE_URL + API_KEY pair.
 * → { ok: true, baseUrl, models } | { ok: false, baseUrl, error }
 */
export async function validateAgent(rawBaseUrl, rawApiKey, fallbackModel) {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  if (!baseUrl) {
    return { ok: false, error: 'Это не похоже на URL. Пример: `https://api.openai.com/v1`' };
  }

  const apiKey = String(rawApiKey ?? '').trim();
  if (!apiKey || /\s/.test(apiKey)) {
    return { ok: false, baseUrl, error: 'Ключ пустой или содержит пробелы. Пришли его одним сообщением.' };
  }

  try {
    const listed = await getModels(baseUrl, apiKey);

    if (listed.ok && listed.models.length) {
      return { ok: true, baseUrl, models: listed.models };
    }

    // /models is missing or empty — prove the pair with a real completion.
    const probed = await probeChat(baseUrl, apiKey, fallbackModel);

    if (probed.ok) return { ok: true, baseUrl, models: probed.models };
    if (listed.ok) return { ok: false, baseUrl, error: explain(probed.status, probed.detail) };

    return { ok: false, baseUrl, error: explain(listed.status, listed.detail) };
  } catch (error) {
    const raw = String(error?.message ?? error ?? '');
    if (/timeout|timed out|abort/i.test(raw)) {
      return { ok: false, baseUrl, error: `Шлюз не ответил за ${PROBE_TIMEOUT_MS / 1000} секунд. Проверь адрес.` };
    }
    return {
      ok: false,
      baseUrl,
      error: `Не удалось подключиться к \`${baseUrl}\`. Проверь адрес и доступность шлюза.`,
    };
  }
}