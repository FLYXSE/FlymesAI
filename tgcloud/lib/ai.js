// Thin client for OpenAI-compatible endpoints.
// Uses the platform `fetch` (no npm packages are available at runtime).
//
// Every entry point takes the caller's agent ({ baseUrl, apiKey }) — there is
// no global key any more, since each user brings their own gateway.

import { fetch } from 'sdk';
import { AI_MAX_TOKENS } from './config.js';

function requestHeaders(apiKey, { stream = false } = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: stream ? 'text/event-stream' : 'application/json',
  };
}

async function post(agent, body, { stream = false } = {}) {
  const res = await fetch(`${agent.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: requestHeaders(agent.apiKey, { stream }),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const data = await res.json();
      detail = data?.error?.message ?? JSON.stringify(data);
    } catch {
      try {
        detail = await res.text();
      } catch {
        detail = '';
      }
    }
    throw new Error(`AI ${res.status}: ${detail || res.statusText || 'request failed'}`.slice(0, 400));
  }

  return res;
}

/**
 * Buffered completion with metadata: the assistant text plus which model the
 * gateway actually used, the token usage and how long the request took.
 */
export async function completeDetailed(messages, model, agent, maxTokens = AI_MAX_TOKENS) {
  const started = Date.now();

  const res = await post(agent, {
    model,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
    // Buffered answers are shown after a "typing…" pause, so prefer speed here.
    reasoning_effort: 'low',
    stream: false,
  });

  const data = await res.json();
  const elapsedMs = Date.now() - started;

  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? '';

  if (!content && choice?.finish_reason === 'length') {
    return {
      text: '_Ответ получился слишком длинным. Попробуй переформулировать вопрос короче._',
      model: data?.model ?? model,
      usage: data?.usage ?? null,
      elapsedMs,
    };
  }

  return {
    text: String(content).trim(),
    model: data?.model ?? model,
    usage: data?.usage ?? null,
    elapsedMs,
  };
}

/** Buffered completion. Returns the assistant text. */
export async function complete(messages, model, agent, maxTokens = AI_MAX_TOKENS) {
  const { text } = await completeDetailed(messages, model, agent, maxTokens);
  return text;
}

/**
 * Streaming completion (SSE). Calls `onText(fullTextSoFar)` while tokens arrive
 * and returns the final text. Throws on transport/API errors so the caller can
 * fall back to `complete()`.
 */
export async function completeStream(messages, model, agent, onText) {
  const res = await post(
    agent,
    {
      model,
      messages,
      temperature: 0.7,
      max_tokens: AI_MAX_TOKENS,
      stream: true,
    },
    { stream: true },
  );

  if (!res.body) throw new Error('AI stream: empty body');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });

    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onText?.(text);
        }
      } catch {
        // Ignore keep-alive / malformed chunks.
      }
    }
  }

  return text.trim();
}