import { ChannelType, PermissionFlagsBits } from 'discord.js';

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const STAFF_FALLBACK_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
];

export const TICKET_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
];

/**
 * Ticket Tool channels are named like ticket-0002 and live in the
 * "ᯓ➤ START HERE 🔒" category. The name pattern is required. When the
 * parent category is visible it must also match, so the bot's own /ticket
 * channels (usually under a category named "Tickets") are left alone.
 * If the parent cannot be seen, the name match is enough.
 */
export function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function categoryMatches(parentName, expected) {
  const want = normalizeLabel(expected);
  if (!want) return true;
  const got = normalizeLabel(parentName);
  if (!got) return false;
  if (got.includes(want)) return true;
  const letters = (text) => text.replace(/[^\p{L}\p{N}]+/gu, '');
  const compactWant = letters(want);
  return compactWant.length > 0 && letters(got).includes(compactWant);
}

export function ticketChannelDecision(channel, config) {
  if (!channel || !TEXT_TYPES.has(channel.type)) {
    return { match: false, reason: 'not a text channel' };
  }
  if (!nameMatches(config.namePattern, channel.name || '')) {
    return { match: false, reason: 'name does not match' };
  }

  const expected = (config.categoryName || '').trim();
  if (!expected) return { match: true };

  const parent = channel.parent
    || channel.guild?.channels?.cache?.get?.(channel.parentId)
    || null;
  if (!parent?.name) return { match: true, categoryUnverified: true };
  if (!categoryMatches(parent.name, expected)) {
    return { match: false, reason: `category "${parent.name}" does not contain "${expected}"` };
  }
  return { match: true, category: parent.name };
}

export function isTicketChannel(channel, config) {
  return ticketChannelDecision(channel, config).match;
}

function nameMatches(pattern, name) {
  if (!pattern) return false;
  pattern.lastIndex = 0;
  return pattern.test(name);
}

function cleanLine(line) {
  return line.replace(/[*_~`>#]/g, '').trim();
}

function reasonsInText(blob) {
  const lines = String(blob || '')
    .split(/\n/)
    .map((line) => cleanLine(line))
    .filter(Boolean);
  const haystack = lines.join('\n');
  const found = [];
  if (/claim invite reward/i.test(haystack)) found.push('invite_reward');
  if (/contact with management/i.test(haystack)) found.push('management');
  if (/suggestions or problems/i.test(haystack)) found.push('suggestions');
  if (/education program questions/i.test(haystack)) found.push('education');
  if (
    lines.some((line) => /^partnership$/i.test(line))
    || /(?:reason|topic|category|option|type|department)\s*[:\-]\s*partnership\b/i.test(haystack)
  ) {
    found.push('partnership');
  }
  if (
    lines.some((line) => /^other$/i.test(line))
    || /(?:reason|topic|category|option|type|department)\s*[:\-]\s*other\b/i.test(haystack)
  ) {
    found.push('other');
  }
  return found;
}

/**
 * Each blob is one message or the channel topic, checked on its own.
 * A blob that lists several panel options is ignored so a copied menu
 * cannot mark every ticket as "Claim invite reward".
 */
export function detectTicketReason(blobs) {
  for (const blob of blobs) {
    const found = reasonsInText(blob);
    if (found.length === 1) return found[0];
  }
  return 'unknown';
}

function mentionUsers(message) {
  const users = message?.mentions?.users;
  if (!users) return [];
  if (typeof users.values === 'function') return [...users.values()];
  if (Array.isArray(users)) return users;
  return [];
}

/**
 * Ticket Tool puts the member's reason in an embed field, not in a
 * follow-up message. The live shape is content "@member Welcome" plus
 * a field "Why are you opening this ticket?" whose value is the question.
 */
export function extractTicketToolPrompt(message) {
  const fields = [];
  for (const embed of message?.embeds || []) {
    for (const field of embed.fields || []) {
      const name = String(field?.name || '').trim();
      const value = String(field?.value || '').trim();
      if (name || value) fields.push({ name, value });
    }
  }

  const preferred = fields.find((field) =>
    /why are you opening|your question|question|reason|request|topic/i.test(field.name)
    && field.value
  );
  const chosen = preferred || fields.find((field) => field.value) || null;
  const human = mentionUsers(message).find((user) => user && !user.bot);

  let openerId = human?.id || null;
  if (!openerId) {
    const match = String(message?.content || '').match(/<@!?(\d{17,20})>/);
    openerId = match?.[1] || null;
  }

  return {
    question: chosen?.value || '',
    fieldName: chosen?.name || '',
    openerId,
  };
}

export function openerFromOverwrites(channel, botUserId) {
  const overwrites = channel?.permissionOverwrites?.cache;
  if (!overwrites || typeof overwrites.values !== 'function') return null;
  for (const overwrite of overwrites.values()) {
    const isMember = overwrite?.type === 1 || overwrite?.type === 'member';
    if (!isMember) continue;
    if (!overwrite.id || overwrite.id === botUserId) continue;
    return overwrite.id;
  }
  return null;
}

export function messageToText(message) {
  if (!message) return '';
  const parts = [message.content || ''];
  for (const embed of message.embeds || []) {
    parts.push(embed.title, embed.description, embed.author?.name, embed.footer?.text);
    for (const field of embed.fields || []) {
      parts.push(field.name, field.value);
    }
  }
  return parts.filter(Boolean).join('\n');
}

/**
 * Staff comes from TICKET_STAFF_ROLE_IDS / TICKET_STAFF_USER_IDS.
 * When both are unset, people who can manage the channel still count as
 * staff so a real reply stops the bot, but nobody is pinged.
 */
export function isStaffMember(member, userId, config) {
  if (userId && config.staffUserIds.includes(String(userId))) return true;
  if (member && config.staffRoleIds.some((id) => member.roles?.cache?.has?.(id))) return true;
  if (config.staffRoleIds.length || config.staffUserIds.length) return false;
  const permissions = member?.permissions;
  if (!permissions?.has) return false;
  return STAFF_FALLBACK_PERMISSIONS.some((bit) => permissions.has(bit));
}

export function hasTicketPermissions(permissions) {
  if (!permissions?.has) return false;
  return TICKET_PERMISSIONS.every((bit) => permissions.has(bit));
}

export function isMissingAccessError(error) {
  const code = Number(error?.code ?? error?.rawError?.code);
  return code === 50001 || code === 50013;
}
