import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { canRunQaExport } from '../services/qaExport/owners.js';
import { collectQaRecords, findTranscriptChannel } from '../services/qaExport/collect.js';
import { pairQaMessages, rawMessages, summarizeQaExport } from '../services/qaExport/pairQa.js';
import { sendQaPackage } from '../services/qaExport/post.js';

function rangeForDays(days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default {
  data: new SlashCommandBuilder()
    .setName('export-qa')
    .setDescription('Export Q&A history from the trading and question channels')
    .addIntegerOption((option) => option
      .setName('days')
      .setDescription('How many days back to include (default 90, max 730)')
      .setMinValue(1)
      .setMaxValue(730)
      .setRequired(false))
    .addStringOption((option) => option
      .setName('channels')
      .setDescription('Optional comma-separated channel names or IDs. Leave empty for the usual channels.')
      .setRequired(false)),

  async execute(interaction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'Use this command in the server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!canRunQaExport(interaction.member)) {
      await interaction.reply({
        content: 'Only an Administrator or someone with the FOUNDERS TOFC role can export Q&A history.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const days = interaction.options.getInteger('days') || 90;
    const channelsOption = interaction.options.getString('channels') || '';
    const { from, to } = rangeForDays(days);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.editReply(`Reading the last ${days} days. This can take a few minutes.`);
      const records = await collectQaRecords(interaction.guild, {
        days,
        channelsOption,
        onProgress: async (name) => {
          await interaction.editReply(`Reading #${name}...`).catch(() => {});
        },
      });
      const pairs = pairQaMessages(records);
      const raw = rawMessages(records);
      const summary = summarizeQaExport(pairs, raw, { from, to });
      const destination = findTranscriptChannel(interaction.guild) || interaction.channel;
      await sendQaPackage(destination, {
        pairs,
        raw,
        from,
        to,
        title: `Q&A export (${days} days)`,
      });
      const where = destination?.id === interaction.channelId ? 'this channel' : `${destination}`;
      await interaction.editReply(`Posted the export in ${where}.\n${summary}`.slice(0, 2000));
    } catch (error) {
      logger.error('Q&A export command failed:', error);
      await interaction.editReply('The export failed before it could finish. Check the bot logs and try again.').catch(() => {});
    }
  },
};
