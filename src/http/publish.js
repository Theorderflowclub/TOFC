import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import Busboy from 'busboy';
import { PermissionFlagsBits } from 'discord.js';
import { logger, startupLog } from '../utils/logger.js';

// Hard-coded so a mis-set env var cannot point this endpoint at another server.
export const TOFC_GUILD_ID = '1126304434901749761';

const SNOWFLAKE = /^\d{17,20}$/;
const MIB = 1024 * 1024;
const SINGLE_FIELDS = new Set(['channelId', 'content', 'embeds', 'mentionEveryone']);
const EXT_BY_MIME = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
};

export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 10,
  maxFileBytes: 20 * MIB,
  maxTotalBytes: 25 * MIB,
  maxJsonBytes: 128 * 1024,
  maxFieldBytes: 128 * 1024,
  maxFields: 32,
  windowMs: 60_000,
  maxPerIp: 10,
  maxGlobal: 30,
  maxAuthFailuresPerIp: 20,
});

class HttpError extends Error {
  constructor(status, code, message, headers) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function httpError(status, code, message, headers) {
  return new HttpError(status, code, message, headers);
}

function parseAllowedChannels(value) {
  const ids = new Set();
  const invalid = [];
  if (typeof value !== 'string' || !value.trim()) {
    return { ids, invalid };
  }

  for (const part of value.split(',')) {
    const id = part.trim();
    if (!id) continue;
    if (SNOWFLAKE.test(id)) {
      ids.add(id);
    } else {
      invalid.push(id);
    }
  }

  return { ids, invalid };
}

export function readPublishConfig(env = process.env) {
  const secret = typeof env.PUBLISH_SECRET === 'string' ? env.PUBLISH_SECRET.trim() : '';
  const channels = parseAllowedChannels(env.PUBLISH_ALLOWED_CHANNELS);
  return {
    enabled: secret.length > 0,
    secret,
    secretHasWhitespace: /\s/.test(secret),
    allowedChannels: channels.ids,
    invalidChannelIds: channels.invalid,
  };
}

function extractBearer(authorization) {
  if (typeof authorization !== 'string') return '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim());
  return match ? match[1] : '';
}

// Hash both sides so the comparison stays constant-time when the lengths differ.
function sha256Equal(left, right) {
  const actual = createHash('sha256').update(left, 'utf8').digest();
  const expected = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(actual, expected);
}

export function bearerMatches(authorization, secret) {
  return sha256Equal(extractBearer(authorization), String(secret ?? ''));
}

export function buildAllowedMentions(mentionEveryone) {
  return { parse: mentionEveryone ? ['everyone'] : [] };
}

export function jumpUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function createWindowLimiter(now, windowMs) {
  const events = [];

  function prune(current) {
    const cutoff = current - windowMs;
    let write = 0;
    for (const event of events) {
      if (event.at > cutoff) {
        events[write] = event;
        write += 1;
      }
    }
    events.length = write;
  }

  return {
    count(ip) {
      const current = now();
      prune(current);
      let ipCount = 0;
      let oldest = current;
      for (const event of events) {
        if (event.ip === ip) ipCount += 1;
        if (event.at < oldest) oldest = event.at;
      }
      const retryAfter = events.length
        ? Math.max(1, Math.ceil((oldest + windowMs - current) / 1000))
        : 1;
      return { ipCount, globalCount: events.length, retryAfter };
    },
    push(ip) {
      events.push({ ip, at: now() });
    },
  };
}

function clientIp(req) {
  const value = req.ip || req.socket?.remoteAddress || '';
  const text = String(value).trim();
  if (!text || text.length > 64 || /[\r\n]/.test(text)) return 'unknown';
  return text;
}

function writeLog(log, message) {
  try {
    log?.warn?.(message);
  } catch {
    // A log failure must not change the HTTP result after Discord has accepted the post.
  }
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function sendJson(res, status, body, headers) {
  res.set('Cache-Control', 'no-store');
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      res.set(name, value);
    }
  }
  res.status(status).json(body);
}

function discardBody(req) {
  if (!req.readableEnded && !req.destroyed) {
    req.resume();
  }
}

function parseMentionEveryone(value) {
  if (value == null || value === '') return false;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw httpError(400, 'invalid_mention_everyone', 'mentionEveryone must be true or false.');
}

