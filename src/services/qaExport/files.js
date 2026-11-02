import { gzipSync } from 'zlib';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const SAFE_ATTACHMENT_BYTES = Math.floor(7.5 * 1024 * 1024);

export function gzipJson(value) {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8'));
}

export function chunkItems(items, maxBytes = SAFE_ATTACHMENT_BYTES) {
  const chunks = [];
  let current = [];
  for (const item of items || []) {
    if (!current.length) {
      current = [item];
      continue;
    }
    const size = gzipJson([...current, item]).length;
    if (size > maxBytes) {
      chunks.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function attachmentPayloads(pairs, raw, stamp) {
  const pairChunks = chunkItems(pairs);
  const rawChunks = chunkItems(raw);
  const files = [];
  pairChunks.forEach((chunk, index) => {
    const suffix = pairChunks.length > 1 ? `-part${index + 1}` : '';
    files.push({
      name: `qa-pairs-${stamp}${suffix}.json.gz`,
      data: gzipJson(chunk),
    });
  });
  rawChunks.forEach((chunk, index) => {
    const suffix = rawChunks.length > 1 ? `-part${index + 1}` : '';
    files.push({
      name: `qa-raw-${stamp}${suffix}.json.gz`,
      data: gzipJson(chunk),
    });
  });
  return files;
}
