import assert from 'node:assert/strict';
import express from 'express';
import { PermissionFlagsBits } from 'discord.js';
import test from 'node:test';
import {
  DEFAULT_LIMITS,
  TOFC_GUILD_ID,
  bearerMatches,
  buildAllowedMentions,
  createPublishHandler,
  jumpUrl,
  readPublishConfig,
} from '../src/http/publish.js';
import { createWebApp } from '../src/http/createWebApp.js';
import pkg from '../package.json' with { type: 'json' };

const SECRET = 'test-secret-value';
const ALERTS = '1564051322485870803';
const TRADERS = '1566110195938107643';
const ANNOUNCEMENTS = '1129232583503384618';
const MESSAGE_ID = '123456789012345678';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const GIF = Buffer.from('GIF89aHELLO', 'ascii');
const WEBP = Buffer.alloc(12);
WEBP.write('RIFF', 0);
WEBP.write('WEBP', 8);

function enabledConfig(channels = [ALERTS], secret = SECRET) {
  return {
    enabled: true,
    secret,
    secretHasWhitespace: /\s/.test(secret),
    allowedChannels: new Set(channels),
    invalidChannelIds: [],
  };
}

function createFixture(clientOptions = {}, handlerOptions = {}) {
  const calls = { guildLookups: [], guildFetches: [], channelFetches: [], send: [] };
  const denied = clientOptions.deny || new Set();
  const channel = {
    id: clientOptions.channelId || ALERTS,
    guildId: clientOptions.channelGuildId || TOFC_GUILD_ID,
    isTextBased: () => clientOptions.text !== false,
    isDMBased: () => clientOptions.dm === true,
    isThread: () => clientOptions.thread === true,
    permissionsFor() {
      return { has: (bit) => !denied.has(bit) };
    },
    guild: {
      id: clientOptions.channelGuildId || TOFC_GUILD_ID,
      members: {
        me: clientOptions.me === undefined ? { id: 'bot' } : clientOptions.me,
        fetchMe: clientOptions.fetchMe,
      },
    },
    async send(payload) {
      calls.send.push(payload);
      if (clientOptions.sendError) throw clientOptions.sendError;
      return { id: clientOptions.messageId === undefined ? MESSAGE_ID : clientOptions.messageId };
    },
  };
  const guild = {
    id: TOFC_GUILD_ID,
    channels: {
      async fetch(id) {
        calls.channelFetches.push(id);
        if (clientOptions.fetchError) throw clientOptions.fetchError;
        if (clientOptions.missingChannel) return null;
        return { ...channel, id };
      },
    },
  };
  const client = {
    isReady: () => clientOptions.ready !== false,
    commands: { size: 4 },
    db: clientOptions.db || {
      getStatus: () => ({ isDegraded: false, connectionType: 'postgres', degradedReason: null }),
    },
    config: clientOptions.config || {
      api: { cors: { origin: '*' }, rateLimit: { windowMs: 60_000, max: 100 } },
    },
    guilds: {
      cache: {
        size: 1,
        get(id) {
          calls.guildLookups.push(id);
          if (clientOptions.uncached) return undefined;
          return id === TOFC_GUILD_ID ? guild : undefined;
        },
      },
      async fetch(id) {
        calls.guildFetches.push(id);
        if (id !== TOFC_GUILD_ID || clientOptions.guildFetchError) {
          throw clientOptions.guildFetchError || new Error('unexpected guild');
        }
        return guild;
      },
    },
  };
  const lines = [];
  const handler = createPublishHandler({
    getClient: () => client,
    readConfig: () => handlerOptions.config || enabledConfig(),
    logger: { warn: (message) => lines.push(String(message)) },
    limits: handlerOptions.limits,
    now: handlerOptions.now,
  });
  return { client, calls, lines, handler };
}

function handlerApp(handler) {
  const app = express();
  app.post('/internal/publish', handler);
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

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function postJson(base, body, { token = SECRET, contentType = 'application/json' } = {}) {
  const headers = { 'content-type': contentType };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}/internal/publish`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { response, json: await readBody(response) };
}

async function postForm(base, form, { token = SECRET } = {}) {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${base}/internal/publish`, {
    method: 'POST',
    headers,
    body: form,
  });
  return { response, json: await readBody(response) };
}