function parseContent(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') {
    throw httpError(400, 'invalid_message', 'content must be a string.');
  }
  if (value.length > 2000) {
    throw httpError(400, 'invalid_message', 'content must be 2000 characters or fewer.');
  }
  return value.trim() ? value : '';
}

function parseChannelId(value) {
  if (typeof value === 'number') {
    throw httpError(400, 'invalid_channel', 'channelId must be a string. JSON numbers cannot hold a Discord snowflake.');
  }
  if (typeof value !== 'string' || !SNOWFLAKE.test(value.trim())) {
    throw httpError(400, 'invalid_channel', 'channelId must be a Discord snowflake.');
  }
  return value.trim();
}

function requireText(value, label, max) {
  if (typeof value !== 'string') {
    throw httpError(400, 'invalid_embed', `${label} must be a string.`);
  }
  const text = value.trim();
  if (!text) {
    throw httpError(400, 'invalid_embed', `${label} cannot be empty.`);
  }
  if (text.length > max) {
    throw httpError(400, 'invalid_embed', `${label} must be ${max} characters or fewer.`);
  }
  return text;
}

function attachmentName(url) {
  const raw = url.slice('attachment://'.length).trim();
  if (!raw || raw.length > 128) return null;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  if (!name || name.length > 128 || name !== name.trim()) return null;
  if (/[\\/\0]/.test(name) || name.includes('..')) return null;
  return name;
}

function normalizeUrl(value, label, allowAttachment) {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(400, 'invalid_embed', `${label} must be a URL.`);
  }
  const url = value.trim();
  if (url.length > 2048) {
    throw httpError(400, 'invalid_embed', `${label} is too long.`);
  }
  if (allowAttachment && url.toLowerCase().startsWith('attachment://')) {
    const name = attachmentName(url);
    if (!name) {
      throw httpError(400, 'invalid_embed', `${label} has an invalid attachment:// filename.`);
    }
    return { url: `attachment://${name}`, attachment: name };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw httpError(400, 'invalid_embed', `${label} must be an http(s) URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw httpError(400, 'invalid_embed', `${label} must be an http(s) URL.`);
  }
  return { url, attachment: null };
}

function parseColor(value, index) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) {
    return value;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(text) || /^0x([0-9a-f]{6})$/i.exec(text);
    if (hex) return Number.parseInt(hex[1], 16);
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffff) return numeric;
    }
  }
  throw httpError(400, 'invalid_embed', `embeds[${index}].color must be an integer from 0 to 16777215 or #RRGGBB.`);
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) {
      return obj[key];
    }
  }
  return undefined;
}

function asPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'invalid_embed', `${label} must be an object.`);
  }
  return value;
}

