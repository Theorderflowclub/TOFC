import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../config/bot.js';
import { logger } from '../utils/logger.js';

// Prestige ranks are Discord roles, not a coded enum. Founders are matched by
// name in qaExport/owners.js; these ranks are matched the same way. Premium
// (PREMIUM_ROLE_ID) is a separate Whop role and is not part of this log.
// Prestige 4 is the Legends rank. Prestige 5 is the monthly tournament champion.
export const DEFAULT_LEGENDS_GUILD_ID = '1126304434901749761';
export const DEFAULT_LEGENDS_CHANNEL_ID = '1569664297997434930';
export const SHOWCASE_TITLE = '🏆 TOFC LEGENDS: Hall of Fame';
export const PRESTIGE_5_HEADING = '🥇 Prestige-5 · Monthly Tournament Champion(s)';
export const PRESTIGE_4_HEADING = '👑 Prestige-4 Legends';
export const PRESTIGE_4_PROMOTION = 'got promoted to **Prestige-4** and is now a **Legend** in the TOFC community!';
export const PRESTIGE_5_PROMOTION = 'won the monthly tournament and reached **Prestige-5**, the highest honor in the TOFC community!';
// Shop legendary gold. The Hall of Fame list itself stays the bot's green.
export const CHAMPION_COLOR = 0xF1C40F;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMBED_DESCRIPTION_MAX = 4096;
const RANK_ENV = { 4: 'PRESTIGE_4_ROLE_ID', 5: 'PRESTIGE_5_ROLE_ID' };
const REQUIRED_PERMISSIONS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
  ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
];

const memory = new Map();
const chains = new Map();
const roleMissUntil = new Map();

export function legendsGuildId() {
  return (process.env.LEGENDS_GUILD_ID || '').trim() || DEFAULT_LEGENDS_GUILD_ID;
}

export function legendsChannelId() {
  return (process.env.LEGENDS_CHANNEL_ID || '').trim() || DEFAULT_LEGENDS_CHANNEL_ID;
}

export function legendsColor() {
  return getColor('green');
}

