import type { DatabaseSync } from 'node:sqlite';
import { logger } from './logger.js';
import { nowIso } from './text.js';
import { handleMessage } from './engine.js';
import type { WhatsAppProvider } from './client.js';
import type { WhatsAppEvent } from './parser.js';

const TAG = 'CONVERSATION';

export function isMessageProcessed(db: DatabaseSync, messageId: string | null): boolean {
  if (!messageId) return false;
  const row = db.prepare('SELECT 1 FROM whatsapp_webhook_events WHERE message_id = ?').get(messageId);
  return Boolean(row);
}

export function recordEvent(db: DatabaseSync, event: WhatsAppEvent, payloadJson: string, status = 'RECEIVED'): boolean {
  const result = db
    .prepare(
      `INSERT INTO whatsapp_webhook_events (message_id, phone, event_type, payload_json, status, received_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO NOTHING`
    )
    .run(event.messageId || null, event.phone, event.type, payloadJson, status, nowIso());
  return Number(result.changes) > 0;
}

export function upsertCustomer(db: DatabaseSync, phone: string, name: string | null): void {
  const ts = nowIso();
  const existing = db.prepare('SELECT id FROM clientes WHERE telefone = ?').get(phone);
  if (existing) {
    if (name) {
      db.prepare('UPDATE clientes SET nome = COALESCE(?, nome), atualizado_em = ? WHERE telefone = ?').run(name, ts, phone);
    } else {
      db.prepare('UPDATE clientes SET atualizado_em = ? WHERE telefone = ?').run(ts, phone);
    }
  } else {
    db.prepare('INSERT INTO clientes (nome, telefone, criado_em, atualizado_em) VALUES (?, ?, ?, ?)').run(
      name || 'Cliente WhatsApp', phone, ts, ts
    );
  }
}

export async function handleIncomingEvent({ db, whatsapp, event }: { db: DatabaseSync; whatsapp: WhatsAppProvider; event: WhatsAppEvent }): Promise<{ replied: boolean; sendResult?: { ok: boolean; mock?: boolean; error?: string } }> {
  const t0 = Date.now();
  logger.info('PERF', `[${event.phone}] webhook_received t=${t0}`);
  logger.info(TAG, `mensagem recebida de ${event.phone}${event.name ? ` (${event.name})` : ''}`);

  upsertCustomer(db, event.phone, event.name);
  logMessage(db, event.phone, 'in', event.text);

  if (!event.text) {
    logger.info(TAG, 'evento sem texto; nada a responder');
    return { replied: false };
  }

  const st = db.prepare('SELECT attendance_status FROM whatsapp_conversation_state WHERE phone = ?').get(event.phone) as { attendance_status: string } | undefined;
  if (st && st.attendance_status && st.attendance_status !== 'BOT') {
    logger.info(TAG, `[${event.phone}] status=${st.attendance_status} — sem resposta automatica`);
    logMessage(db, event.phone, 'out', null);
    return { replied: false };
  }

  const tEngineStart = Date.now();
  let reply: string | null = null;
  try {
    reply = handleMessage(db, event);
  } catch (err) {
    const e = err as Error;
    logger.error(TAG, `erro no motor: ${e.stack || e.message}`);
    reply = '😕 Tive um problema momentâneo. Digite menu para tentar novamente.';
  }
  const engineMs = Date.now() - tEngineStart;
  logger.info('PERF', `[${event.phone}] engine_start=${tEngineStart} engine_end=${Date.now()} engine_ms=${engineMs}`);

  if (!reply) {
    logger.info(TAG, `[${event.phone}] atendimento humano ativo — sem resposta automatica`);
    return { replied: false };
  }

  logMessage(db, event.phone, 'out', reply);

  const tSendStart = Date.now();
  const result = await whatsapp.sendMessage(event.phone, reply);
  const tSendEnd = Date.now();
  logger.info(
    'PERF',
    `[${event.phone}] total=${tSendEnd - t0}ms webhook_para_engine=${tEngineStart - t0}ms engine=${engineMs}ms engine_para_send=${tSendStart - tEngineStart - engineMs}ms send=${tSendEnd - tSendStart}ms`
  );
  return { replied: result.ok, sendResult: result };
}

function logMessage(db: DatabaseSync, phone: string, direction: string, text: string | null): void {
  try {
    if (!text) return;
    const safe = String(text).replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***cpf***');
    db.prepare('INSERT INTO whatsapp_messages (phone, direction, text, created_at) VALUES (?, ?, ?, ?)')
      .run(phone, direction, safe.slice(0, 2000), nowIso());
  } catch {
    // logging nunca quebra o atendimento
  }
}
