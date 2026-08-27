import { parseAdd } from './add-parser.js';

export const INTENTS = {
  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
  CANCEL: 'CANCEL',
  MENU: 'MENU',
  BACK: 'BACK',
  ORDER: 'ORDER',
  ADD_TO_CART: 'ADD_TO_CART',
  VIEW_CART: 'VIEW_CART',
  REMOVE_FROM_CART: 'REMOVE_FROM_CART',
  CLEAR_CART: 'CLEAR_CART',
  FINALIZE: 'FINALIZE',
  QTY_MORE: 'QTY_MORE',
  MY_ORDERS: 'MY_ORDERS',
  LIST: 'LIST',
  SMALLTALK: 'SMALLTALK',
  PRODUCT_SEARCH: 'PRODUCT_SEARCH',
  NUMERIC: 'NUMERIC',
  NONE: 'NONE',
} as const;

export type Intent = typeof INTENTS[keyof typeof INTENTS];

function norm(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const HUMAN_PATTERNS = [
  /atendente/,
  /\bhumano\b/,
  /\bvendedor\b/,
  /\batendimento humano\b/,
  /\bquero atendimento\b/,
  /\bpreciso de atendimento\b/,
  /\b(preciso|quero) (de )?(uma |um )?(pessoa|alguem)\b/,
  /\bfalar com (uma |um )?(pessoa|alguem|voces)\b/,
  /\btem alguem para me atender\b/,
];

const LEADING_GREETING = /^(oi|ola|bom dia|boa tarde|boa noite|eae|e ai)\b[,!.]?\s*/;

function stripGreeting(t: string): { text: string; stripped: boolean } {
  let out = t;
  let stripped = false;
  while (true) {
    const next = out.replace(LEADING_GREETING, '');
    if (next === out) break;
    out = next;
    stripped = true;
  }
  return { text: out.trim(), stripped };
}

const CANCEL_EXACT = new Set(['cancelar', 'cancela', 'desisto', 'cancelar pedido', 'quero cancelar', 'pode cancelar']);
const GREETING_WORDS = ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'eae', 'e ai'];
const MENU_EXACT = new Set([
  'menu', 'ajuda', 'opcoes', 'reiniciar', 'reiniciar atendimento',
  ...GREETING_WORDS,
]);
const BACK_EXACT = new Set(['voltar', 'quero voltar', 'voltar menu', 'voltar ao menu']);

const ORDER_CUES = [/^quero comprar\b/, /^comprar\b/, /^fazer um pedido$/, /^fazer pedido$/, /^quero fazer um pedido\b/, /^novo pedido$/];
const ORDER_STRIP = /^(quero comprar|comprar|fazer um pedido|fazer pedido|quero fazer um pedido|novo pedido)\s*/;

export function extractQtyPrefix(s: string): { qty: number | null; rest: string } {
  const m = String(s || '').match(/^(\d{1,3})\s*(.+)$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1 && n <= 999 && m[2]) return { qty: n, rest: m[2].trim() };
  }
  return { qty: null, rest: s };
}

const PRODUCT_CUES = [
  /^(tem|temos|voces tem|vc tem)\b/,
  /^(quanto custa|qual (o|a) (valor|preco)|preco da?|preco do?|valor d[ao])\b/,
  /^preco\b/,
  /^busca[r]?\b/,
  /^procura[r]?\b/,
];

const MY_ORDER_CUES = [/\bmeu(s)? pedidos?\b/, /\bconsulta(r)? (meu )?pedido\b/];

const ADD_CUES = [/^(adiciona|adicionar|add)\b/, /^(coloca|colocar|poe|ponha)\b/, /^quero \d*\s*\d*(x)?\s*\S/];
const REMOVE_CUES = [/^(remove|remover|tira|tirar)\b/];
const VIEW_CART_EXACT = new Set(['carrinho', 'ver carrinho', 'meu carrinho', 'pedido', 'ver pedido']);

const LIST_RE = /^(quero (a |o )?|me manda (a )?|me passa (a )?)?(lista|catalogo|produtos|sabores)\b[\s\S]*$/;