test('publish config fails closed and does not invent an allowlist', () => {
  assert.equal(readPublishConfig({}).enabled, false);
  assert.equal(readPublishConfig({ PUBLISH_SECRET: '   ' }).enabled, false);
  const configured = readPublishConfig({
    PUBLISH_SECRET: '  abc  ',
    PUBLISH_ALLOWED_CHANNELS: `nope, ${ALERTS}, 123, ${TRADERS}`,
  });
  assert.equal(configured.enabled, true);
  assert.equal(configured.secret, 'abc');
  assert.equal(configured.secretHasWhitespace, false);
  assert.deepEqual([...configured.allowedChannels], [ALERTS, TRADERS]);
  assert.deepEqual(configured.invalidChannelIds, ['nope', '123']);
  assert.equal(readPublishConfig({ PUBLISH_SECRET: 'abc def' }).secretHasWhitespace, true);
  assert.equal(readPublishConfig({ PUBLISH_SECRET: 'only-the-secret' }).allowedChannels.size, 0);
  assert.equal(DEFAULT_LIMITS.maxFiles, 10);
  assert.equal(DEFAULT_LIMITS.maxFileBytes, 20 * 1024 * 1024);
  assert.equal(DEFAULT_LIMITS.maxTotalBytes, 25 * 1024 * 1024);
});

test('bearer comparison is exact and ignores the token length', () => {
  assert.equal(bearerMatches('Bearer test-secret', 'test-secret'), true);
  assert.equal(bearerMatches('bearer test-secret', 'test-secret'), true);
  assert.equal(bearerMatches('  Bearer    test-secret  ', 'test-secret'), true);
  assert.equal(bearerMatches('Bearer wrong', 'test-secret'), false);
  assert.equal(bearerMatches('Bearer short', 'a-much-longer-secret-value'), false);
  assert.equal(bearerMatches('Bearer a-much-longer-secret-value', 'short'), false);
  assert.equal(bearerMatches(undefined, 'test-secret'), false);
  assert.equal(bearerMatches('Basic test-secret', 'test-secret'), false);
  assert.equal(bearerMatches('Bearer test-secret extra', 'test-secret'), false);
  assert.equal(bearerMatches('Bearer ab', 'ab cd'), false);
  assert.deepEqual(buildAllowedMentions(false), { parse: [] });
  assert.deepEqual(buildAllowedMentions(true), { parse: ['everyone'] });
  assert.equal(
    jumpUrl(TOFC_GUILD_ID, ALERTS, MESSAGE_ID),
    `https://discord.com/channels/${TOFC_GUILD_ID}/${ALERTS}/${MESSAGE_ID}`,
  );
});

test('a JSON post is sent as the bot and returns a jump url', async () => {
  const fixture = createFixture();
  await withServer(handlerApp(fixture.handler), async (base) => {
    const { response, json } = await postJson(base, {
      channelId: ALERTS,
      content: '@everyone TOP-SECRET-NEWSLETTER',
      embeds: [{
        title: 'Sunday news',
        description: 'Levels for the week are in.',
        color: '#336699',
        author: { name: 'TOFC', iconURL: 'https://example.com/icon.png' },
        image: { url: 'https://example.com/chart.png' },
      }],
      tts: true,
      components: [{ type: 1 }],
      files: ['http://127.0.0.1:1/should-not-fetch.png'],
      username: 'Not The Bot',
    }, { contentType: 'application/json; charset=utf-8' });
    assert.equal(response.status, 201);
    assert.deepEqual(json, {
      messageId: MESSAGE_ID,
      channelId: ALERTS,
      url: `https://discord.com/channels/${TOFC_GUILD_ID}/${ALERTS}/${MESSAGE_ID}`,
    });

    const embedOnly = await postJson(base, {
      channelId: ALERTS,
      embeds: [{ description: 'Embed only' }],
    });
    assert.equal(embedOnly.response.status, 201, JSON.stringify(embedOnly.json));
  });

  assert.equal(fixture.calls.send.length, 2);
  const payload = fixture.calls.send[0];
  assert.equal(payload.content, '@everyone TOP-SECRET-NEWSLETTER');
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(payload.embeds[0].color, 0x336699);
  assert.equal(payload.embeds[0].author.icon_url, 'https://example.com/icon.png');
  assert.equal(payload.embeds[0].image.url, 'https://example.com/chart.png');
  assert.equal(payload.tts, undefined);
  assert.equal(payload.components, undefined);
  assert.equal(payload.files, undefined);
  assert.equal(payload.username, undefined);
  assert.equal(fixture.calls.send[1].content, undefined);
  assert.equal(fixture.calls.send[1].embeds[0].description, 'Embed only');
  assert.deepEqual(fixture.calls.send[1].allowedMentions, { parse: [] });
  assert.deepEqual(fixture.calls.guildLookups, [TOFC_GUILD_ID, TOFC_GUILD_ID]);
  assert.deepEqual(fixture.calls.channelFetches, [ALERTS, ALERTS]);
  const logged = fixture.lines.join('\n');
  assert.match(logged, /Publish posted/);
  assert.equal(logged.includes(SECRET), false);
  assert.equal(logged.includes('TOP-SECRET-NEWSLETTER'), false);
  assert.equal(logged.includes('@everyone'), false);
});

