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
export function isTicketChannel(channel, config) {
  if (!channel || !TEXT_TYPES.has(channel.type)) return false;
  if (!nameMatches(config.namePattern, channel.name || '')) return false;

  const expected = (config.categoryName || '').trim().toLowerCase();
  if (!expected) return true;

  const parent = channel.parent
    || channel.guild?.channels?.cache?.get?.(channel.parentId)
    || null;
  if (!parent?.name) return true;
  return parent.name.toLowerCase().includes(expected);
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
