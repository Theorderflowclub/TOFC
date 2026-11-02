export const AUTO_REPLY_MARKER = '\u200b\u2060\u200b';

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/%/g, ' percent ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function includesPhrase(normalizedText, phraseText) {
  const phrase = normalize(phraseText);
  if (!phrase || !normalizedText) return false;
  let haystack = normalizedText;
  if (phrase === 'price' && haystack.includes('price action')) {
    haystack = haystack.replaceAll('price action', ' ');
  }
  if (!phrase.includes(' ')) {
    return new RegExp(`(?:^| )${escapeRegExp(phrase)}(?:$| )`).test(haystack);
  }
  return haystack.includes(phrase);
}

function levenshtein(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[left.length][right.length];
}

function fuzzyEqual(token, part) {
  if (token === part) return true;
  // Abbreviations such as vah, poc, cpi, mnq and gex only match the whole word.
  // A longer token like "pocs" or "mnqs" must not fuzzy-match them.
  if (!token || !part || part.length < 4 || token.length < 4) return false;
  const longer = Math.max(token.length, part.length);
  if (token[0] !== part[0]) return false;
  const limit = longer >= 6 ? 2 : 1;
  if (Math.abs(token.length - part.length) > limit) return false;
  return levenshtein(token, part) <= limit;
}

function phraseHit(normalizedText, phraseText) {
  if (includesPhrase(normalizedText, phraseText)) return 'exact';
  const phrase = normalize(phraseText);
  if (!phrase) return null;
  if (phrase === 'price' && normalizedText.includes('price action')) {
    return phraseHit(normalizedText.replaceAll('price action', ' '), phraseText);
  }
  const tokens = normalizedText.split(' ').filter(Boolean);
  const parts = phrase.split(' ');
  if (parts.length === 1) {
    return tokens.some((token) => fuzzyEqual(token, parts[0])) ? 'fuzzy' : null;
  }
  for (let index = 0; index <= tokens.length - parts.length; index += 1) {
    const window = tokens.slice(index, index + parts.length);
    if (window.every((token, partIndex) => fuzzyEqual(token, parts[partIndex]))) return 'fuzzy';
  }
  return null;
}

export function scorePhrases(normalizedText, phrases) {
  let score = 0;
  const matched = [];
  for (const phrase of phrases || []) {
    const hit = phraseHit(normalizedText, phrase.text);
    if (!hit) continue;
    score += Number(phrase.weight) || 0;
    matched.push(normalize(phrase.text));
  }
  return { score, matched };
}

export function matchQuestion(text, faq) {
  const normalized = normalize(text);
  const ranked = faq.entries
    .map((entry) => ({ entry, ...scorePhrases(normalized, entry.phrases) }))
    .sort((a, b) => b.score - a.score);
  if (/\$/.test(String(text || ''))) {
    const prices = ranked.find((item) => item.entry.id === 'whop-prices');
    if (prices) prices.score += 4;
    ranked.sort((a, b) => b.score - a.score);
  }
  const best = ranked[0];
  const secondScore = ranked[1]?.score || 0;
  const bestScore = best?.score || 0;
  const handoffRanked = (faq.handoffTopics || [])
    .map((topic) => ({ topic, ...scorePhrases(normalized, topic.phrases) }))
    .filter((item) => item.score >= faq.minScore)
    .sort((a, b) => b.score - a.score);

  const confident = Boolean(
    best && bestScore >= faq.minScore && (bestScore - secondScore) >= faq.minMargin
  );
  if (confident) {
    const blocked = handoffRanked.find((item) => !best.entry.coversHandoff?.includes(item.topic.id));
    if (!blocked) return { type: 'answer', entry: best.entry, score: bestScore };
    if (blocked.topic.id === 'pricing') {
      const prices = ranked.find((item) =>
        item.entry.coversHandoff?.includes('pricing') && item.score >= faq.minScore
      );
      if (prices) return { type: 'answer', entry: prices.entry, score: prices.score };
    }
  }
  if (handoffRanked.length) return { type: 'handoff', topicId: handoffRanked[0].topic.id };
  return { type: 'none' };
}

