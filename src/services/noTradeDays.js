import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

// Weekday session pings skip when today's New York date is NO-TRADE or CLOSED.
// data/no-trade-days.json is the primary source. The alerts-channel calendar is
// a backup, and a failed read of that channel leaves the JSON list in charge.
// During US/EU daylight-saving mismatch the calendar post can land after the
// 9:00 New York ping, so the file has to carry those dates on its own.

export const NY_TIMEZONE = 'America/New_York';
export const ALERTS_CHANNEL_ID = '1564051322485870803';
export const CALENDAR_FETCH_LIMIT = 100;
const TOFC_GUILD_ID = '1126304434901749761';

const LIST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/no-trade-days.json',
);

const PING_LABELS = {
  morning_hype: 'morning hype',
  daily_checkin: 'daily check-in',
};

const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/i;

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function part(parts, type) {
  return parts.find((entry) => entry.type === type)?.value || '';
}

export function nyDateParts(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date');
  }
  const parts = nyFormatter.formatToParts(date);
  const year = part(parts, 'year');
  const month = part(parts, 'month');
  const day = part(parts, 'day');
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    iso: `${year}-${month}-${day}`,
  };
}

export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return text;
}

function splitIso(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

export function sanitizeLogText(value) {
  return String(value || 'unknown error')
    .replace(/[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function cleanReason(value, fallback) {
  if (value == null || value === '') return { ok: true, reason: fallback };
  if (typeof value !== 'string') return { ok: false };
  const reason = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!reason) return { ok: true, reason: fallback };
  if (reason.length > 200) return { ok: false };
  return { ok: true, reason };
}

function normalizeEntry(row) {
  if (!row || typeof row !== 'object') return null;
  const date = parseIsoDate(row.date);
  if (!date || (row.status !== 'NO-TRADE' && row.status !== 'CLOSED')) return null;
  const reason = cleanReason(row.reason, '');
  if (!reason.ok || !reason.reason) return null;
  return { date, status: row.status, reason: reason.reason };
}

export function loadNoTradeDays() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(LIST_PATH, 'utf8'));
  } catch (error) {
    logger.error(`Could not read no-trade days: ${sanitizeLogText(error?.message)}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    logger.error('No-trade day list must be a JSON array. Ignoring it.');
    return [];
  }

  const entries = [];
  const seen = new Set();
  for (const row of parsed) {
    const normalized = normalizeEntry(row);
    const label = typeof row?.date === 'string' ? row.date.slice(0, 32) : 'unknown';
    if (!normalized) {
      logger.error(`Ignoring invalid no-trade day row for ${label}.`);
      continue;
    }
    if (seen.has(normalized.date)) {
      logger.error(`Ignoring duplicate no-trade day row for ${normalized.date}.`);
      continue;
    }
    seen.add(normalized.date);
    entries.push(normalized);
  }
  return entries;
}

export function resolveListedStatus(date, entries, overrides) {
  const seed = (entries || []).find((entry) => entry.date === date) || null;
  if (seed?.status === 'CLOSED') {
    return { status: 'CLOSED', reason: seed.reason, source: 'list' };
  }
  const override = overrides?.get(date);
  if (override?.type === 'mark') {
    return { status: 'NO-TRADE', reason: override.reason, source: 'override' };
  }
  if (override?.type === 'unmark') return null;
  if (seed?.status === 'NO-TRADE') {
    return { status: 'NO-TRADE', reason: seed.reason, source: 'list' };
  }
  return null;
}

function firstMonthDay(title) {
  const match = title.match(MONTH_RE);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return { month, day, year: match[3] ? Number(match[3]) : null };
}

function titleSignal(title, today) {
  if (typeof title !== 'string' || !title) return null;
  const markers = [];
  const statusRe = /(^|[^A-Z0-9])(NO-TRADE|CLOSED)(?![A-Z0-9])/g;
  for (const match of title.matchAll(statusRe)) {
    markers.push({ status: match[2], index: match.index + match[1].length });
  }
  if (!markers.length) return null;

  const dated = firstMonthDay(title);
  if (dated && (dated.month !== today.month || dated.day !== today.day || (dated.year && dated.year !== today.year))) {
    return null;
  }

  const chosen = markers[0];
  const rest = title
    .slice(chosen.index + chosen.status.length)
    .replace(/^[\s:·\-–—|]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return { status: chosen.status, reason: rest || chosen.status };
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === 'function') return [...value.values()];
  return [];
}

function messageInstant(message) {
  const raw = message?.createdAt ?? message?.createdTimestamp ?? message?.timestamp;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number' || typeof raw === 'string') {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function embedTitle(embed) {
  if (!embed || typeof embed !== 'object') return '';
  if (typeof embed.title === 'string') return embed.title;
  if (typeof embed.data?.title === 'string') return embed.data.title;
  return '';
}

function authorId(message) {
  if (typeof message?.author?.id === 'string') return message.author.id;
  if (typeof message?.authorId === 'string') return message.authorId;
  return '';
}

export function calendarSignal(messages, botId, iso) {
  if (!botId || !iso) return null;
  const today = splitIso(iso);
  let best = null;
  for (const message of asList(messages)) {
    if (authorId(message) !== botId) continue;
    const created = messageInstant(message);
    if (!created || nyDateParts(created).iso !== iso) continue;
    for (const embed of asList(message.embeds)) {
      const signal = titleSignal(embedTitle(embed), today);
      if (!signal) continue;
      if (!best || created > best.at) {
        best = { ...signal, at: created };
      }
    }
  }
  if (!best) return null;
  return { status: best.status, reason: best.reason, source: 'calendar' };
}

export function decideSkip({ now = new Date(), entries = [], overrides = new Map(), calendar = null } = {}) {
  const date = nyDateParts(now).iso;
  const listed = resolveListedStatus(date, entries, overrides);
  if (listed) {
    return { skip: true, date, status: listed.status, reason: listed.reason, source: listed.source };
  }

  const calendarFailed = !calendar || calendar.failed === true;
  if (!calendarFailed) {
    const signal = calendarSignal(calendar.messages, calendar.botId, date);
    if (signal) {
      return { skip: true, date, status: signal.status, reason: signal.reason, source: 'calendar' };
    }
  }

  return { skip: false, date, status: null, reason: null, source: null };
}

export function createNoTradeStore() {
  const overrides = new Map();

  function listed(date, entries) {
    return resolveListedStatus(date, entries, overrides);
  }

  return {
    overrides,
    mark(date, reason, entries) {
      const iso = parseIsoDate(date);
      if (!iso) return { ok: false, code: 'invalid_date' };
      const seed = (entries || []).find((entry) => entry.date === iso);
      if (seed?.status === 'CLOSED') return { ok: false, code: 'closed_day', date: iso };
      const cleaned = cleanReason(reason, 'Marked at runtime');
      if (!cleaned.ok) return { ok: false, code: 'invalid_reason' };
      overrides.set(iso, { type: 'mark', reason: cleaned.reason });
      return { ok: true, date: iso, listed: listed(iso, entries) };
    },
    unmark(date, entries) {
      const iso = parseIsoDate(date);
      if (!iso) return { ok: false, code: 'invalid_date' };
      const seed = (entries || []).find((entry) => entry.date === iso);
      if (seed?.status === 'CLOSED') return { ok: false, code: 'closed_day', date: iso };
      if (seed?.status === 'NO-TRADE') {
        overrides.set(iso, { type: 'unmark' });
      } else {
        overrides.delete(iso);
      }
      return { ok: true, date: iso, listed: listed(iso, entries) };
    },
    clear() {
      overrides.clear();
    },
  };
}

const defaultStore = createNoTradeStore();

export function getDefaultNoTradeStore() {
  return defaultStore;
}

export function skipLogLine(pingName, decision) {
  const label = PING_LABELS[pingName] || String(pingName || 'ping');
  return `Skipping scheduled ${label} on ${decision.date} (${decision.status}: ${decision.reason}) source=${decision.source}`;
}

export function calendarFailureLogLine(date, error) {
  return `No-trade calendar check failed for ${date}; using the date list only (${sanitizeLogText(error?.message)})`;
}

function warn(log, message) {
  try {
    (log || logger).warn(message);
  } catch {
    // A log failure must not change whether the ping is sent.
  }
}

async function readCalendar(client) {
  const botId = client?.user?.id;
  if (!botId) throw new Error('bot user is not available');
  if (typeof client?.channels?.fetch !== 'function') throw new Error('channel lookup is not available');
  const channel = await client.channels.fetch(ALERTS_CHANNEL_ID);
  if (!channel || typeof channel.messages?.fetch !== 'function') {
    throw new Error('alerts channel is not readable');
  }
  const guildId = channel.guildId || channel.guild?.id;
  if (guildId !== undefined && guildId !== TOFC_GUILD_ID) {
    throw new Error('alerts channel is not in the TOFC server');
  }
  const fetched = await channel.messages.fetch({ limit: CALENDAR_FETCH_LIMIT });
  return { failed: false, botId, messages: asList(fetched) };
}

export async function evaluateScheduledSkip(client, options = {}) {
  const now = options.now ?? new Date();
  const entries = options.entries ?? loadNoTradeDays();
  const store = options.store || defaultStore;
  const overrides = options.overrides ?? store.overrides;
  const date = nyDateParts(now).iso;
  let calendar;
  try {
    calendar = options.calendar ?? await readCalendar(client);
  } catch (error) {
    warn(options.logger, calendarFailureLogLine(date, error));
    calendar = { failed: true };
  }
  return decideSkip({ now, entries, overrides, calendar });
}

export async function runIfTradingDay(client, pingName, send, options = {}) {
  const decision = await evaluateScheduledSkip(client, options);
  if (decision.skip) {
    warn(options.logger, skipLogLine(pingName, decision));
    return decision;
  }
  await send(client);
  return decision;
}
