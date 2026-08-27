import type { DatabaseSync } from 'node:sqlite';
import { MESSAGE_REGISTRY, MESSAGE_DEFAULTS } from './registry.js';
import { getSettings } from './settings.js';

export function renderMessage(db: DatabaseSync, key: string, vars: Record<string, unknown> = {}): string {
  let text: string | null = null;
  try {
    const row = db.prepare('SELECT text, active FROM whatsapp_responses WHERE key = ?').get(key) as { text: string; active: number } | undefined;
    if (row && row.active === 1 && row.text && row.text.trim() !== '') text = row.text;
  } catch {}
  if (text == null) text = MESSAGE_DEFAULTS[key] ?? '';
  const settings = getSettings(db);
  const allVars: Record<string, unknown> = { store_name: settings.storeName, ...vars };
  let out = text;
  for (const [k, v] of Object.entries(allVars)) {
    if (v == null) continue;
    out = out.split('{' + k + '}').join(String(v));
  }
  return out;
}

export function renderLines(db: DatabaseSync, key: string, vars: Record<string, unknown> = {}): string[] {
  return renderMessage(db, key, vars).split('\n');
}

export function messageText(db: DatabaseSync, key: string): string {
  try {
    const row = db.prepare('SELECT text FROM whatsapp_responses WHERE key = ?').get(key) as { text: string } | undefined;
    return row?.text ?? MESSAGE_DEFAULTS[key] ?? '';
  } catch { return MESSAGE_DEFAULTS[key] ?? ''; }
}

export function listMessages(db: DatabaseSync): Array<{
  key: string; name: string; category: string; variables: string[];
  text: string; active: boolean; isDefault: boolean;
}> {
  const configured: Record<string, { text: string; active: number }> = {};
  try {
    for (const r of db.prepare('SELECT key, text, active FROM whatsapp_responses').all() as Array<{ key: string; text: string; active: number }>) {
      configured[r.key] = { text: r.text, active: r.active };
    }
  } catch {}
  return Object.entries(MESSAGE_REGISTRY).map(([key, meta]) => ({
    key,
    name: meta.name,
    category: meta.category,
    variables: meta.variables,
    text: configured[key]?.text ?? MESSAGE_DEFAULTS[key] ?? '',
    active: configured[key] ? configured[key].active === 1 : true,
    isDefault: !configured[key],
  }));
}

export function saveMessage(db: DatabaseSync, key: string, text: string, active = true): { key: string; text: string; active: boolean } {
  const meta = MESSAGE_REGISTRY[key];
  if (!meta) throw new Error('chave de mensagem invalida');
  if (typeof text !== 'string' || text.trim() === '') throw new Error('texto obrigatorio');
  try {
    const prev = db.prepare('SELECT text FROM whatsapp_responses WHERE key = ?').get(key) as { text: string } | undefined;
    if (prev) {
      db.prepare('INSERT INTO whatsapp_responses (key, name, description, text, active) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET text=excluded.text, active=excluded.active')
        .run(key, meta.name, meta.category, String(text), active ? 1 : 0);
    }
  } catch {}
  db.prepare(
    `INSERT INTO whatsapp_responses (key, name, description, text, active)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET text=excluded.text, active=excluded.active`
  ).run(key, meta.name, meta.category, String(text), active ? 1 : 0);
  return { key, text, active };
}

export function restoreMessage(db: DatabaseSync, key: string): { key: string; restored: boolean; text: string } {
  const meta = MESSAGE_REGISTRY[key];
  if (!meta) throw new Error('chave de mensagem invalida');
  db.prepare('DELETE FROM whatsapp_responses WHERE key = ?').run(key);
  return { key, restored: true, text: MESSAGE_DEFAULTS[key] ?? '' };
}

export function previewMessage(db: DatabaseSync, key: string): string {
  const vars: Record<string, string> = {
    quantity: '2', product_name: 'Strong Mint 100ml', price: 'R$ 20,00',
    total: 'R$ 40,00', subtotal: 'R$ 40,00', delivery: 'Retirada na loja',
    fee: 'R$ 0,00', stock: '📦 Disponível', order_id: '1001',
    customer_name: 'Fulano', store_name: 'Loja Tabacaria',
    term: 'strong mint', address: 'Rua das Palmeiras, 123',
    zone: 'Centro', methods: '1️⃣ Pix\n2️⃣ Cartão de crédito',
    lines: '• 2x Strong Mint 100ml', count: '1',
    min_order: 'R$ 20,00', max: '99',
  };
  return renderMessage(db, key, vars);
}