const SMALLTALK: Array<[RegExp, string]> = [
  [/^tudo (bem|bom|otimo|certo)[?!.]*$/, 'allgood'],
  [/^(obrigado|obrigada|valeu|brigad(o|a))[!.,]*$/, 'thanks'],
  [/^boa noite a todos$/, 'greet'],
];
const CLEAR_CART = /limpa(r)?\s+(o\s+)?carrinho/;
const FINALIZE_RE = /(finaliza|fechar o pedido|fecha o pedido|pode finalizar|encerrar pedido)/;
const QTY_MORE_RE = /^(coloca mais|adiciona mais|mais)\s+\d{1,3}$/;

export function classify(textRaw: string): { intent: Intent; term: string; qty?: number | null } {
  const t = norm(textRaw);
  if (t === '') return { intent: INTENTS.NONE, term: '' };

  const { text: t1 } = stripGreeting(t);
  for (const re of HUMAN_PATTERNS) {
    if (re.test(t1)) return { intent: INTENTS.HUMAN_HANDOFF, term: t1 };
  }

  if (CANCEL_EXACT.has(t) || CANCEL_EXACT.has(t1)) {
    return { intent: INTENTS.CANCEL, term: '' };
  }

  if (MENU_EXACT.has(t)) return { intent: INTENTS.MENU, term: '' };

  if (BACK_EXACT.has(t) || BACK_EXACT.has(t1)) return { intent: INTENTS.BACK, term: '' };

  if (/^\d{1,3}$/.test(t)) return { intent: INTENTS.NUMERIC, term: t };

  const listM = LIST_RE.exec(t1) || LIST_RE.exec(t);
  if (listM) {
    const term = t1
      .replace(/^(quero (a |o )?|me manda (a )?|me passa (a )?)?/, '')
      .replace(/^(lista|catalogo|produtos|sabores)\b\s*/, '')
      .replace(/^de\s+/, '')
      .replace(/[?!.]+$/, '')
      .trim();
    return { intent: INTENTS.LIST, term };
  }

  for (const [re, kind] of SMALLTALK) {
    if (re.test(t)) return { intent: INTENTS.SMALLTALK, term: kind };
  }

  if (VIEW_CART_EXACT.has(t)) return { intent: INTENTS.VIEW_CART, term: '' };
  if (CLEAR_CART.test(t)) return { intent: INTENTS.CLEAR_CART, term: '' };
  if (FINALIZE_RE.test(t1) || FINALIZE_RE.test(t)) return { intent: INTENTS.FINALIZE, term: '' };
  if (QTY_MORE_RE.test(t1)) return { intent: INTENTS.QTY_MORE, term: t1, qty: Number(t1.match(/\d{1,3}/)?.[0]) };
  for (const re of REMOVE_CUES) {
    if (re.test(t1)) {
      const term = t1.replace(/^(remover|tirar|remove|tira)(\s+(o|a|o item|o produto))?\s*/, '').replace(/[?!.]+$/, '');
      return { intent: INTENTS.REMOVE_FROM_CART, term };
    }
  }

  for (const re of MY_ORDER_CUES) {
    if (re.test(t1)) return { intent: INTENTS.MY_ORDERS, term: '' };
  }

  const addRes = parseAdd(t);
  if (addRes) {
    if (!addRes.term) return { intent: INTENTS.ORDER, term: '' };
    if (addRes.explicit || /^(adiciona|adicionar|add|coloca|colocar|poe|ponha|me ve|manda)/.test(t)) {
      return { intent: INTENTS.ADD_TO_CART, term: addRes.term, qty: addRes.qty || 1 };
    }
    return { intent: INTENTS.PRODUCT_SEARCH, term: addRes.term };
  }
  for (const re of ORDER_CUES) {
    if (re.test(t1)) {
      const rest = t1.replace(ORDER_STRIP, '').trim();
      const q = extractQtyPrefix(rest);
      return { intent: q.qty ? INTENTS.ADD_TO_CART : INTENTS.ORDER, term: q.rest, qty: q.qty || null };
    }
  }

  const { text: t2 } = stripGreeting(t1);
  for (const re of PRODUCT_CUES) {
    if (re.test(t2)) {
      const term = t2.replace(/^(tem|temos|voces tem|vc tem|quanto custa|qual o valor|qual a preco|qual o preco|preco da|preco do|preco de|preco|valor da|valor do|valor de)\b\s*/, '').replace(/[?!.]+$/, '').trim();
      return { intent: INTENTS.PRODUCT_SEARCH, term: term || t2.replace(/[?!.]+$/, '') };
    }
  }

  return { intent: INTENTS.NONE, term: '' };
}