const GREETING_ONLY = /^(hi|hii|hiii|hey|hello|yo|sup|thanks|thank you|ty|ok|okay|good morning|good afternoon|good evening|hi there|hey there|hello there)[.! ]*$/;

export function isGreetingOnly(text) {
  const normalized = normalize(text);
  if (!normalized) return false;
  return GREETING_ONLY.test(normalized);
}

export function modeForReason(reason) {
  if (reason === 'invite_reward') return 'invite';
  if (reason === 'management' || reason === 'partnership' || reason === 'suggestions') return 'handoff';
  return 'faq';
}

export function modeFromMemberText(text) {
  const normalized = normalize(text);
  if (!normalized) return null;
  if (/\bclaim\b/.test(normalized) && /\b(invite|reward|rewards)\b/.test(normalized)) return 'invite';
  if (/\b(my reward|my invite reward)\b/.test(normalized)) return 'invite';
  if (/\bpartnership\b/.test(normalized)) return 'handoff';
  if (/\bcontact with management\b/.test(normalized) || /\bcontact management\b/.test(normalized)) return 'handoff';
  if (/\bsuggestions or problems\b/.test(normalized)) return 'handoff';
  return null;
}

export function areSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = shorter === a ? b : a;
  if (shorter.length > 12 && longer.includes(shorter)) return true;
  const left = new Set(a.split(' ').filter((token) => token.length > 2));
  const right = new Set(b.split(' ').filter((token) => token.length > 2));
  if (!left.size || !right.size) return false;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union > 0 && intersection / union >= 0.72;
}

export function emptyState() {
  return {
    greeted: false,
    stopped: false,
    handedOff: false,
    inviteAcked: false,
    answeredIds: [],
    previousAsks: [],
    replyCount: 0,
  };
}

export const DEFAULT_FALLBACKS = [
  'Thanks for your question! A team member will get back to you soon.',
  'Got it. A team member will reply in this ticket shortly.',
  'Thanks for the message. The team will get back to you soon.',
  'Appreciate you writing in. Someone from the team will follow up soon.',
];

export const MEMBER_DEBOUNCE_MS = 3000;

export function fallbackList(faq) {
  const configured = Array.isArray(faq?.fallbacks) ? faq.fallbacks.filter(Boolean) : [];
  const list = configured.length ? configured : DEFAULT_FALLBACKS;
  if (faq?.handoff && !list.includes(faq.handoff)) return [...list, faq.handoff];
  return list;
}

export function pickFallback(faq, index = 0) {
  const list = fallbackList(faq);
  const safeIndex = Number.isFinite(index) ? Math.abs(index) : 0;
  return list[safeIndex % list.length];
}

export function isOurAutoReply(content, faq) {
  if (!content) return false;
  if (content.includes(AUTO_REPLY_MARKER)) return true;
  const probes = [
    faq.handoff,
    faq.inviteRewardAck,
    faq.greetingPrompt,
    ...fallbackList(faq),
    ...faq.entries.map((entry) => entry.answer),
  ];
  return probes.some((probe) => probe && content.includes(probe));
}

export function createDebouncer({ delayMs = MEMBER_DEBOUNCE_MS, schedule, cancel, onFire }) {
  const buckets = new Map();
  return {
    push(key, text) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { texts: [] };
        buckets.set(key, bucket);
      }
      if (text) bucket.texts.push(text);
      if (bucket.timer != null) cancel(bucket.timer);
      bucket.timer = schedule(() => {
        const texts = bucket.texts.slice();
        buckets.delete(key);
        onFire(key, texts);
      }, delayMs);
    },
    cancelKey(key) {
      const bucket = buckets.get(key);
      if (!bucket) return;
      if (bucket.timer != null) cancel(bucket.timer);
      buckets.delete(key);
    },
    cancelPrefix(prefix) {
      for (const key of [...buckets.keys()]) {
        if (String(key).startsWith(prefix)) this.cancelKey(key);
      }
    },
  };
}