export function formatLegendDate(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function resetLegendsLogState() {
  memory.clear();
  chains.clear();
  roleMissUntil.clear();
}

function storageKey(guildId) {
  return `legends:${guildId}`;
}

function enqueue(guildId, task) {
  const previous = chains.get(guildId) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  chains.set(guildId, run);
  return run;
}

const RANK_WORDS = [
  ['one', '1'],
  ['two', '2'],
  ['three', '3'],
  ['four', '4'],
  ['five', '5'],
  ['six', '6'],
  ['seven', '7'],
  ['eight', '8'],
  ['nine', '9'],
];

function roleNameKey(name) {
  let text = String(name ?? '').toLowerCase();
  for (const [word, digit] of RANK_WORDS) {
    text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
  }
  return text.replace(/[^a-z0-9]+/g, '');
}

// "Prestige 4", "prestige-4", and "PRESTIGE FOUR" match.
// "Prestige 40" and "PRESTIGE FOURTEEN" do not.
export function isPrestigeRankName(name, rank) {
  return new RegExp(`^prestige${rank}(?!\\d)`).test(roleNameKey(name));
}

function iter(collection) {
  if (!collection) return [];
  if (typeof collection.values === 'function') return [...collection.values()];
  if (Array.isArray(collection)) return collection;
  return [];
}

function configuredRoleId(roleId, envKey) {
  if (roleId === null) return null;
  const value = roleId === undefined ? process.env[envKey] : roleId;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

export function resolvePrestigeRankRole(roles, rank, roleId) {
  const list = iter(roles).filter((role) => role?.id);
  const configured = configuredRoleId(roleId, RANK_ENV[rank]);
  if (configured) {
    const role = list.find((entry) => entry.id === configured) || null;
    return { role, reason: role ? 'id' : 'missing-id', matches: role ? [role] : [], rank };
  }

  const matches = list.filter((role) => isPrestigeRankName(role.name, rank));
  if (matches.length === 1) return { role: matches[0], reason: 'name', matches, rank };
  if (matches.length === 0) return { role: null, reason: 'not-found', matches, rank };
  return { role: null, reason: 'ambiguous', matches, rank };
}

function rememberMember(byId, member, prestige4RoleId, prestige5RoleId) {
  if (!member?.user || member.user.bot) return;
  const id = member.user.id || member.id;
  if (!/^\d{17,20}$/.test(id)) return;
  byId.set(id, {
    id,
    username: member.user.username || id,
    prestige4: Boolean(prestige4RoleId && member.roles?.cache?.has?.(prestige4RoleId)),
    prestige5: Boolean(prestige5RoleId && member.roles?.cache?.has?.(prestige5RoleId)),
  });
}

export function partitionHallOfFame(members, prestige4RoleId, prestige5RoleId, changedMember = null) {
  const byId = new Map();
  for (const member of iter(members)) rememberMember(byId, member, prestige4RoleId, prestige5RoleId);
  if (changedMember) rememberMember(byId, changedMember, prestige4RoleId, prestige5RoleId);

  const sort = (a, b) => a.username.localeCompare(b.username, 'en') || a.id.localeCompare(b.id);
  const people = [...byId.values()];
  return {
    champions: people.filter((person) => person.prestige5).sort(sort),
    legends: people.filter((person) => person.prestige4 && !person.prestige5).sort(sort),
    prestige4Holders: people.filter((person) => person.prestige4).map((person) => person.id),
    prestige5Holders: people.filter((person) => person.prestige5).map((person) => person.id),
  };
}

function packLines(lines, max = EMBED_DESCRIPTION_MAX) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (current && next.length > max) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

export function buildShowcaseMessage({ championIds = [], legendIds = [] } = {}, color = legendsColor()) {
  const lines = [
    PRESTIGE_5_HEADING,
    ...championIds.map((id) => `💎 <@${id}>`),
    '',
    PRESTIGE_4_HEADING,
    ...legendIds.map((id) => `👑 <@${id}>`),
  ];
  const chunks = packLines(lines).slice(0, 10);
  const total = championIds.length + legendIds.length;
  const embeds = chunks.map((description, index) => {
    const embed = new EmbedBuilder().setColor(color).setDescription(description);
    if (index === 0) embed.setTitle(SHOWCASE_TITLE);
    if (index === chunks.length - 1) embed.setFooter({ text: `Total Legends: ${total}` });
    return embed;
  });
  return {
    embeds,
    allowedMentions: { parse: [] },
  };
}

export function buildPromotionMessage({
  rank,
  userId,
  avatarUrl,
  promotedAt = new Date(),
  color = legendsColor(),
}) {
  const date = formatLegendDate(promotedAt);
  if (rank === 5) {
    const embed = new EmbedBuilder()
      .setColor(CHAMPION_COLOR)
      .setTitle('👑 Prestige-5 Champion')
      .setDescription(`Crowned ${date}`);
    if (avatarUrl) embed.setThumbnail(avatarUrl);
    return {
      content: `🏆 <@${userId}> ${PRESTIGE_5_PROMOTION}`,
      embeds: [embed],
      allowedMentions: { parse: [], users: [userId] },
    };
  }

  const embed = new EmbedBuilder().setColor(color).setDescription(`Promoted ${date}`);
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return {
    content: `🔥 <@${userId}> ${PRESTIGE_4_PROMOTION}`,
    embeds: [embed],
    allowedMentions: { parse: [], users: [userId] },
  };
}

function embedData(embed) {
  if (!embed) return {};
  if (typeof embed.toJSON === 'function') return embed.toJSON();
  return embed;
}

function embedTitle(embed) {
  return embedData(embed).title || '';
}

function embedMarker(embed) {
  const data = embedData(embed);
  return `${data.title || ''}\n${data.description || ''}\n${data.footer?.text || ''}`;
}

export function showcaseNeedsUpdate(existingEmbeds, nextEmbeds) {
  const current = [...(existingEmbeds || [])].map(embedMarker);
  const next = [...(nextEmbeds || [])].map(embedMarker);
  if (current.length !== next.length) return true;
  return current.some((marker, index) => marker !== next[index]);
}

function idList(value) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => /^\d{17,20}$/.test(id)))] : [];
}

function normalizeState(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  return {
    bootstrapped: value?.bootstrapped === true,
    showcaseMessageId: typeof value?.showcaseMessageId === 'string' ? value.showcaseMessageId : null,
    announcedPrestige4: idList(value?.announcedPrestige4),
    announcedPrestige5: idList(value?.announcedPrestige5),
  };
}

function cloneState(state) {
  return {
    bootstrapped: state.bootstrapped,
    showcaseMessageId: state.showcaseMessageId,
    announcedPrestige4: [...state.announcedPrestige4],
    announcedPrestige5: [...state.announcedPrestige5],
  };
}

async function loadState(client, guildId) {
  if (memory.has(guildId)) return cloneState(memory.get(guildId));
  const raw = await client.db.get(storageKey(guildId), null);
  const state = normalizeState(raw);
  memory.set(guildId, cloneState(state));
  return cloneState(state);
}

