import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import test from 'node:test';
import { createWebApp } from '../src/http/createWebApp.js';
import { createNoTradeDaysHandler } from '../src/http/noTradeDays.js';
import {
  ALERTS_CHANNEL_ID,
  CALENDAR_FETCH_LIMIT,
  calendarSignal,
  createNoTradeStore,
  decideSkip,
  getDefaultNoTradeStore,
  loadNoTradeDays,
  nyDateParts,
  runIfTradingDay,
} from '../src/services/noTradeDays.js';

const SECRET = 'test-secret-value';
const BOT = 'bot';
const RULEBOOK = [
  'CLOSED 2026-11-26 Thanksgiving',
  'NO-TRADE 2026-11-27 Early close',
  'NO-TRADE 2026-12-04 NFP',
  'NO-TRADE 2026-12-09 FOMC',
  'NO-TRADE 2026-12-10 CPI',
  'NO-TRADE 2026-12-18 Quarterly witching',
  'NO-TRADE 2026-12-24 Early close',
  'CLOSED 2026-12-25 Christmas',
  'CLOSED 2027-01-01 New Year',
  'NO-TRADE 2027-01-08 NFP',
  'NO-TRADE 2027-01-13 CPI',
  'NO-TRADE 2027-01-15 Monthly OpEx',
  'CLOSED 2027-01-18 MLK',
  'NO-TRADE 2027-01-27 FOMC',
  'NO-TRADE 2027-02-05 NFP',
  'NO-TRADE 2027-02-11 CPI',
  'CLOSED 2027-02-15 Presidents Day',
  'NO-TRADE 2027-02-17 VIX + FOMC minutes',
  'NO-TRADE 2027-02-19 Monthly OpEx',
  'NO-TRADE 2027-03-05 NFP',
  'NO-TRADE 2027-03-10 CPI',
  'NO-TRADE 2027-03-17 FOMC + VIX exp',
  'NO-TRADE 2027-03-19 Quarterly witching',
  'CLOSED 2027-03-26 Good Friday',
  'NO-TRADE 2027-04-02 NFP',
  'NO-TRADE 2027-04-13 CPI',
  'NO-TRADE 2027-04-16 Monthly OpEx',
  'NO-TRADE 2027-04-28 FOMC',
  'NO-TRADE 2027-05-07 NFP',
  'NO-TRADE 2027-05-12 CPI',
  'NO-TRADE 2027-05-21 Monthly OpEx',
  'CLOSED 2027-05-31 Memorial Day',
  'NO-TRADE 2027-06-04 NFP',
  'NO-TRADE 2027-06-09 FOMC',
  'NO-TRADE 2027-06-10 CPI',
  'NO-TRADE 2027-06-17 Quarterly witching',
  'CLOSED 2027-06-18 Juneteenth observed',
  'CLOSED 2027-07-05 Independence Day observed',
  'CLOSED 2027-09-06 Labor Day',
  'NO-TRADE 2027-09-17 Triple witching',
  'CLOSED 2027-11-25 Thanksgiving',
  'NO-TRADE 2027-11-26 Early close',
  'NO-TRADE 2027-12-17 Triple witching',
  'CLOSED 2027-12-24 Christmas observed',
].join('; ');

function parseRulebook(text) {
  return text.split(';').map((part) => part.trim()).filter(Boolean).map((line) => {
    const match = /^(NO-TRADE|CLOSED)\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(line);
    assert.ok(match, line);
    return { date: match[2], status: match[1], reason: match[3] };
  });
}

function listedDecision(instant, extras = {}) {
  return decideSkip({
    now: new Date(instant),
    entries: loadNoTradeDays(),
    overrides: new Map(),
    calendar: { failed: true },
    ...extras,
  });
}

function message({ title, at, author = BOT, description = '' }) {
  return {
    author: { id: author },
    createdAt: new Date(at),
    embeds: [{ title, description }],
  };
}

function quietLogger() {
  return { warn() {} };
}

function throwingClient(messageText = 'discord down') {
  return {
    user: { id: BOT },
    channels: {
      async fetch() {
        throw new Error(messageText);
      },
    },
  };
}

