# TitanBot - Ultimate Discord Bot

**TitanBot** is a powerful, feature-rich Discord bot designed to enhance your server experience with comprehensive moderation tools, engaging economy systems, utility features, and much more. Built with modern Discord.js v14 and PostgreSQL for optimal performance and data persistence.

[![Support Server](https://img.shields.io/badge/-Support%20Server-%235865F2?logo=discord&logoColor=white&style=flat-square&logoWidth=20)](https://discord.gg/8kJBYhTGW9)
[![Discord.js](https://img.shields.io/npm/v/discord.js?style=flat-square&labelColor=%23202225&color=%23202225&logo=npm&logoColor=white&logoWidth=20)](https://www.npmjs.com/package/discord.js)
![PostgreSQL](https://img.shields.io/badge/-PostgreSQL-%23336791?logo=postgresql&logoColor=white&style=flat-square&logoWidth=20)

## Table of Contents

- [Features Overview](#features-overview)
- [Quick Setup](#quick-setup)
- [Manual Installation Steps](#manual-installation-steps)
- [Publish posts from an external job](#publish-posts-from-an-external-job)
- [Support Server](https://discord.gg/QnWNz2dKCE)
- [Required Bot Intents](#bot-intents)
- [Contributing](CONTRIBUTING.md)

<a name="features-overview"></a>
## Features Overview

TitanBot offers a complete suite of tools for Discord server management and community engagement:

<table>
<tr>
<td width="50%" valign="top">

### Moderation & Administration
- **Mass Actions** - Bulk ban/kick capabilities
- **User Notes** - Keep detailed moderation records
- **Case Management** - View and track all mod actions

### Economy System
- **Shop & Inventory** - Buy and manage items
- **Gambling** - Risk it for rewards
- **Pay System** - Transfer money between users

### Fun & Entertainment
- **Random Facts** - Learn something new
- **Wanted Poster** - Create fun wanted images
- **Text Reversal** - Reverse any text

### Advanced Ticket System
- **Claim & Priority** - Staff ticket management
- **Ticket Limits** - Prevent spam
- **Transcript System** - Save ticket history

### Server Stats
- **Member Counter** - Live member count channels
- **Voice Counters** - Track voice stats
- **Dynamic Updates** - Real-time channel updates

### Reaction Roles
- **Role Assignment** - Self-assignable roles
- **Emoji Selection** - Reaction-based system
- **Multi-role Support** - Multiple role options

</td>
<td width="50%" valign="top">

### Leveling & XP System
- **XP Tracking** - Automatic message-based XP
- **Level Roles** - Auto-assign roles by level
- **Custom Configuration** - Personalize leveling

### Giveaways & Events
- **Multiple Winners** - Support multi-winner giveaways
- **Auto Picking** - Automatic winner selection
- **Reroll System** - Pick new winners if needed

### Birthday System
- **Birthday Tracking** - Never miss a birthday
- **Auto Announcements** - Celebrate automatically
- **Timezone Support** - Accurate worldwide tracking

### Utility Tools
- **Report System** - Report issues to staff
- **Todo Lists** - Personal task management
- **First Message** - Jump to channel's first message

### Welcome System
- **Welcome Messages** - Greet new members
- **Auto Roles** - Assign roles on join
- **Custom Embeds** - Personalized messages
  
### Music
- **24/7 Mode** - Play music 24/7
- **Interative Button System** - Manage music through buttons
- **Supports EVERY platform** - Supports spotify, deezer, youtube, apple music
  
</td>
</tr>
</table>

<a name="quick-setup"></a>
## Quick Setup (Recommended for non-coders)

### Video Tutorial
For a detailed step-by-step setup guide, watch our comprehensive video tutorial:
[**TitanBot Setup Tutorial**](https://www.youtube.com/@TouchDisc)

## Docker Deployment (Recommended)

TitanBot is fully containerized for easy deployment.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/codebymitch/TitanBot.git
   cd TitanBot
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Set at minimum `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`. Docker Compose also reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from `.env` (defaults: `titanbot` / `password` / `titanbot`).

3. **Build and start the containers:**
   ```bash
   docker compose up -d --build
   ```

4. **Check status:**
   ```bash
   docker compose ps
   curl http://localhost:3000/health
   ```

This starts the bot and PostgreSQL. The compose file sets `POSTGRES_SSL=false` and `AUTO_MIGRATE=true` for the bundled database. Music uses public Lavalink v4 nodes from `lavalink/nodes.json` by default.

### Music

Music uses [Lavalink v4](https://github.com/lavalink-devs/Lavalink) via [Riffy](https://github.com/riffy-rb/riffy), similar to [Musicify](https://github.com/codebymitch/Musicify).

1. By default, the bot loads multiple public v4 SSL nodes from [`lavalink/nodes.json`](lavalink/nodes.json) (sourced from [lavalink.darrennathanael.com](https://lavalink.darrennathanael.com/SSL/Lavalink-SSL/)). Edit that file to add or remove nodes.
2. To self-host Lavalink instead, run `docker compose --profile local-lavalink up -d` and set single-node env vars in `.env`:
   ```env
   LAVALINK_HOST=lavalink
   LAVALINK_PORT=2333
   LAVALINK_PASSWORD=youshallnotpass
   LAVALINK_SECURE=false
   ```
   Remove or rename `lavalink/nodes.json` so the bot falls back to those env vars.
3. Override nodes inline with `LAVALINK_NODES` (JSON array) or point at another file with `LAVALINK_NODES_FILE`.
4. Use `/play <song>` from a voice channel, or `/join` to connect without playing. Prefix shortcuts: `join`, `np`, `leave`, `pause`, `resume`, `skip`, `stop`, `volume <0-100>`, or `music <subcommand>`. Use `/nowplaying` and `/queue` for status; `/music` for loop, shuffle, seek, and other controls.

### Using GitHub Container Registry

The bot is automatically published to GitHub Container Registry on every push to main.

```bash
docker pull ghcr.io/codebymitch/titanbot:main
```

<a name="manual-installation-steps"></a>
## Manual Installation Steps

### Prerequisites
- Node.js 20.10.0 or higher
- PostgreSQL server (recommended) or memory storage fallback
- Discord bot application with proper intents

1. **Clone the Repository**
   ```bash
   git clone https://github.com/codebymitch/TitanBot.git
   cd TitanBot
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your configuration (only the following variables require configuration, leave remaining variables as default):
   ```env
   # Discord Bot Configuration
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_discord_client_id_here
   GUILD_ID=your_discord_guild_id_here

   # PostgreSQL Configuration (Primary Database)
   POSTGRES_URL=postgresql://postgres:yourpassword@localhost:5432/titanbot
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_DB=titanbot
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=yourpassword
   ```

   Production note:
   - `NODE_ENV=production`
   - `LOG_LEVEL=warn` for a clean production console (critical issues + startup status)
   - `LOG_LEVEL=info` if you want more detailed operational logs
   - If your chosen `PORT` is already used, TitanBot automatically tries the next port(s)

   Environment options reference:
   - `NODE_ENV`: `development`, `production`, `test` (any non-`production` value is treated as non-production)
   - `LOG_LEVEL`: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`
   - Accepted aliases for `LOG_LEVEL` in this bot: `warns`, `warning`, `warnings` → `warn`

   Recommended production `.env` (easy mode + default mode):
   ```env
   NODE_ENV=production
   LOG_LEVEL=warn
   WEB_HOST=0.0.0.0
   PORT=3000
   PORT_RETRY_ATTEMPTS=5
   ```
   This gives clear startup/online status messages while keeping logs simple for non-technical operators.
   If port `3000` is busy, the bot tries the next available ports automatically (up to `PORT_RETRY_ATTEMPTS`).

### Multiple servers

Slash commands are registered **globally** on startup (via `CLIENT_ID`), so the bot works in every server it is invited to. `GUILD_ID` stays in the tutorial `.env` for setup steps but is not used for command registration.

Notes:
- Global slash commands may take up to about an hour to propagate on first deploy
- Each server has **isolated** data: config, economy, tickets, leveling, dashboards, warnings, etc. (all keys are scoped as `guild:{guildId}:...`)
- In the [Discord Developer Portal](https://discord.com/developers/applications), ensure your bot is not restricted to a single guild if you plan to invite it elsewhere
- Generate an OAuth2 invite URL from the [Discord Developer Portal](https://discord.com/developers/applications) (OAuth2 → URL Generator, scopes: `bot` and `applications.commands`)

4. **Setup PostgreSQL Database** (Optional but recommended)
   ```bash
   # Create database and user
   createdb titanbot
   createuser titanbot
   psql -c "ALTER USER titanbot PASSWORD 'yourpassword';"
   psql -c "GRANT ALL PRIVILEGES ON DATABASE titanbot TO titanbot;"
   ```

5. **Verify Database Setup**
   ```bash
   npm run migrate:check
   ```

6. **Start the Bot**
   ```bash
   npm start
   ```

> **Note on database migrations:** Schema tables and legacy key migrations run
> **automatically on startup**, so` managed hosts like **Railway** need no manual
> migration step — just deploy/restart. To disable auto-migration set
> `AUTO_MIGRATE=false`. You can still run a manual key migration locally with
> `node scripts/migrate-keys.js --dry-run` (preview) or `node scripts/migrate-keys.js`.
## Export Q&A history

Administrators and members with the **FOUNDERS TOFC** role can run `/export-qa` in the server.

- `days` is how far back to look. It defaults to 90 and cannot be more than 730.
- `channels` is optional. Leave it empty to use every text channel or forum whose name contains `tofc-trading-chat`, `questions`, `questions-access`, or `faq`. Emoji and bracket prefixes such as `〔🗽〕` are ignored. Forum posts and threads under those channels are included, including archived ones.
- The command reads history in pages of 100. It can take several minutes. The result is posted in `#ticket-transcripts` when that channel exists, otherwise in the channel where you ran the command.
- You get two gzipped JSON files: Q&A pairs, and a raw file of member and owner messages so the pairs can be rebuilt later. Files larger than 8MB are split.

The bot also saves new pairs from those channels and from ticket channels as messages arrive. Every Sunday at 20:00 Europe/Amsterdam it posts that week's pairs in `#ticket-transcripts`. Nothing is sent to members, and ticket replies are unchanged.

Slash commands, including `/export-qa`, are registered when the bot starts. After this is deployed, restart the bot (Railway does that on deploy). If `GUILD_ID` is set, the command shows up in that server right away. Without a guild id, Discord can take up to an hour to show a new global command.

<a name="publish-posts-from-an-external-job"></a>

## Publish posts from an external job

`POST /internal/publish` lets a scheduled job post in the TOFC Discord **as the bot**. The caller never receives the Discord bot token. The token stays in the host environment. The caller authenticates with a separate bearer secret.

The route is on the same HTTP server as `/health`. It does nothing until both variables below are set. Merging the code is safe before they exist: with `PUBLISH_SECRET` unset, every request is refused.

After merging, set these on the Railway service and restart (a new deploy also restarts the process):

```env
PUBLISH_SECRET=<openssl rand -hex 32>
PUBLISH_ALLOWED_CHANNELS=1564051322485870803,1566110195938107643,1129232583503384618
```

| Variable | Purpose |
| --- | --- |
| `PUBLISH_SECRET` | Bearer secret. Use a long random hex string with no spaces. If it is unset or blank, the route answers `503 publish_disabled` for every request. |
| `PUBLISH_ALLOWED_CHANNELS` | Comma-separated channel snowflakes. Any other channel is rejected. If this is empty, every channel is rejected. |

Suggested allowlist (not applied automatically):

| Channel | ID |
| --- | --- |
| TOFC alerts | `1564051322485870803` |
| Best weekly traders | `1566110195938107643` |
| Announcements | `1129232583503384618` |

Posts are only delivered in guild `1126304434901749761`. The bot needs **View Channel**, **Send Messages**, **Embed Links**, and **Attach Files** in each target channel. Pinging `@everyone` also needs **Mention Everyone**.

Mentions are off unless the request opts in. `allowedMentions.parse` is `[]` by default, so `@everyone`, roles, and user mentions in the text do not notify anyone. Set `mentionEveryone` to `true` to allow `@everyone` and `@here`. The message text still has to contain `@everyone` or `@here` for Discord to deliver the ping. User and role mentions stay suppressed.

### JSON (text and embeds, no files)

```bash
curl -sS -X POST "$BASE_URL/internal/publish" \
  -H "Authorization: Bearer $PUBLISH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "1566110195938107643",
    "content": "Weekly trader spotlight",
    "embeds": [{
      "title": "Best weekly traders",
      "description": "Results are in.",
      "color": "#336699"
    }]
  }'
```

### Multipart (image plus an embed that uses it)

`channelId` is required. `content`, `embeds`, and `mentionEveryone` are optional. Attach up to 10 images with the field name `file` (any file field name is accepted). `embeds` is a JSON array. An embed image can reference an upload with `attachment://filename`. The filename must match the uploaded file exactly.

```bash
curl -sS -X POST "$BASE_URL/internal/publish" \
  -H "Authorization: Bearer $PUBLISH_SECRET" \
  -F "channelId=1564051322485870803" \
  -F "content=@everyone Sunday news is up." \
  -F "mentionEveryone=true" \
  -F 'embeds=[{"title":"Sunday news","description":"Levels for the week are in.","image":{"url":"attachment://levels.png"},"color":"#336699"}]' \
  -F "file=@levels.png;type=image/png"
```

A successful response is `201` JSON. If the connection drops after Discord accepts the message, a retry can post a second copy. Wait for this response, or check the channel, before sending the same post again.

```json
{
  "messageId": "123456789012345678",
  "channelId": "1564051322485870803",
  "url": "https://discord.com/channels/1126304434901749761/1564051322485870803/123456789012345678"
}
```

Errors are JSON `{ "error", "message" }`. `429` responses include `Retry-After` (seconds).

| HTTP | `error` | When |
| --- | --- | --- |
| 503 | `publish_disabled` | `PUBLISH_SECRET` is not set. |
| 503 | `bot_not_ready` | The bot has not finished logging in. |
| 503 | `guild_unavailable` | The bot cannot see the TOFC server. |
| 401 | `unauthorized` | Bearer token is missing or wrong. |
| 403 | `channel_not_allowed` | The channel is not in `PUBLISH_ALLOWED_CHANNELS`. |
| 403 | `guild_not_allowed` | The channel is not in the TOFC server. |
| 403 | `missing_permissions` | The bot cannot speak, attach files, embed links, or mention everyone. |
| 404 | `channel_not_found` | The channel is not in the TOFC server. |
| 400 | `invalid_channel` | `channelId` is missing or not a snowflake string. |
| 400 | `invalid_json` / `invalid_multipart` | The body could not be read. |
| 400 | `invalid_message` | Content is too long, or Discord rejected the payload (`50035`). |
| 400 | `invalid_embed` | An embed is the wrong shape or over Discord's limits. |
| 400 | `invalid_mention_everyone` | `mentionEveryone` is not `true` or `false`. |
| 400 | `empty_message` | No content, embed, or image. |
| 400 | `unsupported_file_type` | A file is not PNG, JPEG, GIF, or WebP. |
| 400 | `file_type_mismatch` | The extension does not match the image bytes. |
| 400 | `invalid_filename` / `duplicate_filename` | Filename missing, unsafe, or repeated. |
| 400 | `missing_attachment` | `attachment://name` does not match an uploaded file. |
| 400 | `duplicate_field` / `too_many_fields` | The same text field was repeated, or there are too many fields. |
| 400 | `too_many_files` | More than 10 images. |
| 400 | `channel_not_text` | That channel cannot receive messages. |
| 413 | `payload_too_large` | JSON, one image, or the combined upload is too large. |
| 415 | `unsupported_media_type` | Content-Type is not JSON or multipart. |
| 429 | `rate_limited` | More than 10 authorized requests per minute from one IP (invalid payloads count), 30 per minute overall, or 20 bad tokens per minute from one IP. |
| 429 | `discord_rate_limited` | Discord rate limited the bot. |
| 502 | `channel_lookup_failed` / `discord_send_failed` | Discord could not be reached or rejected the send. |
| 500 | `internal_error` | Unexpected failure before Discord accepted the message. |

The existing app-wide limiter can also return `429` with `{ "error": "Too many requests" }` (100 requests per 15 minutes per connecting IP). That shape is older and is not specific to publish.

Limits, matching Discord's create-message caps: content 2000 characters, 10 embeds and 6000 embed characters combined, 10 images, 20 MiB per image, 25 MiB combined. JSON bodies are limited to 128 KiB. Only PNG, JPEG, GIF, and WebP are accepted, checked from the file bytes. `https` image URLs inside an embed are rendered by Discord. This endpoint does not download them. Upload the bytes and use `attachment://filename` when the bot should host the image.

Each accepted publish and each rejection is logged without the bearer secret, the Discord token, or the message text. Successful lines look like `Publish posted messageId=... channelId=...`. They are written at warn level so they still show when `LOG_LEVEL=warn`.

`/say`, tickets, FAQ replies, `/export-qa`, health checks, and the scheduled jobs are unchanged. `/say` remains a human slash command for plain text.

<a name="bot-intents"></a>

## Required Bot Intents
TitanBot requires the following Discord intents:
- **Guilds**
- **Guild Messages**
- **Message Content**
- **Guild Members**
- **Guild Message Reactions**
- **Guild Voice States**
- **Direct Messages**
- **Bot**
- **Applications.commands**

### Required Permissions
- **View Channels**
- **Send Messages**
- **Embed Links**
- **Attach Files**
- **Read Message History**
- **Manage Messages**
- **Manage Channels**
- **Manage Roles**
- **Kick Members**
- **Manage Messages**
- **Ban Members**
- **Moderate Members**
- **Connect**

## License

TitanBot is released under the MIT License. See [LICENSE](LICENSE) for details.

## Thank You

Thank you for choosing TitanBot for your Discord server! We're constantly working to improve and add new features based on community feedback.

*Last updated: May 2026*
