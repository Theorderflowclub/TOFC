import { readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';

const FAQ_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/ticket-faq.json'
);

let cache = { mtimeMs: -1, faq: null };

export function getFaqPath() {
  return FAQ_PATH;
}

export function clearFaqCache() {
  cache = { mtimeMs: -1, faq: null };
}

export function loadTicketFaq() {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(FAQ_PATH).mtimeMs;
  } catch (error) {
    logger.error(`TOFC ticket auto-reply: FAQ file missing at ${FAQ_PATH}: ${error.message}`);
    cache = { mtimeMs: -1, faq: null };
    return null;
  }

  if (cache.faq && cache.mtimeMs === mtimeMs) return cache.faq;

  try {
    const parsed = JSON.parse(readFileSync(FAQ_PATH, 'utf8'));
    const faq = normalizeFaq(parsed);
    cache = { mtimeMs, faq };
    return faq;
  } catch (error) {
    logger.error(`TOFC ticket auto-reply: could not read FAQ file ${FAQ_PATH}: ${error.message}`);
    cache = { mtimeMs, faq: null };
    return null;
  }
}

function normalizePhrase(phrase, entryId) {
  if (typeof phrase === 'string') return { text: phrase, weight: 3 };
  const text = String(phrase?.text || '').trim();
  const weight = Number(phrase?.weight);
  if (!text || !Number.isFinite(weight)) {
    throw new Error(`FAQ entry "${entryId}" has a phrase without text and weight`);
  }
  return { text, weight };
}

function normalizeFaq(parsed) {
  if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    throw new Error('FAQ file must contain an entries array');
  }

  const entries = parsed.entries.map((entry, index) => {
    const id = String(entry?.id || '').trim();
    const answer = String(entry?.answer || '').trim();
    if (!id || !answer || !Array.isArray(entry.phrases) || entry.phrases.length === 0) {
      throw new Error(`FAQ entry ${index} needs id, answer, and phrases`);
    }
    return {
      id,
      question: String(entry.question || id),
      answer,
      phrases: entry.phrases.map((phrase) => normalizePhrase(phrase, id)),
      coversHandoff: Array.isArray(entry.coversHandoff) ? entry.coversHandoff.map(String) : [],
    };
  });

  const handoffTopics = (parsed.handoffTopics || []).map((topic, index) => {
    const id = String(topic?.id || '').trim();
    if (!id || !Array.isArray(topic.phrases)) {
      throw new Error(`handoff topic ${index} needs id and phrases`);
    }
    return {
      id,
      phrases: topic.phrases.map((phrase) => normalizePhrase(phrase, id)),
    };
  });

  return {
    greeting: String(parsed.greeting || 'Hey {user}, thanks for opening a ticket.').trim(),
    greetingPrompt: String(
      parsed.greetingPrompt
      || 'Send your question here whenever you are ready and I will answer if it is in the FAQ.'
    ).trim(),
    handoff: String(
      parsed.handoff
      || 'Thanks for reaching out. A member of the team will get back to you soon.'
    ).trim(),
    inviteRewardAck: String(
      parsed.inviteRewardAck
      || "Thanks, we're checking your invites, you'll get your reward here."
    ).trim(),
    fallbacks: Array.isArray(parsed.fallbacks)
      ? parsed.fallbacks.map((line) => String(line || '').trim()).filter(Boolean)
      : [],
    entries,
    handoffTopics,
    minScore: Number(parsed.minScore) > 0 ? Number(parsed.minScore) : 3,
    minMargin: Number(parsed.minMargin) >= 0 ? Number(parsed.minMargin) : 1,
    todos: Array.isArray(parsed.todos) ? parsed.todos.map(String) : [],
  };
}