test('the rulebook file is exactly the owner list', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/no-trade-days.json', import.meta.url), 'utf8'));
  const expected = parseRulebook(RULEBOOK);
  assert.equal(expected.length, 44);
  for (const row of raw) {
    assert.deepEqual(Object.keys(row).sort(), ['date', 'reason', 'status']);
  }
  assert.deepEqual(loadNoTradeDays(), expected);
  const dates = expected.map((entry) => entry.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(dates).size, dates.length);
});

test('New York dates roll at local midnight, including across UTC midnight and both DST offsets', () => {
  const cases = [
    ['2026-11-26T04:30:00.000Z', '2026-11-25'],
    ['2026-11-27T00:00:00.000Z', '2026-11-26'],
    ['2026-11-27T04:59:59.999Z', '2026-11-26'],
    ['2026-11-27T05:00:00.000Z', '2026-11-27'],
    ['2026-11-27T15:00:00.000Z', '2026-11-27'],
    ['2026-11-28T04:30:00.000Z', '2026-11-27'],
    ['2026-11-28T05:00:00.000Z', '2026-11-28'],
    ['2027-03-14T06:30:00.000Z', '2027-03-14'],
    ['2027-03-14T07:30:00.000Z', '2027-03-14'],
    ['2027-07-05T03:59:59.999Z', '2027-07-04'],
    ['2027-07-05T04:00:00.000Z', '2027-07-05'],
    ['2027-07-05T15:00:00.000Z', '2027-07-05'],
  ];
  for (const [instant, iso] of cases) {
    assert.equal(nyDateParts(new Date(instant)).iso, iso, instant);
  }
});

test('listed NO-TRADE and CLOSED days skip, and the lookup uses the New York date', () => {
  const thanksgivingEve = listedDecision('2026-11-26T04:30:00.000Z');
  assert.equal(thanksgivingEve.skip, false);
  assert.equal(thanksgivingEve.date, '2026-11-25');

  const utcMidnight = listedDecision('2026-11-27T00:30:00.000Z');
  assert.equal(utcMidnight.date, '2026-11-26');
  assert.equal(utcMidnight.skip, true);
  assert.equal(utcMidnight.status, 'CLOSED');
  assert.equal(utcMidnight.reason, 'Thanksgiving');
  assert.equal(utcMidnight.source, 'list');

  const beforeNyMidnight = listedDecision('2026-11-27T04:59:59.999Z');
  assert.equal(beforeNyMidnight.date, '2026-11-26');
  assert.equal(beforeNyMidnight.status, 'CLOSED');

  const atNyMidnight = listedDecision('2026-11-27T05:00:00.000Z');
  assert.equal(atNyMidnight.date, '2026-11-27');
  assert.equal(atNyMidnight.status, 'NO-TRADE');
  assert.equal(atNyMidnight.reason, 'Early close');

  const duringNyDay = listedDecision('2026-11-27T15:00:00.000Z');
  assert.equal(duringNyDay.status, 'NO-TRADE');
  assert.equal(duringNyDay.reason, 'Early close');

  const tradingMonday = listedDecision('2026-11-30T15:00:00.000Z');
  assert.equal(tradingMonday.skip, false);
  assert.equal(tradingMonday.date, '2026-11-30');
  assert.equal(tradingMonday.status, null);

  const beforeIndependence = listedDecision('2027-07-05T03:59:59.999Z');
  assert.equal(beforeIndependence.skip, false);
  assert.equal(beforeIndependence.date, '2027-07-04');

  const independence = listedDecision('2027-07-05T04:00:00.000Z');
  assert.equal(independence.skip, true);
  assert.equal(independence.date, '2027-07-05');
  assert.equal(independence.status, 'CLOSED');
  assert.equal(independence.reason, 'Independence Day observed');
});

