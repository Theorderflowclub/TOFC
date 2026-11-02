import { AttachmentBuilder } from 'discord.js';
import { attachmentPayloads } from './files.js';
import { summarizeQaExport } from './pairQa.js';

export async function sendQaPackage(channel, { pairs, raw, from, to, title }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const summary = [title, summarizeQaExport(pairs, raw, { from, to })].filter(Boolean).join('\n');
  const files = attachmentPayloads(pairs, raw, stamp);
  if (!files.length) {
    await channel.send({ content: summary.slice(0, 2000) });
    return summary;
  }

  for (let index = 0; index < files.length; index += 10) {
    const batch = files.slice(index, index + 10).map((file) => new AttachmentBuilder(file.data, { name: file.name }));
    const content = index === 0 ? summary : `${title || 'Q&A export'} continued.`;
    await channel.send({ content: content.slice(0, 2000), files: batch });
  }
  return summary;
}
