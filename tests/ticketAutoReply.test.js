import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getTicketAutoReplyConfig } from '../src/config/ticketAutoReply.js';
import { loadTicketFaq } from '../src/services/ticketAutoReply/faqStore.js';
import {
  detectTicketReason,
  isStaffMember,
  isTicketChannel,
} from '../src/services/ticketAutoReply/detect.js';
import {
  AUTO_REPLY_MARKER,
  buildStateFromHistory,
  decideReply,
  emptyState,
  matchQuestion,
  renderReply,
} from '../src/services/ticketAutoReply/decide.js';

const faq = loadTicketFaq();
const ticketConfig = {
  namePattern: /^ticket-\d+/i,
  categoryName: 'START HERE',
  staffRoleIds: [],
  staffUserIds: [],
  maxReplies: 6,
};

function replyTo(text, extras = {}) {
  const decision = decideReply({
    text,
    reason: 'education',
    authorIsStaff: false,
    state: emptyState(),
    faq,
    maxReplies: 6,
    ...extras,
  });
  if (decision.action !== 'reply') return decision;
  const rendered = renderReply({
    kind: decision.kind,
    entry: decision.entry,
    faq,
    userId: '42',
    withGreeting: decision.withGreeting,
    staffRoleIds: decision.ping ? (extras.staffRoleIds || []) : [],
    staffUserIds: decision.ping ? (extras.staffUserIds || []) : [],
  });
  return { ...decision, ...rendered };
}

function channel({ name, parentName, type = ChannelType.GuildText }) {
  const parent = parentName
    ? { id: 'cat', name: parentName, type: ChannelType.GuildCategory }
    : null;
  return {
    name,
    type,
    parent,
    parentId: parent?.id || null,
    guild: {
      channels: {
        cache: { get: (id) => (id === parent?.id ? parent : null) },
      },
    },
  };
}

test('FAQ file loads the confirmed facts and keeps unconfirmed facts out of replies', () => {
  assert.ok(faq);
  assert.equal(faq.inviteRewardAck, "Thanks, we're checking your invites, you'll get your reward here.");
  const spoken = [
    faq.greeting,
    faq.greetingPrompt,
    faq.handoff,
    faq.inviteRewardAck,
    ...faq.entries.map((entry) => entry.answer),
  ].join('\n');
  assert.equal(/https?:\/\/|www\.|TODO|\$|€|£/i.test(spoken), false);
  assert.match(spoken, /Premium membership and 1:1 coaching through Whop/);
  assert.match(spoken, /15:30 Amsterdam time/);
  assert.match(spoken, /Master TOFC Models/);
  assert.match(spoken, /50% off your first month of Premium/);
  assert.match(spoken, /payout is 4/);
  assert.match(spoken, /every Friday/);
  assert.ok(faq.todos.some((item) => /price/i.test(item)));
  assert.ok(faq.todos.some((item) => /URL/i.test(item)));
  assert.equal(spoken.includes(faq.todos[0]), false);
});

test('matches membership, GEX, the course, invites, and leaderboards', () => {
  assert.equal(matchQuestion('What does TOFC sell?', faq).entry.id, 'what-tofc-sells');
  assert.equal(matchQuestion('Do you offer 1:1 coaching?', faq).entry.id, 'what-tofc-sells');
  assert.equal(matchQuestion('Where are the GEX levels posted?', faq).entry.id, 'premium-includes');
  assert.equal(matchQuestion('What is included in premium?', faq).entry.id, 'premium-includes');
  assert.equal(matchQuestion('What is the Master TOFC Models course?', faq).entry.id, 'education-course');
  assert.equal(matchQuestion('Tell me about the price action chapter', faq).entry.id, 'education-course');
  assert.equal(matchQuestion('How do invite rewards work?', faq).entry.id, 'invite-rewards');
  assert.equal(matchQuestion('How does trader of the month work?', faq).entry.id, 'trader-of-the-month');
  assert.equal(matchQuestion('When are the weekly best traders highlighted?', faq).entry.id, 'weekly-best');
});