test('a bot calendar embed from today skips when the JSON list does not', () => {
  const now = '2026-11-30T16:00:00.000Z';
  const title = '📅 Monday Nov 30 · 🔴 NO-TRADE: surprise halt';
  const decision = decideSkip({
    now: new Date(now),
    entries: [],
    overrides: new Map(),
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({ title, at: '2026-11-30T14:00:00.000Z' })],
    },
  });
  assert.equal(decision.skip, true);
  assert.equal(decision.date, '2026-11-30');
  assert.equal(decision.status, 'NO-TRADE');
  assert.equal(decision.reason, 'surprise halt');
  assert.equal(decision.source, 'calendar');

  const closed = decideSkip({
    now: new Date('2026-11-26T16:00:00.000Z'),
    entries: [],
    overrides: new Map(),
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Thursday Nov 26 · 🔴 CLOSED: Thanksgiving',
        at: '2026-11-26T15:00:00.000Z',
      })],
    },
  });
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.reason, 'Thanksgiving');

  const exact = decideSkip({
    now: new Date('2026-11-27T15:00:00.000Z'),
    entries: [],
    overrides: new Map(),
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Friday Nov 27 · 🔴 NO-TRADE: Early close (day after Thanksgiving)',
        at: '2026-11-27T14:05:00.000Z',
      })],
    },
  });
  assert.equal(exact.reason, 'Early close (day after Thanksgiving)');
  assert.equal(exact.source, 'calendar');
});

test('calendar messages count only for the same New York date, the bot, and an embed title', () => {
  const entries = [];
  const overrides = new Map();

  const postedYesterdayNy = decideSkip({
    now: new Date('2026-11-27T15:00:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Friday Nov 27 · 🔴 NO-TRADE: Early close',
        at: '2026-11-27T04:30:00.000Z',
      })],
    },
  });
  assert.equal(postedYesterdayNy.date, '2026-11-27');
  assert.equal(postedYesterdayNy.skip, false);

  const stillTodayAfterUtcMidnight = decideSkip({
    now: new Date('2026-11-28T04:30:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Friday Nov 27 · 🔴 NO-TRADE: Early close',
        at: '2026-11-27T15:00:00.000Z',
      })],
    },
  });
  assert.equal(stillTodayAfterUtcMidnight.date, '2026-11-27');
  assert.equal(stillTodayAfterUtcMidnight.skip, true);
  assert.equal(stillTodayAfterUtcMidnight.source, 'calendar');

  const rolledToNextNyDate = decideSkip({
    now: new Date('2026-11-28T05:00:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Friday Nov 27 · 🔴 NO-TRADE: Early close',
        at: '2026-11-27T15:00:00.000Z',
      })],
    },
  });
  assert.equal(rolledToNextNyDate.date, '2026-11-28');
  assert.equal(rolledToNextNyDate.skip, false);

  const titleForAnotherDay = decideSkip({
    now: new Date('2026-11-27T15:00:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Thursday Nov 26 · 🔴 CLOSED: Thanksgiving',
        at: '2026-11-27T14:00:00.000Z',
      })],
    },
  });
  assert.equal(titleForAnotherDay.skip, false);

  const wrongYear = decideSkip({
    now: new Date('2026-11-27T15:00:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Friday Nov 27, 2025 · 🔴 NO-TRADE: old note',
        at: '2026-11-27T14:00:00.000Z',
      })],
    },
  });
  assert.equal(wrongYear.skip, false);

  const humanPost = decideSkip({
    now: new Date('2026-11-30T16:00:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Monday Nov 30 · 🔴 NO-TRADE: halt',
        at: '2026-11-30T14:00:00.000Z',
        author: 'human',
      })],
    },
  });
  assert.equal(humanPost.skip, false);

  const descriptionOnly = decideSkip({
    now: new Date('2026-11-30T16:00:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Monday Nov 30 · 🟢 Session open',
        description: 'Remember NO-TRADE days exist',
        at: '2026-11-30T14:00:00.000Z',
      })],
    },
  });
  assert.equal(descriptionOnly.skip, false);

  const undatedTitle = decideSkip({
    now: new Date('2026-11-27T15:00:00.000Z'),
    entries,
    overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [{
        authorId: BOT,
        createdAt: new Date('2026-11-27T14:00:00.000Z'),
        embeds: [{ data: { title: '🔴 NO-TRADE: Early close' } }],
      }],
    },
  });
  assert.equal(undatedTitle.skip, true);
  assert.equal(undatedTitle.reason, 'Early close');

  const earlier = message({
    title: '📅 Monday Nov 30 · 🔴 NO-TRADE: halt',
    at: '2026-11-30T14:00:00.000Z',
  });
  const laterClear = message({
    title: '📅 Monday Nov 30 · 🟢 We are trading',
    at: '2026-11-30T18:00:00.000Z',
  });
  const anyMatch = decideSkip({
    now: new Date('2026-11-30T19:00:00.000Z'),
    entries,
    overrides,
    calendar: { failed: false, botId: BOT, messages: [laterClear, earlier] },
  });
  assert.equal(anyMatch.skip, true);
  assert.equal(anyMatch.reason, 'halt');

  const laterUpdate = message({
    title: '📅 Monday Nov 30 · 🔴 CLOSED: updated halt',
    at: '2026-11-30T18:30:00.000Z',
  });
  const latest = calendarSignal([earlier, laterUpdate], BOT, '2026-11-30');
  assert.equal(latest.status, 'CLOSED');
  assert.equal(latest.reason, 'updated halt');
});

