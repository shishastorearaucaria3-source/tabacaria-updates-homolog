import { logger } from './logger.js';

const TAG = 'WHATSAPP';

export abstract class WhatsAppProvider {
  abstract sendMessage(phone: string, message: string): Promise<{ ok: boolean; mock?: boolean; error?: string; response?: { status: number; body: string } }>;
}

export class WAWebPlusProvider extends WhatsAppProvider {
  private apiUrl: string;
  private apiKey: string;
  private authHeader: string;
  private authScheme: string;
  private timeoutMs: number;
  private mock: boolean;
  private maxAttempts = 2;

  constructor(cfg: {
    apiUrl: string;
    apiKey: string;
    authHeader?: string;
    authScheme?: string;
    timeoutMs?: number;
    mock?: boolean;
  }) {
    super();
    this.apiUrl = cfg.apiUrl;
    this.apiKey = cfg.apiKey;
    this.authHeader = cfg.authHeader || 'Authorization';
    this.authScheme = cfg.authScheme ?? 'Bearer';
    this.timeoutMs = cfg.timeoutMs || 15000;
    this.mock = Boolean(cfg.mock);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      let key = String(this.apiKey).trim();
      const prefix = `${this.authScheme} `;
      if (this.authScheme && key.toLowerCase().startsWith(prefix.toLowerCase())) {
        key = key.slice(prefix.length).trim();
        logger.warn(TAG, 'WA_WEB_PLUS_API_KEY continha o esquema embutido; esquema removido automaticamente');
      }
      const value = this.authScheme ? `${this.authScheme} ${key}` : key;
      headers[this.authHeader] = value;
    }
    return headers;
  }

  private async attemptSend(phone: string, message: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(this.apiUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          action: 'send-message',
          type: 'text',
          content: message,
          phone,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(phone: string, message: string): Promise<{ ok: boolean; mock?: boolean; error?: string; response?: { status: number; body: string } }> {
    if (!phone) return { ok: false, error: 'telefone obrigatorio' };
    if (typeof message !== 'string' || message.length === 0) {
      return { ok: false, error: 'mensagem vazia' };
    }
    if (message.length > 4096) {
      message = message.slice(0, 4096);
    }

    if (this.mock) {
      logger.info(TAG, `MOCK send para ${phone}: ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}`);
      return { ok: true, mock: true };
    }

    if (!this.apiUrl) {
      logger.error(TAG, 'WA_WEB_PLUS_API_URL ausente');
      return { ok: false, error: 'api url ausente' };
    }

    let lastError = 'erro desconhecido';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const res = await this.attemptSend(phone, message);
        const bodyText = await res.text();
        if (res.ok) {
          logger.info(TAG, `Mensagem enviada para ${phone} (status ${res.status})`);
          return { ok: true, response: { status: res.status, body: bodyText.slice(0, 500) } };
        }
        lastError = `HTTP ${res.status}: ${bodyText.slice(0, 200)}`;
        if (res.status < 500) break;
      } catch (err) {
        const e = err as Error;
        lastError = e.name === 'AbortError' ? `timeout apos ${this.timeoutMs}ms` : e.message;
      }
      if (attempt < this.maxAttempts) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    logger.error(TAG, `Falha ao enviar para ${phone} apos ${this.maxAttempts} tentativas: ${lastError}`);
    return { ok: false, error: lastError };
  }
}
