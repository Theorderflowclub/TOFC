import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
  CHAMPION_COLOR,
  DEFAULT_LEGENDS_CHANNEL_ID,
  DEFAULT_LEGENDS_GUILD_ID,
  PRESTIGE_4_HEADING,
  PRESTIGE_4_PROMOTION,
  PRESTIGE_5_HEADING,
  PRESTIGE_5_PROMOTION,
  SHOWCASE_TITLE,
  buildPromotionMessage,
  buildShowcaseMessage,
  formatLegendDate,
  handleLegendsMemberUpdate,
  isPrestigeRankName,
  legendsColor,
  partitionHallOfFame,
  resetLegendsLogState,
  resolvePrestigeRankRole,
  syncLegendsLog,
} from '../src/services/legendsLogService.js';

const GUILD = DEFAULT_LEGENDS_GUILD_ID;
const CHANNEL = DEFAULT_LEGENDS_CHANNEL_ID;
const PRESTIGE_4 = '200000000000000004';
const PRESTIGE_5 = '200000000000000005';
const OTHER_ROLE = '200000000000000006';
const BOT = '100000000000000099';
const ADA = '100000000000000001';
const BEA = '100000000000000002';
const OPTIONS = { guildId: GUILD, channelId: CHANNEL, prestige4RoleId: null, prestige5RoleId: null };

function role(id, name) {
  return { id, name };
}

function member(id, username, roleIds, { bot = false, guild = null, client = null } = {}) {
  return {
    id,
    guild,
    client,
    nickname: username,
    user: {
      id,
      bot,
      username,
      tag: username,
      displayAvatarURL: () => `https://cdn.example/${id}.png`,
    },
    roles: { cache: new Map(roleIds.map((roleId) => [roleId, { id: roleId }])) },
  };
}

function hallText({ champions = [], legends = [] } = {}) {
  return [
    PRESTIGE_5_HEADING,
    ...champions.map((id) => `💎 <@${id}>`),
    '',
    PRESTIGE_4_HEADING,
    ...legends.map((id) => `👑 <@${id}>`),
  ].join('\n');
}

function createHarness({ roles, members = [], history = [], permissions = null }) {
  const sent = [];
  const edits = [];
  const store = new Map();
  const messages = new Map(history.map((message) => [message.id, message]));
  const channel = {
    id: CHANNEL,
    isTextBased: () => true,
    permissionsFor: () => ({
      has: (bit) => (permissions ? permissions.has(bit) : true),
    }),
    messages: {
      fetch: async (arg) => {
        if (typeof arg === 'string') {
          const message = messages.get(arg);
          if (!message) {
            const error = new Error('Unknown Message');
            error.code = 10008;
            throw error;
          }
          return message;
        }
        return messages;
      },
    },
    send: async (payload) => {
      const message = {
        id: `msg-${messages.size + 1}`,
        author: { id: BOT },
        content: payload.content ?? null,
        embeds: (payload.embeds || []).map((embed) => embed.toJSON()),
        edit: async (next) => {
          edits.push(next);
          message.embeds = (next.embeds || []).map((embed) => embed.toJSON());
          return message;
        },
      };
      messages.set(message.id, message);
      sent.push(payload);
      return message;
    },
  };

  const roleMap = new Map(roles.map((entry) => [entry.id, entry]));
  const memberMap = new Map(members.map((entry) => [entry.id, entry]));
  const guild = {
    id: GUILD,
    roles: { cache: roleMap, fetch: async () => roleMap },
    members: { me: { id: BOT }, cache: memberMap, fetch: async (id) => (id ? memberMap.get(id) : memberMap) },
    channels: { cache: new Map([[CHANNEL, channel]]), fetch: async () => channel },
  };
  const client = {
    user: { id: BOT },
    guilds: { cache: new Map([[GUILD, guild]]), fetch: async () => guild },
    db: {
      async get(key, fallback = null) {
        return store.has(key) ? store.get(key) : fallback;
      },
      async set(key, value) {
        store.set(key, structuredClone(value));
        return true;
      },
    },
  };
  for (const entry of members) {
    entry.guild = guild;
    entry.client = client;
  }
  return { client, guild, channel, sent, edits, store, messages };
}

