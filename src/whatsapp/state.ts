import type { DatabaseSync } from 'node:sqlite';
import { getSettings } from './settings.js';

export const STATES = {
  FRESH: 'MENU_PRINCIPAL',
  MENU_PRINCIPAL: 'MENU_PRINCIPAL',
  CATEGORIAS: 'CATEGORIAS',
  PRODUTOS_CATEGORIA: 'PRODUTOS_CATEGORIA',
  LISTA_RESULTADOS: 'LISTA_RESULTADOS',
  DETALHE_PRODUTO: 'DETAIL',
  PEDIDO_QTD: 'PEDIDO_QTD',
  MONTANDO_PEDIDO: 'MONTANDO_PEDIDO',
  CHECKOUT_NOME: 'CHECKOUT_NOME',
  CHECKOUT_ENTREGA: 'CHECKOUT_ENTREGA',
  CHECKOUT_ENDERECO: 'CHECKOUT_ENDERECO',
  CHECKOUT_ENTREGA_CONFIRMA: 'CHECKOUT_ENTREGA_CONFIRMA',
  CHECKOUT_PAGAMENTO: 'CHECKOUT_PAGAMENTO',
  CHECKOUT_CPF: 'CHECKOUT_CPF',
  CHECKOUT_CONFIRMAR: 'CHECKOUT_CONFIRMAR',
  MEUS_PEDIDOS: 'MEUS_PEDIDOS',
  DETALHE_PEDIDO: 'DETALHE_PEDIDO',
  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
} as const;

export type ConversationState = typeof STATES[keyof typeof STATES];

export interface ConversationContext {
  state: ConversationState;
  lastProductId: number | null;
  list: { kind: string; mode?: string; items: Array<{ id: number; name: string }>; originCategory?: string } | null;
  pendingQuestion: string | null;
  checkoutData: Record<string, unknown> | null;
  attendanceStatus: string;
  updatedAt: string | null;
  phone?: string;
}

const DEFAULT_ROW: ConversationContext = {
  state: STATES.FRESH,
  lastProductId: null,
  list: null,
  pendingQuestion: null,
  checkoutData: null,
  attendanceStatus: 'BOT',
  updatedAt: null,
};

function rowToContext(row: Record<string, unknown> | undefined): ConversationContext {
  if (!row) return { ...DEFAULT_ROW };
  let list: ConversationContext['list'] = null;
  if (row.last_products_json) {
    try { list = JSON.parse(row.last_products_json as string); } catch { list = null; }
  }
  let checkoutData: Record<string, unknown> | null = null;
  if (row.checkout_data) {
    try { checkoutData = JSON.parse(row.checkout_data as string); } catch { checkoutData = null; }
  }
  return {
    state: (row.last_intent as ConversationState) || STATES.FRESH,
    lastProductId: (row.last_product_id as number) || null,
    list,
    pendingQuestion: (row.pending_question as string) || null,
    checkoutData,
    attendanceStatus: (row.attendance_status as string) || 'BOT',
    updatedAt: (row.updated_at as string) || null,
  };
}

export function isExpired(ctx: ConversationContext, db: DatabaseSync): boolean {
  if (!ctx.updatedAt) return false;
  const settings = getSettings(db);
  const ageMs = Date.now() - new Date(ctx.updatedAt).getTime();
  return ageMs > settings.conversationTimeoutMinutes * 60 * 1000;
}

export function defaultContext(): ConversationContext {
  return { ...DEFAULT_ROW };
}

export function loadContext(db: DatabaseSync, phone: string): ConversationContext {
  const row = db.prepare('SELECT * FROM whatsapp_conversation_state WHERE phone = ?').get(phone) as Record<string, unknown> | undefined;
  const ctx = rowToContext(row);
  if (isExpired(ctx, db)) {
    saveContext(db, phone, defaultContext());
    return defaultContext();
  }
  return ctx;
}

export function saveContext(db: DatabaseSync, phone: string, ctx: ConversationContext): void {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO whatsapp_conversation_state (phone, last_product_id, last_products_json, last_intent, pending_question, updated_at, checkout_data, attendance_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       last_product_id=excluded.last_product_id,
       last_products_json=excluded.last_products_json,
       last_intent=excluded.last_intent,
       pending_question=excluded.pending_question,
       updated_at=excluded.updated_at,
       checkout_data=excluded.checkout_data,
       attendance_status=excluded.attendance_status`
  ).run(
    phone,
    ctx.lastProductId ?? null,
    ctx.list ? JSON.stringify(ctx.list) : null,
    ctx.state || STATES.MENU_PRINCIPAL,
    ctx.pendingQuestion ?? null,
    ts,
    ctx.checkoutData ? JSON.stringify(ctx.checkoutData) : null,
    ctx.attendanceStatus || 'BOT'
  );
}

export function resetConversation(db: DatabaseSync, phone: string): void {
  saveContext(db, phone, defaultContext());
}

export function releaseToBot(db: DatabaseSync, phone: string): void {
  resetConversation(db, phone);
}
