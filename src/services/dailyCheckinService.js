import { logger } from '../utils/logger.js';

async function postCheckin(client, channelId, content, allowedMentions) {
  const channel = await client.channels.fetch(channelId);

  if (!channel) {
    logger.error(`Daily check-in: could not find channel ${channelId}.`);
    return;
  }

  const message = await channel.send({ content, allowedMentions });

  await message.react('🟢');
  await message.react('🔴');
  await message.react('🟠');
}

export async function sendDailyCheckin(client) {
  try {
    // Premium channel - ping the premium role
    await postCheckin(
      client,
      process.env.PREMIUM_CHANNEL_ID,
      `How did we do today? <@&${process.env.PREMIUM_ROLE_ID}>`,
      { parse: [], roles: [process.env.PREMIUM_ROLE_ID] }
    );

    // Trading-chat channel - ping everyone
    await postCheckin(
      client,
      process.env.TRADING_CHAT_CHANNEL_ID,
      `How did we do today? @everyone`,
      { parse: ['everyone'] }
    );

    logger.info('Daily check-in messages sent successfully.');
  } catch (error) {
    logger.error('Error sending daily check-in message:', error);
  }
}