function normalizeEmbed(raw, index, attachmentRefs) {
  const embed = asPlainObject(raw, `embeds[${index}]`);
  const out = {};
  const label = `embeds[${index}]`;

  if (pick(embed, 'title') != null) out.title = requireText(pick(embed, 'title'), `${label}.title`, 256);
  if (pick(embed, 'description') != null) {
    out.description = requireText(pick(embed, 'description'), `${label}.description`, 4096);
  }
  if (pick(embed, 'url') != null) {
    out.url = normalizeUrl(pick(embed, 'url'), `${label}.url`, false).url;
  }
  if (pick(embed, 'timestamp') != null) {
    const date = new Date(pick(embed, 'timestamp'));
    if (Number.isNaN(date.getTime())) {
      throw httpError(400, 'invalid_embed', `${label}.timestamp is not a valid date.`);
    }
    out.timestamp = date.toISOString();
  }
  if (pick(embed, 'color') != null) out.color = parseColor(pick(embed, 'color'), index);

  const footer = pick(embed, 'footer');
  if (footer != null) {
    const footerObject = asPlainObject(footer, `${label}.footer`);
    const text = requireText(pick(footerObject, 'text'), `${label}.footer.text`, 2048);
    const icon = pick(footerObject, 'icon_url', 'iconURL');
    out.footer = { text };
    if (icon != null) {
      const normalized = normalizeUrl(icon, `${label}.footer.icon_url`, true);
      out.footer.icon_url = normalized.url;
      if (normalized.attachment) attachmentRefs.push(normalized.attachment);
    }
  }

  for (const key of ['image', 'thumbnail']) {
    const media = pick(embed, key);
    if (media == null) continue;
    const mediaObject = asPlainObject(media, `${label}.${key}`);
    const normalized = normalizeUrl(pick(mediaObject, 'url'), `${label}.${key}.url`, true);
    out[key] = { url: normalized.url };
    if (normalized.attachment) attachmentRefs.push(normalized.attachment);
  }

  const author = pick(embed, 'author');
  if (author != null) {
    const authorObject = asPlainObject(author, `${label}.author`);
    out.author = { name: requireText(pick(authorObject, 'name'), `${label}.author.name`, 256) };
    const authorUrl = pick(authorObject, 'url');
    if (authorUrl != null) out.author.url = normalizeUrl(authorUrl, `${label}.author.url`, false).url;
    const icon = pick(authorObject, 'icon_url', 'iconURL');
    if (icon != null) {
      const normalized = normalizeUrl(icon, `${label}.author.icon_url`, true);
      out.author.icon_url = normalized.url;
      if (normalized.attachment) attachmentRefs.push(normalized.attachment);
    }
  }

  const fields = pick(embed, 'fields');
  if (fields != null) {
    if (!Array.isArray(fields)) {
      throw httpError(400, 'invalid_embed', `${label}.fields must be an array.`);
    }
    if (fields.length > 25) {
      throw httpError(400, 'invalid_embed', `${label}.fields cannot have more than 25 fields.`);
    }
    out.fields = fields.map((field, fieldIndex) => {
      const fieldObject = asPlainObject(field, `${label}.fields[${fieldIndex}]`);
      const normalized = {
        name: requireText(pick(fieldObject, 'name'), `${label}.fields[${fieldIndex}].name`, 256),
        value: requireText(pick(fieldObject, 'value'), `${label}.fields[${fieldIndex}].value`, 1024),
      };
      if (pick(fieldObject, 'inline') != null) {
        const inline = pick(fieldObject, 'inline');
        if (typeof inline !== 'boolean') {
          throw httpError(400, 'invalid_embed', `${label}.fields[${fieldIndex}].inline must be true or false.`);
        }
        normalized.inline = inline;
      }
      return normalized;
    });
  }

  const visible = out.title || out.description || out.footer || out.image || out.thumbnail || out.author || out.fields?.length;
  if (!visible) {
    throw httpError(400, 'invalid_embed', `${label} needs a title, description, author, footer, image, thumbnail, or field.`);
  }
  return out;
}

function embedCharCount(embed) {
  let count = 0;
  count += embed.title?.length || 0;
  count += embed.description?.length || 0;
  count += embed.footer?.text?.length || 0;
  count += embed.author?.name?.length || 0;
  for (const field of embed.fields || []) {
    count += field.name.length + field.value.length;
  }
  return count;
}

function normalizeEmbeds(value) {
  if (value == null || value === '') return { embeds: [], attachmentRefs: [] };
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw httpError(400, 'invalid_embed', 'embeds must be a JSON array of embed objects.');
    }
  }
  if (!Array.isArray(raw)) {
    throw httpError(400, 'invalid_embed', 'embeds must be an array.');
  }
  if (raw.length > 10) {
    throw httpError(400, 'invalid_embed', 'A message can include at most 10 embeds.');
  }

  const attachmentRefs = [];
  const embeds = raw.map((embed, index) => normalizeEmbed(embed, index, attachmentRefs));
  const total = embeds.reduce((sum, embed) => sum + embedCharCount(embed), 0);
  if (total > 6000) {
    throw httpError(400, 'invalid_embed', `Embeds are ${total} characters combined. Discord allows 6000.`);
  }
  return { embeds, attachmentRefs };
}

function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function validateFilename(filename, mime) {
  if (typeof filename !== 'string' || !filename.trim()) {
    throw httpError(400, 'invalid_filename', 'Each image needs a filename.');
  }
  if (/[\\/]/.test(filename)) {
    throw httpError(400, 'invalid_filename', 'Image filenames cannot include a directory.');
  }
  const base = path.basename(filename).trim();
  if (!base || base === '.' || base === '..' || base.length > 128) {
    throw httpError(400, 'invalid_filename', 'Image filenames must be 1-128 characters.');
  }
  if (!/^[\p{L}\p{N}._\- ()]+$/u.test(base)) {
    throw httpError(400, 'invalid_filename', `Filename "${base.slice(0, 64)}" has unsupported characters.`);
  }
  const extension = path.extname(base).toLowerCase();
  const expected = EXT_BY_MIME[mime] || [];
  if (!expected.includes(extension)) {
    throw httpError(
      400,
      'file_type_mismatch',
      `File "${base}" is a ${mime} image and needs a ${expected.join(' or ')} extension.`,
    );
  }
  return base;
}