test('mentionEveryone opts in to everyone mentions only', async () => {
  const allowed = createFixture();
  await withServer(handlerApp(allowed.handler), async (base) => {
    const { response } = await postJson(base, {
      channelId: ALERTS,
      content: '@everyone Sunday news is up.',
      mentionEveryone: true,
    });
    assert.equal(response.status, 201);
  });
  assert.deepEqual(allowed.calls.send[0].allowedMentions, { parse: ['everyone'] });

  const denied = createFixture({
    deny: new Set([PermissionFlagsBits.MentionEveryone]),
  });
  await withServer(handlerApp(denied.handler), async (base) => {
    const withoutPing = await postJson(base, {
      channelId: ALERTS,
      content: '@everyone this must not ping',
    });
    assert.equal(withoutPing.response.status, 201);
    const withPing = await postJson(base, {
      channelId: ALERTS,
      content: '@everyone this must ping',
      mentionEveryone: true,
    });
    assert.equal(withPing.response.status, 403);
    assert.equal(withPing.json.error, 'missing_permissions');
    assert.match(withPing.json.message, /Mention Everyone/);
  });
  assert.equal(denied.calls.send.length, 1);
  assert.deepEqual(denied.calls.send[0].allowedMentions, { parse: [] });
});

test('the route is disabled until a secret is set, even with a bearer token', async () => {
  const fixture = createFixture({}, {
    config: {
      enabled: false,
      secret: '',
      secretHasWhitespace: false,
      allowedChannels: new Set([ALERTS]),
      invalidChannelIds: [],
    },
  });
  await withServer(handlerApp(fixture.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' }, { token: SECRET });
    assert.equal(response.status, 503);
    assert.equal(json.error, 'publish_disabled');
    const missing = await postJson(base, { channelId: ALERTS, content: 'hi' }, { token: null });
    assert.equal(missing.response.status, 503);
  });
  assert.equal(fixture.calls.send.length, 0);
  assert.equal(fixture.calls.channelFetches.length, 0);
});

test('bad, missing, and wrong-length tokens are rejected without logging them', async () => {
  const fixture = createFixture();
  await withServer(handlerApp(fixture.handler), async (base) => {
    const missing = await postJson(base, { channelId: ALERTS, content: 'hi' }, { token: null });
    assert.equal(missing.response.status, 401);
    assert.equal(missing.response.headers.get('www-authenticate'), 'Bearer');
    const wrong = await postJson(base, { channelId: ALERTS, content: 'hi' }, { token: 'attacker-token-value' });
    assert.equal(wrong.response.status, 401);
    assert.equal(wrong.json.error, 'unauthorized');
  });
  assert.equal(fixture.calls.send.length, 0);
  const logged = fixture.lines.join('\n');
  assert.equal(logged.includes('attacker-token-value'), false);
  assert.equal(logged.includes(SECRET), false);
});

