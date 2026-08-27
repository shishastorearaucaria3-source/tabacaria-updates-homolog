import type { DatabaseSync } from 'node:sqlite';
import type { Request, Response } from 'express';
import { ensureIntentsSeeded, listIntents, updateIntent, addPhrase, removePhrase,
         listResponses, upsertResponse,
         listMenuItems, saveMenuItem, deleteMenuItem,
         listConversations, conversationHistory, setAttendanceStatus,
         setProductVisible, setCategoryLabel, categoryLabels,
         getDeliveryZones, getSetting, setSetting, getAllSettings } from '../repo.js';
import { checkCredentials, createSession, validateSession } from './auth.js';
import { listMessages, saveMessage, restoreMessage, previewMessage } from '../messages.js';

export function registerPanelRoutes(app: import('express').Router, db: DatabaseSync, adminCfg: { user: string; password: string }): void {
  let seeded = false;
  const ensureSeed = () => {
    if (!seeded) {
      ensureIntentsSeeded(db);
      seeded = true;
    }
  };

  // Login
  app.post('/login', (req: Request, res: Response) => {
    const { user, password } = req.body;
    if (!checkCredentials(user, password, adminCfg)) {
      res.status(401).json({ ok: false, error: 'credenciais invalidas' });
      return;
    }
    res.json({ ok: true, token: createSession() });
  });

  // Auth middleware for all routes below
  app.use((req: Request, res: Response, next) => {
    const header = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m || !validateSession(m[1].trim())) {
      res.status(401).json({ ok: false, error: 'nao autenticado' });
      return;
    }
    ensureSeed();
    next();
  });

  // Intents
  app.get('/intents', (_req, res) => {
    res.json({ ok: true, intents: listIntents(db) });
  });

  app.post('/intents/update', (req, res) => {
    const { name, ...data } = req.body;
    updateIntent(db, name, data);
    res.json({ ok: true });
  });

  app.post('/intents/phrase/add', (req, res) => {
    addPhrase(db, req.body.intent, req.body.phrase);
    res.json({ ok: true });
  });

  app.post('/intents/phrase/remove', (req, res) => {
    removePhrase(db, req.body.id);
    res.json({ ok: true });
  });

  // Responses
  app.get('/responses', (_req, res) => {
    res.json({ ok: true, responses: listResponses(db) });
  });

  app.post('/responses/save', (req, res) => {
    upsertResponse(db, req.body);
    res.json({ ok: true });
  });

  // Menu
  app.get('/menu', (_req, res) => {
    res.json({ ok: true, items: listMenuItems(db) });
  });

  app.post('/menu/save', (req, res) => {
    saveMenuItem(db, req.body);
    res.json({ ok: true });
  });

  app.post('/menu/delete', (req, res) => {
    deleteMenuItem(db, req.body.id);
    res.json({ ok: true });
  });

  // Products
  app.get('/products', (_req, res) => {
    const rows = db.prepare(
      `SELECT p.id, p.nome AS name, COALESCE(c.nome, '') AS category,
              p.preco_venda AS price, p.preco_promo AS promotional_price,
              p.estoque AS stock, p.ativo AS available
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       ORDER BY p.nome`
    ).all();
    res.json({ ok: true, products: rows });
  });

  app.post('/products/visible', (req, res) => {
    setProductVisible(db, req.body.id, Boolean(req.body.visible));
    res.json({ ok: true });
  });

  // Categories
  app.get('/categories', (_req, res) => {
    const cats = db.prepare(
      `SELECT COALESCE(c.nome, '') AS key, COUNT(*) AS total
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.ativo = 1 AND p.publicado = 1 AND (p.estoque IS NULL OR p.estoque > 0)
       GROUP BY c.nome ORDER BY total DESC`
    ).all();
    const labels = categoryLabels(db);
    res.json({ ok: true, categories: (cats as any[]).map((c) => ({ ...c, label: labels[c.key] || c.key })) });
  });

  app.post('/categories/label', (req, res) => {
    if (!req.body.key || !req.body.label) throw new Error('key e label obrigatorios');
    setCategoryLabel(db, req.body.key, req.body.label);
    res.json({ ok: true });
  });

  // Conversations
  app.get('/conversations', (_req, res) => {
    res.json({ ok: true, conversations: listConversations(db) });
  });

  app.post('/conversations/history', (req, res) => {
    res.json({ ok: true, history: conversationHistory(db, String(req.body.phone || '')) });
  });

  app.post('/conversations/status', (req, res) => {
    const allowed = ['BOT', 'AGUARDANDO_ATENDENTE', 'EM_ATENDIMENTO', 'ENCERRADO'];
    if (!allowed.includes(req.body.status)) throw new Error('status invalido');
    setAttendanceStatus(db, String(req.body.phone), req.body.status);
    if (req.body.status === 'BOT') {
      db.prepare('DELETE FROM whatsapp_conversation_state WHERE phone = ?').run(String(req.body.phone));
      setAttendanceStatus(db, String(req.body.phone), 'BOT');
    }
    res.json({ ok: true });
  });

  // Delivery
  app.get('/delivery/settings', (_req, res) => {
    const zones = getDeliveryZones(db);
    res.json({ ok: true, settings: getAllSettings(db), zones });
  });

  app.post('/delivery/settings', (req, res) => {
    for (const [k, v] of Object.entries(req.body)) setSetting(db, k, String(v));
    res.json({ ok: true });
  });

  // Bot controls
  app.get('/bot/status', (_req, res) => {
    res.json({ ok: true, enabled: getSetting(db, 'bot_enabled', 'true') !== 'false' });
  });

  app.post('/bot/pause', (_req, res) => {
    setSetting(db, 'bot_enabled', 'false');
    res.json({ ok: true, enabled: false });
  });

  app.post('/bot/resume', (_req, res) => {
    setSetting(db, 'bot_enabled', 'true');
    res.json({ ok: true, enabled: true });
  });

  // Dashboard
  app.get('/dashboard', (_req, res) => {
    const c = db.prepare(`SELECT
      (SELECT COUNT(*) FROM whatsapp_conversation_state) AS conversas,
      (SELECT COUNT(*) FROM whatsapp_conversation_state WHERE attendance_status = 'AGUARDANDO_ATENDENTE' OR attendance_status = 'EM_ATENDIMENTO') AS humano,
      (SELECT COUNT(*) FROM whatsapp_conversation_state WHERE attendance_status = 'BOT') AS bot,
      (SELECT COUNT(*) FROM pedidos WHERE status = 'novo' AND origem = 'whatsapp') AS pedidos_iniciados,
      (SELECT COUNT(*) FROM pedidos WHERE status = 'finalizado' AND origem = 'whatsapp') AS pedidos_finalizados,
      (SELECT COUNT(*) FROM pedidos WHERE status = 'cancelado' AND origem = 'whatsapp') AS pedidos_cancelados,
      (SELECT COALESCE(SUM(total),0) FROM pedidos WHERE origem = 'whatsapp') AS valor_total,
      (SELECT COUNT(*) FROM produtos WHERE ativo = 1 AND publicado = 1 AND (estoque IS NULL OR estoque > 0)) AS produtos_disponiveis,
      (SELECT COUNT(*) FROM produtos WHERE ativo = 1 AND publicado = 1 AND estoque = 0) AS sem_estoque`).get() as any;
    c.bot_enabled = getSetting(db, 'bot_enabled', 'true') !== 'false';
    c.delivery_mode = getSetting(db, 'delivery_mode', 'fixed');
    res.json({ ok: true, ...c });
  });

  // Messages
  app.get('/messages', (_req, res) => {
    res.json({ ok: true, messages: listMessages(db) });
  });

  app.post('/messages/save', (req, res) => {
    const r = saveMessage(db, req.body.key, req.body.text, req.body.active !== false);
    res.json({ ok: true, ...r });
  });

  app.post('/messages/restore', (req, res) => {
    res.json({ ok: true, ...restoreMessage(db, req.body.key) });
  });

  app.post('/messages/preview', (req, res) => {
    res.json({ ok: true, preview: previewMessage(db, req.body.key) });
  });

  // Backup
  app.get('/backup/export', (_req, res) => {
    const data = {
      exportedAt: new Date().toISOString(),
      settings: getAllSettings(db),
      messages: listMessages(db).map((m) => ({ key: m.key, text: m.text, active: m.active })),
      intents: listIntents(db).map((i) => ({ name: i.name, enabled: i.enabled, priority: i.priority, phrases: (i.phrases as any[]).map((p) => p.phrase) })),
      menuItems: listMenuItems(db),
      categoryLabels: categoryLabels(db),
      zones: getDeliveryZones(db),
    };
    res.json({ ok: true, backup: data });
  });

  app.post('/backup/import', (req, res) => {
    const data = req.body.backup;
    if (!data || typeof data !== 'object') throw new Error('arquivo de backup invalido');
    if (data.settings && typeof data.settings === 'object') {
      for (const [k, v] of Object.entries(data.settings)) setSetting(db, k, String(v));
    }
    if (Array.isArray(data.messages)) {
      for (const m of data.messages) { if (m.key && typeof m.text === 'string') saveMessage(db, m.key, m.text, m.active !== false); }
    }
    if (Array.isArray(data.menuItems)) {
      db.prepare('DELETE FROM whatsapp_menu_items').run();
      for (const it of data.menuItems) { if (it.label && it.action) saveMenuItem(db, { position: it.position ?? 99, label: it.label, action: it.action, enabled: it.enabled !== 0 }); }
    }
    res.json({ ok: true, imported: true });
  });

  // Hours
  app.get('/hours', (_req, res) => {
    const hours = getSetting(db, 'business_hours', '[]');
    let parsed = [];
    try { parsed = JSON.parse(hours!); } catch {}
    res.json({ ok: true, hours: parsed, message: getSetting(db, 'closed_message', '') });
  });

  app.post('/hours', (req, res) => {
    if (!Array.isArray(req.body.hours)) throw new Error('hours invalido');
    setSetting(db, 'business_hours', JSON.stringify(req.body.hours));
    if (typeof req.body.message === 'string') setSetting(db, 'closed_message', req.body.message);
    res.json({ ok: true });
  });
}
