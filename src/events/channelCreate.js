import { logger } from '../utils/logger.js';
import { getTicketAutoReplyConfig } from '../config/ticketAutoReply.js';
import { handleNewTicketChannel } from '../services/ticketAutoReply/service.js';

export default {
  name: 'channelCreate',
  async execute(channel, client) {
    try {
      const config = getTicketAutoReplyConfig();
      if (!config.enabled) return;
      await handleNewTicketChannel(channel, client);
    } catch (error) {
      logger.error('TOFC ticket auto-reply channelCreate error:', error);
    }
  },
};