async function saveState(client, guildId, state) {
  const snapshot = cloneState(state);
  memory.set(guildId, snapshot);
  try {
    const saved = await client.db.set(storageKey(guildId), cloneState(snapshot));
    if (saved === false) logger.error(`Legends state for guild ${guildId} was not saved.`);
  } catch (error) {
    logger.error(`Legends state for guild ${guildId} was not saved:`, error);
  }
}

function isShowcaseMessage(message, botId) {
  if (!message || message.author?.id !== botId) return false;
  return [...(message.embeds || [])].some((embed) => embedTitle(embed) === SHOWCASE_TITLE);
}

async function fetchMessage(channel, messageId) {
  try {
    return await channel.messages.fetch(messageId);
  } catch (error) {
    if (error?.code === 10008) return null;
    throw error;
  }
}

function oldestMessageId(messages) {
  let oldest = null;
  for (const message of messages) {
    if (!/^\d+$/.test(message?.id || '')) continue;
    if (!oldest || BigInt(message.id) < BigInt(oldest)) oldest = message.id;
  }
  return oldest;
}

async function findShowcaseInHistory(channel, botId) {
  let before;
  for (let page = 0; page < 5; page += 1) {
    const fetched = await channel.messages.fetch(before ? { limit: 100, before } : { limit: 100 });
    const batch = [...fetched.values()];
    for (const message of batch) {
      if (isShowcaseMessage(message, botId)) return message;
    }
    const oldest = oldestMessageId(batch);
    if (!oldest || oldest === before || batch.length < 100) return null;
    before = oldest;
  }
  return null;
}

async function resolveShowcaseMessage(channel, botId, messageId) {
  if (messageId) {
    const message = await fetchMessage(channel, messageId);
    if (isShowcaseMessage(message, botId)) return message;
  }
  return findShowcaseInHistory(channel, botId);
}

function missingPermissions(channel, guild) {
  const me = guild.members?.me;
  if (!me || !channel.permissionsFor) return [];
  const perms = channel.permissionsFor(me);
  if (!perms?.has) return [];
  return REQUIRED_PERMISSIONS.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
}

async function getLegendChannel(guild, channelId) {
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel;
}

function warnUnresolved(guild, resolved) {
  const label = `Prestige ${resolved.rank}`;
  const envKey = RANK_ENV[resolved.rank];
  if (resolved.reason === 'ambiguous') {
    const list = resolved.matches.map((role) => `${role.name} [${role.id}]`).join(', ');
    logger.warn(`${label} matched more than one role (${list}). Set ${envKey} to choose one.`);
    return;
  }
  if (resolved.reason === 'missing-id') {
    logger.warn(`${envKey} is set, but that role is not in the guild.`);
    return;
  }
  const hints = iter(guild.roles.cache)
    .filter((role) => roleNameKey(role.name).includes('prestige'))
    .map((role) => role.name);
  logger.warn(`${label} role not found. Prestige roles seen: ${hints.join(', ') || 'none'}. Set ${envKey} if the rank name differs.`);
}

async function resolveRanks(guild, options, { quiet = false } = {}) {
  const read = () => ({
    prestige4: resolvePrestigeRankRole(guild.roles.cache, 4, options.prestige4RoleId),
    prestige5: resolvePrestigeRankRole(guild.roles.cache, 5, options.prestige5RoleId),
  });
  let ranks = read();
  const missUntil = roleMissUntil.get(guild.id) || 0;
  if ((!ranks.prestige4.role || !ranks.prestige5.role) && Date.now() >= missUntil) {
    await guild.roles.fetch().catch(() => null);
    ranks = read();
    if (ranks.prestige4.role && ranks.prestige5.role) roleMissUntil.delete(guild.id);
    else roleMissUntil.set(guild.id, Date.now() + 5 * 60 * 1000);
  }
  if (!quiet) {
    if (!ranks.prestige4.role) warnUnresolved(guild, ranks.prestige4);
    if (!ranks.prestige5.role) warnUnresolved(guild, ranks.prestige5);
  }
  return ranks;
}

function avatarUrlOf(user) {
  try {
    return user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;
  } catch {
    return null;
  }
}

async function publishShowcase(channel, botId, state, championIds, legendIds) {
  const payload = buildShowcaseMessage({ championIds, legendIds });
  const existing = await resolveShowcaseMessage(channel, botId, state.showcaseMessageId);
  if (existing && !showcaseNeedsUpdate(existing.embeds, payload.embeds)) {
    state.showcaseMessageId = existing.id;
    return existing;
  }
  if (existing) {
    const edited = await existing.edit(payload);
    state.showcaseMessageId = edited?.id || existing.id;
    return edited || existing;
  }
  const sent = await channel.send(payload);
  state.showcaseMessageId = sent.id;
  return sent;
}

