import { logger } from '../utils/logger.js';
import { getTicketAutoReplyConfig } from '../config/ticketAutoReply.js';
import { noteNewTicketChannel } from '../services/ticketAutoReply/service.js';

export default {
  name: 'channelCreate',
  async execute(channel) {
    try {
      const config = getTicketAutoReplyConfig();
      if (!config.enabled) return;
      noteNewTicketChannel(channel);
    } catch (error) {
      logger.error('TOFC ticket auto-reply channelCreate error:', error);
    }
  },
};