test('channels outside the allowlist or the TOFC guild are rejected', async () => {
  const blocked = createFixture();
  await withServer(handlerApp(blocked.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: TRADERS, content: 'hi' });
    assert.equal(response.status, 403);
    assert.equal(json.error, 'channel_not_allowed');
    assert.match(json.message, new RegExp(TRADERS));
  });
  assert.equal(blocked.calls.channelFetches.length, 0);

  const empty = createFixture({}, { config: enabledConfig([]) });
  await withServer(handlerApp(empty.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 403);
    assert.match(json.message, /PUBLISH_ALLOWED_CHANNELS is empty/);
  });

  const otherGuild = createFixture({ channelGuildId: '999999999999999999' });
  await withServer(handlerApp(otherGuild.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 403);
    assert.equal(json.error, 'guild_not_allowed');
  });
  assert.equal(otherGuild.calls.send.length, 0);

  const dm = createFixture({ dm: true });
  await withServer(handlerApp(dm.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 403);
    assert.equal(json.error, 'guild_not_allowed');
  });
  assert.equal(dm.calls.send.length, 0);
});

test('missing channels, a disconnected bot, and Discord send errors stay in the TOFC guild', async () => {
  const notReady = createFixture({ ready: false });
  await withServer(handlerApp(notReady.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 503);
    assert.equal(json.error, 'bot_not_ready');
  });
  assert.equal(notReady.calls.guildLookups.length, 0);

  const uncached = createFixture({ uncached: true });
  await withServer(handlerApp(uncached.handler), async (base) => {
    const { response } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 201);
  });
  assert.deepEqual(uncached.calls.guildFetches, [TOFC_GUILD_ID]);

  const unavailable = createFixture({ uncached: true, guildFetchError: new Error('gateway down') });
  await withServer(handlerApp(unavailable.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 503);
    assert.equal(json.error, 'guild_unavailable');
  });

  const missing = createFixture({ missingChannel: true });
  await withServer(handlerApp(missing.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 404);
    assert.equal(json.error, 'channel_not_found');
  });

  const unknown = createFixture({ fetchError: Object.assign(new Error('Unknown Channel'), { code: 10003 }) });
  await withServer(handlerApp(unknown.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 404);
    assert.equal(json.error, 'channel_not_found');
  });

  const token = 'aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.ccccccccccccccccccccccccccc';
  const discordError = Object.assign(new Error(`Invalid Form Body ${token}`), {
    code: 50035,
    request: { headers: { authorization: `Bot ${token}` } },
  });
  const invalid = createFixture({ sendError: discordError });
  await withServer(handlerApp(invalid.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 400);
    assert.equal(json.error, 'invalid_message');
    assert.equal(JSON.stringify(json).includes(token), false);
    assert.match(json.message, /\[redacted\]/);
  });
  assert.equal(invalid.lines.join('\n').includes(token), false);

  const generic = createFixture({
    sendError: Object.assign(new Error(`nope ${token}`), { code: 99999, request: { authorization: token } }),
  });
  await withServer(handlerApp(generic.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 502);
    assert.equal(json.error, 'discord_send_failed');
    assert.equal(json.message.includes('nope'), false);
    assert.equal(JSON.stringify(json).includes(token), false);
  });
  assert.equal(generic.lines.join('\n').includes(token), false);
});

test('validation rejects empty, oversized, and unsafe payloads before send', async () => {
  const fixture = createFixture({}, { limits: { maxPerIp: 100, maxGlobal: 100 } });
  await withServer(handlerApp(fixture.handler), async (base) => {
    const cases = [
      [{ channelId: ALERTS }, 'empty_message'],
      [{ channelId: 1564051322485870803, content: 'hi' }, 'invalid_channel'],
      [{ channelId: 'abc', content: 'hi' }, 'invalid_channel'],
      [{ channelId: ALERTS, content: 'x'.repeat(2001) }, 'invalid_message'],
      [{ channelId: ALERTS, content: 'hi', mentionEveryone: 'yes' }, 'invalid_mention_everyone'],
      [{ channelId: ALERTS, embeds: [{ title: 't'.repeat(257) }] }, 'invalid_embed'],
      [{ channelId: ALERTS, embeds: Array.from({ length: 11 }, () => ({ title: 't' })) }, 'invalid_embed'],
      [{ channelId: ALERTS, embeds: [{ description: 'd'.repeat(6001) }] }, 'invalid_embed'],
      [{ channelId: ALERTS, embeds: [{ title: 'T', image: { url: 'javascript:alert(1)' } }] }, 'invalid_embed'],
      [{ channelId: ALERTS, embeds: [{ title: 'T', image: { url: 'attachment://../levels.png' } }] }, 'invalid_embed'],
      [{ channelId: ALERTS, embeds: [{ title: 'T', image: { url: 'attachment://missing.png' } }] }, 'missing_attachment'],
      ['not-json', 'invalid_json'],
    ];
    for (const [body, code] of cases) {
      const { response, json } = await postJson(base, body);
      assert.equal(response.status, 400, `${code}: ${JSON.stringify(json)}`);
      assert.equal(json.error, code);
    }
    const text = await postJson(base, { channelId: ALERTS, content: 'hi' }, { contentType: 'text/plain' });
    assert.equal(text.response.status, 415);
    assert.equal(text.json.error, 'unsupported_media_type');
  });
  assert.equal(fixture.calls.send.length, 0);
});

