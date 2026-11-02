import { PermissionFlagsBits } from 'discord.js';

export const FOUNDERS_ROLE_NAME = 'founders tofc';

export function isQaOwner(member) {
  if (!member || member.user?.bot) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = member.roles?.cache;
  if (!roles) return false;
  for (const role of roles.values()) {
    if (String(role.name || '').trim().toLowerCase() === FOUNDERS_ROLE_NAME) return true;
  }
  return false;
}

export function canRunQaExport(member) {
  return isQaOwner(member);
}