test('a failed calendar read leaves the JSON decision unchanged', async () => {
  const tokenish = 'abcdefghijklmnopqrstuvwxyz.abcde.abcdefghijklmnopqrstuvwxyz';
  const lines = [];
  const sends = [];
  const skipped = await runIfTradingDay(throwingClient(`boom ${tokenish}`), 'morning_hype', async () => {
    sends.push('hype');
  }, {
    now: new Date('2026-11-27T15:00:00.000Z'),
    overrides: new Map(),
    logger: { warn: (line) => lines.push(line) },
  });
  assert.equal(skipped.skip, true);
  assert.equal(skipped.source, 'list');
  assert.equal(skipped.reason, 'Early close');
  assert.deepEqual(sends, []);
  assert.deepEqual(lines, [
    'No-trade calendar check failed for 2026-11-27; using the date list only (boom [redacted])',
    'Skipping scheduled morning hype on 2026-11-27 (NO-TRADE: Early close) source=list',
  ]);
  assert.equal(lines.join('\n').includes(tokenish), false);

  const tradingLines = [];
  const tradingSends = [];
  const trading = await runIfTradingDay(throwingClient('discord down'), 'daily_checkin', async () => {
    tradingSends.push('checkin');
  }, {
    now: new Date('2026-11-30T16:00:00.000Z'),
    overrides: new Map(),
    logger: { warn: (line) => tradingLines.push(line) },
  });
  assert.equal(trading.skip, false);
  assert.equal(trading.date, '2026-11-30');
  assert.deepEqual(tradingSends, ['checkin']);
  assert.deepEqual(tradingLines, [
    'No-trade calendar check failed for 2026-11-30; using the date list only (discord down)',
  ]);
});

test('the JSON list stays primary when the calendar title is a normal trading day', () => {
  const decision = decideSkip({
    now: new Date('2026-11-27T15:00:00.000Z'),
    entries: loadNoTradeDays(),
    overrides: new Map(),
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Friday Nov 27 · 🟢 Session open',
        at: '2026-11-27T14:00:00.000Z',
      })],
    },
  });
  assert.equal(decision.skip, true);
  assert.equal(decision.source, 'list');
  assert.equal(decision.reason, 'Early close');
});

