import express from 'express';
import pkg from '../../package.json' with { type: 'json' };
import { EXPECTED_SCHEMA_LABEL, EXPECTED_SCHEMA_VERSION } from '../config/database/schemaVersion.js';
import { mountPublishRoute } from './publish.js';

export function createWebApp(client, options = {}) {
  const app = express();
  const corsOrigin = client.config?.api?.cors?.origin || '*';
  const windowMs = client.config?.api?.rateLimit?.windowMs || 60000;
  const maxRequests = client.config?.api?.rateLimit?.max || 100;

  app.use((req, res, next) => {
    const allowedOrigins = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin];
    const origin = req.headers.origin;

    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  const requestCounts = new Map();

  app.use((req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!requestCounts.has(ip)) {
      requestCounts.set(ip, []);
    }

    const times = requestCounts.get(ip).filter((t) => t > windowStart);

    if (times.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    times.push(now);
    requestCounts.set(ip, times);
    next();
  });

  app.get('/health', (req, res) => {
    const dbStatus = client.db?.getStatus?.() || { isDegraded: 'unknown' };
    const status = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        connected: dbStatus.connectionType !== 'none',
        degraded: dbStatus.isDegraded,
        type: dbStatus.connectionType,
      },
    };
    res.status(200).json(status);
  });

  app.get('/ready', (req, res) => {
    const dbStatus = client.db?.getStatus?.() || { isDegraded: true, connectionType: 'none' };
    const isReady = client.isReady() && !dbStatus.isDegraded;

    const metrics = {
      guildCount: client.guilds?.cache?.size ?? 0,
      commandCount: client.commands?.size ?? 0,
      database: {
        mode: dbStatus.connectionType,
        degraded: dbStatus.isDegraded,
        degradedReason: dbStatus.degradedReason ?? null,
      },
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      schemaLabel: EXPECTED_SCHEMA_LABEL,
    };

    if (isReady) {
      return res.status(200).json({
        ready: true,
        message: 'Bot is ready',
        metrics,
      });
    }

    res.status(503).json({
      ready: false,
      reason: !client.isReady() ? 'Bot not Ready' : 'Database degraded',
      metrics,
    });
  });

  app.get('/', (req, res) => {
    res.status(200).json({
      message: 'TitanBot System Online',
      version: pkg.version,
      timestamp: new Date().toISOString(),
    });
  });

  mountPublishRoute(app, client, options.publish);
  return app;
}
