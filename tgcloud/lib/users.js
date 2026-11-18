// Per-user records: their own AI agent, model list and onboarding state.

import { db } from 'sdk';
import { eq, sql } from 'sdk/db';
import { users } from '../schema.js';
import { AI_API_KEY, AI_BASE_URL, DEFAULT_MODEL, MODEL_ID_RE } from './config.js';
import { isAdmin } from './auth.js';
import { decrypt, encrypt } from './crypto.js';

export const ONBOARD = {
  URL: 'url',
  KEY: 'key',
  MODEL: 'model',
  MODEL_ADD: 'model-add',
};

function parseIds(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

async function read(userId) {
  return db.select().from(users).where(eq(users.id, userId)).get();
}

/**
 * Create the row on first contact and refresh `lastSeen`. Admins are seeded
 * with the agent from config.js so the bot keeps working without onboarding.
 */
export async function ensureUser(userId, from = {}) {
  const existing = await read(userId);
  if (existing) {
    const patch = { lastSeen: sql`(unixepoch())` };
    if (from.username !== undefined) patch.username = from.username ?? null;
    if (from.first_name !== undefined) patch.firstName = from.first_name ?? null;
    await db.update(users).set(patch).where(eq(users.id, userId)).run();
    return { ...existing, ...patch };
  }

  const seed = isAdmin(userId)
    ? {
        baseUrl: AI_BASE_URL,
        apiKey: await encrypt(AI_API_KEY),
        models: JSON.stringify([DEFAULT_MODEL]),
        model: DEFAULT_MODEL,
      }
    : {};

  const row = {
    id: userId,
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    ...seed,
  };

  await db.insert(users).values(row).onConflictDoNothing().run();
  return read(userId);
}

export async function getUser(userId) {
  return read(userId);
}

export async function setOnboard(userId, step) {
  await db.update(users).set({ onboard: step ?? null }).where(eq(users.id, userId)).run();
}

export async function clearOnboard(userId) {
  await setOnboard(userId, null);
}

export async function setBaseUrl(userId, baseUrl) {
  await db.update(users).set({ baseUrl }).where(eq(users.id, userId)).run();
}

/** Store the API key encrypted and remember the models it reported. */
export async function setAgent(userId, { baseUrl, apiKey, models }) {
  const ids = Array.isArray(models) ? models.filter((id) => MODEL_ID_RE.test(id)) : [];
  const list = ids.length ? ids : [DEFAULT_MODEL];

  await db
    .update(users)
    .set({
      baseUrl,
      apiKey: await encrypt(apiKey),
      models: JSON.stringify(list),
      model: list[0],
      onboard: null,
    })
    .where(eq(users.id, userId))
    .run();

  return list;
}

/** Decrypted agent credentials, or null when the user has not set them up. */
export async function getAgent(userId) {
  const row = await read(userId);
  if (!row?.baseUrl || !row?.apiKey) return null;

  const apiKey = await decrypt(row.apiKey);
  if (!apiKey) return null;

  return { baseUrl: row.baseUrl, apiKey };
}

/** Model ids this user can pick from. Never empty. */
export async function listModelIds(userId) {
  const ids = parseIds((await read(userId))?.models);
  return ids.length ? ids : [];
}

/** `[{ id, label }]` — the gateway does not give us labels, so id === label. */
export async function listModels(userId) {
  return (await listModelIds(userId)).map((id) => ({ id, label: id }));
}

/** The user's active model, falling back to the first one they have. */
export async function getModel(userId) {
  const row = await read(userId);
  const ids = parseIds(row?.models);
  if (!ids.length) return DEFAULT_MODEL;
  return ids.includes(row?.model) ? row.model : ids[0];
}

export async function setModel(userId, model) {
  await db.update(users).set({ model }).where(eq(users.id, userId)).run();
}

export async function addModel(userId, rawId) {
  const id = String(rawId ?? '').trim();

  if (!MODEL_ID_RE.test(id)) {
    return {
      ok: false,
      error: 'Некорректный id модели. Разрешены латиница, цифры и символы `. _ : / -`, до 60 знаков.',
    };
  }

  const row = await read(userId);
  const ids = parseIds(row?.models);
  if (ids.includes(id)) return { ok: false, exists: true, error: `Модель \`${id}\` уже есть в списке.` };

  await db
    .update(users)
    .set({ models: JSON.stringify([...ids, id]) })
    .where(eq(users.id, userId))
    .run();

  return { ok: true, id };
}

export async function removeModel(userId, rawId) {
  const id = String(rawId ?? '').trim();
  const row = await read(userId);
  const ids = parseIds(row?.models);

  if (!ids.includes(id)) return { ok: false, error: `Модели \`${id}\` нет в списке.` };
  if (ids.length <= 1) return { ok: false, error: 'Нельзя удалить последнюю модель — оставь хотя бы одну.' };

  const rest = ids.filter((item) => item !== id);
  const patch = { models: JSON.stringify(rest) };
  // Dropping the active model rolls back to the first one left.
  if (row.model === id) patch.model = rest[0];

  await db.update(users).set(patch).where(eq(users.id, userId)).run();
  return { ok: true, id };
}

/** Subscription cache: read the last known answer plus when it was checked. */
export async function getSubCache(userId) {
  const row = await read(userId);
  if (!row) return { subscribed: false, checkedAt: 0 };
  // The column is `mode: 'timestamp'`, so the driver hands back a Date.
  const checkedAt = row.subCheckedAt instanceof Date ? row.subCheckedAt.getTime() : Number(row.subCheckedAt ?? 0);
  return { subscribed: row.subscribed === 1, checkedAt };
}

export async function setSubCache(userId, subscribed) {
  await db
    .update(users)
    .set({ subscribed: subscribed ? 1 : 0, subCheckedAt: sql`(unixepoch())` })
    .where(eq(users.id, userId))
    .run();
}

/** True when the user has an agent configured (URL + readable key). */
export async function hasAgent(userId) {
  return Boolean(await getAgent(userId));
}