async function memberById(guild, id) {
  const cached = guild.members.cache.get(id);
  if (cached?.user) return cached;
  const fetched = await guild.members.fetch(id).catch(() => null);
  return fetched?.user ? fetched : null;
}

async function announceRank(channel, member, rank) {
  await channel.send(buildPromotionMessage({
    rank,
    userId: member.user.id,
    avatarUrl: avatarUrlOf(member.user),
  }));
}

async function syncRank(client, guild, channel, guildId, state, rank, currentIds) {
  const key = rank === 5 ? 'announcedPrestige5' : 'announcedPrestige4';
  const known = new Set(state[key]);
  for (const id of currentIds.filter((entry) => !known.has(entry))) {
    const member = await memberById(guild, id);
    if (!member || member.user.bot) continue;
    state[key].push(id);
    await saveState(client, guildId, state);
    try {
      await announceRank(channel, member, rank);
    } catch (error) {
      state[key] = state[key].filter((entry) => entry !== id);
      await saveState(client, guildId, state);
      throw error;
    }
    logger.info(`Logged Prestige ${rank} for ${member.user.tag || id}.`);
  }

  const still = new Set(currentIds);
  if (state[key].some((id) => !still.has(id))) {
    state[key] = state[key].filter((id) => still.has(id));
    await saveState(client, guildId, state);
  }
}

function showcaseIds(hall) {
  return {
    championIds: hall.champions.map((person) => person.id),
    legendIds: hall.legends.map((person) => person.id),
  };
}

function rankChange(oldMember, newMember, roleId) {
  if (!roleId || !oldMember?.roles?.cache || !newMember?.roles?.cache) return 'unknown';
  if (oldMember === newMember) return 'unknown';
  const had = oldMember.roles.cache.has(roleId);
  const has = newMember.roles.cache.has(roleId);
  if (has && !had) return 'gained';
  if (!has && had) return 'lost';
  return 'unchanged';
}

function withoutDeferred(ids, deferred) {
  if (!deferred?.length) return ids;
  const skip = new Set(deferred);
  return ids.filter((id) => !skip.has(id));
}

async function runSync(client, guildId, channelId, options) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    logger.warn(`Legends log skipped: guild ${guildId} is not available.`);
    return;
  }

  const ranks = await resolveRanks(guild, options);
  if (!ranks.prestige4.role) return;

  try {
    await guild.members.fetch();
  } catch (error) {
    logger.error(
      'Legends log could not list members. The bot already requests GuildMembers; the Server Members Intent must stay enabled in the Discord developer portal.',
      error,
    );
    return;
  }

  const channel = await getLegendChannel(guild, channelId);
  if (!channel) {
    logger.warn(`Legends log skipped: channel ${channelId} is not a text channel in guild ${guildId}.`);
    return;
  }
  const missing = missingPermissions(channel, guild);
  if (missing.length) {
    logger.warn(`Legends log skipped: missing ${missing.join(', ')} in channel ${channelId}.`);
    return;
  }

  const prestige5RoleId = ranks.prestige5.role?.id || null;
  const hall = partitionHallOfFame(guild.members.cache, ranks.prestige4.role.id, prestige5RoleId);
  const { championIds, legendIds } = showcaseIds(hall);
  const state = await loadState(client, guildId);
  const botId = client.user.id;

  if (!state.bootstrapped) {
    await publishShowcase(channel, botId, state, championIds, legendIds);
    state.announcedPrestige4 = withoutDeferred(hall.prestige4Holders, options.deferPrestige4);
    state.announcedPrestige5 = ranks.prestige5.role
      ? withoutDeferred(hall.prestige5Holders, options.deferPrestige5)
      : [];
    state.bootstrapped = true;
    await saveState(client, guildId, state);
    logger.info(
      `Legends showcase ready. Prestige 4 "${ranks.prestige4.role.name}" [${ranks.prestige4.role.id}] (${hall.prestige4Holders.length}). Prestige 5 ${ranks.prestige5.role ? `"${ranks.prestige5.role.name}" [${ranks.prestige5.role.id}] (${hall.prestige5Holders.length})` : 'not found'}.`,
    );
    return;
  }

  await syncRank(client, guild, channel, guildId, state, 4, hall.prestige4Holders);
  if (ranks.prestige5.role) {
    await syncRank(client, guild, channel, guildId, state, 5, hall.prestige5Holders);
  }
  await publishShowcase(channel, botId, state, championIds, legendIds);
  await saveState(client, guildId, state);
}

