import { bearerMatches, readPublishConfig } from './publish.js';
import {
  getDefaultNoTradeStore,
  loadNoTradeDays,
  sanitizeLogText,
} from '../services/noTradeDays.js';
import { logger, startupLog } from '../utils/logger.js';

const JSON_LIMIT = 4096;

function httpError(status, code, message, headers) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.headers = headers;
  return error;
}

function clientIp(req) {
  const text = String(req.ip || req.socket?.remoteAddress || '').trim();
  if (!text || text.length > 64 || /[\r\n]/.test(text)) return 'unknown';
  return text;
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

function discard(req) {
  if (!req.readableEnded && !req.destroyed) req.resume();
}

function warn(log, message) {
  try {
    (log || logger).warn(message);
  } catch {
    // A log failure must not change the HTTP result.
  }
}

function isJsonContentType(header) {
  if (Array.isArray(header) || typeof header !== 'string') return false;
  const [type, ...params] = header.split(';');
  if (type.trim().toLowerCase() !== 'application/json') return false;
  for (const param of params) {
    const match = /^\s*charset\s*=\s*["']?([^"';]+)["']?\s*$/i.exec(param);
    if (match && match[1].toLowerCase() !== 'utf-8') return false;
  }
  return true;
}

function createAuthLimiter(now, windowMs, max) {
  const events = [];

  function prune(current) {
    const cutoff = current - windowMs;
    let write = 0;
    for (const event of events) {
      if (event.at > cutoff) events[write++] = event;
    }
    events.length = write;
  }

  return {
    blocked(ip) {
      const current = now();
      prune(current);
      let count = 0;
      let oldest = current;
      for (const event of events) {
        if (event.ip !== ip) continue;
        count += 1;
        if (event.at < oldest) oldest = event.at;
      }
      if (count < max) return null;
      return Math.max(1, Math.ceil((oldest + windowMs - current) / 1000));
    },
    add(ip) {
      events.push({ ip, at: now() });
    },
  };
}

function readJsonObject(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
      discard(req);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        fail(httpError(413, 'payload_too_large', `JSON body must be at most ${limit} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '');
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          reject(httpError(400, 'invalid_json', 'JSON body must be an object.'));
          return;
        }
        resolve(data);
      } catch {
        reject(httpError(400, 'invalid_json', 'Request body is not valid JSON.'));
      }
    });
    req.on('error', () => fail(httpError(400, 'invalid_json', 'Could not read the request body.')));
  });
}

export function createNoTradeDaysHandler(options = {}) {
  const readConfig = options.readConfig || readPublishConfig;
  const log = options.logger || logger;
  const store = options.store || getDefaultNoTradeStore();
  const loadEntries = options.loadEntries || loadNoTradeDays;
  const now = options.now || (() => Date.now());
  const limiter = createAuthLimiter(now, options.windowMs ?? 60_000, options.maxAuthFailures ?? 20);

  return async function noTradeDaysHandler(req, res) {
    const ip = clientIp(req);
    try {
      const config = readConfig();
      if (!config.enabled) {
        throw httpError(503, 'no_trade_disabled', 'No-trade day endpoint is disabled because PUBLISH_SECRET is not set.');
      }
      if (!bearerMatches(req.headers?.authorization, config.secret)) {
        const retryAfter = limiter.blocked(ip);
        if (retryAfter) {
          throw httpError(429, 'rate_limited', `Too many authentication failures. Try again in ${retryAfter} seconds.`, {
            'Retry-After': String(retryAfter),
          });
        }
        limiter.add(ip);
        throw httpError(401, 'unauthorized', 'Missing or invalid bearer token.', {
          'WWW-Authenticate': 'Bearer',
        });
      }
      if (!isJsonContentType(req.headers?.['content-type'])) {
        throw httpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
      }

      const body = await readJsonObject(req, JSON_LIMIT);
      if (body.action !== 'mark' && body.action !== 'unmark') {
        throw httpError(400, 'invalid_action', 'action must be "mark" or "unmark".');
      }

      const entries = loadEntries();
      const result = body.action === 'mark'
        ? store.mark(body.date, body.reason, entries)
        : store.unmark(body.date, entries);
      if (!result.ok && result.code === 'invalid_reason') {
        throw httpError(400, 'invalid_reason', 'reason must be a string of 200 characters or fewer.');
      }
      if (!result.ok && result.code === 'closed_day') {
        throw httpError(409, 'closed_day', 'That date is CLOSED in the no-trade list and cannot be changed at runtime.');
      }
      if (!result.ok) {
        throw httpError(400, 'invalid_date', 'date must be a real YYYY-MM-DD calendar date.');
      }

      warn(
        log,
        `No-trade day ${body.action} date=${result.date} status=${result.listed?.status ?? 'cleared'} source=${result.listed?.source ?? 'none'} ip=${ip}`,
      );
      sendJson(res, 200, {
        date: result.date,
        action: body.action,
        status: result.listed?.status ?? null,
        reason: result.listed?.reason ?? null,
        source: result.listed?.source ?? null,
      });
    } catch (error) {
      if (error?.status && error?.code) {
        warn(log, `No-trade day update rejected status=${error.status} error=${error.code} ip=${ip}`);
        if (!res.headersSent) sendJson(res, error.status, { error: error.code, message: error.message }, error.headers);
        discard(req);
        return;
      }
      warn(log, `No-trade day update failed status=500 error=internal_error ip=${ip} message=${sanitizeLogText(error?.message)}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error', message: 'The no-trade day update failed.' });
      }
      discard(req);
    }
  };
}

export function mountNoTradeDaysRoute(app, options = {}) {
  const readConfig = options.readConfig || readPublishConfig;
  const snapshot = readConfig();
  if (!snapshot.enabled) {
    startupLog('No-trade day endpoint disabled: POST /internal/no-trade-days refuses every request until PUBLISH_SECRET is set');
  } else {
    startupLog('No-trade day endpoint enabled: POST /internal/no-trade-days');
  }

  app.post('/internal/no-trade-days', createNoTradeDaysHandler({
    ...options,
    readConfig,
  }));
}
