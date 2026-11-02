import { ChannelType } from 'discord.js';
import { logger, startupLog } from '../../utils/logger.js';
import { getTicketAutoReplyConfig, staffConfigIsSet } from '../../config/ticketAutoReply.js';
import { loadTicketFaq } from './faqStore.js';
import {
  detectTicketReason,
  hasTicketPermissions,
  isMissingAccessError,
  isStaffMember,
  isTicketChannel,
  messageToText,
} from './detect.js';
import { buildStateFromHistory, decideReply, renderReply } from './decide.js';

const ACCESS_WARNING = [
  'Ticket Tool sets per-channel permissions, so TOFC Bot cannot see ticket channels unless its role is allowed.',
  'Add the bot role in Ticket Tool\'s support-role settings, or grant View Channel, Read Message History, and Send Messages on the "ᯓ➤ START HERE 🔒" category.',
  'No token reset is required.',
].join(' ');

const locks = new Map();
const accessWarned = new Set();
let staffUnsetWarned = false;

function warnStaffUnset() {
  if (staffUnsetWarned) return;
  staffUnsetWarned = true;
  logger.warn(
    'TOFC ticket auto-reply: TICKET_STAFF_ROLE_IDS and TICKET_STAFF_USER_IDS are unset. '
    + 'The bot will not ping anyone. It still stops auto-answering when someone with Administrator, Manage Messages, or Manage Channels speaks in the ticket. '
    + 'Set those env vars in Railway to ping a specific role or person. Leaving them unset is safe.'
  );
}

export function logTicketAccessWarning(channel, error) {
  const id = channel?.id || 'unknown';
  if (accessWarned.has(id)) return;
  accessWarned.add(id);
  const code = error?.code ? ` Discord error ${error.code}.` : '';
  logger.warn(
    `TOFC ticket auto-reply: missing access to #${channel?.name || id} (${id}). ${ACCESS_WARNING}${code}`
  );
}

export function forgetTicketChannel(channelId) {
  if (!channelId) return;
  locks.delete(channelId);
  accessWarned.delete(channelId);
}

export function noteNewTicketChannel(channel) {
  const config = getTicketAutoReplyConfig();
  if (!config.enabled || !channel?.guild || !isTicketChannel(channel, config)) return;
  logger.info(
    `TOFC ticket auto-reply: watching #${channel.name} (${channel.id}). Waiting for the member's question.`
  );
  const me = channel.guild.members?.me;
  if (!me) return;
  const perms = channel.permissionsFor(me);
  if (!hasTicketPermissions(perms)) {
    logTicketAccessWarning(channel);
  }
}

export async function auditTicketAccess(client) {
  try {
    const config = getTicketAutoReplyConfig();
    if (!config.enabled) {
      startupLog('TOFC ticket auto-reply is off (TICKET_AUTO_REPLY_ENABLED=false).');
      return;
    }
    startupLog('TOFC ticket auto-reply enabled. Answers come from data/ticket-faq.json.');
    if (!staffConfigIsSet(config)) warnStaffUnset();

    for (const guild of client.guilds.cache.values()) {
      const expected = config.categoryName.trim().toLowerCase();
      if (expected) {
        const visible = guild.channels.cache.some((channel) =>
          channel.type === ChannelType.GuildCategory
          && channel.name.toLowerCase().includes(expected)
        );
        if (!visible) {
          logger.warn(
            `TOFC ticket auto-reply: no category containing "${config.categoryName}" is visible in ${guild.name} (${guild.id}). `
            + `If tickets are created under "ᯓ➤ START HERE 🔒", the bot cannot see that category. ${ACCESS_WARNING}`
          );
        }
      }

      const me = guild.members.me;
      for (const channel of guild.channels.cache.values()) {
        if (!isTicketChannel(channel, config)) continue;
        const perms = me ? channel.permissionsFor(me) : null;
        if (!hasTicketPermissions(perms)) logTicketAccessWarning(channel);
      }
    }
  } catch (error) {
    logger.error('TOFC ticket auto-reply: startup access check failed:', error);
  }
}

export async function handleTicketMessage(message, client) {
  try {
    const config = getTicketAutoReplyConfig();
    if (!config.enabled) return;
    if (!message.guild || message.author?.bot || message.webhookId) return;
    if (!isTicketChannel(message.channel, config)) return;

    const key = message.channel.id;
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => processTicketMessage(message, client, config));
    locks.set(key, current);
    await current;
  } catch (error) {
    logger.error(
      `TOFC ticket auto-reply failed in #${message.channel?.name || message.channelId}:`,
      error
    );
  }
}

async function processTicketMessage(message, client, config) {
  const me = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
  const perms = me ? message.channel.permissionsFor(me) : null;
  if (!hasTicketPermissions(perms)) {
    logTicketAccessWarning(message.channel);
    return;
  }

  const prefix = (process.env.PREFIX || '!').trim() || '!';
  if ((message.content || '').trim().startsWith(prefix)) return;

  if (!staffConfigIsSet(config)) warnStaffUnset();

  const faq = loadTicketFaq();
  if (!faq) return;

  let fetched;
  try {
    fetched = await message.channel.messages.fetch({ limit: 50 });
  } catch (error) {
    if (isMissingAccessError(error)) {
      logTicketAccessWarning(message.channel, error);
      return;
    }
    logger.warn(
      `TOFC ticket auto-reply: could not read history in #${message.channel.name}: ${error.message}`
    );
    fetched = new Map();
  }

  const messages = new Map(fetched);
  messages.set(message.id, message);
  const ordered = [...messages.values()].sort(
    (a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0)
  );
  const reason = detectTicketReason([
    message.channel.topic || '',
    ...ordered.map((candidate) => messageToText(candidate)),
  ]);

  const staffByUser = new Map();
  for (const candidate of ordered) {
    if (!candidate.author || candidate.author.bot || staffByUser.has(candidate.author.id)) continue;
    let member = candidate.member;
    if (!member) {
      member = await message.guild.members.fetch(candidate.author.id).catch(() => null);
    }
    staffByUser.set(candidate.author.id, isStaffMember(member, candidate.author.id, config));
  }

  const state = buildStateFromHistory(ordered, {
    botUserId: client.user?.id,
    faq,
    currentMessageId: message.id,
    isStaffUser: (userId) => staffByUser.get(userId) === true,
  });

  const decision = decideReply({
    text: message.content,
    hasAttachment: (message.attachments?.size || 0) > 0,
    reason,
    authorIsStaff: staffByUser.get(message.author.id) === true,
    state,
    faq,
    maxReplies: config.maxReplies,
  });

  if (decision.action !== 'reply') return;

  const rendered = renderReply({
    kind: decision.kind,
    entry: decision.entry,
    faq,
    userId: message.author.id,
    withGreeting: decision.withGreeting,
    staffRoleIds: decision.ping ? config.staffRoleIds : [],
    staffUserIds: decision.ping ? config.staffUserIds : [],
  });

  try {
    await message.channel.send({
      content: rendered.content,
      allowedMentions: rendered.allowedMentions,
    });
  } catch (error) {
    if (isMissingAccessError(error)) {
      logTicketAccessWarning(message.channel, error);
      return;
    }
    throw error;
  }

  const entryNote = decision.entry?.id ? ` FAQ: ${decision.entry.id}.` : '';
  logger.info(
    `TOFC ticket auto-reply: sent ${decision.kind} in #${message.channel.name} (${message.channel.id}) for ${message.author.tag}. Reason: ${reason}.${entryNote}`
  );
}