const RANK_ROLES = [role(PRESTIGE_4, 'Prestige 4'), role(PRESTIGE_5, 'Prestige 5')];

test('prestige rank names match that rank and skip nearby ranks', () => {
  for (const name of ['Prestige 4', 'prestige-4', 'Prestige-4', '🏆 Prestige 4', 'PRESTIGE FOUR', 'prestige four']) {
    assert.equal(isPrestigeRankName(name, 4), true, name);
    assert.equal(isPrestigeRankName(name, 5), false, name);
  }
  for (const name of ['Prestige 5', 'prestige-5', 'Prestige-5', 'Prestige 5 | Champion', 'PRESTIGE FIVE']) {
    assert.equal(isPrestigeRankName(name, 5), true, name);
    assert.equal(isPrestigeRankName(name, 4), false, name);
  }
  for (const name of [
    'Prestige 1', 'PRESTIGE ONE', 'PRESTIGE TWO', 'PRESTIGE THREE',
    'Prestige 14', 'PRESTIGE FOURTEEN', 'Prestige 40', 'PRESTIGE FORTY',
    'Prestige 15', 'PRESTIGE FIFTEEN', 'Prestige 50', 'Premium',
  ]) {
    assert.equal(isPrestigeRankName(name, 4), false, name);
    assert.equal(isPrestigeRankName(name, 5), false, name);
  }

  const roles = [
    role('200000000000000001', 'PRESTIGE ONE'),
    role('200000000000000002', 'PRESTIGE TWO'),
    role('200000000000000003', 'PRESTIGE THREE'),
    role(PRESTIGE_4, 'PRESTIGE FOUR'),
    role(PRESTIGE_5, 'PRESTIGE FIVE'),
    role(OTHER_ROLE, 'PRESTIGE FOURTEEN'),
  ];
  assert.equal(resolvePrestigeRankRole(roles, 4, null).role.id, PRESTIGE_4);
  assert.equal(resolvePrestigeRankRole(roles, 5, null).role.id, PRESTIGE_5);
  assert.equal(resolvePrestigeRankRole(roles, 4, OTHER_ROLE).role.name, 'PRESTIGE FOURTEEN');
  assert.equal(resolvePrestigeRankRole([role(PRESTIGE_4, 'Prestige 4'), role(OTHER_ROLE, 'prestige-4')], 4, null).role, null);
});

test('the hall of fame lists champions above legends and pings one rank at a time', () => {
  const promotedAt = new Date('2026-11-10T15:04:00.000Z');
  assert.equal(formatLegendDate(promotedAt), 'Nov 10, 2026');

  const both = partitionHallOfFame([
    member(ADA, 'ada', [PRESTIGE_4, PRESTIGE_5]),
    member(BEA, 'bea', [PRESTIGE_4]),
    member(BOT, 'tofc-bot', [PRESTIGE_4, PRESTIGE_5], { bot: true }),
  ], PRESTIGE_4, PRESTIGE_5);
  assert.deepEqual(both.champions.map((person) => person.id), [ADA]);
  assert.deepEqual(both.legends.map((person) => person.id), [BEA]);

  const showcase = buildShowcaseMessage({ championIds: [ADA], legendIds: [BEA] });
  const showcaseJson = showcase.embeds[0].toJSON();
  assert.equal(showcaseJson.title, SHOWCASE_TITLE);
  assert.equal(showcaseJson.description, hallText({ champions: [ADA], legends: [BEA] }));
  assert.equal(showcaseJson.color, legendsColor());
  assert.equal(showcaseJson.footer.text, 'Total Legends: 2');
  assert.deepEqual(showcase.allowedMentions, { parse: [] });
  assert.equal(showcase.content, undefined);

  const legend = buildPromotionMessage({
    rank: 4,
    userId: BEA,
    avatarUrl: 'https://cdn.example/bea.png',
    promotedAt,
  });
  assert.equal(legend.content, `🔥 <@${BEA}> ${PRESTIGE_4_PROMOTION}`);
  assert.deepEqual(legend.allowedMentions, { parse: [], users: [BEA] });
  assert.equal(legend.embeds[0].toJSON().color, legendsColor());
  assert.equal(legend.embeds[0].toJSON().description, 'Promoted Nov 10, 2026');
  assert.equal(legend.embeds[0].toJSON().thumbnail.url, 'https://cdn.example/bea.png');

  const champion = buildPromotionMessage({
    rank: 5,
    userId: ADA,
    avatarUrl: 'https://cdn.example/ada.png',
    promotedAt,
  });
  assert.equal(champion.content, `🏆 <@${ADA}> ${PRESTIGE_5_PROMOTION}`);
  assert.deepEqual(champion.allowedMentions, { parse: [], users: [ADA] });
  const championEmbed = champion.embeds[0].toJSON();
  assert.equal(championEmbed.color, CHAMPION_COLOR);
  assert.equal(championEmbed.title, '👑 Prestige-5 Champion');
  assert.equal(championEmbed.description, 'Crowned Nov 10, 2026');
  assert.equal(championEmbed.thumbnail.url, 'https://cdn.example/ada.png');
});