test('runtime mark and unmark change NO-TRADE days and leave CLOSED days in place', () => {
  const entries = loadNoTradeDays();
  const store = createNoTradeStore();

  const marked = store.mark('2026-11-30', 'halt', entries);
  assert.equal(marked.ok, true);
  const added = decideSkip({
    now: new Date('2026-11-30T15:00:00.000Z'),
    entries,
    overrides: store.overrides,
    calendar: { failed: true },
  });
  assert.equal(added.skip, true);
  assert.equal(added.status, 'NO-TRADE');
  assert.equal(added.reason, 'halt');
  assert.equal(added.source, 'override');

  const unmarked = store.unmark('2026-12-04', entries);
  assert.equal(unmarked.ok, true);
  assert.equal(unmarked.listed, null);
  const cleared = decideSkip({
    now: new Date('2026-12-04T15:00:00.000Z'),
    entries,
    overrides: store.overrides,
    calendar: { failed: true },
  });
  assert.equal(cleared.skip, false);

  const calendarStillSkips = decideSkip({
    now: new Date('2026-12-04T15:00:00.000Z'),
    entries,
    overrides: store.overrides,
    calendar: {
      failed: false,
      botId: BOT,
      messages: [message({
        title: '📅 Friday Dec 4 · 🔴 NO-TRADE: NFP',
        at: '2026-12-04T14:00:00.000Z',
      })],
    },
  });
  assert.equal(calendarStillSkips.skip, true);
  assert.equal(calendarStillSkips.source, 'calendar');

  const closed = store.unmark('2026-11-26', entries);
  assert.equal(closed.ok, false);
  assert.equal(closed.code, 'closed_day');
  const markedClosed = store.mark('2026-12-25', 'nope', entries);
  assert.equal(markedClosed.ok, false);
  assert.equal(markedClosed.code, 'closed_day');
  const holiday = decideSkip({
    now: new Date('2026-11-26T15:00:00.000Z'),
    entries,
    overrides: store.overrides,
    calendar: { failed: true },
  });
  assert.equal(holiday.status, 'CLOSED');
  assert.equal(holiday.reason, 'Thanksgiving');
  assert.equal(store.mark('2026-02-31', 'bad', entries).code, 'invalid_date');
  assert.equal(store.mark('2026-11-30', 'x'.repeat(201), entries).code, 'invalid_reason');
});

test('scheduled pings are not sent on a skip day and the alerts channel is the only calendar read', async () => {
  const seen = [];
  const client = {
    user: { id: BOT },
    channels: {
      async fetch(id) {
        seen.push(id);
        return {
          messages: {
            async fetch(options) {
              seen.push(options);
              return new Map([
                ['1', message({
                  title: '📅 Monday Nov 30 · 🔴 NO-TRADE: surprise halt',
                  at: '2026-11-30T14:00:00.000Z',
                })],
              ]);
            },
          },
        };
      },
    },
  };
  const lines = [];
  const sends = [];
  const decision = await runIfTradingDay(client, 'daily_checkin', async () => {
    sends.push('checkin');
  }, {
    now: new Date('2026-11-30T16:00:00.000Z'),
    entries: [],
    overrides: new Map(),
    logger: { warn: (line) => lines.push(line) },
  });
  assert.equal(decision.skip, true);
  assert.equal(decision.source, 'calendar');
  assert.deepEqual(sends, []);
  assert.deepEqual(seen, [ALERTS_CHANNEL_ID, { limit: CALENDAR_FETCH_LIMIT }]);
  assert.equal(ALERTS_CHANNEL_ID, '1564051322485870803');
  assert.equal(CALENDAR_FETCH_LIMIT, 100);
  assert.deepEqual(lines, [
    'Skipping scheduled daily check-in on 2026-11-30 (NO-TRADE: surprise halt) source=calendar',
  ]);
});

test('a calendar channel outside the TOFC server is ignored', async () => {
  const sends = [];
  const client = {
    user: { id: BOT },
    channels: {
      async fetch() {
        return {
          guildId: '999999999999999999',
          messages: {
            async fetch() {
              throw new Error('should not read');
            },
          },
        };
      },
    },
  };
  const decision = await runIfTradingDay(client, 'morning_hype', async () => {
    sends.push('hype');
  }, {
    now: new Date('2026-11-30T16:00:00.000Z'),
    entries: [],
    overrides: new Map(),
    logger: quietLogger(),
  });
  assert.equal(decision.skip, false);
  assert.equal(decision.date, '2026-11-30');
  assert.deepEqual(sends, ['hype']);
});

