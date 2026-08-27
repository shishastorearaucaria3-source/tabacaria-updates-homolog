import type { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { getWhatsAppConfig } from './config.js';
import { WAWebPlusProvider } from './client.js';
import { createWebhookHandler } from './webhook.js';
import { logger } from './logger.js';
import { registerPanelRoutes } from './panel/routes.js';

const TAG = 'WHATSAPP';

let whatsappProvider: WAWebPlusProvider | null = null;
let running = false;

export interface WhatsAppStatus {
  running: boolean;
  mock: boolean;
  apiUrl: string;
  configured: boolean;
}

export function getStatus(db: DatabaseSync): WhatsAppStatus {
  const cfg = getWhatsAppConfig(db);
  return {
    running,
    mock: cfg.mock,
    apiUrl: cfg.apiUrl,
    configured: Boolean(cfg.webhookToken),
  };
}

export function startWhatsApp(db: DatabaseSync): void {
  if (running) {
    logger.warn(TAG, 'WhatsApp ja esta em execucao');
    return;
  }

  const cfg = getWhatsAppConfig(db);

  if (!cfg.webhookToken) {
    logger.warn(TAG, 'WhatsApp desabilitado: wa_webhook_token ausente');
    return;
  }

  whatsappProvider = new WAWebPlusProvider({
    apiUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    authHeader: cfg.authHeader,
    authScheme: cfg.authScheme,
    mock: cfg.mock,
  });

  running = true;
  logger.info(TAG, `WhatsApp bot iniciado (mock=${cfg.mock}, api=${cfg.apiUrl})`);
}

export function stopWhatsApp(): void {
  if (!running) return;
  whatsappProvider = null;
  running = false;
  logger.info(TAG, 'WhatsApp bot parado');
}

export function registerWhatsAppRoutes(
  app: express.Express,
  db: DatabaseSync,
  validarSessaoPanel?: (token: string) => boolean
): void {
  const cfg = getWhatsAppConfig(db);

  // Start WhatsApp on server boot
  startWhatsApp(db);

  // Webhook endpoint — receives events from WA Web Plus extension
  // Only register if provider was created (webhook token exists)
  if (whatsappProvider) {
    const webhookHandler = createWebhookHandler({
      db,
      whatsapp: whatsappProvider,
      webhookToken: cfg.webhookToken,
      tokenHeader: cfg.webhookTokenHeader,
    });
    app.post('/webhooks/wa-web-plus', webhookHandler);
  }

  // Management API (authenticated via the NossoSistema session)
  const panelRouter = express.Router();
  registerPanelRoutes(panelRouter, db, validarSessaoPanel);
  app.use('/api/whatsapp', panelRouter);

  // Convenience endpoints on main app
  app.get('/api/servidor/whatsapp', (_req, res) => {
    res.json({ ok: true, ...getStatus(db) });
  });

  app.post('/api/servidor/whatsapp/start', (_req, res) => {
    startWhatsApp(db);
    res.json({ ok: true, ...getStatus(db) });
  });

  app.post('/api/servidor/whatsapp/stop', (_req, res) => {
    stopWhatsApp();
    res.json({ ok: true, ...getStatus(db) });
  });
}
