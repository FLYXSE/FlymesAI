// Access control.

import { ADMIN_IDS } from './config.js';

export function isAdmin(userId) {
  return ADMIN_IDS.some((id) => Number(id) === Number(userId));
}

// Kept for the private-era call sites: an admin is the only "special" user.
export const isOwner = isAdmin;