describe('legends log', { concurrency: false }, () => {
  test('backfill posts one showcase and a restart does not post again', async () => {
    resetLegendsLogState();
    const harness = createHarness({
      roles: RANK_ROLES,
      members: [
        member(ADA, 'ada', [PRESTIGE_4, PRESTIGE_5]),
        member(BEA, 'bea', [PRESTIGE_4]),
        member(BOT, 'tofc-bot', [PRESTIGE_4], { bot: true }),
      ],
    });

    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].content, undefined);
    assert.deepEqual(harness.sent[0].allowedMentions, { parse: [] });
    const description = harness.sent[0].embeds[0].toJSON().description;
    assert.equal(description, hallText({ champions: [ADA], legends: [BEA] }));
    assert.equal(description.includes(BOT), false);
    assert.equal(description.includes(`👑 <@${ADA}>`), false);

    resetLegendsLogState();
    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.edits.length, 0);

    const cal = member('100000000000000003', 'cal', [PRESTIGE_4], {
      guild: harness.guild,
      client: harness.client,
    });
    harness.guild.members.cache.set(cal.id, cal);
    resetLegendsLogState();
    await syncLegendsLog(harness.client, OPTIONS);
    const promotions = harness.sent.filter((payload) => payload.content);
    assert.equal(promotions.length, 1);
    assert.equal(promotions[0].content, `🔥 <@${cal.id}> ${PRESTIGE_4_PROMOTION}`);
    assert.deepEqual(promotions[0].allowedMentions, { parse: [], users: [cal.id] });
  });

  test('an existing bot showcase is edited in place', async () => {
    resetLegendsLogState();
    const edits = [];
    const existing = {
      id: 'existing-showcase',
      author: { id: BOT },
      embeds: [{ title: SHOWCASE_TITLE, description: 'stale', footer: { text: 'Total Legends: 0' } }],
      edit: async (next) => {
        edits.push(next);
        existing.embeds = next.embeds.map((embed) => embed.toJSON());
        return existing;
      },
    };
    const human = {
      id: 'human-showcase',
      author: { id: ADA },
      embeds: [{ title: SHOWCASE_TITLE, description: 'nope' }],
      edit: async () => {
        throw new Error('member message was edited');
      },
    };
    const harness = createHarness({
      roles: [role(PRESTIGE_4, 'prestige-4'), role(PRESTIGE_5, 'prestige-5')],
      members: [member(ADA, 'ada', [PRESTIGE_4])],
      history: [human, existing],
    });

    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 0);
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0].allowedMentions, { parse: [] });
    assert.equal(edits[0].embeds[0].toJSON().description, hallText({ legends: [ADA] }));
    assert.equal(edits[0].embeds[0].toJSON().footer.text, 'Total Legends: 1');
  });

  test('gaining prestige 4 pings once, and gaining prestige 5 pings the champion message', async () => {
    resetLegendsLogState();
    const ada = member(ADA, 'ada', []);
    const harness = createHarness({ roles: RANK_ROLES, members: [ada] });
    ada.guild = harness.guild;
    ada.client = harness.client;

    await handleLegendsMemberUpdate({ nickname: 'ada' }, ada, OPTIONS);
    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].content, undefined);

    ada.roles.cache.set(PRESTIGE_4, { id: PRESTIGE_4 });
    await handleLegendsMemberUpdate(null, ada, OPTIONS);
    await handleLegendsMemberUpdate(null, ada, OPTIONS);
    const legendPings = harness.sent.filter((payload) => payload.content?.startsWith('🔥'));
    assert.equal(legendPings.length, 1);
    assert.equal(legendPings[0].content, `🔥 <@${ADA}> ${PRESTIGE_4_PROMOTION}`);
    assert.equal(harness.edits.at(-1).embeds[0].toJSON().description, hallText({ legends: [ADA] }));

    ada.roles.cache.set(PRESTIGE_5, { id: PRESTIGE_5 });
    await handleLegendsMemberUpdate(null, ada, OPTIONS);
    await handleLegendsMemberUpdate(null, ada, OPTIONS);
    const championPings = harness.sent.filter((payload) => payload.content?.startsWith('🏆'));
    assert.equal(championPings.length, 1);
    assert.equal(championPings[0].content, `🏆 <@${ADA}> ${PRESTIGE_5_PROMOTION}`);
    assert.equal(championPings[0].embeds[0].toJSON().color, CHAMPION_COLOR);
    const listed = harness.edits.at(-1).embeds[0].toJSON().description;
    assert.equal(listed, hallText({ champions: [ADA] }));
    assert.equal(listed.includes(`👑 <@${ADA}>`), false);
  });

  test('a failed promotion can be retried, and losing prestige 4 only updates the list', async () => {
    resetLegendsLogState();
    const ada = member(ADA, 'ada', [PRESTIGE_4]);
    const harness = createHarness({ roles: RANK_ROLES, members: [ada] });
    ada.guild = harness.guild;
    ada.client = harness.client;
    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 1);

    const bea = member(BEA, 'bea', [PRESTIGE_4], { guild: harness.guild, client: harness.client });
    harness.guild.members.cache.set(BEA, bea);
    let fail = true;
    const send = harness.channel.send;
    harness.channel.send = async (payload) => {
      if (fail && payload.content) {
        fail = false;
        throw new Error('discord down');
      }
      return send(payload);
    };

    await handleLegendsMemberUpdate(null, bea, OPTIONS);
    assert.equal(harness.sent.filter((payload) => payload.content).length, 0);
    await handleLegendsMemberUpdate(null, bea, OPTIONS);
    assert.equal(harness.sent.filter((payload) => payload.content).length, 1);

    ada.roles.cache.clear();
    const sentBefore = harness.sent.length;
    await handleLegendsMemberUpdate(null, ada, OPTIONS);
    assert.equal(harness.sent.length, sentBefore);
    assert.equal(harness.edits.at(-1).embeds[0].toJSON().description, hallText({ legends: [BEA] }));
  });

  test('missing embed permission does not mark the backfill done', async () => {
    resetLegendsLogState();
    const harness = createHarness({
      roles: RANK_ROLES,
      members: [member(ADA, 'ada', [PRESTIGE_4])],
      permissions: new Set([PermissionFlagsBits.ViewChannel]),
    });
    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 0);

    harness.channel.permissionsFor = () => ({ has: () => true });
    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 1);
  });

  test('two prestige 4 roles post nothing until an id is chosen', async () => {
    resetLegendsLogState();
    const harness = createHarness({
      roles: [role(PRESTIGE_4, 'Prestige 4'), role(OTHER_ROLE, 'prestige-4'), role(PRESTIGE_5, 'Prestige 5')],
      members: [member(ADA, 'ada', [PRESTIGE_4])],
    });
    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 0);

    await syncLegendsLog(harness.client, { ...OPTIONS, prestige4RoleId: PRESTIGE_4 });
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].embeds[0].toJSON().description, hallText({ legends: [ADA] }));
  });

  test('a role gain before ready still posts the promotion and edits the showcase', async () => {
    resetLegendsLogState();
    const ada = member(ADA, 'ada', [PRESTIGE_4]);
    const before = member(ADA, 'ada', []);
    const harness = createHarness({ roles: RANK_ROLES, members: [ada] });
    ada.guild = harness.guild;
    ada.client = harness.client;
    before.guild = harness.guild;

    await handleLegendsMemberUpdate(before, ada, OPTIONS);
    await handleLegendsMemberUpdate(before, ada, OPTIONS);

    const promotions = harness.sent.filter((payload) => payload.content);
    assert.equal(promotions.length, 1);
    assert.equal(promotions[0].content, `🔥 <@${ADA}> ${PRESTIGE_4_PROMOTION}`);
    const descriptions = [
      ...harness.sent.map((payload) => payload.embeds?.[0]?.toJSON?.().description),
      ...harness.edits.map((payload) => payload.embeds?.[0]?.toJSON?.().description),
    ].filter(Boolean);
    assert.equal(descriptions.some((description) => description === hallText({ legends: [ADA] })), true);
  });

  test('gaining both ranks in one event posts both messages and lists the champion once', async () => {
    resetLegendsLogState();
    const ada = member(ADA, 'ada', []);
    const harness = createHarness({ roles: RANK_ROLES, members: [ada] });
    ada.guild = harness.guild;
    ada.client = harness.client;
    await syncLegendsLog(harness.client, OPTIONS);

    ada.roles.cache.set(PRESTIGE_4, { id: PRESTIGE_4 });
    ada.roles.cache.set(PRESTIGE_5, { id: PRESTIGE_5 });
    const before = member(ADA, 'ada', [], { guild: harness.guild, client: harness.client });
    await handleLegendsMemberUpdate(before, ada, OPTIONS);

    const promotions = harness.sent.filter((payload) => payload.content);
    assert.deepEqual(promotions.map((payload) => payload.content), [
      `🔥 <@${ADA}> ${PRESTIGE_4_PROMOTION}`,
      `🏆 <@${ADA}> ${PRESTIGE_5_PROMOTION}`,
    ]);
    assert.equal(harness.edits.at(-1).embeds[0].toJSON().description, hallText({ champions: [ADA] }));
  });

  test('removing prestige 5 edits the showcase and does not post', async () => {
    resetLegendsLogState();
    const ada = member(ADA, 'ada', [PRESTIGE_4, PRESTIGE_5]);
    const harness = createHarness({ roles: RANK_ROLES, members: [ada] });
    ada.guild = harness.guild;
    ada.client = harness.client;
    await syncLegendsLog(harness.client, OPTIONS);

    const before = member(ADA, 'ada', [PRESTIGE_4, PRESTIGE_5], { guild: harness.guild, client: harness.client });
    ada.roles.cache.delete(PRESTIGE_5);
    const sentBefore = harness.sent.length;
    await handleLegendsMemberUpdate(before, ada, OPTIONS);

    assert.equal(harness.sent.length, sentBefore);
    assert.equal(harness.edits.at(-1).embeds[0].toJSON().description, hallText({ legends: [ADA] }));
    assert.equal(harness.edits.at(-1).allowedMentions.parse.length, 0);
  });

  test('an ambiguous prestige 5 role still lists prestige 4 legends', async () => {
    resetLegendsLogState();
    const harness = createHarness({
      roles: [role(PRESTIGE_4, 'Prestige 4'), role(PRESTIGE_5, 'Prestige 5'), role(OTHER_ROLE, 'prestige-5')],
      members: [member(BEA, 'bea', [PRESTIGE_4])],
    });
    await syncLegendsLog(harness.client, OPTIONS);
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].embeds[0].toJSON().description, hallText({ legends: [BEA] }));
    assert.equal(harness.sent[0].embeds[0].toJSON().footer.text, 'Total Legends: 1');
  });
});