test('multipart posts an image the embed can reference', async () => {
  const fixture = createFixture();
  await withServer(handlerApp(fixture.handler), async (base) => {
    const form = new FormData();
    form.set('channelId', ALERTS);
    form.set('content', '@everyone Sunday news is up.');
    form.set('mentionEveryone', 'true');
    form.set('embeds', JSON.stringify([{
      title: 'Sunday news',
      image: { url: 'attachment://levels.png' },
      color: '#336699',
    }]));
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'levels.png');
    form.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'thumb.jpg');
    form.append('file', new Blob([GIF], { type: 'image/gif' }), 'anim.gif');
    form.append('file', new Blob([WEBP], { type: 'image/webp' }), 'still.webp');
    const { response, json } = await postForm(base, form);
    assert.equal(response.status, 201, JSON.stringify(json));
    assert.equal(json.url, jumpUrl(TOFC_GUILD_ID, ALERTS, MESSAGE_ID));
  });
  const payload = fixture.calls.send[0];
  assert.equal(payload.content, '@everyone Sunday news is up.');
  assert.deepEqual(payload.allowedMentions, { parse: ['everyone'] });
  assert.equal(payload.embeds[0].image.url, 'attachment://levels.png');
  assert.deepEqual(payload.files.map((file) => file.name), ['levels.png', 'thumb.jpg', 'anim.gif', 'still.webp']);
  assert.ok(payload.files[0].attachment.equals(PNG));
  assert.equal(fixture.lines.join('\n').includes(SECRET), false);
});

test('uploads that are not images, or that disagree with their extension, are rejected', async () => {
  const fixture = createFixture();
  await withServer(handlerApp(fixture.handler), async (base) => {
    const text = new FormData();
    text.set('channelId', ALERTS);
    text.set('content', 'hi');
    text.append('file', new Blob(['hello'], { type: 'image/png' }), 'notes.png');
    const disguised = await postForm(base, text);
    assert.equal(disguised.response.status, 400);
    assert.equal(disguised.json.error, 'unsupported_file_type');

    const mismatch = new FormData();
    mismatch.set('channelId', ALERTS);
    mismatch.set('content', 'hi');
    mismatch.append('file', new Blob([JPEG], { type: 'image/jpeg' }), 'photo.png');
    const wrongExt = await postForm(base, mismatch);
    assert.equal(wrongExt.response.status, 400);
    assert.equal(wrongExt.json.error, 'file_type_mismatch');

    const duplicate = new FormData();
    duplicate.set('channelId', ALERTS);
    duplicate.set('content', 'hi');
    duplicate.append('file', new Blob([PNG], { type: 'image/png' }), 'dot.png');
    duplicate.append('file', new Blob([PNG], { type: 'image/png' }), 'dot.png');
    const repeated = await postForm(base, duplicate);
    assert.equal(repeated.response.status, 400);
    assert.equal(repeated.json.error, 'duplicate_filename');

    const missing = new FormData();
    missing.set('channelId', ALERTS);
    missing.set('embeds', JSON.stringify([{ title: 'T', image: { url: 'attachment://levels.png' } }]));
    const absent = await postForm(base, missing);
    assert.equal(absent.response.status, 400);
    assert.equal(absent.json.error, 'missing_attachment');
  });
  assert.equal(fixture.calls.send.length, 0);
});

