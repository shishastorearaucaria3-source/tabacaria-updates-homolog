import type { DatabaseSync } from 'node:sqlite';

export function getSetting(db: DatabaseSync, key: string, fallback: string | null = null): string | null {
  const row = db.prepare('SELECT value FROM whatsapp_delivery_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO whatsapp_delivery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function getAllSettings(db: DatabaseSync): Record<string, string> {
  return Object.fromEntries(
    (db.prepare('SELECT key, value FROM whatsapp_delivery_settings').all() as Array<{ key: string; value: string }>)
      .map((r) => [r.key, r.value])
  );
}

export function listResponses(db: DatabaseSync) {
  return db.prepare('SELECT key, name, description, text, active FROM whatsapp_responses ORDER BY key').all();
}

export function getText(db: DatabaseSync, key: string, fallback: string | (() => string)): string {
  try {
    const row = db.prepare('SELECT text, active FROM whatsapp_responses WHERE key = ?').get(key) as { text: string; active: number } | undefined;
    if (row && row.active === 1 && row.text && row.text.trim() !== '') return row.text;
  } catch {}
  return typeof fallback === 'function' ? fallback() : fallback;
}

export function upsertResponse(db: DatabaseSync, data: { key: string; name?: string; description?: string; text: string; active?: number }): void {
  if (!data.key || !data.text) throw new Error('key e text obrigatorios');
  db.prepare(
    `INSERT INTO whatsapp_responses (key, name, description, text, active)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       name=excluded.name, description=excluded.description,
       text=excluded.text, active=excluded.active`
  ).run(data.key, data.name || data.key, data.description || '', data.text, data.active === 0 ? 0 : 1);
}

export const BUILTIN_INTENTS = [
  { name: 'GREETING', description: 'Saudacoes e retorno ao menu', priority: 100 },
  { name: 'MENU', description: 'Menu principal / ajuda', priority: 100 },
  { name: 'PRODUCTS', description: 'Ver produtos (categorias)', priority: 100 },
  { name: 'PRODUCT_SEARCH', description: 'Busca de produto/estoque', priority: 100 },
  { name: 'PRODUCT_DETAIL', description: 'Detalhe de produto', priority: 100 },
  { name: 'ADD_TO_CART', description: 'Adicionar ao carrinho', priority: 100 },
  { name: 'VIEW_CART', description: 'Ver carrinho', priority: 100 },
  { name: 'REMOVE_FROM_CART', description: 'Remover do carrinho', priority: 100 },
  { name: 'CHECKOUT', description: 'Finalizar pedido', priority: 100 },
  { name: 'MY_ORDERS', description: 'Consultar pedidos', priority: 100 },
  { name: 'HUMAN_HANDOFF', description: 'Atendimento humano', priority: 999 },
  { name: 'STORE_HOURS', description: 'Horario de atendimento', priority: 100 },
  { name: 'DELIVERY', description: 'Entrega', priority: 100 },
  { name: 'PAYMENT', description: 'Pagamento', priority: 100 },
  { name: 'CANCEL', description: 'Cancelar operacao/pedido', priority: 100 },
  { name: 'BACK', description: 'Voltar', priority: 100 },
  { name: 'HELP', description: 'Ajuda', priority: 100 },
  { name: 'UNKNOWN', description: 'Nao entendido', priority: 0 },
];

export function ensureIntentsSeeded(db: DatabaseSync): void {
  for (const it of BUILTIN_INTENTS) {
    db.prepare('INSERT OR IGNORE INTO whatsapp_intents (name, description, enabled, priority) VALUES (?, ?, 1, ?)')
      .run(it.name, it.description, it.priority);
  }
}

export function listIntents(db: DatabaseSync) {
  ensureIntentsSeeded(db);
  const rows = db.prepare('SELECT name, description, enabled, priority FROM whatsapp_intents ORDER BY priority DESC, name').all() as Array<{
    name: string; description: string; enabled: number; priority: number;
  }>;
  return rows.map((r) => ({
    ...r,
    phrases: db.prepare('SELECT id, phrase FROM whatsapp_intent_phrases WHERE intent_name = ? ORDER BY id').all(r.name),
  }));
}

export function updateIntent(db: DatabaseSync, name: string, data: { description?: string; enabled?: number; priority?: number }): void {
  if (name === 'HUMAN_HANDOFF') {
    db.prepare('UPDATE whatsapp_intents SET description = COALESCE(?, description), enabled = 1, priority = 999 WHERE name = ?')
      .run(data.description ?? null, name);
    return;
  }
  db.prepare(
    `UPDATE whatsapp_intents SET
       description = COALESCE(?, description),
       enabled = COALESCE(?, enabled),
       priority = COALESCE(?, priority)
     WHERE name = ?`
  ).run(data.description ?? null, data.enabled ?? null, data.priority ?? null, name);
}

export function addPhrase(db: DatabaseSync, intentName: string, phrase: string): void {
  const p = String(phrase || '').trim();
  if (!p) throw new Error('frase obrigatoria');
  db.prepare('INSERT INTO whatsapp_intent_phrases (intent_name, phrase) VALUES (?, ?)').run(intentName, p);
}

export function removePhrase(db: DatabaseSync, phraseId: number): void {
  db.prepare('DELETE FROM whatsapp_intent_phrases WHERE id = ?').run(Number(phraseId));
}

export function customPhrases(db: DatabaseSync): Array<{ phrase: string; intent: string }> {
  let rows: Array<{ phrase: string; intent: string }> = [];
  try {
    rows = db.prepare(
      `SELECT ip.phrase, ip.intent_name AS intent
       FROM whatsapp_intent_phrases ip
       JOIN whatsapp_intents ci ON ci.name = ip.intent_name
       WHERE ci.enabled = 1
       ORDER BY CASE WHEN ip.intent_name = 'HUMAN_HANDOFF' THEN 0 ELSE 1 END, ci.priority DESC`
    ).all() as Array<{ phrase: string; intent: string }>;
  } catch { rows = []; }
  return rows;
}

export function listMenuItems(db: DatabaseSync) {
  return db.prepare('SELECT id, position, label, action, enabled FROM whatsapp_menu_items ORDER BY position').all();
}

export function saveMenuItem(db: DatabaseSync, data: { id?: number; position?: number; label: string; action: string; enabled?: boolean }): void {
  if (!data.label || !data.action) throw new Error('label e action obrigatorios');
  if (data.id) {
    db.prepare('UPDATE whatsapp_menu_items SET position = ?, label = ?, action = ?, enabled = ? WHERE id = ?')
      .run(data.position ?? 99, data.label, data.action, data.enabled ? 1 : 0, data.id);
  } else {
    db.prepare('INSERT INTO whatsapp_menu_items (position, label, action, enabled) VALUES (?, ?, ?, ?)')
      .run(data.position ?? 99, data.label, data.action, data.enabled ? 1 : 0);
  }
}

export function deleteMenuItem(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM whatsapp_menu_items WHERE id = ?').run(Number(id));
}

export function getMenuItemsForBot(db: DatabaseSync) {
  return db
    .prepare('SELECT position, label, action, enabled FROM whatsapp_menu_items WHERE enabled = 1 ORDER BY position')
    .all();
}

export function categoryLabels(db: DatabaseSync): Record<string, string> {
  return Object.fromEntries(
    (db.prepare('SELECT key, value FROM whatsapp_delivery_settings WHERE key LIKE ?').all('catlabel:%') as Array<{ key: string; value: string }>)
      .map((r) => [r.key.slice('catlabel:'.length), r.value])
  );
}

export function setCategoryLabel(db: DatabaseSync, categoryKey: string, label: string): void {
  setSetting(db, `catlabel:${categoryKey}`, label.trim());
}

export function setProductVisible(db: DatabaseSync, productId: number, visible: boolean): void {
  const p = db.prepare('SELECT ativo, estoque FROM produtos WHERE id = ?').get(Number(productId)) as { ativo: number; estoque: number } | undefined;
  if (!p) throw new Error('produto nao encontrado');
  if (visible && !(p.ativo === 1 && Number(p.estoque) > 0)) {
    throw new Error('produto indisponivel/sem estoque nao pode ser mostrado no WhatsApp');
  }
  db.prepare('UPDATE produtos SET publicado = ? WHERE id = ?').run(visible ? 1 : 0, Number(productId));
}

export function listConversations(db: DatabaseSync, limit = 50) {
  return db
    .prepare(
      `SELECT cs.phone,
              COALESCE(c.nome, '') AS name,
              cs.last_intent AS state,
              COALESCE(cs.attendance_status, 'BOT') AS attendance_status,
              (SELECT text FROM whatsapp_messages m WHERE m.phone = cs.phone AND m.direction = 'in' ORDER BY m.id DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM whatsapp_messages m WHERE m.phone = cs.phone AND m.direction = 'in' ORDER BY m.id DESC LIMIT 1) AS last_at,
              cs.updated_at
       FROM whatsapp_conversation_state cs
       LEFT JOIN clientes c ON c.telefone = cs.phone
       ORDER BY cs.updated_at DESC
       LIMIT ?`
    )
    .all(limit);
}

export function conversationHistory(db: DatabaseSync, phone: string, limit = 100) {
  return db
    .prepare('SELECT direction, text, created_at FROM whatsapp_messages WHERE phone = ? ORDER BY id DESC LIMIT ?')
    .all(phone, limit)
    .reverse();
}

export function setAttendanceStatus(db: DatabaseSync, phone: string, status: string): void {
  db.prepare(`INSERT INTO whatsapp_conversation_state (phone, last_intent, pending_question, updated_at, attendance_status)
              VALUES (?, 'MENU_PRINCIPAL', NULL, ?, ?)
              ON CONFLICT(phone) DO UPDATE SET attendance_status = excluded.attendance_status, updated_at = excluded.updated_at`)
    .run(phone, new Date().toISOString(), status);
}

export function getDeliveryZones(db: DatabaseSync, onlyActive = false) {
  const zones = db
    .prepare(`SELECT id, nome AS name, preco AS fee, poligono FROM zonas_entrega ${onlyActive ? 'WHERE ativo = 1' : ''} ORDER BY id`)
    .all() as Array<{ id: number; name: string; fee: number; poligono: string }>;
  return zones.map((z) => {
    let points: Array<{ lat: number; lng: number }> = [];
    try { points = JSON.parse(z.poligono || '[]'); } catch { points = []; }
    return { id: z.id, name: z.name, fee: z.fee, points };
  });
}
