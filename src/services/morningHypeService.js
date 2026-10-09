import { logger } from '../utils/logger.js';

export async function sendMorningHype(client) {
  try {
    const channel = await client.channels.fetch(process.env.TRADING_CHAT_CHANNEL_ID);

    if (!channel) {
      logger.error('Morning hype: could not find the trading-chat channel.');
      return;
    }

    const message = await channel.send({
      content: `Match starting soon, who's ready to drop into NY session and secure the loot? @everyone`,
      allowedMentions: { parse: ['everyone'] },
    });

    await message.react('🟢');
    await message.react('🔴');

    logger.info('Morning hype message sent successfully.');
  } catch (error) {
    logger.error('Error sending morning hype message:', error);
  }
}