function prepareFiles(rawFiles, limits) {
  if (rawFiles.length > limits.maxFiles) {
    throw httpError(400, 'too_many_files', `At most ${limits.maxFiles} images can be attached.`);
  }
  const names = new Set();
  let total = 0;
  const files = [];
  for (const raw of rawFiles) {
    total += raw.buffer.length;
    if (raw.buffer.length > limits.maxFileBytes || total > limits.maxTotalBytes) {
      throw httpError(
        413,
        'payload_too_large',
        `Each image must be at most ${limits.maxFileBytes} bytes, and the images combined must be at most ${limits.maxTotalBytes} bytes.`,
      );
    }
    const mime = detectImage(raw.buffer);
    if (!mime) {
      const label = raw.filename ? `"${String(raw.filename).slice(0, 64)}"` : 'an uploaded file';
      throw httpError(400, 'unsupported_file_type', `Only PNG, JPEG, GIF, and WebP images are allowed (${label}).`);
    }
    const name = validateFilename(raw.filename, mime);
    if (names.has(name)) {
      throw httpError(400, 'duplicate_filename', `More than one file is named "${name}".`);
    }
    names.add(name);
    files.push({ attachment: raw.buffer, name, contentType: mime });
  }
  return files;
}

function assertAttachmentsExist(refs, files) {
  const uploaded = new Set(files.map((file) => file.name));
  for (const name of refs) {
    if (!uploaded.has(name)) {
      throw httpError(
        400,
        'missing_attachment',
        `Embed references attachment://${name}, but no uploaded file has that filename.`,
      );
    }
  }
}

