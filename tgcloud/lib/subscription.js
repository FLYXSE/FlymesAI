// Membership check for the channel every user must subscribe to.
//
// getChatMember only reports other users' status when the bot is an admin of
// the channel — @FLYXSE_README has it as administrator. Any API error is
// treated as "not subscribed" (fail-closed): a broken check must not open the
// bot to everyone.

import { api } from 'sdk';
import { CHANNEL_USERNAME, SUBSCRIPTION_TTL_MS } from './config.js';
import { isAdmin } from './auth.js';
import { getSubCache, setSubCache } from './users.js';

const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

function statusIsSubscribed(member) {
  if (!member?.status) return false;
  if (MEMBER_STATUSES.has(member.status)) return true;
  // "restricted" users are still members when is_member is true.
  return member.status === 'restricted' && member.is_member === true;
}

/**
 * Is this user subscribed to the required channel?
 * Admins always pass; everyone else is checked against a short-lived cache.
 * @param {number} userId
 * @param {{ force?: boolean }} options force = ignore the cache
 */
export async function isSubscribed(userId, { force = false } = {}) {
  if (isAdmin(userId)) return true;

  if (!force) {
    const cache = await getSubCache(userId);
    // A fresh answer is trusted in both directions, so a non-subscriber who
    // keeps messaging does not hit the Bot API on every update.
    if (cache.checkedAt && Date.now() - cache.checkedAt < SUBSCRIPTION_TTL_MS) return cache.subscribed;
  }

  let member;
  try {
    member = await api.getChatMember({ chat_id: `@${CHANNEL_USERNAME}`, user_id: userId });
  } catch (error) {
    // Fail closed, but do NOT cache: a transient Bot API failure must not lock
    // the user out for the whole TTL.
    console.warn('subscription check failed:', error?.description ?? error?.message ?? error);
    return false;
  }

  const subscribed = statusIsSubscribed(member);

  // Cache both outcomes so a subscriber and a visitor are each answered from
  // the cache until the TTL expires.
  await setSubCache(userId, subscribed).catch(() => {});
  return subscribed;
}

export { CHANNEL_USERNAME };