test('does not invent a price, link, code, or winner', () => {
  const price = replyTo('How much is premium membership?');
  assert.equal(price.kind, 'handoff');
  assert.equal(/\$|https?:\/\/|\bcode\b/i.test(price.content), false);
  assert.match(price.content, /team will get back to you soon/);

  const link = replyTo('Can you send me the Whop link?');
  assert.equal(link.kind, 'handoff');
  assert.equal(/https?:\/\//.test(link.content), false);

  const winner = replyTo('Who won trader of the month?');
  assert.equal(winner.kind, 'handoff');
  assert.equal(winner.content.includes('free month'), false);

  const coursePrice = replyTo('How much is the course?');
  assert.equal(coursePrice.kind, 'handoff');
});

test('price action is the course, not a price question', () => {
  const decision = replyTo('What is price action in the course?');
  assert.equal(decision.kind, 'answer');
  assert.equal(decision.entry.id, 'education-course');
  assert.match(decision.content, /Price Action \(Context\)/);
});

test('invite reward tickets only acknowledge and never send the reward rules or a code', () => {
  const decision = replyTo('I invited 10 people, where is my code?', { reason: 'invite_reward' });
  assert.equal(decision.kind, 'invite');
  assert.match(decision.content, /checking your invites, you'll get your reward here/);
  assert.equal(decision.content.includes('50%'), false);
  assert.equal(/code\s*[:=]|https?:\/\//i.test(decision.content), false);
  assert.match(decision.content, /<@42>/);
  assert.equal(decision.content.endsWith(AUTO_REPLY_MARKER), true);
});

test('partnership, management, and suggestion tickets hand off once and can ping staff', () => {
  for (const reason of ['partnership', 'management', 'suggestions']) {
    const decision = replyTo('Hello, I have a request', {
      reason,
      staffRoleIds: ['123456789012345678'],
      staffUserIds: ['223456789012345678'],
    });
    assert.equal(decision.kind, 'handoff', reason);
    assert.match(decision.content, /<@&123456789012345678>/);
    assert.match(decision.content, /<@223456789012345678>/);
    assert.deepEqual(decision.allowedMentions.parse, []);
    assert.ok(decision.allowedMentions.roles.includes('123456789012345678'));
  }
});

test('a claim or partnership written in a normal ticket is not answered from the FAQ', () => {
  const claim = replyTo('I want to claim my invite reward');
  assert.equal(claim.kind, 'invite');
  assert.equal(claim.content.includes('50%'), false);

  const partner = replyTo('I want to talk about a partnership');
  assert.equal(partner.kind, 'handoff');
});

test('first member message gets one greeting plus the answer, then only new questions', () => {
  const first = replyTo('Where do I buy premium?');
  assert.equal(first.kind, 'answer');
  assert.match(first.content, /Hey <@42>, thanks for opening a ticket\./);
  assert.match(first.content, /through Whop/);
  assert.equal((first.content.match(/thanks for opening a ticket/g) || []).length, 1);

  const state = emptyState();
  state.greeted = true;
  state.replyCount = 1;
  state.answeredIds = ['what-tofc-sells'];
  state.previousAsks = ['where do i buy premium'];

  const repeat = decideReply({
    text: 'where do I buy premium??',
    reason: 'unknown',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 6,
  });
  assert.equal(repeat.action, 'ignore');

  const next = decideReply({
    text: 'When are weekly best traders posted?',
    reason: 'unknown',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 6,
  });
  assert.equal(next.action, 'reply');
  assert.equal(next.entry.id, 'weekly-best');
  assert.equal(next.withGreeting, false);
});

test('a greeting alone does not hand off, and a later real question still can', () => {
  const hello = replyTo('Hey there');
  assert.equal(hello.kind, 'greeting');
  assert.equal(hello.ping, false);
  assert.equal(hello.content.includes(faq.handoff), false);

  const unknown = replyTo('blorp zing quota');
  assert.equal(unknown.kind, 'handoff');
  assert.equal(unknown.ping, true);
});

test('staff replies stop auto-answers, including ones already in the channel', () => {
  assert.equal(replyTo('What is GEX?', { authorIsStaff: true }).action, 'stop');

  const state = buildStateFromHistory(
    [
      {
        id: '1',
        content: 'What is the education course?',
        createdTimestamp: 1,
        author: { id: 'member', bot: false },
      },
      {
        id: '2',
        content: `On it.${AUTO_REPLY_MARKER}`,
        createdTimestamp: 2,
        author: { id: 'staff', bot: false },
      },
      {
        id: '3',
        content: 'What is GEX?',
        createdTimestamp: 3,
        author: { id: 'member', bot: false },
      },
    ],
    {
      botUserId: 'bot',
      faq,
      currentMessageId: '3',
      isStaffUser: (userId) => userId === 'staff',
    }
  );
  assert.equal(state.stopped, true);
  assert.equal(decideReply({
    text: 'What is GEX?',
    reason: 'education',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 6,
  }).action, 'stop');
});

test('history remembers a previous answer so a restart does not greet again', () => {
  const previous = renderReply({
    kind: 'answer',
    entry: faq.entries.find((entry) => entry.id === 'premium-includes'),
    faq,
    userId: '42',
    withGreeting: true,
  });
  const state = buildStateFromHistory(
    [
      { id: 'q', content: 'Where are GEX levels posted?', createdTimestamp: 1, author: { id: '42', bot: false } },
      { id: 'a', content: previous.content, createdTimestamp: 2, author: { id: 'bot', bot: true } },
      { id: 'q2', content: 'When is trader of the month announced?', createdTimestamp: 3, author: { id: '42', bot: false } },
    ],
    {
      botUserId: 'bot',
      faq,
      currentMessageId: 'q2',
      isStaffUser: () => false,
    }
  );
  assert.equal(state.greeted, true);
  assert.ok(state.answeredIds.includes('premium-includes'));
  const decision = decideReply({
    text: 'When is trader of the month announced?',
    reason: 'education',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 6,
  });
  assert.equal(decision.kind, 'answer');
  assert.equal(decision.entry.id, 'trader-of-the-month');
  assert.equal(decision.withGreeting, false);
});

test('ticket channel detection uses the name and the START HERE category', () => {
  const startHere = 'ᯓ➤ START HERE 🔒';
  assert.equal(isTicketChannel(channel({ name: 'ticket-0002', parentName: startHere }), ticketConfig), true);
  assert.equal(isTicketChannel(channel({ name: 'ticket-0002-member', parentName: startHere }), ticketConfig), true);
  assert.equal(isTicketChannel(channel({ name: 'ticket-0002' }), ticketConfig), true);
  assert.equal(isTicketChannel(channel({ name: 'ticket-12', parentName: 'Tickets' }), ticketConfig), false);
  assert.equal(isTicketChannel(channel({ name: 'questions-access', parentName: startHere }), ticketConfig), false);
  assert.equal(isTicketChannel(channel({ name: 'ticket-0002', parentName: startHere, type: ChannelType.GuildCategory }), ticketConfig), false);
});

test('panel reason is read from one Ticket Tool message and a full menu is ignored', () => {
  assert.equal(detectTicketReason(['Reason: Education program questions']), 'education');
  assert.equal(detectTicketReason(['🎁 Claim invite reward']), 'invite_reward');
  assert.equal(detectTicketReason(['Contact with management']), 'management');
  assert.equal(detectTicketReason(['Suggestions or problems']), 'suggestions');
  assert.equal(detectTicketReason(['Partnership']), 'partnership');
  assert.equal(detectTicketReason(['Other']), 'other');
  assert.equal(detectTicketReason(['**Topic:** Partnership']), 'partnership');
  assert.equal(detectTicketReason(['Topic: Other']), 'other');
  assert.equal(
    detectTicketReason([
      [
        'Education program questions',
        'Contact with management',
        'Partnership',
        'Suggestions or problems',
        '🎁 Claim invite reward',
        'Other',
      ].join('\n'),
      'Reason: Partnership',
    ]),
    'partnership'
  );
});

test('staff ids are explicit, and the permission fallback is only used when they are unset', () => {
  const member = {
    roles: { cache: { has: (id) => id === 'role-1' } },
    permissions: { has: (bit) => bit === PermissionFlagsBits.ManageMessages },
  };
  const configured = { staffRoleIds: ['role-1'], staffUserIds: ['999999999999999999'] };
  assert.equal(isStaffMember(member, 'user', configured), true);
  assert.equal(isStaffMember(member, '999999999999999999', { staffRoleIds: [], staffUserIds: ['999999999999999999'] }), true);
  assert.equal(isStaffMember(
    { roles: { cache: { has: () => false } }, permissions: member.permissions },
    'user',
    configured
  ), false);
  assert.equal(isStaffMember(member, 'user', { staffRoleIds: [], staffUserIds: [] }), true);
  assert.equal(isStaffMember(
    { roles: { cache: { has: () => false } }, permissions: { has: () => false } },
    'user',
    { staffRoleIds: [], staffUserIds: [] }
  ), false);
});

test('new env vars are optional and fall back safely', () => {
  const previous = {
    TICKET_AUTO_REPLY_ENABLED: process.env.TICKET_AUTO_REPLY_ENABLED,
    TICKET_CHANNEL_NAME_PATTERN: process.env.TICKET_CHANNEL_NAME_PATTERN,
    TICKET_CATEGORY_NAME: process.env.TICKET_CATEGORY_NAME,
    TICKET_STAFF_ROLE_IDS: process.env.TICKET_STAFF_ROLE_IDS,
    TICKET_STAFF_USER_IDS: process.env.TICKET_STAFF_USER_IDS,
    TICKET_AUTO_REPLY_MAX: process.env.TICKET_AUTO_REPLY_MAX,
  };
  delete process.env.TICKET_AUTO_REPLY_ENABLED;
  delete process.env.TICKET_CHANNEL_NAME_PATTERN;
  delete process.env.TICKET_CATEGORY_NAME;
  delete process.env.TICKET_STAFF_ROLE_IDS;
  delete process.env.TICKET_STAFF_USER_IDS;
  delete process.env.TICKET_AUTO_REPLY_MAX;

  const defaults = getTicketAutoReplyConfig();
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.categoryName, 'START HERE');
  assert.equal(defaults.namePattern.test('ticket-0002'), true);
  assert.equal(defaults.maxReplies, 6);
  assert.deepEqual(defaults.staffRoleIds, []);
  assert.deepEqual(defaults.staffUserIds, []);

  process.env.TICKET_CHANNEL_NAME_PATTERN = '(';
  process.env.TICKET_STAFF_ROLE_IDS = 'not-an-id,123456789012345678';
  process.env.TICKET_AUTO_REPLY_ENABLED = 'false';
  const fallback = getTicketAutoReplyConfig();
  assert.equal(fallback.enabled, false);
  assert.equal(fallback.namePattern.test('ticket-0002'), true);
  assert.deepEqual(fallback.staffRoleIds, ['123456789012345678']);

  for (const [key, value] of Object.entries(previous)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

test('existing scheduled chat messages and their cron entries are unchanged', () => {
  const checkin = readFileSync(new URL('../src/services/dailyCheckinService.js', import.meta.url), 'utf8');
  const hype = readFileSync(new URL('../src/services/morningHypeService.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(checkin, /How did we do today\? <@&\$\{process\.env\.PREMIUM_ROLE_ID\}>/);
  assert.match(checkin, /How did we do today\? @everyone/);
  assert.match(hype, /Match starting soon, who's ready to drop into NY session and secure the loot\? @everyone/);
  assert.match(app, /cron\.schedule\('0 11 \* \* 1-5', runSafeTask\('daily_checkin'/);
  assert.match(app, /cron\.schedule\('0 9 \* \* 1-5', runSafeTask\('morning_hype'/);
  assert.match(app, /GatewayIntentBits\.MessageContent/);
  assert.equal(app.includes('ticketAutoReply'), false);
});
