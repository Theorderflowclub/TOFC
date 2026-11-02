import { ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { isQaOwner } from './owners.js';
import { channelMatchesFilter, isTranscriptChannelName } from './matchChannels.js';
import { pairQaMessages, rawMessages } from './pairQa.js';

const TEXT_OR_FORUM = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
]);

const FETCH_DELAY_MS = 350;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRateLimit(work) {
  try {
    return await work();
  } catch (error) {
    const retry = Number(error?.retryAfter ?? error?.rawError?.retry_after ?? error?.data?.retry_after);
    const limited = error?.status === 429 || error?.code === 429 || Number.isFinite(retry);
    if (!limited) throw error;
    const waitMs = Math.ceil((Number.isFinite(retry) ? retry : 1) * 1000) + 250;
    logger.warn(`Q&A export hit a Discord rate limit. Waiting ${waitMs}ms.`);
    await sleep(waitMs);
    return work();
  }
}

function usernameOf(user) {
  return user?.username || user?.tag || user?.id || '';
}

export function recordFromDiscordMessage(message, { owner, channelName, threadName, inThread, containerId }) {
  return {
    id: message.id,
    containerId,
    channelName,
    threadName: threadName || null,
    inThread: Boolean(inThread),
    authorId: message.author?.id || '',
    authorUsername: usernameOf(message.author),
    bot: Boolean(message.author?.bot),
    owner: Boolean(owner) && !message.author?.bot,
    content: message.content || '',
    createdAt: message.createdTimestamp || Date.now(),
    replyToId: message.reference?.messageId || null,
    guildId: message.guildId || message.guild?.id || '',
    linkChannelId: message.channelId || message.channel?.id || containerId,
  };
}

async function rememberOwner(guild, userId, cache) {
  if (cache.has(userId)) return cache.get(userId);
  const cached = guild.members?.cache?.get?.(userId);
  const member = cached || await guild.members.fetch(userId).catch(() => null);
  const owner = member ? isQaOwner(member) : false;
  cache.set(userId, owner);
  if (!cached) await sleep(50);
  return owner;
}

export async function fetchMessagesSince(channel, sinceMs) {
  const collected = [];
  let before;
  for (let page = 0; page < 500; page += 1) {
    const batch = await withRateLimit(() => channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }));
    if (!batch?.size) break;
    const ordered = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    let reachedCutoff = false;
    for (const message of ordered) {
      if (message.createdTimestamp < sinceMs) {
        reachedCutoff = true;
        continue;
      }
      collected.push(message);
    }
    before = ordered[ordered.length - 1]?.id;
    if (reachedCutoff || batch.size < 100) break;
    await sleep(FETCH_DELAY_MS);
  }
  return collected;
}

async function archivedThreads(parent, type) {
  if (!parent.threads?.fetchArchived) return [];
  const found = [];
  let before;
  for (let page = 0; page < 50; page += 1) {
    let result;
    try {
      result = await withRateLimit(() => parent.threads.fetchArchived({
        type,
        limit: 100,
        ...(before ? { before } : {}),
      }));
    } catch (error) {
      logger.warn(`Q&A export: could not list ${type} archived threads in #${parent.name}: ${error.message}`);
      break;
    }
    const threads = result?.threads ? [...result.threads.values()] : [];
    found.push(...threads);
    if (!threads.length || result.hasMore === false) break;
    before = threads[threads.length - 1]?.id;
    await sleep(FETCH_DELAY_MS);
  }
  return found;
}

export async function listThreads(parent) {
  const threads = [];
  const seen = new Set();
  const add = (thread) => {
    if (!thread || seen.has(thread.id)) return;
    seen.add(thread.id);
    threads.push(thread);
  };

  if (parent.threads?.fetchActive) {
    try {
      const active = await withRateLimit(() => parent.threads.fetchActive());
      for (const thread of active?.threads?.values?.() || []) add(thread);
    } catch (error) {
      logger.warn(`Q&A export: could not list active threads in #${parent.name}: ${error.message}`);
    }
  }

  for (const thread of await archivedThreads(parent, 'public')) add(thread);
  if (parent.type !== ChannelType.GuildForum) {
    for (const thread of await archivedThreads(parent, 'private')) add(thread);
  }
  return threads;
}