function mediaType(header) {
  if (Array.isArray(header)) return '';
  if (typeof header !== 'string') return '';
  return header.split(';', 1)[0].trim().toLowerCase();
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        finish(httpError(413, 'payload_too_large', `JSON body must be at most ${limit} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    req.on('error', () => finish(httpError(400, 'invalid_json', 'Could not read the request body.')));
  });
}

async function parseJsonBody(req, limits) {
  const raw = await readRawBody(req, limits.maxJsonBytes);
  let data;
  try {
    data = JSON.parse(raw.toString('utf8') || '');
  } catch {
    throw httpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw httpError(400, 'invalid_json', 'JSON body must be an object.');
  }
  return normalizePayload({
    channelId: data.channelId,
    content: data.content,
    embeds: data.embeds,
    mentionEveryone: data.mentionEveryone,
    files: [],
  }, limits);
}

function parseMultipart(req, limits) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: {
          files: limits.maxFiles,
          fileSize: limits.maxFileBytes + 1,
          fields: limits.maxFields,
          fieldSize: limits.maxFieldBytes + 1,
        },
      });
    } catch {
      reject(httpError(400, 'invalid_multipart', 'Could not read the multipart body. Check the form boundary.'));
      return;
    }

    const fields = new Map();
    const files = [];
    let pendingFiles = 0;
    let finished = false;
    let settled = false;
    let totalBytes = 0;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
      req.unpipe(busboy);
      busboy.destroy();
      if (!req.readableEnded && !req.destroyed) req.resume();
    };

    const succeed = () => {
      if (settled || pendingFiles > 0 || !finished) return;
      settled = true;
      resolve({ fields, files: files.filter(Boolean) });
    };

    busboy.on('field', (name, value, info) => {
      if (settled) return;
      if (info?.valueTruncated || Buffer.byteLength(value) > limits.maxFieldBytes) {
        fail(httpError(413, 'payload_too_large', `Form field "${String(name).slice(0, 40)}" exceeds the size limit.`));
        return;
      }
      if (SINGLE_FIELDS.has(name) && fields.has(name)) {
        fail(httpError(400, 'duplicate_field', `Field "${name}" was sent more than once.`));
        return;
      }
      fields.set(name, value);
    });

    busboy.on('file', (_name, stream, info) => {
      const index = files.length;
      files.push(null);
      pendingFiles += 1;
      const chunks = [];
      let truncated = false;
      stream.on('data', (chunk) => {
        if (settled) return;
        totalBytes += chunk.length;
        if (totalBytes > limits.maxTotalBytes) {
          stream.resume();
          fail(httpError(
            413,
            'payload_too_large',
            `Combined images must be at most ${limits.maxTotalBytes} bytes.`,
          ));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('error', () => {
        fail(httpError(400, 'invalid_multipart', 'Could not read an uploaded file.'));
      });
      stream.on('end', () => {
        pendingFiles -= 1;
        if (settled) return;
        const buffer = Buffer.concat(chunks);
        if (truncated || buffer.length > limits.maxFileBytes) {
          fail(httpError(413, 'payload_too_large', `Each image must be at most ${limits.maxFileBytes} bytes.`));
          return;
        }
        files[index] = {
          filename: info.filename,
          mimeType: info.mimeType,
          buffer,
        };
        succeed();
      });
    });

    busboy.on('filesLimit', () => {
      fail(httpError(400, 'too_many_files', `At most ${limits.maxFiles} images can be attached.`));
    });
    busboy.on('fieldsLimit', () => {
      fail(httpError(400, 'too_many_fields', 'Too many form fields.'));
    });
    busboy.on('error', () => {
      fail(httpError(400, 'invalid_multipart', 'Could not read the multipart body.'));
    });
    busboy.on('finish', () => {
      finished = true;
      succeed();
    });
    req.on('error', () => {
      fail(httpError(400, 'invalid_multipart', 'Could not read the multipart body.'));
    });

    req.pipe(busboy);
  });
}

function normalizePayload(input, limits) {
  const channelId = parseChannelId(input.channelId);
  const content = parseContent(input.content);
  const mentionEveryone = parseMentionEveryone(input.mentionEveryone);
  const { embeds, attachmentRefs } = normalizeEmbeds(input.embeds);
  const files = prepareFiles(input.files || [], limits);
  assertAttachmentsExist(attachmentRefs, files);
  if (!content && embeds.length === 0 && files.length === 0) {
    throw httpError(400, 'empty_message', 'Send content, an embed, or an image.');
  }
  return { channelId, content, embeds, files, mentionEveryone };
}

async function parseRequest(req, limits) {
  const type = mediaType(req.headers['content-type']);
  if (type === 'application/json') {
    return parseJsonBody(req, limits);
  }
  if (type === 'multipart/form-data') {
    const { fields, files } = await parseMultipart(req, limits);
    return normalizePayload({
      channelId: fields.get('channelId'),
      content: fields.get('content'),
      embeds: fields.get('embeds'),
      mentionEveryone: fields.get('mentionEveryone'),
      files,
    }, limits);
  }
  throw httpError(415, 'unsupported_media_type', 'Content-Type must be application/json or multipart/form-data.');
}

async function resolveChannel(client, channelId) {
  if (!client || typeof client.isReady !== 'function' || !client.isReady()) {
    throw httpError(503, 'bot_not_ready', 'The bot is not connected to Discord yet.');
  }

  let guild = client.guilds?.cache?.get(TOFC_GUILD_ID);
  if (!guild) {
    try {
      guild = await client.guilds.fetch(TOFC_GUILD_ID);
    } catch (error) {
      const wrapped = httpError(503, 'guild_unavailable', 'The bot cannot see the TOFC server right now.');
      wrapped.cause = error;
      throw wrapped;
    }
  }
  if (!guild || guild.id !== TOFC_GUILD_ID || typeof guild.channels?.fetch !== 'function') {
    throw httpError(503, 'guild_unavailable', 'The bot cannot see the TOFC server right now.');
  }

  let channel;
  try {
    channel = await guild.channels.fetch(channelId);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.code === 10003 || error?.code === 10004) {
      throw httpError(404, 'channel_not_found', `Channel ${channelId} was not found in the TOFC server.`);
    }
    const wrapped = httpError(502, 'channel_lookup_failed', 'The bot could not look up that channel.');
    wrapped.cause = error;
    throw wrapped;
  }

  if (!channel) {
    throw httpError(404, 'channel_not_found', `Channel ${channelId} was not found in the TOFC server.`);
  }
  const guildId = channel.guildId || channel.guild?.id;
  if (guildId !== TOFC_GUILD_ID || channel.isDMBased?.()) {
    throw httpError(403, 'guild_not_allowed', 'Publishing is only allowed in the TOFC server.');
  }
  if (channel.isTextBased?.() !== true || typeof channel.send !== 'function') {
    throw httpError(400, 'channel_not_text', 'That channel cannot receive messages.');
  }
  return channel;
}

async function botMember(channel) {
  const guild = channel.guild;
  if (guild?.members?.me) return guild.members.me;
  if (typeof guild?.members?.fetchMe === 'function') {
    try {
      return await guild.members.fetchMe();
    } catch (error) {
      const wrapped = httpError(403, 'missing_permissions', 'The bot member is not available in the TOFC server yet.');
      wrapped.cause = error;
      throw wrapped;
    }
  }
  return null;
}

async function assertPermissions(channel, { embeds, files, mentionEveryone }) {
  const me = await botMember(channel);
  if (!me) {
    throw httpError(403, 'missing_permissions', 'The bot member is not available in the TOFC server yet.');
  }
  const perms = channel.permissionsFor(me);
  if (!perms?.has) {
    throw httpError(403, 'missing_permissions', 'Could not resolve the bot permissions in that channel.');
  }

  const required = [['View Channel', PermissionFlagsBits.ViewChannel]];
  if (channel.isThread?.()) {
    required.push(['Send Messages in Threads', PermissionFlagsBits.SendMessagesInThreads]);
  } else {
    required.push(['Send Messages', PermissionFlagsBits.SendMessages]);
  }
  if (embeds.length) required.push(['Embed Links', PermissionFlagsBits.EmbedLinks]);
  if (files.length) required.push(['Attach Files', PermissionFlagsBits.AttachFiles]);
  if (mentionEveryone) required.push(['Mention Everyone', PermissionFlagsBits.MentionEveryone]);

  const missing = required.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
  if (missing.length) {
    throw httpError(403, 'missing_permissions', `The bot is missing permissions in that channel: ${missing.join(', ')}.`);
  }
}

function mapDiscordError(error) {
  const code = error?.code;
  const safe = sanitizeText(error?.message);
  if (error?.name === 'RateLimitError' || error?.status === 429) {
    const retryMs = Number(error?.retryAfter);
    const retryAfter = Number.isFinite(retryMs) ? Math.max(1, Math.ceil(retryMs / 1000)) : 1;
    return httpError(429, 'discord_rate_limited', 'Discord rate limited the bot. Try again shortly.', {
      'Retry-After': String(retryAfter),
    });
  }
  if (code === 50013 || code === 50001) {
    return httpError(403, 'missing_permissions', safe || 'The bot is missing permissions in that channel.');
  }
  if (code === 10003 || code === 10004) {
    return httpError(404, 'channel_not_found', 'Channel was not found in the TOFC server.');
  }
  if (code === 50006) {
    return httpError(400, 'empty_message', 'Discord rejected an empty message.');
  }
  if (code === 50035) {
    return httpError(400, 'invalid_message', safe || 'Discord rejected the message.');
  }
  if (code === 40005 || error?.status === 413) {
    return httpError(413, 'payload_too_large', 'Discord rejected the upload as too large.');
  }
  return httpError(502, 'discord_send_failed', 'Discord did not accept the message.');
}

function rateLimitError(retryAfter) {
  return httpError(429, 'rate_limited', `Too many publish requests. Try again in ${retryAfter} seconds.`, {
    'Retry-After': String(retryAfter),
  });
}

function authorize(req, config, limiters, limits, ip) {
  if (!config.enabled) {
    throw httpError(503, 'publish_disabled', 'Publish endpoint is disabled because PUBLISH_SECRET is not set.');
  }
  const authorized = bearerMatches(req.headers?.authorization, config.secret);
  if (!authorized) {
    const failures = limiters.auth.count(ip);
    if (failures.ipCount >= limits.maxAuthFailuresPerIp) {
      throw rateLimitError(failures.retryAfter);
    }
    limiters.auth.push(ip);
    throw httpError(401, 'unauthorized', 'Missing or invalid bearer token.', {
      'WWW-Authenticate': 'Bearer',
    });
  }

  const publishes = limiters.publish.count(ip);
  if (publishes.ipCount >= limits.maxPerIp || publishes.globalCount >= limits.maxGlobal) {
    throw rateLimitError(publishes.retryAfter);
  }
  limiters.publish.push(ip);
}

function assertChannelAllowed(channelId, config) {
  if (config.allowedChannels.has(channelId)) return;
  const suffix = config.allowedChannels.size === 0 ? ' PUBLISH_ALLOWED_CHANNELS is empty.' : '';
  throw httpError(403, 'channel_not_allowed', `Channel ${channelId} is not in PUBLISH_ALLOWED_CHANNELS.${suffix}`);
}

export function createPublishHandler(options = {}) {
  if (typeof options.getClient !== 'function') {
    throw new Error('createPublishHandler requires getClient');
  }

  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const now = options.now || (() => Date.now());
  const readConfig = options.readConfig || (() => readPublishConfig());
  const log = options.logger || logger;
  const limiters = {
    auth: createWindowLimiter(now, limits.windowMs),
    publish: createWindowLimiter(now, limits.windowMs),
  };

  return async function publishHandler(req, res) {
    let ip = '-';
    let channelId = '-';
    try {
      ip = clientIp(req);
      const config = readConfig();
      authorize(req, config, limiters, limits, ip);

      const payload = await parseRequest(req, limits);
      channelId = payload.channelId;
      assertChannelAllowed(payload.channelId, config);

      const channel = await resolveChannel(options.getClient(), payload.channelId);
      await assertPermissions(channel, payload);

      const messagePayload = {
        allowedMentions: buildAllowedMentions(payload.mentionEveryone),
      };
      if (payload.content) messagePayload.content = payload.content;
      if (payload.embeds.length) messagePayload.embeds = payload.embeds;
      if (payload.files.length) messagePayload.files = payload.files;

      let sent;
      try {
        sent = await channel.send(messagePayload);
      } catch (error) {
        writeLog(log, `Publish discord error code=${error?.code ?? error?.name ?? '-'} message=${sanitizeText(error?.message)}`);
        throw mapDiscordError(error);
      }

      const messageId = String(sent?.id ?? '');
      if (!SNOWFLAKE.test(messageId)) {
        throw httpError(502, 'discord_send_failed', 'Discord did not return a message id.');
      }

      const body = {
        messageId,
        channelId: channel.id,
        url: jumpUrl(TOFC_GUILD_ID, channel.id, messageId),
      };
      const fileNames = payload.files.map((file) => file.name).join(',') || '-';
      writeLog(
        log,
        `Publish posted messageId=${messageId} channelId=${channel.id} guildId=${TOFC_GUILD_ID} embeds=${payload.embeds.length} files=${payload.files.length} fileNames=${fileNames} mentionEveryone=${payload.mentionEveryone} contentLength=${payload.content.length} ip=${ip}`,
      );
      sendJson(res, 201, body);
    } catch (error) {
      if (error instanceof HttpError) {
        const cause = error.cause ? ` cause=${sanitizeText(error.cause.message)}` : '';
        writeLog(log, `Publish rejected status=${error.status} error=${error.code} channelId=${channelId} ip=${ip}${cause}`);
        if (!res.headersSent) sendJson(res, error.status, { error: error.code, message: error.message }, error.headers);
        discardBody(req);
        return;
      }
      writeLog(log, `Publish failed status=500 error=internal_error channelId=${channelId} ip=${ip} message=${sanitizeText(error?.message)}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', message: 'The publish request failed.' });
      }
      discardBody(req);
    }
  };
}

