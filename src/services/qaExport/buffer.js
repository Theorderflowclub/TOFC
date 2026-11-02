import { pairQaMessages, rawMessages } from './pairQa.js';
import { recordFromDiscordMessage } from './collect.js';
import { nameMatchesNeedles } from './matchChannels.js';
import { isTicketChannel } from '../ticketAutoReply/detect.js';
import { getTicketAutoReplyConfig } from '../../config/ticketAutoReply.js';
import { isQaOwner } from './owners.js';
import { logger } from '../../utils/logger.js';

const messagesById = new Map();

export function resetQaBuffer() {
  messagesById.clear();
}

export function rememberQaRecord(record) {
  if (!record?.id || record.bot) return;
  messagesById.set(record.id, record);
}

export function bufferedRecordsSince(sinceMs) {
  return [...messagesById.values()].filter((record) => record.createdAt >= sinceMs);
}

export function bufferedExportSince(sinceMs) {
  const records = bufferedRecordsSince(sinceMs);
  return {
    pairs: pairQaMessages(records),
    raw: rawMessages(records),
  };
}

export function shouldCaptureMessage(message) {
  const channel = message?.channel;
  if (!channel || message.author?.bot) return false;
  if (channel.isThread?.()) return shouldCaptureMessage({ ...message, channel: channel.parent, author: message.author });
  if (nameMatchesNeedles(channel.name)) return true;
  try {
    return isTicketChannel(channel, getTicketAutoReplyConfig());
  } catch (error) {
    logger.warn(`Q&A capture: could not check ticket channel ${channel?.name}: ${error.message}`);
    return false;
  }
}

export function noteLiveQaMessage(message) {
  try {
    if (!shouldCaptureMessage(message)) return;
    const channel = message.channel;
    const thread = channel.isThread?.() ? channel : null;
    const parent = thread?.parent || channel;
    const record = recordFromDiscordMessage(message, {
      owner: isQaOwner(message.member),
      channelName: parent?.name || channel.name,
      threadName: thread ? thread.name : null,
      inThread: Boolean(thread),
      containerId: thread ? thread.id : channel.id,
    });
    rememberQaRecord(record);
  } catch (error) {
    logger.error('Q&A capture failed:', error);
  }
}