function parentChannels(guild, channelsOption) {
  return [...guild.channels.cache.values()].filter((channel) => {
    if (!TEXT_OR_FORUM.has(channel.type)) return false;
    return channelMatchesFilter(channel, channelsOption);
  });
}

async function recordsFromChannel(channel, sinceMs, ownerCache, names) {
  const discordMessages = await fetchMessagesSince(channel, sinceMs);
  if (channel.isThread?.()) {
    try {
      const starter = await withRateLimit(() => channel.fetchStarterMessage());
      if (starter && starter.createdTimestamp >= sinceMs && !discordMessages.some((message) => message.id === starter.id)) {
        discordMessages.push(starter);
      }
    } catch (error) {
      logger.warn(`Q&A export: could not read the starter message in ${channel.name}: ${error.message}`);
    }
  }

  const records = [];
  for (const message of discordMessages) {
    if (message.author?.bot) continue;
    const owner = await rememberOwner(channel.guild, message.author.id, ownerCache);
    records.push(recordFromDiscordMessage(message, { owner, ...names }));
  }
  return records;
}

export async function collectQaRecords(guild, { days = 90, channelsOption = '', sinceMs, onProgress } = {}) {
  const cutoff = Number.isFinite(sinceMs) ? sinceMs : Date.now() - (Number(days) || 90) * 24 * 60 * 60 * 1000;
  const parents = parentChannels(guild, channelsOption);
  const ownerCache = new Map();
  const records = [];

  for (const parent of parents) {
    if (typeof onProgress === 'function') {
      await onProgress(parent.name);
    }
    const parentNames = {
      channelName: parent.name,
      threadName: null,
      inThread: false,
      containerId: parent.id,
    };
    if (parent.type !== ChannelType.GuildForum) {
      try {
        records.push(...await recordsFromChannel(parent, cutoff, ownerCache, parentNames));
      } catch (error) {
        logger.warn(`Q&A export: could not read #${parent.name}: ${error.message}`);
      }
    }

    let threads = [];
    try {
      threads = await listThreads(parent);
    } catch (error) {
      logger.warn(`Q&A export: could not list threads in #${parent.name}: ${error.message}`);
    }
    for (const thread of threads) {
      const threadNames = {
        channelName: parent.name,
        threadName: thread.name,
        inThread: true,
        containerId: thread.id,
      };
      try {
        records.push(...await recordsFromChannel(thread, cutoff, ownerCache, threadNames));
      } catch (error) {
        logger.warn(`Q&A export: could not read thread ${thread.name}: ${error.message}`);
      }
      await sleep(FETCH_DELAY_MS);
    }
    await sleep(FETCH_DELAY_MS);
  }

  return records;
}

export function buildQaExport(records, { from, to } = {}) {
  const pairs = pairQaMessages(records);
  const raw = rawMessages(records);
  return { pairs, raw, from, to };
}

export async function collectTicketRecords(guild, sinceMs) {
  const { isTicketChannel } = await import('../ticketAutoReply/detect.js');
  const { getTicketAutoReplyConfig } = await import('../../config/ticketAutoReply.js');
  const config = getTicketAutoReplyConfig();
  const tickets = [...guild.channels.cache.values()].filter((channel) => isTicketChannel(channel, config));
  const ownerCache = new Map();
  const records = [];
  for (const ticket of tickets) {
    try {
      records.push(...await recordsFromChannel(ticket, sinceMs, ownerCache, {
        channelName: ticket.name,
        threadName: null,
        inThread: false,
        containerId: ticket.id,
      }));
    } catch (error) {
      logger.warn(`Q&A export: could not read ticket #${ticket.name}: ${error.message}`);
    }
    await sleep(FETCH_DELAY_MS);
  }
  return records;
}

export function findTranscriptChannel(guild) {
  return guild.channels.cache.find((channel) =>
    TEXT_OR_FORUM.has(channel.type) && isTranscriptChannelName(channel.name)
  ) || null;
}
