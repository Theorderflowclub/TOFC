import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'zlib';
import { channelMatchesFilter, looseName, nameMatchesNeedles } from '../src/services/qaExport/matchChannels.js';
import { looksLikeQuestion, pairQaMessages, rawMessages, summarizeQaExport } from '../src/services/qaExport/pairQa.js';
import { chunkItems, gzipJson } from '../src/services/qaExport/files.js';

const GUILD = '999';
const minute = 60 * 1000;
const start = Date.parse('2026-11-01T10:00:00.000Z');

function message(overrides) {
  return {
    id: '1',
    containerId: 'channel-1',
    channelName: '〔🗽〕tofc-trading-chat',
    threadName: null,
    inThread: false,
    authorId: 'member',
    authorUsername: 'brndnn',
    bot: false,
    owner: false,
    content: 'How does this work?',
    createdAt: start,
    replyToId: null,
    guildId: GUILD,
    linkChannelId: 'channel-1',
    ...overrides,
  };
}

test('channel names match loosely and ignore emoji prefixes', () => {
  assert.equal(nameMatchesNeedles('〔🗽〕tofc-trading-chat'), true);
  assert.equal(nameMatchesNeedles('questions-access'), true);
  assert.equal(nameMatchesNeedles('〔📥〕questions'), true);
  assert.equal(nameMatchesNeedles('faq'), true);
  assert.equal(nameMatchesNeedles('general'), false);
  assert.equal(looseName('ticket-transcripts'), 'tickettranscripts');
  assert.equal(channelMatchesFilter({ id: 'abc', name: 'random' }, 'abc'), true);
  assert.equal(channelMatchesFilter({ id: 'abc', name: 'random' }, 'other'), false);
});

test('a Discord reply from an owner pairs with the member message', () => {
  const pairs = pairQaMessages([
    message({ id: 'q', content: 'where do I click', createdAt: start }),
    message({
      id: 'a',
      authorId: 'founder',
      authorUsername: 'chromey',
      owner: true,
      content: 'Use the Whop checkout link.',
      createdAt: start + minute,
      replyToId: 'q',
    }),
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].askerUsername, 'brndnn');
  assert.equal(pairs[0].questionText, 'where do I click');
  assert.equal(pairs[0].answererUsername, 'chromey');
  assert.equal(pairs[0].answerText, 'Use the Whop checkout link.');
  assert.equal(pairs[0].channel, '〔🗽〕tofc-trading-chat');
  assert.equal(pairs[0].thread, null);
  assert.equal(pairs[0].date, '2026-11-01T10:00:00.000Z');
  assert.equal(pairs[0].messageLink, `https://discord.com/channels/${GUILD}/channel-1/a`);
});

test('forum owner messages after the opener pair with that opener', () => {
  const pairs = pairQaMessages([
    message({
      id: 'open',
      containerId: 'post-1',
      linkChannelId: 'post-1',
      channelName: 'faq',
      threadName: 'How do I join',
      inThread: true,
      content: 'How do I join premium?',
      createdAt: start,
    }),
    message({
      id: 'a1',
      containerId: 'post-1',
      linkChannelId: 'post-1',
      channelName: 'faq',
      threadName: 'How do I join',
      inThread: true,
      authorUsername: 'brandon',
      owner: true,
      content: 'Premium is on Whop.',
      createdAt: start + 2 * minute,
    }),
    message({
      id: 'a2',
      containerId: 'post-1',
      linkChannelId: 'post-1',
      channelName: 'faq',
      threadName: 'How do I join',
      inThread: true,
      authorUsername: 'brandon',
      owner: true,
      content: 'The monthly plan is $125.',
      createdAt: start + 4 * minute,
    }),
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].thread, 'How do I join');
  assert.equal(pairs[0].questionText, 'How do I join premium?');
  assert.equal(pairs[0].answerText, 'Premium is on Whop.\nThe monthly plan is $125.');
});

test('an owner message within 10 minutes pairs with a question, and later ones do not', () => {
  const pairs = pairQaMessages([
    message({ id: 'q', content: 'What time are the levels posted?', createdAt: start }),
    message({ id: 'chat', content: 'nice trade', createdAt: start + 2 * minute }),
    message({
      id: 'a',
      authorUsername: 'brandon',
      owner: true,
      content: 'Before the New York open.',
      createdAt: start + 9 * minute,
    }),
    message({ id: 'old', content: 'How old is this question?', createdAt: start }),
    message({
      id: 'late',
      containerId: 'channel-2',
      linkChannelId: 'channel-2',
      authorUsername: 'brandon',
      owner: true,
      content: 'Too late to pair.',
      createdAt: start + 11 * minute,
    }),
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].questionText, 'What time are the levels posted?');
  assert.equal(pairs[0].answerText, 'Before the New York open.');
});

test('owner messages more than 3 minutes apart stay separate answers', () => {
  const pairs = pairQaMessages([
    message({ id: 'q', content: 'Can I get premium?', createdAt: start }),
    message({
      id: 'a1',
      authorUsername: 'brandon',
      owner: true,
      content: 'Yes.',
      createdAt: start + minute,
    }),
    message({
      id: 'a2',
      authorUsername: 'brandon',
      owner: true,
      content: 'Here is the link.',
      createdAt: start + 5 * minute,
    }),
  ]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].answerText, 'Yes.');
  assert.equal(pairs[1].answerText, 'Here is the link.');
});

test('bots and owners are not askers, and raw export keeps member and owner messages', () => {
  const messages = [
    message({ id: 'bot', bot: true, authorUsername: 'Ticket Tool', content: 'Welcome?' }),
    message({ id: 'q', content: 'Is the course included?' }),
    message({
      id: 'a',
      authorUsername: 'brandon',
      owner: true,
      content: 'Yes, with Premium.',
      createdAt: start + minute,
      replyToId: 'q',
    }),
  ];
  const raw = rawMessages(messages);
  assert.equal(raw.length, 2);
  assert.deepEqual(raw.map((entry) => entry.role), ['member', 'owner']);
  assert.equal(raw[0].replyToId, null);
  assert.equal(raw[1].replyToId, 'q');
  assert.equal(pairQaMessages(messages).length, 1);
  assert.equal(looksLikeQuestion('hello there'), false);
  assert.equal(looksLikeQuestion('How do I join'), true);
});

test('summary counts pairs per channel', () => {
  const summary = summarizeQaExport([
    { channel: 'faq', date: '2026-11-01T00:00:00.000Z' },
    { channel: 'faq', date: '2026-11-02T00:00:00.000Z' },
    { channel: 'questions', date: '2026-11-02T00:00:00.000Z' },
  ], [{ id: '1' }, { id: '2' }], {
    from: '2026-08-03T00:00:00.000Z',
    to: '2026-11-02T00:00:00.000Z',
  });
  assert.match(summary, /3 pairs, 2 messages/);
  assert.match(summary, /faq: 2/);
  assert.match(summary, /questions: 1/);
});

test('gzipped json splits before 8MB', () => {
  const items = ['a', 'b', 'c'];
  const one = gzipJson(['a']).length;
  const two = gzipJson(['a', 'b']).length;
  assert.ok(two > one);
  const chunks = chunkItems(items, one);
  assert.equal(chunks.length, 3);
  assert.deepEqual(JSON.parse(gunzipSync(gzipJson(chunks[0])).toString()), ['a']);
});
