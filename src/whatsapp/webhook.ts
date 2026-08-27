import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { logger } from './logger.js';
import { parseEvent } from './parser.js';
import { handleIncomingEvent, isMessageProcessed, recordEvent } from './service.js';
import type { WhatsAppProvider } from './client.js';

const TAG = 'WEBHOOK';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createWebhookHandler({ db, whatsapp, webhookToken, tokenHeader = 'x-wawebplus-token' }: {
  db: DatabaseSync;
  whatsapp: WhatsAppProvider;
  webhookToken: string;
  tokenHeader?: string;
}) {
  const normalizedHeader = tokenHeader.toLowerCase();

  return async function handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const token = req.headers[normalizedHeader] as string | undefined;
      if (!webhookToken || !token || !safeEqual(webhookToken, token)) {
        logger.warn(TAG, 'Requisicao rejeitada: token ausente ou invalido');
        res.status(401).json({ ok: false, error: 'nao autorizado' });
        return;
      }

      const contentType = String(req.headers['content-type'] || '');
      if (!contentType.includes('application/json')) {
        res.status(400).json({ ok: false, error: 'content-type deve ser application/json' });
        return;
      }

      const body = req.body;

      const parsed = parseEvent(body);
      if (!parsed.ok) {
        logger.warn(TAG, `Payload invalido: ${parsed.reason}`);
        res.status(400).json({ ok: false, error: parsed.reason });
        return;
      }

      const event = parsed.event;

      if (event.isGroup) {
        logger.info(TAG, 'Mensagem de grupo ignorada');
        res.json({ ok: true, ignored: 'grupo' });
        return;
      }

      if (event.messageId && isMessageProcessed(db, event.messageId)) {
        logger.info(TAG, `Mensagem duplicada ignorada: ${event.messageId}`);
        res.json({ ok: true, duplicated: true });
        return;
      }

      const inserted = recordEvent(db, event, JSON.stringify(body));
      if (!inserted) {
        logger.info(TAG, `Mensagem duplicada ignorada: ${event.messageId}`);
        res.json({ ok: true, duplicated: true });
        return;
      }

      const outcome = await handleIncomingEvent({ db, whatsapp, event });
      if (event.messageId) {
        const finalStatus = outcome.replied ? 'REPLIED' : 'PROCESSED';
        db.prepare('UPDATE whatsapp_webhook_events SET status = ? WHERE message_id = ?').run(finalStatus, event.messageId);
      }

      res.json({ ok: true, replied: outcome.replied });
    } catch (err) {
      logger.error(TAG, `Erro interno no webhook: ${(err as Error).stack || (err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'erro interno' });
      }
    }
  };
}
