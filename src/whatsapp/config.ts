import type { DatabaseSync } from 'node:sqlite';

export interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  authHeader: string;
  authScheme: string;
  mock: boolean;
  webhookToken: string;
  webhookTokenHeader: string;
  conversationTimeoutMinutes: number;
  adminUser: string;
  adminPassword: string;
  storeName: string;
  attendanceStatus: string;
}

export function getWhatsAppConfig(db: DatabaseSync): WhatsAppConfig {
  const get = (key: string, fallback = ''): string => {
    const row = db.prepare('SELECT valor FROM whatsapp_config WHERE chave = ?').get(key) as { valor: string } | undefined;
    return row?.valor ?? fallback;
  };

  const num = (v: string, def: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };

  return {
    apiUrl: get('wa_api_url', 'http://localhost:8080'),
    apiKey: get('wa_api_key', ''),
    authHeader: get('wa_auth_header', 'Authorization'),
    authScheme: get('wa_auth_scheme', 'Bearer'),
    mock: get('wa_mock', 'false') === 'true',
    webhookToken: get('wa_webhook_token', ''),
    webhookTokenHeader: get('wa_webhook_token_header', 'x-wawebplus-token'),
    conversationTimeoutMinutes: num(get('conversation_timeout', '30'), 30),
    adminUser: get('admin_user', 'admin'),
    adminPassword: get('admin_password', 'admin123'),
    storeName: get('store_name', 'Loja Tabacaria'),
    attendanceStatus: get('attendance_status', 'BOT'),
  };
}

export function setWhatsAppConfig(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO whatsapp_config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
  ).run(key, value);
}

export function getAllWhatsAppConfig(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare('SELECT chave, valor FROM whatsapp_config').all() as Array<{ chave: string; valor: string }>;
  return Object.fromEntries(rows.map(r => [r.chave, r.valor]));
}
