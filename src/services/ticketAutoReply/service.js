import { ChannelType } from 'discord.js';
import { logger, startupLog } from '../../utils/logger.js';
import { getTicketAutoReplyConfig, staffConfigIsSet } from '../../config/ticketAutoReply.js';
import { loadTicketFaq } from './faqStore.js';
import {
  detectTicketReason,
  extractTicketToolPrompt,
  hasTicketPermissions,
  isMissingAccessError,
  isStaffMember,
  isTicketChannel,
  messageToText,
  openerFromOverwrites,
  ticketChannelDecision,
  categoryMatches,
} from './detect.js';
import { buildStateFromHistory, decideReply, isOurAutoReply, renderReply } from './decide.js';

const OPENING_WAIT_MS = [2000, 2000, 2000];

function ticketLog(message) {
  console.log(`[ticket-auto-reply] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueue(channelId, task) {
  const previous = locks.get(channelId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  locks.set(channelId, current);
  return current;
}

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
  const line = `skipped: missing access to #${channel?.name || id} (${id}). ${ACCESS_WARNING}${code}`;
  ticketLog(line);
  logger.warn(`TOFC ticket auto-reply: ${line}`);
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
          && categoryMatches(channel.name, expected)
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
    if (!message.guild || !message.author || !message.channel) return;

    const verdict = ticketChannelDecision(message.channel, config);
    if (!verdict.match) {
      if (String(verdict.reason || '').startsWith('category')) {
        ticketLog(`skipped: #${message.channel.name} (${message.channel.id}) ${verdict.reason}`);
      }
      return;
    }

    if (message.author.id && message.author.id === client.user?.id) {
      ticketLog(`skipped: our own message in #${message.channel.name} (${message.channel.id})`);
      return;
    }

    const categoryLabel = verdict.category || (verdict.categoryUnverified ? 'not visible' : '');
    ticketLog(
      `ticket detected: #${message.channel.name} (${message.channel.id}) category="${categoryLabel}" from ${message.author.tag || message.author.username || message.author.id} bot=${Boolean(message.author.bot)}`
    );

    await enqueue(message.channel.id, () => processTicketMessage(message, client, config));
  } catch (error) {
    ticketLog(`error in #${message.channel?.name || message.channelId}: ${error.message}`);
    logger.error(
      `TOFC ticket auto-reply failed in #${message.channel?.name || message.channelId}:`,
      error
    );
  }
}

export async function handleNewTicketChannel(channel, client) {
  const config = getTicketAutoReplyConfig();
  if (!config.enabled || !channel?.guild) return;

  const verdict = ticketChannelDecision(channel, config);
  if (!verdict.match) {
    if (String(verdict.reason || '').startsWith('category')) {
      ticketLog(`skipped: #${channel.name} (${channel.id}) ${verdict.reason}`);
    }
    return;
  }

  ticketLog(
    `ticket detected: #${channel.name} (${channel.id}) created category="${verdict.category || 'not visible yet'}"`
  );

  const me = channel.guild.members?.me;
  if (me && !hasTicketPermissions(channel.permissionsFor(me))) {
    logTicketAccessWarning(channel);
  }

  for (let attempt = 0; attempt < OPENING_WAIT_MS.length; attempt += 1) {
    await sleep(OPENING_WAIT_MS[attempt]);
    const done = await enqueue(channel.id, () => replyFromOpeningHistory(channel, client, config));
    if (done) return;
    ticketLog(`waiting for Ticket Tool's opening message in #${channel.name} (${channel.id}), attempt ${attempt + 1}`);
  }

  ticketLog(`skipped: no opening message in #${channel.name} (${channel.id}) after waiting`);
}

async function replyFromOpeningHistory(channel, client, config) {
  const faq = loadTicketFaq();
  if (!faq) {
    ticketLog('skipped: FAQ file could not be read');
    return true;
  }

  let fetched;
  try {
    fetched = await channel.messages.fetch({ limit: 20 });
  } catch (error) {
    if (isMissingAccessError(error)) {
      logTicketAccessWarning(channel, error);
      return true;
    }
    ticketLog(`could not read #${channel.name} (${channel.id}): ${error.message}`);
    return false;
  }

  const ordered = [...fetched.values()].sort(
    (a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0)
  );
  if (ordered.some((candidate) => candidate.author?.id === client.user?.id && isOurAutoReply(candidate.content, faq))) {
    ticketLog(`skipped: already replied in #${channel.name} (${channel.id})`);
    return true;
  }

  const toolMessage = [...ordered].reverse().find((candidate) =>
    candidate.author?.bot && candidate.author.id !== client.user?.id
  );
  if (!toolMessage) return false;

  await processTicketMessage(toolMessage, client, config);
  return true;
}

async function processTicketMessage(message, client, config) {
  const me = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
  const perms = me ? message.channel.permissionsFor(me) : null;
  if (!hasTicketPermissions(perms)) {
    logTicketAccessWarning(message.channel);
    return;
  }

  if (!message.author.bot) {
    const prefix = (process.env.PREFIX || '!').trim() || '!';
    if ((message.content || '').trim().startsWith(prefix)) {
      ticketLog(`skipped: prefix command in #${message.channel.name} (${message.channel.id})`);
      return;
    }
  }

  if (!staffConfigIsSet(config)) warnStaffUnset();

  const faq = loadTicketFaq();
  if (!faq) {
    ticketLog(`skipped: FAQ file could not be read for #${message.channel.name} (${message.channel.id})`);
    return;
  }

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

  const fromTool = Boolean(message.author.bot);
  const prompt = fromTool
    ? extractTicketToolPrompt(message)
    : { question: message.content || '', fieldName: 'message', openerId: message.author.id };
  if (!prompt.openerId) {
    prompt.openerId = openerFromOverwrites(message.channel, client.user?.id);
  }

  ticketLog(
    `reason extracted: field="${prompt.fieldName || 'none'}" value="${prompt.question || ''}" opener=${prompt.openerId || 'unknown'} panel=${reason} in #${message.channel.name} (${message.channel.id})`
  );

  const decision = decideReply({
    text: prompt.question,
    hasAttachment: (message.attachments?.size || 0) > 0,
    reason,
    authorIsStaff: fromTool ? false : staffByUser.get(message.author.id) === true,
    state,
    faq,
    maxReplies: config.maxReplies,
    acknowledgeWhenBlank: fromTool,
  });

  if (decision.action !== 'reply') {
    const why = decision.action === 'stop'
      ? 'staff already replied or the author is staff'
      : 'already answered, duplicate, blank, or over the reply cap';
    ticketLog(`skipped: ${why} in #${message.channel.name} (${message.channel.id})`);
    return;
  }

  if (decision.kind === 'answer') {
    ticketLog(`FAQ match: ${decision.entry.id} in #${message.channel.name} (${message.channel.id})`);
  } else {
    ticketLog(`no FAQ match (${decision.kind}) in #${message.channel.name} (${message.channel.id}); sending an acknowledgement`);
  }

  const rendered = renderReply({
    kind: decision.kind,
    entry: decision.entry,
    faq,
    userId: prompt.openerId,
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

  ticketLog(`reply sent in #${message.channel.name} (${message.channel.id}) kind=${decision.kind}`);
  logger.info(
    `TOFC ticket auto-reply: sent ${decision.kind} in #${message.channel.name} (${message.channel.id}). Reason: ${reason}.`
  );
}
