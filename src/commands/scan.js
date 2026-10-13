import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';

const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;
const MAX_MESSAGES_PER_CHANNEL = 20000;

const BUCKETS = [
  { value: '10', label: '10+ days inactive', min: 10 },
  { value: '20', label: '20+ days inactive', min: 20 },
  { value: '30', label: '30+ days inactive', min: 30 },
  { value: '40', label: '40+ days inactive', min: 40 },
];

export default {
  data: new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Scan the server (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('inactiveusers')
        .setDescription('List members who have not sent a message recently')
        .addIntegerOption((opt) =>
          opt
            .setName('scan_days')
            .setDescription('How many days of history to scan (default 60, max 180)')
            .setMinValue(40)
            .setMaxValue(180)
        )
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== 'inactiveusers') return;

    const scanDays = interaction.options.getInteger('scan_days') ?? 60;
    await interaction.deferReply({ flags: ['Ephemeral'] });

    const guild = interaction.guild;
    const cutoff = Date.now() - scanDays * DAY;
    const me = guild.members.me;

    // Channels the bot can read
    await guild.channels.fetch();
    const channels = [...guild.channels.cache.values()].filter(
      (c) =>
        (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) &&
        c.permissionsFor(me)?.has(['ViewChannel', 'ReadMessageHistory'])
    );

    const lastSeen = new Map(); // userId -> timestamp of latest message
    let done = 0;

    for (const channel of channels) {
      let before;
      let fetched = 0;
      while (true) {
        const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
        if (!batch || batch.size === 0) break;

        let reachedCutoff = false;
        for (const m of batch.values()) {
          if (m.createdTimestamp < cutoff) {
            reachedCutoff = true;
            continue;
          }
          if (m.author.bot) continue;
          const prev = lastSeen.get(m.author.id);
          if (!prev || m.createdTimestamp > prev) lastSeen.set(m.author.id, m.createdTimestamp);
        }

        fetched += batch.size;
        if (reachedCutoff || batch.size < 100 || fetched >= MAX_MESSAGES_PER_CHANNEL) break;
        before = batch.last().id;
      }

      done += 1;
      if (done % 3 === 0 || done === channels.length) {
        await interaction
          .editReply({ content: `Scanning... ${done}/${channels.length} channels` })
          .catch(() => {});
      }
    }

    // Work out inactivity for every human member
    const members = await guild.members.fetch();
    const now = Date.now();
    const rows = [];
    for (const member of members.values()) {
      if (member.user.bot) continue;
      const last = lastSeen.get(member.id);
      if (last) {
        rows.push({ id: member.id, days: Math.floor((now - last) / DAY), noMessage: false, plus: false });
      } else {
        const joinedDays = Math.floor((now - (member.joinedTimestamp ?? now)) / DAY);
        const plus = joinedDays >= scanDays;
        rows.push({ id: member.id, days: plus ? scanDays : joinedDays, noMessage: true, plus });
      }
    }

    let bucket = BUCKETS[0];
    let page = 0;

    const filtered = () =>
      rows.filter((r) => r.days >= bucket.min).sort((a, b) => b.days - a.days);

    const render = () => {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      page = Math.min(page, pages - 1);
      const slice = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

      const lines = slice.map((r, i) => {
        const n = page * PAGE_SIZE + i + 1;
        const days = `${r.days}${r.plus ? '+' : ''} days`;
        const note = r.noMessage ? ' (no messages found)' : '';
        return `${n}. <@${r.id}> — **${days}**${note}`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`Inactive members: ${bucket.label}`)
        .setDescription(lines.length ? lines.join('\n') : 'No members in this range.')
        .setColor(0xe67e22)
        .setFooter({
          text: `${list.length} members | Page ${page + 1}/${pages} | Scanned ${scanDays} days across ${channels.length} channels`,
        });

      const select = new StringSelectMenuBuilder()
        .setCustomId('scan_bucket')
        .setPlaceholder('Choose inactivity range')
        .addOptions(
          BUCKETS.map((b) => ({ label: b.label, value: b.value, default: b.value === bucket.value }))
        );

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('scan_prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('scan_next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= pages - 1)
      );

      return {
        content: '',
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select), buttons],
      };
    };

    const message = await interaction.editReply(render());

    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 15 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
      if (i.componentType === ComponentType.StringSelect) {
        bucket = BUCKETS.find((b) => b.value === i.values[0]) ?? BUCKETS[0];
        page = 0;
      } else if (i.customId === 'scan_prev') {
        page = Math.max(0, page - 1);
      } else if (i.customId === 'scan_next') {
        page += 1;
      }
      await i.update(render());
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
