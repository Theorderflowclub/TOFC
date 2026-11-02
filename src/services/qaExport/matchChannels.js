export const DEFAULT_CHANNEL_NEEDLES = [
  'tofc-trading-chat',
  'questions',
  'questions-access',
  'faq',
];

export const TRANSCRIPT_CHANNEL_NAME = 'ticket-transcripts';

export function looseName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function nameMatchesNeedles(name, needles = DEFAULT_CHANNEL_NEEDLES) {
  const loose = looseName(name);
  if (!loose) return false;
  return needles.some((needle) => {
    const wanted = looseName(needle);
    return wanted && loose.includes(wanted);
  });
}

export function channelMatchesFilter(channel, channelsOption) {
  const raw = String(channelsOption || '').trim();
  if (!raw) return nameMatchesNeedles(channel?.name);
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.some((part) => {
    if (part === channel?.id) return true;
    return nameMatchesNeedles(channel?.name, [part]);
  });
}

export function isTranscriptChannelName(name) {
  return looseName(name) === looseName(TRANSCRIPT_CHANNEL_NAME);
}