function previewId(value) {
  const text = String(value).replace(/[\r\n]/g, '');
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

export function mountPublishRoute(app, client, options = {}) {
  const readConfig = options.readConfig || readPublishConfig;
  const snapshot = readConfig();
  if (!snapshot.enabled) {
    startupLog('Publish endpoint disabled: POST /internal/publish refuses every request until PUBLISH_SECRET is set');
  } else if (!snapshot.allowedChannels || snapshot.allowedChannels.size === 0) {
    startupLog('Publish endpoint enabled for POST /internal/publish, but PUBLISH_ALLOWED_CHANNELS is empty so every channel is rejected');
  } else {
    const count = snapshot.allowedChannels.size;
    startupLog(`Publish endpoint enabled: POST /internal/publish (${count} allowed channel${count === 1 ? '' : 's'})`);
  }
  if (snapshot.secretHasWhitespace) {
    logger.warn('PUBLISH_SECRET contains whitespace. Generate a hex secret with no spaces or authentication will fail.');
  }
  if (snapshot.invalidChannelIds?.length) {
    const shown = snapshot.invalidChannelIds.slice(0, 10).map(previewId).join(', ');
    logger.warn(`PUBLISH_ALLOWED_CHANNELS ignored invalid ids: ${shown}`);
  }

  app.post('/internal/publish', createPublishHandler({
    getClient: () => client,
    readConfig,
    logger: options.logger,
    limits: options.limits,
    now: options.now,
  }));
}