test('only the two weekday session jobs are gated; manual test commands still send', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const hype = readFileSync(new URL('../src/commands/testhype.js', import.meta.url), 'utf8');
  const checkin = readFileSync(new URL('../src/commands/testcheckin.js', import.meta.url), 'utf8');
  const morning = readFileSync(new URL('../src/services/morningHypeService.js', import.meta.url), 'utf8');
  const daily = readFileSync(new URL('../src/services/dailyCheckinService.js', import.meta.url), 'utf8');

  assert.match(app, /cron\.schedule\('0 11 \* \* 1-5', runSafeTask\('daily_checkin', \(\) => runIfTradingDay\(this, 'daily_checkin', sendDailyCheckin\)\)/);
  assert.match(app, /cron\.schedule\('0 9 \* \* 1-5', runSafeTask\('morning_hype', \(\) => runIfTradingDay\(this, 'morning_hype', sendMorningHype\)\)/);
  assert.match(app, /cron\.schedule\('0 6 \* \* \*', runSafeTask\('birthday_check'/);
  assert.match(app, /cron\.schedule\('\* \* \* \* \*', runSafeTask\('giveaway_check'/);
  assert.match(app, /cron\.schedule\('\*\/15 \* \* \* \*', runSafeTask\('counter_update'/);
  assert.match(app, /cron\.schedule\('0 20 \* \* 0', runSafeTask\('qa_weekly_export'/);
  assert.match(hype, /sendMorningHype\(interaction\.client\)/);
  assert.equal(hype.includes('runIfTradingDay'), false);
  assert.match(checkin, /sendDailyCheckin\(interaction\.client\)/);
  assert.equal(checkin.includes('runIfTradingDay'), false);
  assert.match(morning, /Match starting soon, who's ready to drop into NY session and secure the loot\? @everyone/);
  assert.match(daily, /How did we do today\? <@&\$\{process\.env\.PREMIUM_ROLE_ID\}>/);
  assert.match(daily, /How did we do today\? @everyone/);
});

function enabledConfig(secret = SECRET) {
  return {
    enabled: true,
    secret,
    secretHasWhitespace: false,
    allowedChannels: new Set(),
    invalidChannelIds: [],
  };
}

function handlerApp(handler) {
  const app = express();
  app.post('/internal/no-trade-days', handler);
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function post(base, body, { token = SECRET, contentType = 'application/json' } = {}) {
  const headers = {};
  if (contentType !== null) headers['content-type'] = contentType;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}/internal/no-trade-days`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

test('the no-trade endpoint uses the publish secret and updates the shared in-memory list', async () => {
  const lines = [];
  const store = getDefaultNoTradeStore();
  store.clear();
  const handler = createNoTradeDaysHandler({
    readConfig: () => enabledConfig(),
    logger: { warn: (line) => lines.push(String(line)) },
  });

  try {
    await withServer(handlerApp(handler), async (base) => {
      const disabled = createNoTradeDaysHandler({
        readConfig: () => ({ ...enabledConfig(), enabled: false, secret: '' }),
        logger: { warn: (line) => lines.push(String(line)) },
        store: createNoTradeStore(),
      });
      await withServer(handlerApp(disabled), async (disabledBase) => {
        const refused = await post(disabledBase, { date: '2026-11-30', action: 'mark', reason: 'halt' });
        assert.equal(refused.response.status, 503);
        assert.equal(refused.json.error, 'no_trade_disabled');
      });

      const missing = await post(base, { date: '2026-11-30', action: 'mark' }, { token: null });
      assert.equal(missing.response.status, 401);
      assert.equal(missing.json.error, 'unauthorized');
      assert.match(missing.response.headers.get('www-authenticate'), /Bearer/);

      const wrong = await post(base, { date: '2026-11-30', action: 'mark' }, { token: 'wrong-token' });
      assert.equal(wrong.response.status, 401);
      assert.equal(store.overrides.size, 0);

      const badType = await post(base, { date: '2026-11-30', action: 'mark' }, { contentType: 'text/plain' });
      assert.equal(badType.response.status, 415);

      const badDate = await post(base, { date: '2026-02-31', action: 'mark', reason: 'nope' });
      assert.equal(badDate.response.status, 400);
      assert.equal(badDate.json.error, 'invalid_date');

      const marked = await post(base, { date: '2026-11-30', action: 'mark', reason: 'halt' });
      assert.equal(marked.response.status, 200);
      assert.equal(marked.response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(marked.json, {
        date: '2026-11-30',
        action: 'mark',
        status: 'NO-TRADE',
        reason: 'halt',
        source: 'override',
      });

      const sends = [];
      const decision = await runIfTradingDay(throwingClient(), 'daily_checkin', async () => {
        sends.push('sent');
      }, {
        now: new Date('2026-11-30T16:00:00.000Z'),
        logger: quietLogger(),
      });
      assert.equal(decision.skip, true);
      assert.equal(decision.reason, 'halt');
      assert.equal(decision.source, 'override');
      assert.deepEqual(sends, []);

      const closed = await post(base, { date: '2026-11-26', action: 'unmark' });
      assert.equal(closed.response.status, 409);
      assert.equal(closed.json.error, 'closed_day');
      const holiday = decideSkip({
        now: new Date('2026-11-26T16:00:00.000Z'),
        entries: loadNoTradeDays(),
        overrides: store.overrides,
        calendar: { failed: true },
      });
      assert.equal(holiday.status, 'CLOSED');
      assert.equal(holiday.reason, 'Thanksgiving');

      const unmarked = await post(base, { date: '2026-12-04', action: 'unmark' });
      assert.equal(unmarked.response.status, 200);
      assert.equal(unmarked.json.status, null);
      const cleared = decideSkip({
        now: new Date('2026-12-04T16:00:00.000Z'),
        entries: loadNoTradeDays(),
        overrides: store.overrides,
        calendar: { failed: true },
      });
      assert.equal(cleared.skip, false);
    });
  } finally {
    store.clear();
  }

  assert.equal(lines.join('\n').includes(SECRET), false);
  assert.equal(lines.join('\n').includes('wrong-token'), false);
});

test('bad tokens on the no-trade endpoint are rate limited without locking out a valid token', async () => {
  const handler = createNoTradeDaysHandler({
    readConfig: () => enabledConfig(),
    logger: quietLogger(),
    store: createNoTradeStore(),
    now: () => 1_700_000_000_000,
    maxAuthFailures: 2,
  });
  await withServer(handlerApp(handler), async (base) => {
    assert.equal((await post(base, { date: '2026-11-30', action: 'mark' }, { token: 'nope' })).response.status, 401);
    assert.equal((await post(base, { date: '2026-11-30', action: 'mark' }, { token: 'nope' })).response.status, 401);
    const limited = await post(base, { date: '2026-11-30', action: 'mark' }, { token: 'nope' });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.json.error, 'rate_limited');
    assert.ok(Number(limited.response.headers.get('retry-after')) >= 1);
    const ok = await post(base, { date: '2026-11-30', action: 'mark', reason: 'halt' });
    assert.equal(ok.response.status, 200);
  });
});

test('createWebApp mounts the no-trade route beside publish', async () => {
  const store = createNoTradeStore();
  const lines = [];
  const client = {
    isReady: () => false,
    commands: { size: 0 },
    db: { getStatus: () => ({ isDegraded: true, connectionType: 'none', degradedReason: null }) },
    config: { api: { cors: { origin: '*' }, rateLimit: { windowMs: 60_000, max: 100 } } },
    guilds: { cache: { size: 0 } },
  };
  const app = createWebApp(client, {
    publish: { readConfig: () => enabledConfig(), logger: { warn() {} } },
    noTradeDays: {
      readConfig: () => enabledConfig(),
      logger: { warn: (line) => lines.push(String(line)) },
      store,
    },
  });
  await withServer(app, async (base) => {
    const marked = await post(base, {
      date: '2026-12-01',
      action: 'mark',
      reason: 'runtime',
    });
    assert.equal(marked.response.status, 200, JSON.stringify(marked.json));
    assert.equal(marked.json.source, 'override');
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
  });
  assert.equal(lines.join('\n').includes(SECRET), false);
  assert.equal(store.overrides.get('2026-12-01')?.reason, 'runtime');
});
