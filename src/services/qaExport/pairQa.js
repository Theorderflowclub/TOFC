const THREE_MINUTES_MS = 3 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const QUESTION_START = /^(what|why|how|when|where|who|which|can|could|do|does|did|is|are|was|were|will|would|should|anyone|anybody)\b/i;

export function looksLikeQuestion(text) {
  const trimmed = String(text || '').trim().replace(/^[^a-zA-Z0-9]+/, '').replace(/['’]/g, '');
  if (!trimmed) return false;
  if (String(text || '').includes('?')) return true;
  return QUESTION_START.test(trimmed);
}

function messageLink(message) {
  if (!message.guildId || !message.linkChannelId || !message.id) return '';
  return `https://discord.com/channels/${message.guildId}/${message.linkChannelId}/${message.id}`;
}

function groupOwnerAnswers(sorted) {
  const groups = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const message = sorted[index];
    if (!message.owner || message.bot) continue;
    const previous = groups[groups.length - 1];
    const last = previous?.messages[previous.messages.length - 1];
    const between = previous ? sorted.slice(previous.endIndex + 1, index) : [];
    const consecutive = previous
      && !between.some((item) => !item.owner)
      && message.createdAt - last.createdAt <= THREE_MINUTES_MS
      && message.createdAt >= last.createdAt;
    if (consecutive) {
      previous.messages.push(message);
      previous.endIndex = index;
    } else {
      groups.push({ messages: [message], endIndex: index });
    }
  }
  return groups;
}

function questionForGroup(group, sorted, byId, inThread) {
  for (const message of group.messages) {
    if (!message.replyToId) continue;
    const target = byId.get(message.replyToId);
    if (target && !target.bot && !target.owner) return target;
  }

  const opener = sorted[0];
  const firstAnswer = group.messages[0];
  if (
    inThread
    && opener
    && !opener.bot
    && !opener.owner
    && firstAnswer.id !== opener.id
    && firstAnswer.createdAt >= opener.createdAt
  ) {
    return opener;
  }

  let candidate = null;
  for (const message of sorted) {
    if (message.createdAt > firstAnswer.createdAt) break;
    if (message.owner || message.bot) continue;
    if (firstAnswer.createdAt - message.createdAt > TEN_MINUTES_MS) continue;
    if (!looksLikeQuestion(message.content)) continue;
    candidate = message;
  }
  return candidate;
}

function pairContainer(messages) {
  const sorted = [...messages]
    .filter((message) => message && !message.bot)
    .sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)));
  if (!sorted.length) return [];
  const inThread = sorted.some((message) => message.inThread);
  const byId = new Map(sorted.map((message) => [message.id, message]));
  const pairs = [];

  for (const group of groupOwnerAnswers(sorted)) {
    const question = questionForGroup(group, sorted, byId, inThread);
    if (!question || !String(question.content || '').trim()) continue;
    const answerText = group.messages
      .map((message) => String(message.content || '').trim())
      .filter(Boolean)
      .join('\n');
    if (!answerText) continue;
    const first = group.messages[0];
    pairs.push({
      channel: question.channelName || first.channelName || '',
      thread: question.threadName || first.threadName || null,
      date: new Date(question.createdAt).toISOString(),
      askerUsername: question.authorUsername || '',
      questionText: String(question.content || ''),
      answererUsername: first.authorUsername || '',
      answerText,
      messageLink: messageLink(first),
    });
  }
  return pairs;
}

export function pairQaMessages(messages) {
  const groups = new Map();
  for (const message of messages || []) {
    if (!message || message.bot) continue;
    const key = message.containerId || message.linkChannelId || message.channelName || 'channel';
    const list = groups.get(key) || [];
    list.push(message);
    groups.set(key, list);
  }
  const pairs = [];
  for (const list of groups.values()) {
    pairs.push(...pairContainer(list));
  }
  return pairs.sort((a, b) => a.date.localeCompare(b.date) || a.messageLink.localeCompare(b.messageLink));
}

export function toRawMessage(message) {
  return {
    id: message.id,
    replyToId: message.replyToId || null,
    author: message.authorUsername || '',
    role: message.owner ? 'owner' : 'member',
    time: new Date(message.createdAt).toISOString(),
    content: String(message.content || ''),
    channel: message.channelName || '',
    thread: message.threadName || null,
  };
}

export function rawMessages(messages) {
  return (messages || [])
    .filter((message) => message && !message.bot)
    .sort((a, b) => a.createdAt - b.createdAt || String(a.id).localeCompare(String(b.id)))
    .map(toRawMessage);
}

export function countPairsByChannel(pairs) {
  const counts = new Map();
  for (const pair of pairs || []) {
    const name = pair.channel || 'unknown';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function summarizeQaExport(pairs, raw, { from, to } = {}) {
  const lines = [
    `Q&A export: ${pairs.length} pair${pairs.length === 1 ? '' : 's'}, ${raw.length} message${raw.length === 1 ? '' : 's'}.`,
  ];
  if (from && to) lines.push(`Range: ${from} to ${to}.`);
  const counts = countPairsByChannel(pairs);
  if (!counts.length) {
    lines.push('No Q&A pairs in that range.');
  } else {
    for (const [name, count] of counts) {
      lines.push(`${name}: ${count}`);
    }
  }
  return lines.join('\n');
}
