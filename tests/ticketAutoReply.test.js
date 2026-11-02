import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getTicketAutoReplyConfig } from '../src/config/ticketAutoReply.js';
import { loadTicketFaq } from '../src/services/ticketAutoReply/faqStore.js';
import {
  detectTicketReason,
  extractTicketToolPrompt,
  isStaffMember,
  isTicketChannel,
  messageToText,
} from '../src/services/ticketAutoReply/detect.js';
import {
  AUTO_REPLY_MARKER,
  buildStateFromHistory,
  createDebouncer,
  decideReply,
  emptyState,
  matchQuestion,
  MEMBER_DEBOUNCE_MS,
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
    fallbackText: decision.fallbackText,
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
  const priceEntry = faq.entries.find((entry) => entry.id === 'whop-prices');
  const originalIds = new Set([
    'what-tofc-sells',
    'premium-includes',
    'education-course',
    'invite-rewards',
    'trader-of-the-month',
    'weekly-best',
  ]);
  const spokenWithoutPrices = [
    faq.greeting,
    faq.greetingPrompt,
    faq.handoff,
    faq.inviteRewardAck,
    ...faq.entries.filter((entry) => originalIds.has(entry.id)).map((entry) => entry.answer),
  ].join('\n');
  assert.equal(/https?:\/\/|www\.|TODO|\$|€|£/i.test(spokenWithoutPrices), false);
  assert.equal(JSON.stringify(faq).includes('prestige-1.whop.site'), false);
  assert.match(spokenWithoutPrices, /Premium membership and 1:1 coaching through Whop/);
  assert.match(spokenWithoutPrices, /15:30 Amsterdam time/);
  assert.match(spokenWithoutPrices, /Master TOFC Models/);
  assert.match(spokenWithoutPrices, /50% off your first month of Premium/);
  assert.match(spokenWithoutPrices, /payout is 4/);
  assert.match(spokenWithoutPrices, /every Friday/);
  assert.ok(faq.todos.some((item) => /affiliate link URL/i.test(item)));
  assert.ok(faq.todos.some((item) => /Trader of the Month/i.test(item)));
  assert.ok(faq.todos.some((item) => /Refunds/i.test(item)));
  assert.equal(priceEntry.answer.includes(faq.todos[0]), false);
  assert.equal(/refund policy|affiliate link URL|winner is/i.test(priceEntry.answer), false);
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

test('answers Whop price questions with the real plans and nothing invented', () => {
  const price = replyTo('whats the whop price');
  assert.equal(price.kind, 'answer');
  assert.equal(price.entry.id, 'whop-prices');
  assert.match(price.content, /no free trials/i);
  assert.match(price.content, /Free Discord Access — free\. https:\/\/whop\.com\/checkout\/plan_QMJla0RcCdDYI/);
  assert.match(price.content, /Premium \(Prestige 1\) — \$125\/month/);
  assert.match(price.content, /No signals or callouts\. https:\/\/whop\.com\/checkout\/plan_048dLgwCwNmMZ/);
  assert.match(price.content, /Premium Lifetime — \$799 one-time\. https:\/\/whop\.com\/checkout\/plan_uYRhdFiA0iYky/);
  assert.match(price.content, /Mentorship 1 Month — \$399\/month/);
  assert.match(price.content, /https:\/\/whop\.com\/checkout\/plan_uMBPr7A1Kxguo/);
  assert.match(price.content, /Mentorship 2 Months — \$699 per 2 months \(8 sessions\)\. https:\/\/whop\.com\/checkout\/plan_7VkqFgXS3uEkf/);
  assert.match(price.content, /Mentorship 3 Months \+ FREE DeepCharts — \$999 per 3 months \(12 sessions, plus 3 months of DeepCharts free\)\. https:\/\/whop\.com\/checkout\/plan_c45K1tKpgeBdY/);
  assert.ok(price.content.length <= 2000);

  assert.equal(replyTo('How much is premium membership?').entry.id, 'whop-prices');
  assert.equal(replyTo('How much is the course?').entry.id, 'whop-prices');
  assert.equal(replyTo('how much is the mentorship').entry.id, 'whop-prices');
  assert.equal(replyTo('premium lifetime cost').entry.id, 'whop-prices');
  assert.equal(replyTo('Can you send me the Whop link?').entry.id, 'whop-prices');

  const winner = replyTo('Who won trader of the month?');
  assert.equal(winner.kind, 'handoff');
  assert.equal(winner.content.includes('$125'), false);

  const refund = replyTo('can I get a refund');
  assert.equal(refund.kind, 'handoff');
  assert.equal(refund.content.includes('whop.com/checkout'), false);

  const code = replyTo('do you have a discount code');
  assert.equal(code.kind, 'handoff');
  assert.equal(code.content.includes('$399'), false);
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
    maxReplies: 50,
  });
  assert.equal(repeat.action, 'reply');
  assert.equal(repeat.entry.id, 'what-tofc-sells');

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

test('a greeting and an unknown question both get a reply', () => {
  const hello = replyTo('Hey there');
  assert.equal(hello.action, 'reply');
  assert.equal(hello.ping, false);
  assert.match(hello.content, /get back to you soon|reply in this ticket|follow up soon/i);

  const unknown = replyTo('blorp zing quota');
  assert.equal(unknown.kind, 'handoff');
  assert.equal(unknown.ping, false);
  assert.match(unknown.content, /get back to you soon|reply in this ticket|follow up soon/i);
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
  assert.equal(isTicketChannel(channel({ name: 'ticket-0003', parentName: startHere }), ticketConfig), true);
  assert.equal(
    isTicketChannel(channel({ name: 'ticket-0003', parentName: 'ᯓ➤  START\u00A0HERE\u200b  🔒' }), ticketConfig),
    true
  );
});

test('Ticket Tool welcome embed is the question when the member never types', () => {
  const openerId = '111111111111111111';
  const toolMessage = {
    id: 'tool-1',
    content: `<@${openerId}> Welcome`,
    author: { id: '222222222222222222', bot: true, username: 'Ticket Tool' },
    embeds: [
      {
        description: 'Thank you for reaching out to us. A member of staff will be with you shortly.',
        fields: [
          { name: 'Why are you opening this ticket?', value: 'whats in the education course' },
        ],
      },
    ],
    mentions: {
      users: new Map([[openerId, { id: openerId, bot: false, username: 'brndnn' }]]),
    },
  };

  const prompt = extractTicketToolPrompt(toolMessage);
  assert.equal(prompt.question, 'whats in the education course');
  assert.equal(prompt.fieldName, 'Why are you opening this ticket?');
  assert.equal(prompt.openerId, openerId);
  assert.equal(prompt.question.includes('Thank you for reaching out'), false);
  assert.equal(prompt.question.toLowerCase().includes('welcome'), false);

  const plainMember = {
    roles: { cache: { has: () => false } },
    permissions: { has: () => false },
  };
  assert.equal(isStaffMember(plainMember, openerId, { staffRoleIds: [], staffUserIds: [] }), false);

  assert.equal(detectTicketReason([messageToText(toolMessage)]), 'unknown');

  const decision = decideReply({
    text: prompt.question,
    reason: 'unknown',
    authorIsStaff: false,
    state: emptyState(),
    faq,
    maxReplies: 6,
    acknowledgeWhenBlank: true,
  });
  assert.equal(decision.action, 'reply');
  assert.equal(decision.kind, 'answer');
  assert.equal(decision.entry.id, 'education-course');

  const rendered = renderReply({
    kind: decision.kind,
    entry: decision.entry,
    faq,
    userId: prompt.openerId,
    withGreeting: true,
  });
  assert.match(rendered.content, new RegExp(`<@${openerId}>`));
  assert.match(rendered.content, /Master TOFC Models/);
  assert.match(rendered.content, /about 6 hours of video in 14 chapters/);
  assert.match(rendered.content, /Introduction, DeepCharts Setup, Checklist & No trade days/);
  assert.match(rendered.content, /Price Action \(Context\), AMT \(Location\), Orderflow \(Confirmation\)/);
  assert.match(rendered.content, /TOFC Model 1 to 6, Domino effect models, END/);
  assert.match(rendered.content, /visual, an explanation video, a case study and a quiz/);
});

test('a Ticket Tool ticket with no FAQ match still gets an acknowledgement', () => {
  const unmatched = {
    content: '<@111111111111111111> Welcome',
    author: { bot: true },
    embeds: [
      {
        description: 'Thank you for reaching out to us.',
        fields: [
          { name: 'Why are you opening this ticket?', value: 'zzzz-unmatched-request' },
        ],
      },
    ],
    mentions: { users: new Map() },
  };
  const prompt = extractTicketToolPrompt(unmatched);
  const decision = decideReply({
    text: prompt.question,
    reason: detectTicketReason([messageToText(unmatched)]),
    authorIsStaff: false,
    state: emptyState(),
    faq,
    maxReplies: 6,
    acknowledgeWhenBlank: true,
  });
  assert.equal(decision.action, 'reply');
  assert.equal(decision.kind, 'handoff');
  const rendered = renderReply({
    kind: decision.kind,
    entry: decision.entry,
    faq,
    userId: '111111111111111111',
    withGreeting: true,
  });
  assert.match(rendered.content, /get back to you soon|reply in this ticket|follow up soon/);

  const welcomeOnly = extractTicketToolPrompt({
    content: '<@111111111111111111> Welcome',
    embeds: [{ description: 'Thank you for reaching out to us.' }],
  });
  assert.equal(welcomeOnly.question, '');
  const blank = decideReply({
    text: welcomeOnly.question,
    reason: 'unknown',
    authorIsStaff: false,
    state: emptyState(),
    faq,
    maxReplies: 6,
    acknowledgeWhenBlank: true,
  });
  assert.equal(blank.action, 'reply');
  assert.equal(blank.kind, 'handoff');
});

test('bot messages reach the ticket handler before they are ignored', () => {
  const source = readFileSync(new URL('../src/events/messageCreate.js', import.meta.url), 'utf8');
  const handlerAt = source.indexOf('await handleTicketMessage(message, client);');
  const botReturnAt = source.indexOf('if (message.author.bot) return;');
  assert.ok(handlerAt > 0);
  assert.ok(botReturnAt > handlerAt);
  assert.equal(source.includes('if (message.author.bot || !message.guild) return;'), false);
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
  assert.equal(defaults.maxReplies, 50);
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

test('later member messages still get a reply, including the 7th', () => {
  const state = emptyState();
  state.greeted = true;
  state.handedOff = true;
  state.replyCount = 6;
  state.answeredIds = ['whop-prices', 'education-course'];
  state.previousAsks = ['whats the whop price', 'hello', 'we want a partnership with you guys'];

  const repeated = decideReply({
    text: 'whats the whop price',
    reason: 'education',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 50,
  });
  assert.equal(repeated.action, 'reply');
  assert.equal(repeated.entry.id, 'whop-prices');

  const seventh = decideReply({
    text: 'hello',
    reason: 'education',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 50,
  });
  assert.equal(seventh.action, 'reply');
  assert.equal(seventh.kind, 'handoff');

  const capped = decideReply({
    text: 'hello again',
    reason: 'education',
    authorIsStaff: false,
    state: { ...state, replyCount: 50 },
    faq,
    maxReplies: 50,
  });
  assert.equal(capped.action, 'ignore');
  assert.equal(capped.why, 'reply cap');
});

test('partnership handoff does not silence the next member message', () => {
  const first = replyTo('we want a partnership with you guys');
  assert.equal(first.kind, 'handoff');
  assert.equal(first.ping, true);

  const state = emptyState();
  state.greeted = true;
  state.handedOff = true;
  state.replyCount = 3;
  const hello = decideReply({
    text: 'hello',
    reason: 'education',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 50,
  });
  assert.equal(hello.action, 'reply');
  assert.equal(hello.kind, 'handoff');
});

test('an existing ticket still gets replies after a restart', () => {
  const startHere = 'ᯓ➤ START HERE 🔒';
  assert.equal(isTicketChannel(channel({ name: 'ticket-0003', parentName: startHere }), ticketConfig), true);

  const course = faq.entries.find((entry) => entry.id === 'education-course');
  const prices = faq.entries.find((entry) => entry.id === 'whop-prices');
  const history = [
    { id: 'tool', content: '<@111> Welcome', createdTimestamp: 1, author: { id: 'tool', bot: true } },
    { id: 'a1', content: `Hey <@111>, thanks for opening a ticket.\n\n${course.answer}${AUTO_REPLY_MARKER}`, createdTimestamp: 2, author: { id: 'bot', bot: true } },
    { id: 'q2', content: 'something else', createdTimestamp: 3, author: { id: 'brndnn', bot: false } },
    { id: 'a2', content: `Thanks for reaching out. A member of the team will get back to you soon.${AUTO_REPLY_MARKER}`, createdTimestamp: 4, author: { id: 'bot', bot: true } },
    { id: 'q3', content: 'how much is premium', createdTimestamp: 5, author: { id: 'brndnn', bot: false } },
    { id: 'a3', content: `${prices.answer}${AUTO_REPLY_MARKER}`, createdTimestamp: 6, author: { id: 'bot', bot: true } },
    { id: 'q4', content: 'we want a partnership with you guys', createdTimestamp: 7, author: { id: 'brndnn', bot: false } },
  ];
  const state = buildStateFromHistory(history, {
    botUserId: 'bot',
    faq,
    currentMessageId: 'q4',
    isStaffUser: () => false,
  });
  assert.equal(state.stopped, false);
  assert.equal(state.greeted, true);
  assert.equal(state.handedOff, true);
  assert.equal(state.replyCount, 3);

  const partnership = decideReply({
    text: 'we want a partnership with you guys',
    reason: 'education',
    authorIsStaff: false,
    state,
    faq,
    maxReplies: 50,
  });
  assert.equal(partnership.action, 'reply');

  const helloState = buildStateFromHistory(
    [...history, { id: 'a4', content: `Thanks for your question! A team member will get back to you soon.${AUTO_REPLY_MARKER}`, createdTimestamp: 8, author: { id: 'bot', bot: true } }, { id: 'q5', content: 'hello', createdTimestamp: 9, author: { id: 'brndnn', bot: false } }],
    { botUserId: 'bot', faq, currentMessageId: 'q5', isStaffUser: () => false },
  );
  const hello = decideReply({
    text: 'hello',
    reason: 'education',
    authorIsStaff: false,
    state: helloState,
    faq,
    maxReplies: 50,
  });
  assert.equal(hello.action, 'reply');
  assert.equal(hello.kind, 'handoff');
});

test('typos and loose price wording match the Whop prices', () => {
  assert.equal(matchQuestion('how much got cost premium', faq).entry.id, 'whop-prices');
  assert.equal(matchQuestion('how mch premuim prise', faq).entry.id, 'whop-prices');
  assert.equal(matchQuestion('lifetime mentorship', faq).entry.id, 'whop-prices');
  assert.equal(matchQuestion('whats in the educaton corse', faq).entry.id, 'education-course');
  assert.equal(matchQuestion('premium is $125?', faq).entry.id, 'whop-prices');
});

test('rapid member messages debounce into one combined reply', () => {
  const timers = [];
  let fired = null;
  const debouncer = createDebouncer({
    delayMs: MEMBER_DEBOUNCE_MS,
    schedule(fn, ms) {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(timer) {
      timer.cancelled = true;
    },
    onFire(key, texts) {
      fired = { key, texts };
    },
  });

  debouncer.push('1566877490943885342:brndnn', 'we want a partnership with you guys');
  debouncer.push('1566877490943885342:brndnn', 'hello');
  assert.equal(timers[0].cancelled, true);
  assert.equal(timers[1].ms, 3000);
  timers[1].fn();
  assert.deepEqual(fired, {
    key: '1566877490943885342:brndnn',
    texts: ['we want a partnership with you guys', 'hello'],
  });
});

test('knowledge-base entries match a realistic member question', () => {
  const cases = [
    ['do you trade from the vah or the poc', 'value-area-levels'],
    ['which session do you trade, ny or london', 'which-session'],
    ['which prop firm do you recommend', 'prop-firms'],
    ['how many contracts should I trade on mnq', 'risk-management'],
    ['what do the cvd bubbles tell me', 'cvd-delta-bubbles'],
    ['where can I learn orderflow', 'where-to-learn-orderflow'],
    ['which gex levels should I mark', 'gex-levels-usage'],
    ['do I get all the models with premium', 'premium-models-access'],
    ['when is the live lesson', 'community-calls-schedule'],
    ['how many models are there', 'tofc-models-overview'],
    ['which platform should I use for orderflow', 'orderflow-platform'],
    ['does deepcharts connect to tradovate or only rithmic', 'deepcharts-data-connection'],
    ['is today a no trade day because of cpi', 'no-trade-days'],
    ['where do I find the deepcharts settings', 'deepcharts-settings-templates'],
    ['is there a deepcharts discount code', 'deepcharts-code'],
    ['can I copy your trades', 'copy-trading-signals'],
    ['how long does it take to learn orderflow', 'time-to-learn-orderflow'],
  ];
  for (const [question, id] of cases) {
    const match = matchQuestion(question, faq);
    assert.equal(match.entry?.id, id, question);
  }
});

test('existing FAQ questions still map to their original entries', () => {
  const cases = [
    ['How much is premium?', 'whop-prices'],
    ['how much is premium', 'whop-prices'],
    ['whats the whop price', 'whop-prices'],
    ['deepcharts course', 'education-course'],
    ['What is the Master TOFC Models course?', 'education-course'],
    ['Where are the GEX levels posted?', 'premium-includes'],
    ['What does TOFC sell?', 'what-tofc-sells'],
    ['Do you offer 1:1 coaching?', 'what-tofc-sells'],
    ['How do invite rewards work?', 'invite-rewards'],
    ['How does trader of the month work?', 'trader-of-the-month'],
    ['When are the weekly best traders highlighted?', 'weekly-best'],
  ];
  for (const [question, id] of cases) {
    const match = matchQuestion(question, faq);
    assert.equal(match.entry?.id, id, question);
  }
});

test('student-only question-channel sentences are not in the ticket FAQ', () => {
  const faqText = readFileSync(new URL('../data/ticket-faq.json', import.meta.url), 'utf8');
  const hidden = [
    "Previous' means the previous fair value areas",
    'check it at your POIs',
    "Don't cut the ask & bid",
    "that's the pre-plan",
    'Model 1 needs price to tap into the POC',
    'build your own settings',
    'skip it or keep risk small',
  ];
  for (const sentence of hidden) {
    assert.equal(faqText.includes(sentence), false, sentence);
  }
});

test('casual chat and short-code lookalikes do not hit a knowledge-base entry', () => {
  for (const question of ['my stream lagged', 'just chatting about lunch today', 'the epoch of this move', 'I might trade mnqs later']) {
    const match = matchQuestion(question, faq);
    assert.equal(match.type, 'none', `${question} -> ${match.entry?.id || match.type}`);
  }
  assert.equal(matchQuestion('where is the poc', faq).entry.id, 'value-area-levels');
  assert.equal(matchQuestion('should I use mnq or nq', faq).entry.id, 'risk-management');
});

test('existing scheduled chat messages and their cron entries are unchanged', () => {
  const checkin = readFileSync(new URL('../src/services/dailyCheckinService.js', import.meta.url), 'utf8');
  const hype = readFileSync(new URL('../src/services/morningHypeService.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(checkin, /How did we do today\? <@&\$\{process\.env\.PREMIUM_ROLE_ID\}>/);
  assert.match(checkin, /How did we do today\? @everyone/);
  assert.match(hype, /Match starting soon, who's ready to drop into NY session and secure the loot\? @everyone/);
  assert.match(app, /cron\.schedule\('0 6 \* \* \*', runSafeTask\('birthday_check'/);
  assert.match(app, /cron\.schedule\('\* \* \* \* \*', runSafeTask\('giveaway_check'/);
  assert.match(app, /cron\.schedule\('\*\/15 \* \* \* \*', runSafeTask\('counter_update'/);
  assert.match(app, /cron\.schedule\('0 11 \* \* 1-5', runSafeTask\('daily_checkin'/);
  assert.match(app, /cron\.schedule\('0 9 \* \* 1-5', runSafeTask\('morning_hype'/);
  assert.match(app, /GatewayIntentBits\.MessageContent/);
  assert.equal(app.includes('ticketAutoReply'), false);
});
