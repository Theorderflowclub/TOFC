import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';

// Removes "Flex Premium" from anyone who no longer has "Premium".
// Needs two env vars on Railway: PREMIUM_ROLE_ID (already set) and FLEX_PREMIUM_ROLE_ID.
export function registerFlexRoleSync(client) {
  const flexRoleId = process.env.FLEX_PREMIUM_ROLE_ID;
  const premiumRoleId = process.env.PREMIUM_ROLE_ID;

  if (!flexRoleId || !premiumRoleId) {
    logger.warn('Flex role sync disabled: set FLEX_PREMIUM_ROLE_ID and PREMIUM_ROLE_ID.');
    return;
  }

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      const hasFlex = newMember.roles.cache.has(flexRoleId);
      const hasPremium = newMember.roles.cache.has(premiumRoleId);

      if (hasFlex && !hasPremium) {
        await newMember.roles.remove(flexRoleId, 'Premium removed, so Flex Premium removed too');
        logger.info(`Removed Flex Premium from ${newMember.user.tag} (Premium no longer assigned).`);
      }
    } catch (error) {
      logger.error('Flex role sync failed:', error);
    }
  });

  logger.info('Flex Premium auto-removal is active.');
}
