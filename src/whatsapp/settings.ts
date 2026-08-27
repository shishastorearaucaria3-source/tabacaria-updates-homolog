import type { DatabaseSync } from 'node:sqlite';

export interface WhatsAppSettings {
  storeName: string;
  conversationTimeoutMinutes: number;
  maxQuantityPerItem: number;
  maxDistinctItems: number;
  delivery: {
    options: Array<{ key: string; label: string }>;
    freightNote: string;
  };
  paymentMethods: string[];
  cpfRequired: boolean;
  maxCategoriesInMenu: number;
}

export function getSettings(db: DatabaseSync): WhatsAppSettings {
  const get = (key: string, fallback = ''): string => {
    const row = db.prepare('SELECT valor FROM whatsapp_config WHERE chave = ?').get(key) as { valor: string } | undefined;
    return row?.valor ?? fallback;
  };

  const storeName = get('store_name', 'Loja Tabacaria');
  const timeout = Number(get('conversation_timeout', '30'));
  const conversationTimeoutMinutes = Number.isFinite(timeout) && timeout > 0 ? timeout : 30;

  return {
    storeName,
    conversationTimeoutMinutes,
    maxQuantityPerItem: 99,
    maxDistinctItems: 20,
    delivery: {
      options: [
        { key: 'retirada', label: '1️⃣ Retirar na loja' },
        { key: 'entrega', label: '2️⃣ Receber por entrega' },
      ],
      freightNote: '🛵 A taxa de entrega será combinada com o atendente após a confirmação.',
    },
    paymentMethods: ['Pix', 'Cartão de crédito'],
    cpfRequired: false,
    maxCategoriesInMenu: 9,
  };
}