test('file count and size limits stop before Discord is called', async () => {
  const tooMany = createFixture();
  await withServer(handlerApp(tooMany.handler), async (base) => {
    const form = new FormData();
    form.set('channelId', ALERTS);
    form.set('content', 'hi');
    for (let index = 0; index < 11; index += 1) {
      form.append('file', new Blob([PNG], { type: 'image/png' }), `shot-${index}.png`);
    }
    const { response, json } = await postForm(base, form);
    assert.equal(response.status, 400, JSON.stringify(json));
    assert.equal(json.error, 'too_many_files');
  });
  assert.equal(tooMany.calls.send.length, 0);

  const oversized = createFixture({}, { limits: { maxFileBytes: 8, maxTotalBytes: 64 } });
  await withServer(handlerApp(oversized.handler), async (base) => {
    const form = new FormData();
    form.set('channelId', ALERTS);
    form.set('content', 'hi');
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'big.png');
    const { response, json } = await postForm(base, form);
    assert.equal(response.status, 413, JSON.stringify(json));
    assert.equal(json.error, 'payload_too_large');
  });
  assert.equal(oversized.calls.send.length, 0);

  const combined = createFixture({}, { limits: { maxFileBytes: 1024, maxTotalBytes: PNG.length } });
  await withServer(handlerApp(combined.handler), async (base) => {
    const form = new FormData();
    form.set('channelId', ALERTS);
    form.set('content', 'hi');
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'one.png');
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'two.png');
    const { response, json } = await postForm(base, form);
    assert.equal(response.status, 413, JSON.stringify(json));
    assert.equal(json.error, 'payload_too_large');
  });

  const jsonLimit = createFixture({}, { limits: { maxJsonBytes: 20 } });
  await withServer(handlerApp(jsonLimit.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hello from json' });
    assert.equal(response.status, 413);
    assert.equal(json.error, 'payload_too_large');
  });
  assert.equal(jsonLimit.calls.send.length, 0);

  const exact = createFixture({}, { limits: { maxFileBytes: PNG.length, maxTotalBytes: PNG.length } });
  await withServer(handlerApp(exact.handler), async (base) => {
    const form = new FormData();
    form.set('channelId', ALERTS);
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'exact.png');
    const { response, json } = await postForm(base, form);
    assert.equal(response.status, 201, JSON.stringify(json));
  });
  assert.equal(exact.calls.send.length, 1);
  assert.equal(exact.calls.send[0].content, undefined);
});

test('accepted publishes are rate limited separately from bad tokens', async () => {
  let now = 1_000_000;
  const fixture = createFixture({}, {
    limits: { maxPerIp: 2, maxGlobal: 2, maxAuthFailuresPerIp: 2, windowMs: 60_000 },
    now: () => now,
  });
  await withServer(handlerApp(fixture.handler), async (base) => {
    const first = await postJson(base, { channelId: ALERTS, content: 'one' });
    const second = await postJson(base, { channelId: ALERTS, content: 'two' });
    const third = await postJson(base, { channelId: ALERTS, content: 'three' });
    assert.equal(first.response.status, 201);
    assert.equal(second.response.status, 201);
    assert.equal(third.response.status, 429);
    assert.equal(third.json.error, 'rate_limited');
    assert.equal(third.response.headers.get('retry-after'), '60');
    now += 60_000;
    const again = await postJson(base, { channelId: ALERTS, content: 'four' });
    assert.equal(again.response.status, 201);
  });

  const auth = createFixture({}, { limits: { maxAuthFailuresPerIp: 2, maxPerIp: 10, maxGlobal: 10 } });
  await withServer(handlerApp(auth.handler), async (base) => {
    const a = await postJson(base, { channelId: ALERTS, content: 'nope' }, { token: 'nope-token-1' });
    const b = await postJson(base, { channelId: ALERTS, content: 'nope' }, { token: 'nope-token-2' });
    const c = await postJson(base, { channelId: ALERTS, content: 'nope' }, { token: 'nope-token-3' });
    const ok = await postJson(base, { channelId: ALERTS, content: 'yes' });
    assert.equal(a.response.status, 401);
    assert.equal(b.response.status, 401);
    assert.equal(c.response.status, 429);
    assert.equal(ok.response.status, 201);
  });
  assert.equal(auth.calls.send.length, 1);
  assert.equal(auth.lines.join('\n').includes('nope-token-1'), false);
});

