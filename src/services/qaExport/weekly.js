import { logger } from '../../utils/logger.js';
import { rememberQaRecord, bufferedExportSince } from './buffer.js';
import { collectQaRecords, collectTicketRecords, findTranscriptChannel } from './collect.js';
import { sendQaPackage } from './post.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function rebuildQaBuffer(client) {
  const sinceMs = Date.now() - WEEK_MS;
  for (const guild of client.guilds.cache.values()) {
    try {
      const named = await collectQaRecords(guild, { sinceMs, days: 7 });
      const tickets = await collectTicketRecords(guild, sinceMs);
      for (const record of [...named, ...tickets]) rememberQaRecord(record);
      logger.info(`Q&A buffer rebuilt ${named.length + tickets.length} messages for ${guild.name}.`);
    } catch (error) {
      logger.error(`Q&A buffer rebuild failed for ${guild.name}:`, error);
    }
  }
}

export async function postWeeklyQa(client) {
  const sinceMs = Date.now() - WEEK_MS;
  const from = new Date(sinceMs).toISOString();
  const to = new Date().toISOString();

  for (const guild of client.guilds.cache.values()) {
    try {
      const named = await collectQaRecords(guild, { sinceMs, days: 7 });
      const tickets = await collectTicketRecords(guild, sinceMs);
      for (const record of [...named, ...tickets]) rememberQaRecord(record);

      const { pairs, raw } = bufferedExportSince(sinceMs);
      const destination = findTranscriptChannel(guild);
      if (!destination) {
        logger.warn(`Weekly Q&A: no #ticket-transcripts channel in ${guild.name}. Nothing was posted.`);
        continue;
      }
      await sendQaPackage(destination, {
        pairs,
        raw,
        from,
        to,
        title: 'Weekly Q&A',
      });
      logger.info(`Weekly Q&A posted ${pairs.length} pairs for ${guild.name}.`);
    } catch (error) {
      logger.error(`Weekly Q&A failed for ${guild.name}:`, error);
    }
  }
}
