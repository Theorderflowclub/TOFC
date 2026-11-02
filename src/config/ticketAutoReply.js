import { logger } from '../utils/logger.js';

export const DEFAULT_TICKET_NAME_PATTERN = '^ticket-\\d+';
export const DEFAULT_TICKET_CATEGORY_NAME = 'START HERE';
export const DEFAULT_AUTO_REPLY_MAX = 6;

function boolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  logger.warn(`TOFC ticket auto-reply: ignoring invalid ${name}="${raw}". Using ${defaultValue}.`);
  return defaultValue;
}

function idList(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return [];
  const valid = [];
  const invalid = [];
  for (const part of String(raw).split(',').map((item) => item.trim()).filter(Boolean)) {
    if (/^\d{17,20}$/.test(part)) valid.push(part);
    else invalid.push(part);
  }
  if (invalid.length) {
    logger.warn(`TOFC ticket auto-reply: ignoring non-Discord ids in ${name}: ${invalid.join(', ')}`);
  }
  return valid;
}

function namePattern() {
  const source = (process.env.TICKET_CHANNEL_NAME_PATTERN || '').trim() || DEFAULT_TICKET_NAME_PATTERN;
  try {
    return new RegExp(source, 'i');
  } catch (error) {
    logger.warn(
      `TOFC ticket auto-reply: invalid TICKET_CHANNEL_NAME_PATTERN (${error.message}). Using ${DEFAULT_TICKET_NAME_PATTERN}.`
    );
    return new RegExp(DEFAULT_TICKET_NAME_PATTERN, 'i');
  }
}

function maxReplies() {
  const raw = (process.env.TICKET_AUTO_REPLY_MAX || '').trim();
  if (!raw) return DEFAULT_AUTO_REPLY_MAX;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    logger.warn(`TOFC ticket auto-reply: invalid TICKET_AUTO_REPLY_MAX="${raw}". Using ${DEFAULT_AUTO_REPLY_MAX}.`);
    return DEFAULT_AUTO_REPLY_MAX;
  }
  return parsed;
}

/**
 * Optional env only. Unset values keep the defaults so a Railway deploy
 * does not need new variables or a token reset.
 */
export function getTicketAutoReplyConfig() {
  const categoryRaw = process.env.TICKET_CATEGORY_NAME;
  return {
    enabled: boolEnv('TICKET_AUTO_REPLY_ENABLED', true),
    namePattern: namePattern(),
    categoryName: categoryRaw == null ? DEFAULT_TICKET_CATEGORY_NAME : String(categoryRaw).trim(),
    staffRoleIds: idList('TICKET_STAFF_ROLE_IDS'),
    staffUserIds: idList('TICKET_STAFF_USER_IDS'),
    maxReplies: maxReplies(),
  };
}

export function staffConfigIsSet(config) {
  return config.staffRoleIds.length > 0 || config.staffUserIds.length > 0;
}