test('the bot permission and thread checks run before send', async () => {
  const muted = createFixture({ deny: new Set([PermissionFlagsBits.SendMessages]) });
  await withServer(handlerApp(muted.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 403);
    assert.match(json.message, /Send Messages/);
  });
  assert.equal(muted.calls.send.length, 0);

  const thread = createFixture({
    thread: true,
    deny: new Set([PermissionFlagsBits.SendMessagesInThreads]),
  });
  await withServer(handlerApp(thread.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 403);
    assert.match(json.message, /Send Messages in Threads/);
  });

  const filesDenied = createFixture({ deny: new Set([PermissionFlagsBits.AttachFiles]) });
  await withServer(handlerApp(filesDenied.handler), async (base) => {
    const form = new FormData();
    form.set('channelId', ALERTS);
    form.set('content', 'hi');
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'dot.png');
    const { response, json } = await postForm(base, form);
    assert.equal(response.status, 403);
    assert.match(json.message, /Attach Files/);
  });
  assert.equal(filesDenied.calls.send.length, 0);

  const fetched = createFixture({ me: null, fetchMe: async () => ({ id: 'bot' }) });
  await withServer(handlerApp(fetched.handler), async (base) => {
    const { response } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 201);
  });

  const voice = createFixture({ text: false });
  await withServer(handlerApp(voice.handler), async (base) => {
    const { response, json } = await postJson(base, { channelId: ALERTS, content: 'hi' });
    assert.equal(response.status, 400);
    assert.equal(json.error, 'channel_not_text');
  });
});

test('health, ready, and the publish route share the existing web server', async () => {
  let ready = false;
  let degraded = false;
  const fixture = createFixture({
    db: {
      getStatus: () => ({
        isDegraded: degraded,
        connectionType: degraded ? 'memory' : 'postgres',
        degradedReason: degraded ? 'down' : null,
      }),
    },
  });
  fixture.client.isReady = () => ready;
  const lines = [];
  const app = createWebApp(fixture.client, {
    publish: {
      readConfig: () => enabledConfig([ALERTS, TRADERS, ANNOUNCEMENTS]),
      logger: { warn: (message) => lines.push(String(message)) },
    },
  });

  await withServer(app, async (base) => {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    const rootBody = await root.json();
    assert.equal(rootBody.message, 'TitanBot System Online');
    assert.equal(rootBody.version, pkg.version);

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.status, 'healthy');
    assert.equal(healthBody.database.connected, true);
    assert.equal(healthBody.database.type, 'postgres');

    const notReady = await fetch(`${base}/ready`);
    assert.equal(notReady.status, 503);
    assert.equal((await notReady.json()).reason, 'Bot not Ready');

    ready = true;
    const isReady = await fetch(`${base}/ready`);
    assert.equal(isReady.status, 200);
    const readyBody = await isReady.json();
    assert.equal(readyBody.ready, true);
    assert.equal(readyBody.metrics.guildCount, 1);
    assert.equal(readyBody.metrics.commandCount, 4);

    degraded = true;
    const degradedReady = await fetch(`${base}/ready`);
    assert.equal(degradedReady.status, 503);
    assert.equal((await degradedReady.json()).reason, 'Database degraded');
    degraded = false;

    const options = await fetch(`${base}/internal/publish`, { method: 'OPTIONS' });
    assert.equal(options.status, 200);
    const cors = await fetch(`${base}/health`, { headers: { origin: 'https://example.com' } });
    assert.equal(cors.headers.get('access-control-allow-origin'), 'https://example.com');
    assert.match(cors.headers.get('access-control-allow-headers'), /Authorization/);

    const published = await postJson(base, {
      channelId: ANNOUNCEMENTS,
      content: 'Posted through the web app',
    });
    assert.equal(published.response.status, 201, JSON.stringify(published.json));
    assert.equal(published.json.channelId, ANNOUNCEMENTS);
  });
  assert.equal(fixture.calls.send.length, 1);
  assert.equal(fixture.calls.send[0].content, 'Posted through the web app');
  assert.equal(lines.join('\n').includes(SECRET), false);

  const limited = createFixture({
    config: { api: { cors: { origin: '*' }, rateLimit: { windowMs: 60_000, max: 1 } } },
  });
  const limitedApp = createWebApp(limited.client, {
    publish: { readConfig: () => enabledConfig(), logger: { warn() {} } },
  });
  await withServer(limitedApp, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const blocked = await fetch(`${base}/health`);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'Too many requests' });
  });
});