export function noteAutoReply(state, content, faq) {
  state.greeted = true;
  state.replyCount += 1;
  if (faq.handoff && content.includes(faq.handoff)) state.handedOff = true;
  if (faq.inviteRewardAck && content.includes(faq.inviteRewardAck)) state.inviteAcked = true;
  for (const entry of faq.entries) {
    if (entry.answer && content.includes(entry.answer) && !state.answeredIds.includes(entry.id)) {
      state.answeredIds.push(entry.id);
    }
  }
}

export function buildStateFromHistory(messages, { botUserId, faq, currentMessageId, isStaffUser }) {
  const state = emptyState();
  const ordered = [...messages].sort(
    (a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0)
  );
  for (const message of ordered) {
    if (message.author?.bot) {
      if (message.author.id === botUserId && isOurAutoReply(message.content, faq)) {
        noteAutoReply(state, message.content || '', faq);
      }
      continue;
    }
    if (isStaffUser(message.author?.id)) {
      state.stopped = true;
      continue;
    }
    if (message.id === currentMessageId) continue;
    const normalized = normalize(message.content || '');
    if (normalized) state.previousAsks.push(normalized);
  }
  return state;
}

export function decideReply({
  text,
  hasAttachment = false,
  reason,
  authorIsStaff,
  state,
  faq,
  maxReplies,
  acknowledgeWhenBlank = false,
}) {
  if (authorIsStaff || state.stopped) return { action: 'stop' };

  const normalized = normalize(text || '');
  if (state.replyCount >= maxReplies) return { action: 'ignore', why: 'reply cap' };
  if (!normalized && !hasAttachment) {
    if (acknowledgeWhenBlank) {
      return {
        action: 'reply',
        kind: 'handoff',
        ping: false,
        withGreeting: !state.greeted,
        fallbackText: pickFallback(faq, state.replyCount),
      };
    }
    return { action: 'ignore', why: 'blank message' };
  }

  const withGreeting = !state.greeted;
  const mode = modeForReason(reason);
  const memberMode = modeFromMemberText(text);
  const claim = mode === 'invite' || memberMode === 'invite';
  const match = (!normalized && hasAttachment) ? { type: 'none' } : matchQuestion(text, faq);

  if (match.type === 'answer' && !(claim && match.entry.id === 'invite-rewards')) {
    return {
      action: 'reply',
      kind: 'answer',
      entry: match.entry,
      ping: false,
      withGreeting,
    };
  }

  if (claim) {
    return { action: 'reply', kind: 'invite', ping: false, withGreeting };
  }

  const staffTopic = mode === 'handoff' || memberMode === 'handoff';
  return {
    action: 'reply',
    kind: 'handoff',
    ping: staffTopic,
    withGreeting,
    fallbackText: pickFallback(faq, state.replyCount),
  };
}

export function renderReply({
  kind,
  entry,
  faq,
  userId,
  withGreeting,
  staffRoleIds = [],
  staffUserIds = [],
  fallbackText = '',
}) {
  const greeting = userId
    ? faq.greeting.replaceAll('{user}', `<@${userId}>`)
    : faq.greeting.replaceAll('{user}', 'there');
  const body = kind === 'invite'
    ? faq.inviteRewardAck
    : kind === 'handoff'
      ? (fallbackText || pickFallback(faq, 0))
      : kind === 'greeting'
        ? faq.greetingPrompt
        : entry.answer;

  let visible = withGreeting ? `${greeting}\n\n${body}` : body;
  const users = [];
  const roles = [];
  if (kind === 'handoff') {
    if (staffRoleIds.length || staffUserIds.length) {
      const mentions = [
        ...staffRoleIds.map((id) => `<@&${id}>`),
        ...staffUserIds.map((id) => `<@${id}>`),
      ];
      visible += `\n\n${mentions.join(' ')}`;
      roles.push(...staffRoleIds);
      users.push(...staffUserIds);
    }
  }
  if (withGreeting && userId) users.push(String(userId));

  const markerRoom = AUTO_REPLY_MARKER.length;
  if (visible.length + markerRoom > 2000) {
    visible = `${visible.slice(0, 2000 - markerRoom - 1)}…`;
  }

  return {
    content: `${visible}${AUTO_REPLY_MARKER}`,
    allowedMentions: {
      parse: [],
      users: [...new Set(users)],
      roles: [...new Set(roles)],
    },
  };
}