async function runMemberUpdate(oldMember, newMember, guildId, channelId, options) {
  if (newMember?.guild?.id !== guildId || newMember.user?.bot) return;
  let state = await loadState(newMember.client, guildId);
  if (!state.bootstrapped) {
    const ranksForDefer = await resolveRanks(newMember.guild, options, { quiet: true });
    const userId = newMember.user.id;
    await runSync(newMember.client, guildId, channelId, {
      ...options,
      deferPrestige4: rankChange(oldMember, newMember, ranksForDefer.prestige4.role?.id) === 'gained' ? [userId] : [],
      deferPrestige5: rankChange(oldMember, newMember, ranksForDefer.prestige5.role?.id) === 'gained' ? [userId] : [],
    });
    state = await loadState(newMember.client, guildId);
    if (!state.bootstrapped) return;
  }

  const ranks = await resolveRanks(newMember.guild, options, { quiet: true });
  if (!ranks.prestige4.role) return;

  const prestige5RoleId = ranks.prestige5.role?.id || null;
  const hall = partitionHallOfFame(
    newMember.guild.members?.cache,
    ranks.prestige4.role.id,
    prestige5RoleId,
    newMember,
  );
  const person = {
    prestige4: hall.prestige4Holders.includes(newMember.user.id),
    prestige5: hall.prestige5Holders.includes(newMember.user.id),
  };

  const gained4 = person.prestige4 && !state.announcedPrestige4.includes(newMember.user.id);
  const lost4 = !person.prestige4 && state.announcedPrestige4.includes(newMember.user.id);
  const gained5 = Boolean(ranks.prestige5.role) && person.prestige5 && !state.announcedPrestige5.includes(newMember.user.id);
  const lost5 = Boolean(ranks.prestige5.role) && !person.prestige5 && state.announcedPrestige5.includes(newMember.user.id);
  if (!gained4 && !lost4 && !gained5 && !lost5) return;

  const channel = await getLegendChannel(newMember.guild, channelId);
  if (!channel) return;
  const missing = missingPermissions(channel, newMember.guild);
  if (missing.length) {
    logger.warn(`Legends log skipped: missing ${missing.join(', ')} in channel ${channelId}.`);
    return;
  }

  const userId = newMember.user.id;
  if (gained4) {
    state.announcedPrestige4.push(userId);
    await saveState(newMember.client, guildId, state);
    try {
      await announceRank(channel, newMember, 4);
    } catch (error) {
      state.announcedPrestige4 = state.announcedPrestige4.filter((id) => id !== userId);
      await saveState(newMember.client, guildId, state);
      throw error;
    }
    logger.info(`Logged Prestige 4 for ${newMember.user.tag || userId}.`);
  } else if (lost4) {
    state.announcedPrestige4 = state.announcedPrestige4.filter((id) => id !== userId);
    await saveState(newMember.client, guildId, state);
  }

  if (gained5) {
    state.announcedPrestige5.push(userId);
    await saveState(newMember.client, guildId, state);
    try {
      await announceRank(channel, newMember, 5);
    } catch (error) {
      state.announcedPrestige5 = state.announcedPrestige5.filter((id) => id !== userId);
      await saveState(newMember.client, guildId, state);
      throw error;
    }
    logger.info(`Logged Prestige 5 for ${newMember.user.tag || userId}.`);
  } else if (lost5) {
    state.announcedPrestige5 = state.announcedPrestige5.filter((id) => id !== userId);
    await saveState(newMember.client, guildId, state);
  }

  const { championIds, legendIds } = showcaseIds(hall);
  await publishShowcase(channel, newMember.client.user.id, state, championIds, legendIds);
  await saveState(newMember.client, guildId, state);
}

export function syncLegendsLog(client, options = {}) {
  const guildId = options.guildId || legendsGuildId();
  const channelId = options.channelId || legendsChannelId();
  return enqueue(guildId, () => runSync(client, guildId, channelId, options))
    .catch((error) => logger.error('Legends showcase sync failed:', error));
}

export function handleLegendsMemberUpdate(oldMember, newMember, options = {}) {
  const guildId = options.guildId || legendsGuildId();
  if (newMember?.guild?.id !== guildId) return Promise.resolve();
  const channelId = options.channelId || legendsChannelId();
  return enqueue(guildId, () => runMemberUpdate(oldMember, newMember, guildId, channelId, options))
    .catch((error) => logger.error('Legends promotion log failed:', error));
}
