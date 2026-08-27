import type { DatabaseSync } from 'node:sqlite';
import { STATES, loadContext, defaultContext, saveContext, type ConversationContext } from './state.js';
import { getTexts, stateHints } from './menus.js';
import { getSettings } from './settings.js';
import * as catalog from './product-search.js';
import * as orderMod from './order.js';
import { classify, INTENTS, extractQtyPrefix } from './intent.js';
import { getText, getMenuItemsForBot, getSetting } from './repo.js';
import { calculateDelivery } from './delivery.js';
import { buildFullList } from './list-builder.js';
import { parseMultiOrder } from './multi-order.js';
import { renderMessage as M } from './messages.js';
import { setSearchSettings } from './product-search.js';
import type { WhatsAppEvent } from './parser.js';

const GREETINGS = new Set(['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'menu', 'ajuda']);
const CART_FLOW_STATES = new Set<string>([
  STATES.MONTANDO_PEDIDO, STATES.PEDIDO_QTD, STATES.CHECKOUT_NOME,
  STATES.CHECKOUT_ENTREGA, STATES.CHECKOUT_ENDERECO, STATES.CHECKOUT_ENTREGA_CONFIRMA,
  STATES.CHECKOUT_PAGAMENTO, STATES.CHECKOUT_CPF, STATES.CHECKOUT_CONFIRMAR,
]);

function norm(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function fmtBRL(v: number | string): string {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
}

function numSetting(db: DatabaseSync, key: string, defv: number): number {
  const v = Number(getSetting(db, key, String(defv)));
  return Number.isFinite(v) && v > 0 ? v : defv;
}

function setSearchSettingsFromDb(db: DatabaseSync): void {
  const s: Record<string, number> = {};
  for (const [k, out] of [['search_limit', 'limit'], ['search_min_score', 'min_score'], ['reco_count', 'reco_count']] as const) {
    const v = getSetting(db, k, null);
    if (v != null && Number(v) > 0) s[out] = Number(v);
  }
  setSearchSettings(s);
}

function menuItemsSafe(db: DatabaseSync): Array<{ position: number; label: string; action: string }> {
  try { return getMenuItemsForBot(db) as Array<{ position: number; label: string; action: string }>; } catch { return []; }
}

function buildMenuText(db: DatabaseSync): string | null {
  const items = menuItemsSafe(db);
  if (!items.length) return null;
  const settings = getSettings(db);
  const digits = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
  const body = items.map((it) => `${digits[it.position - 1] || it.position + '.'} ${it.label}`).join('\n');
  return `👋 Olá! Seja bem-vindo à ${settings.storeName}!\n\nComo posso ajudar?\n\n${body}\n\nDigite o número da opção desejada.`;
}

function parseCartView(text: string): { lines: string[]; total: string } {
  const lines = text.split('\n').filter((l) => / — R\$ /.test(l));
  const m = text.match(/💰 Total: R\$ ([\d,.]+)/);
  return { lines, total: m ? m[1] : '0,00' };
}

function T(db: DatabaseSync, key: string, fb: string | (() => string)): string {
  return getText(db, key, typeof fb === 'function' ? fb() : fb);
}

export function handleMessage(db: DatabaseSync, event: WhatsAppEvent): string | null {
  _db = db;
  const phone = event.phone;
  const ctx = { ...loadContext(db, phone), phone };

  if (ctx.state === STATES.HUMAN_HANDOFF || ['AGUARDANDO_ATENDENTE', 'EM_ATENDIMENTO', 'ENCERRADO'].includes(ctx.attendanceStatus)) {
    return null;
  }
  if (getSetting(db, 'bot_enabled', 'true') === 'false') {
    return null;
  }

  let reply: string | null;
  try {
    reply = routeMessage(db, phone, ctx, event);
  } catch (err) {
    reply = M(db, 'error_generic');
  }
  saveContext(db, phone, ctx);
  return reply;
}

function routeMessage(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, event: WhatsAppEvent): string | null {
  const t = norm(event.text || '');
  const raw = String(event.text || '').trim();

  // ---------- pendencias ----------
  if (ctx.pendingQuestion === 'clear_confirm') {
    ctx.pendingQuestion = null;
    if (t === 'sim' || t === 'confirmar') {
      orderMod.cancelCart(db, phone);
      Object.assign(ctx, defaultContext());
      return M(db, 'cart_cleared');
    }
    return 'Ok, mantive seu carrinho.';
  }

  if (ctx.pendingQuestion?.startsWith('stockcap:')) {
    const [, pid, max] = ctx.pendingQuestion.split(':');
    ctx.pendingQuestion = null;
    if (['sim', 'ok', '1'].includes(t)) {
      const resAdd = orderMod.addProduct(db, phone, Number(pid), String(max));
      return finishAddReply(db, phone, ctx, resAdd);
    }
    return 'Ok, não adicionei. Quer ver outro produto?';
  }

  const so = raw.match(/^(?:quero|pode deixar)?\s*(?:só|so)\s+(\d{1,3})\s+(.+)$/i);
  if (so) {
    const rSo = orderMod.changeQtyByName(db, phone, so[2], so[1]);
    if (rSo.ok) return showCart(db, phone);
    return rSo.reply || null;
  }

  const chg = raw.match(/^(?:mudar|alterar)\s+(.+?)\s+para\s+(\d{1,3})$/i);
  if (chg) {
    const rChg = orderMod.changeQtyByName(db, phone, chg[1], chg[2]);
    if (rChg.ok) {
      ctx.state = STATES.MONTANDO_PEDIDO;
      return showCart(db, phone);
    }
    return rChg.reply || null;
  }

  // ---------- classificador ----------
  try { setSearchSettingsFromDb(db); } catch {}
  const cls = classify(raw);

  const FREE_TEXT_STATES = new Set<string>([STATES.CHECKOUT_NOME, STATES.CHECKOUT_ENDERECO, STATES.CHECKOUT_CPF, STATES.PEDIDO_QTD]);
  if (FREE_TEXT_STATES.has(ctx.state) && [INTENTS.ADD_TO_CART, INTENTS.ORDER, INTENTS.PRODUCT_SEARCH].includes(cls.intent as any)) {
    cls.intent = INTENTS.NONE;
  }

  switch (cls.intent) {
    case INTENTS.HUMAN_HANDOFF:
      ctx.state = STATES.HUMAN_HANDOFF;
      ctx.attendanceStatus = 'AGUARDANDO_ATENDENTE';
      return M(db, 'handoff');

    case INTENTS.CANCEL: {
      if (CART_FLOW_STATES.has(ctx.state)) orderMod.cancelCart(db, phone);
      Object.assign(ctx, defaultContext());
      return M(db, 'order_canceled');
    }

    case INTENTS.MENU:
      return goMenuDb(db, ctx);

    case INTENTS.BACK:
      return doBack(db, phone, ctx);

    case INTENTS.LIST:
      return buildFullList(db, {
        launchDays: numSetting(db, 'launch_days', 7),
        maxLines: numSetting(db, 'list_max_lines', 120),
        onlyCategory: cls.term || null,
      }) || '';

    case INTENTS.SMALLTALK:
      return cls.term === 'thanks'
        ? 'Por nada! 😊 Se precisar de algo, estou por aqui.'
        : '😄 Tudo ótimo! Como posso ajudar?';

    case INTENTS.VIEW_CART:
      return showCart(db, phone);

    case INTENTS.CLEAR_CART:
      ctx.pendingQuestion = 'clear_confirm';
      return M(db, 'cart_clear_confirm');

    case INTENTS.FINALIZE:
      return startCheckout(db, phone, ctx);

    case INTENTS.QTY_MORE: {
      const termM = raw.match(/mais\s+\d{1,3}\s+(.+)/i);
      if (termM && termM[1]) {
        const rAdj = orderMod.adjustQtyByName(db, phone, termM[1].trim(), '+' + cls.qty);
        if (rAdj.ok) return cartViewText(db, phone);
        return rAdj.reply || null;
      }
      if (!ctx.lastProductId) {
        return '⚠️ Não sei a qual produto se refere.\n\nEx.: "mais 2 ignite 25000".';
      }
      return applyAdd(db, phone, ctx, orderMod.addProduct(db, phone, ctx.lastProductId, String(cls.qty)));
    }

    case INTENTS.REMOVE_FROM_CART:
      return removeCartItemSmart(db, phone, ctx, cls.term);

    case INTENTS.MY_ORDERS:
      return openMyOrders(db, phone, ctx);

    case INTENTS.ADD_TO_CART: {
      const preMulti = (event.location ? null : parseMultiOrder(raw));
      if (preMulti && preMulti.length >= 2) return handleMultiOrder(db, phone, ctx, preMulti);
      if (!cls.term) return cartFlowHome(db, phone, ctx);
      if (/^(unidade|unidades|so|só)$/.test(cls.term) && ctx.lastProductId) {
        const qtyLast = Number.isInteger(cls.qty) && cls.qty! > 0 ? cls.qty! : 1;
        const resLast = orderMod.addProduct(db, phone, ctx.lastProductId, String(qtyLast));
        return applyAdd(db, phone, ctx, resLast);
      }

      const fromList = resolveFromList(db, ctx, cls.term);
      const addQty = Number.isInteger(cls.qty) && cls.qty! > 0 ? cls.qty! : 1;

      if (fromList.product) {
        return applyAdd(db, phone, ctx, orderMod.addProduct(db, phone, fromList.product.id, String(addQty)));
      }
      if (fromList.ambiguous) {
        ctx.list = { kind: 'produtos', mode: 'add', items: fromList.ambiguous.map((p) => ({ id: p.id, name: p.name })) };
        ctx.state = STATES.LISTA_RESULTADOS;
        ctx.pendingQuestion = `pickadd:${addQty}`;
        return renderProductList(
          (n) => `🔎 Encontrei ${n} produtos com esse nome:\n\n`,
          '\n\nQual você deseja? Digite o número ou o nome.\n0️⃣ Voltar',
          fromList.ambiguous
        );
      }
      return runSearch(db, phone, ctx, cls.term, 'add', addQty);
    }

    case INTENTS.PRODUCT_SEARCH: {
      const mode = ctx.state === STATES.MONTANDO_PEDIDO ? 'add' : 'consulta';
      return runSearch(db, phone, ctx, cls.term || raw, mode);
    }

    case INTENTS.NUMERIC:
    case INTENTS.NONE:
      break;
  }

  const pre = (event.location ? null : parseMultiOrder(raw));
  if (pre && pre.length >= 2) return handleMultiOrder(db, phone, ctx, pre);

  switch (ctx.state) {
    case STATES.MENU_PRINCIPAL: return onMenu(db, phone, ctx, t, raw);
    case STATES.CATEGORIAS: return onCategories(db, phone, ctx, t);
    case STATES.PRODUTOS_CATEGORIA: return onProductList(db, phone, ctx, t);
    case STATES.LISTA_RESULTADOS: return onResults(db, phone, ctx, t, raw);
    case STATES.DETALHE_PRODUTO: return onDetail(db, phone, ctx, t);
    case STATES.PEDIDO_QTD: return onQuantity(db, phone, ctx, t);
    case STATES.MONTANDO_PEDIDO: return onCartMenu(db, phone, ctx, t);
    case STATES.CHECKOUT_NOME: return onCheckoutName(db, phone, ctx, raw);
    case STATES.CHECKOUT_ENTREGA: return onCheckoutDelivery(db, phone, ctx, t);
    case STATES.CHECKOUT_ENDERECO: return onCheckoutAddress(db, phone, ctx, raw, event);
    case STATES.CHECKOUT_ENTREGA_CONFIRMA: return onDeliveryConfirm(db, phone, ctx, t);
    case STATES.CHECKOUT_PAGAMENTO: return onCheckoutPayment(db, phone, ctx, t);
    case STATES.CHECKOUT_CPF: return onCheckoutCpf(db, phone, ctx, t, raw);
    case STATES.CHECKOUT_CONFIRMAR: return onCheckoutConfirm(db, phone, ctx, t);
    case STATES.MEUS_PEDIDOS: return onMyOrdersPick(db, phone, ctx, t);
    case STATES.DETALHE_PEDIDO:
    default:
      Object.assign(ctx, defaultContext());
      return goMenuText(db);
  }
}

const MENU_ACTIONS = new Set(['products', 'search', 'order', 'my_orders', 'handoff', 'hours']);

function onMenu(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string, raw: string): string {
  const items = menuItemsSafe(db);
  if (items.length > 0) {
    const sel = Number.parseInt(t, 10);
    const hit = items.find((i) => i.position === sel);
    if (hit && MENU_ACTIONS.has(hit.action)) return dispatchMenuAction(db, phone, ctx, hit.action);
    if (Number.isInteger(sel)) return M(db, 'unknown_generic');
    if (raw.length >= 2) return runSearch(db, phone, ctx, raw, 'consulta');
    return getTexts(db).unknownGeneric;
  }

  if (t === '1') return openCategories(db, ctx);
  if (t === '2') return askSearch(ctx, 'consulta');
  if (t === '3') return cartFlowHome(db, phone, ctx);
  if (t === '4') return openMyOrders(db, phone, ctx);
  if (t === '5') {
    ctx.state = STATES.HUMAN_HANDOFF;
    ctx.attendanceStatus = 'AGUARDANDO_ATENDENTE';
    return T(db, 'handoff', getTexts(db).handoff);
  }
  if (raw.length >= 2) return runSearch(db, phone, ctx, raw, 'consulta');
  return M(db, 'unknown_generic');
}

function dispatchMenuAction(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, action: string): string {
  const texts = getTexts(db);
  switch (action) {
    case 'products': return openCategories(db, ctx);
    case 'search': return askSearch(ctx, 'consulta');
    case 'order': return cartFlowHome(db, phone, ctx);
    case 'my_orders': return openMyOrders(db, phone, ctx);
    case 'handoff':
      ctx.state = STATES.HUMAN_HANDOFF;
      ctx.attendanceStatus = 'AGUARDANDO_ATENDENTE';
      return T(db, 'handoff', texts.handoff);
    case 'hours': return T(db, 'store_hours', '🕘 Horário de atendimento:\nSeg a Sex: 9h às 18h\nSáb: 9h às 13h');
    default: return texts.unknownGeneric;
  }
}

function openCategories(db: DatabaseSync, ctx: ConversationContext): string {
  const settings = getSettings(db);
  const cats = catalog.listCategories(db, settings.maxCategoriesInMenu);
  if (cats.length === 0) return askSearch(ctx, 'consulta');
  ctx.state = STATES.CATEGORIAS;
  ctx.list = { kind: 'categorias', items: cats.map(c => ({ id: 0, name: c.key })) };
  return renderCategories(ctx);
}

let _db: DatabaseSync;

function renderCategories(ctx: ConversationContext): string {
  const items = ctx.list?.items || [];
  const body = items.map((c, i) => `${i + 1}️⃣ ${c.name}`).join('\n');
  return '📦 Nossos produtos:\n\n' + body + '\n\nDigite o número da categoria.\n0️⃣ Voltar';
}

function renderProductList(headerFn: (n: number) => string, footerText: string, items: Array<{ id: number; name: string; priceLabel?: string; price?: number; available?: boolean; isLaunch?: boolean }>): string {
  const body = items
    .map((p, i) => `${i + 1}️⃣ ${p.name} — ${p.priceLabel || fmtBRL(p.price || 0)}${p.available === false ? ' ❌' : ''}${p.isLaunch ? ' 🔥 LANÇAMENTO' : ''}`)
    .join('\n');
  return headerFn(items.length) + body + footerText;
}

function pickFromList(ctx: ConversationContext, t: string): { id: number; name: string } | null {
  const idx = Number.parseInt(t, 10);
  const items = ctx.list?.items || [];
  if (!(Number.isInteger(idx) && idx >= 1 && idx <= items.length)) return null;
  return items[idx - 1];
}

function productsOf(ctx: ConversationContext, db: DatabaseSync) {
  return (ctx.list?.items || []).map((it) => catalog.getProductById(db, it.id)).filter(Boolean);
}

function resolveFromList(db: DatabaseSync, ctx: ConversationContext, termRaw: string): { product?: any; ambiguous?: any[] } {
  const list = ctx.list?.items || [];
  if (!list.length || !ctx.list?.kind || ctx.list.kind !== 'produtos') return {};
  const term = norm(termRaw);
  if (!term) return {};
  const products = list.map((it) => catalog.getProductById(db, it.id)).filter(Boolean);
  const matches = products.filter((p) => {
    const n = norm(p!.name);
    return n.includes(term) || term.split(' ').filter(Boolean).every((w) => n.includes(w));
  });
  if (matches.length === 1) return { product: matches[0] };
  if (matches.length > 1) return { ambiguous: matches };
  const partial = products.filter((p) => p!.name.toLowerCase().includes(term.split(' ')[0]));
  if (partial.length === 1) return { product: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return {};
}

function onCategories(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  if (t === '0') return goMenuText(db);
  const idx = Number.parseInt(t, 10);
  const items = ctx.list?.items || [];
  if (!(Number.isInteger(idx) && idx >= 1 && idx <= items.length)) {
    return '🤔 Não consegui entender exatamente o que você precisa.\nEscolha uma categoria.\nDigite menu para voltar ao início.';
  }
  const cat = items[idx - 1].name;
  const products = catalog.byCategory(db, cat, 15);
  if (products.length === 0) {
    return `📦 ${cat}:\n\n😕 Nenhum produto disponível agora.`;
  }
  ctx.state = STATES.PRODUTOS_CATEGORIA;
  ctx.list = { kind: 'produtos', originCategory: cat, items: products.map((p) => ({ id: p.id, name: p.name })) };
  return renderProductList(() => `📦 ${cat}:\n\n`, '\n\nDigite o número do produto.\n0️⃣ Voltar', products);
}

function onProductList(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  if (t === '0') return openCategories(db, ctx);
  if (!/^\d{1,3}$/.test(t)) {
    const resolved = resolveFromList(db, ctx, t);
    if (resolved.product) {
      const p = resolved.product;
      ctx.state = STATES.DETALHE_PRODUTO;
      ctx.lastProductId = p.id;
      return getTexts(db).productDetail(p);
    }
    if (resolved.ambiguous) {
      ctx.list = { ...ctx.list!, items: resolved.ambiguous.map((p: any) => ({ id: p.id, name: p.name })) };
      const cat = ctx.list.originCategory || '';
      return renderProductList(() => `📦 ${cat}:\n\n`, '\n\nDigite o número do produto.\n0️⃣ Voltar', resolved.ambiguous);
    }
  }
  const picked = pickFromList(ctx, t);
  if (!picked) return '🤔 Não consegui entender exatamente o que você precisa.\nEscolha um produto.\nDigite menu para voltar ao início.';
  const p = catalog.getProductById(db, picked.id);
  if (!p) return getTexts(db).productUnavailable;
  ctx.state = STATES.DETALHE_PRODUTO;
  ctx.lastProductId = p.id;
  return getTexts(db).productDetail(p);
}

function onResults(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string, raw: string): string {
  const pending = ctx.pendingQuestion || '';
  if (ctx.list?.kind === 'aguardando_termo') {
    if (!pending.startsWith('search:')) return askSearch(ctx, 'consulta');
    const mode = pending.slice('search:'.length);
    if (raw.length < 2) return getTexts(db).askSearchTerm;
    return runSearch(db, phone, ctx, raw, mode);
  }

  if (!/^\d{1,3}$/.test(t)) {
    const resolved = resolveFromList(db, ctx, t);
    if (resolved.ambiguous) {
      ctx.list = { kind: 'produtos', mode: ctx.list?.mode || 'consulta', items: resolved.ambiguous.map((p: any) => ({ id: p.id, name: p.name })) };
      return renderProductList(getTexts(db).searchResultsHeader, getTexts(db).searchResultsFooter, resolved.ambiguous);
    }
    if (resolved.product) {
      const p = resolved.product;
      const isAdd = ctx.list?.mode === 'add' || pending.startsWith('pickadd:');
      const qtyPick = Number((pending.match(/^pickadd:(\d+)/) || [])[1] || 1);
      if (isAdd) {
        const resAdd = orderMod.addProduct(db, phone, p.id, String(qtyPick));
        return finishAddReply(db, phone, ctx, resAdd);
      }
      ctx.state = STATES.DETALHE_PRODUTO;
      ctx.lastProductId = p.id;
      return getTexts(db).productDetail(p);
    }
    return runSearch(db, phone, ctx, raw, ctx.list?.mode || 'consulta');
  }

  if (t === '0') return backFromResultsOrSearch(db, phone, ctx);
  const picked = pickFromList(ctx, t);
  if (!picked) return '🤔 Não consegui entender exatamente o que você precisa.\nDigite o número do produto.\n0️⃣ Voltar';
  const p = catalog.getProductById(db, picked.id);
  if (!p) return getTexts(db).productUnavailable;
  ctx.lastProductId = p.id;

  const isAddMode = ctx.list?.mode === 'add';
  const qa = Number((pending.match(/^pickadd:(\d+)/) || [])[1]);
  const qtyPick = Number.isInteger(qa) && qa >= 1 ? qa : (isAddMode ? 1 : 0);
  if (qtyPick >= 1) {
    const resAdd = orderMod.addProduct(db, phone, p.id, String(qtyPick));
    ctx.state = STATES.MONTANDO_PEDIDO;
    ctx.pendingQuestion = null;
    return finishAddReply(db, phone, ctx, resAdd);
  }
  ctx.state = STATES.DETALHE_PRODUTO;
  return getTexts(db).productDetail(p);
}

function onDetail(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  const p = catalog.getProductById(db, ctx.lastProductId!);
  if (!p) return askSearch(ctx, 'consulta');
  const texts = getTexts(db);

  if (t === '1') {
    if (!p.available) return texts.productUnavailable;
    ctx.state = STATES.PEDIDO_QTD;
    ctx.pendingQuestion = 'qtd';
    return texts.askQuantity(p.name);
  }
  if (t === '2') {
    if (ctx.list?.kind === 'produtos' && ctx.list.items?.length) {
      ctx.state = STATES.LISTA_RESULTADOS;
      return renderProductList(texts.searchResultsHeader, texts.searchResultsFooter, productsOf(ctx, db) as any);
    }
    return askSearch(ctx, 'consulta');
  }
  return '🤔 Não consegui entender exatamente o que você precisa.\nResponda 1 (comprar), 2 (ver outro) ou 0 (voltar).\nDigite menu para voltar ao início.';
}

function askSearch(ctx: ConversationContext, mode: string): string {
  ctx.state = STATES.LISTA_RESULTADOS;
  ctx.pendingQuestion = `search:${mode}`;
  ctx.list = { kind: 'aguardando_termo', mode, items: [] };
  return getTexts(_db).askSearchTerm;
}

function runSearch(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, term: string, mode: string, qty = 1): string {
  const results = catalog.searchSmart(db, term);
  const texts = getTexts(db);

  if (results.mode === 'none') {
    ctx.pendingQuestion = `search:${mode}`;
    const stockRow = db.prepare("SELECT nome AS name FROM produtos WHERE (nome LIKE ?) AND ativo = 1 LIMIT 1")
      .get('%' + term + '%') as { name: string } | undefined;
    if (stockRow) return M(db, 'product_unavailable', { product_name: stockRow.name });
    return `${M(db, 'product_not_found', { term })}\n\n${M(db, 'search_ask_term')}`;
  }

  if (results.mode === 'recommend') {
    const missRow = db.prepare('SELECT nome AS name FROM produtos WHERE ativo = 0 AND (nome LIKE ?) LIMIT 1').get('%' + term + '%') as { name: string } | undefined;
    if (missRow) return M(db, 'product_unavailable', { product_name: missRow.name });
  }

  ctx.list = { kind: 'produtos', mode, items: results.items.map((p) => ({ id: p.id, name: p.name })) };
  if (mode === 'add') ctx.pendingQuestion = `pickadd:${qty}`;

  if (results.mode === 'recommend') {
    ctx.state = STATES.LISTA_RESULTADOS;
    if (mode === 'add' && results.items.length === 1) {
      const resAdd = orderMod.addProduct(db, phone, results.items[0].id, String(qty));
      ctx.state = STATES.MONTANDO_PEDIDO;
      ctx.pendingQuestion = null;
      return finishAddReply(db, phone, ctx, resAdd);
    }
    return renderProductList(
      () => `🔎 Não encontrei exatamente "${term}", mas encontrei opções próximas:\n\n`,
      '\n\nDigite o número ou o nome para adicionar.\n0️⃣ Voltar',
      results.items
    );
  }

  if (results.items.length === 1) {
    const p = results.items[0];
    if (mode === 'add') {
      const resAdd = orderMod.addProduct(db, phone, p.id, String(qty));
      ctx.state = STATES.MONTANDO_PEDIDO;
      ctx.pendingQuestion = null;
      return applyAdd(db, phone, ctx, resAdd);
    }
    ctx.state = STATES.DETALHE_PRODUTO;
    ctx.lastProductId = p.id;
    return `Sim! 🔥 ${getTexts(db).productDetail(p)}`.replace('🔎 Encontrei:\n\n', '');
  }

  ctx.state = STATES.LISTA_RESULTADOS;
  return renderProductList(
    (n) => `Sim! 🔥 Encontrei ${n} opções disponíveis:\n\n`,
    '\n\nPode digitar o número ou o nome do produto.\n0️⃣ Voltar',
    results.items
  );
}

function showCart(db: DatabaseSync, phone: string): string {
  const view = orderMod.viewCart(db, phone);
  if (view.empty) return getTexts(db).cartEmptyMenu;
  const parsed = parseCartView(view.text!);
  return M(db, 'cart_view', { lines: parsed.lines.map((l, i) => `${i + 1}. ${l}`).join('\n'), total: fmtBRL(parsed.total) });
}

function cartFlowHome(db: DatabaseSync, phone: string, ctx: ConversationContext): string {
  ctx.state = STATES.MONTANDO_PEDIDO;
  ctx.pendingQuestion = null;
  const view = orderMod.viewCart(db, phone);
  if (view.empty) return getTexts(db).cartEmptyMenu;
  const parsed = parseCartView(view.text!);
  return `🛒 Seu pedido:\n\n${parsed.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nSubtotal: R$ ${parsed.total}` +
    '\n\n1️⃣ Adicionar produto\n2️⃣ Remover produto\n3️⃣ Finalizar pedido\n0️⃣ Cancelar pedido';
}

function cartViewText(db: DatabaseSync, phone: string): string {
  const view = orderMod.viewCart(db, phone);
  if (view.empty) return getTexts(db).cartEmptyMenu;
  const parsed = parseCartView(view.text!);
  return `🛒 Seu carrinho:\n\n${parsed.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nSubtotal: R$ ${fmtBRL(parsed.total)}`;
}

function finishAddReply(db: DatabaseSync, phone: string, ctx: ConversationContext, resAdd: { ok: boolean; reply?: string; capped?: boolean; productId?: number; quantity?: number; name?: string }): string {
  if (!resAdd.ok) return resAdd.reply || 'Erro ao adicionar produto.';
  ctx.state = STATES.MONTANDO_PEDIDO;
  ctx.lastProductId = resAdd.productId ?? ctx.lastProductId;
  ctx.pendingQuestion = null;

  const view = orderMod.viewCart(db, phone);
  const addedKey = resAdd.capped ? 'cart_product_capped' : 'cart_product_added';
  const parts = [M(db, addedKey, { quantity: String(resAdd.quantity), product_name: resAdd.name })];
  if (!view.empty) {
    const parsed = parseCartView(view.text!);
    parts.push(`🛒 Seu carrinho agora:\n${parsed.lines.map((l) => `• ${l}`).join('\n')}\n\n💰 Total: R$ ${parsed.total}`);
  }
  parts.push('Digite "finalizar" quando quiser fazer o pedido.');
  return parts.join('\n\n');
}

function applyAdd(db: DatabaseSync, phone: string, ctx: ConversationContext, resAdd: { ok: boolean; stockCap?: boolean; noStock?: boolean; productId?: number; available?: number; name?: string; reply?: string; capped?: boolean; quantity?: number }): string {
  if (!resAdd.ok && resAdd.stockCap) {
    ctx.pendingQuestion = `stockcap:${resAdd.productId}:${resAdd.available}`;
    return M(db, 'cart_product_capped', { quantity: String(resAdd.available), product_name: resAdd.name });
  }
  if (!resAdd.ok && resAdd.noStock) {
    return M(db, 'product_unavailable', { product_name: resAdd.name });
  }
  return finishAddReply(db, phone, ctx, resAdd);
}

function onQuantity(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  const resAdd = orderMod.addProduct(db, phone, ctx.lastProductId!, t);
  if (!resAdd.ok) {
    if (resAdd.stockCap) {
      ctx.pendingQuestion = `stockcap:${resAdd.productId}:${resAdd.available}`;
      return M(db, 'cart_product_capped', { quantity: String(resAdd.available), product_name: resAdd.name });
    }
    if (resAdd.noStock) return M(db, 'product_unavailable', { product_name: resAdd.name });
    return resAdd.reply || 'Erro ao adicionar produto.';
  }
  ctx.state = STATES.MONTANDO_PEDIDO;
  ctx.pendingQuestion = null;
  return finishAddReply(db, phone, ctx, resAdd);
}

function onCartMenu(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  const texts = getTexts(db);
  if (ctx.pendingQuestion === 'remove') {
    const res = orderMod.removeByIndex(db, phone, t);
    ctx.pendingQuestion = null;
    if (!res.ok) return texts.removedItemFail;
    const view = orderMod.viewCart(db, phone);
    if (view.empty) return texts.removedItem + '\n\n' + texts.cartEmptyMenu;
    const parsed = parseCartView(view.text!);
    return `${M(db, 'cart_product_removed')}\n\n🛒 Seu carrinho:\n\n${parsed.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nSubtotal: R$ ${fmtBRL(parsed.total)}`;
  }
  if (t === '1') return askSearch(ctx, 'add');
  if (t === '2') {
    const view = orderMod.viewCart(db, phone);
    if (view.empty) return texts.cartEmptyMenu;
    ctx.pendingQuestion = 'remove';
    const numbered = view.items.map((it, i) => `${i + 1}️⃣ ${it.quantity}x ${it.name}`).join('\n');
    return M(db, 'cart_remove_menu', { numbered });
  }
  if (t === '3') return startCheckout(db, phone, ctx);
  if (t === '4') {
    ctx.pendingQuestion = 'clear_confirm';
    return M(db, 'cart_clear_confirm');
  }
  return '🤔 Não consegui entender exatamente o que você precisa.\nEscolha 1, 2, 3 ou 0.\nDigite menu para voltar ao início.';
}

function removeCartItemSmart(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, term: string): string | null {
  const view = orderMod.viewCart(db, phone);
  if (view.empty) return getTexts(db).cartEmptyMenu;

  const idx = Number.parseInt(term, 10);
  if (Number.isInteger(idx)) {
    const namePart = term.replace(/^\d{1,3}\s+/, '').trim();
    if (namePart.length >= 2 && /[a-z]/i.test(namePart)) {
      const rAdj = orderMod.adjustQtyByName(db, phone, namePart, '-' + idx);
      ctx.pendingQuestion = null;
      if (rAdj.ok) return afterRemove(db, phone, ctx);
      return rAdj.reply || null;
    }
    const r = orderMod.removeByIndex(db, phone, String(idx));
    ctx.pendingQuestion = null;
    if (!r.ok) return getTexts(db).removedItemFail;
    return afterRemove(db, phone, ctx);
  }

  const tn = norm(term);
  const matches = view.items.filter((it) => norm(it.name || '').includes(tn));
  if (matches.length === 0) return M(db, 'cart_not_in_cart', { term });
  if (matches.length > 1) {
    const numbered = matches.map((m) => `• ${m.quantity}x ${m.name}`).join('\n');
    return M(db, 'cart_ambiguous', { numbered });
  }
  const realIdx = view.items.indexOf(matches[0]) + 1;
  const rr = orderMod.removeByIndex(db, phone, String(realIdx));
  ctx.pendingQuestion = null;
  if (!rr.ok) return getTexts(db).removedItemFail;
  return afterRemove(db, phone, ctx);
}

function afterRemove(db: DatabaseSync, phone: string, ctx: ConversationContext): string {
  const view = orderMod.viewCart(db, phone);
  if (view.empty) {
    Object.assign(ctx, defaultContext());
    return getTexts(db).removedItem + '\n\n' + getTexts(db).cartEmptyMenu;
  }
  const parsed = parseCartView(view.text!);
  return `${M(db, 'cart_product_removed')}\n\n🛒 Seu carrinho:\n\n${parsed.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nSubtotal: R$ ${fmtBRL(parsed.total)}`;
}

function handleMultiOrder(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, segments: Array<{ qty: number; term: string }>): string {
  const lines: string[] = [];

  for (const seg of segments) {
    const results = catalog.searchSmart(db, seg.term);
    if (results.mode === 'none') {
      lines.push(`⚠️ Não encontrei: ${seg.term}`);
      continue;
    }
    if (results.items.length !== 1) {
      lines.push(`❓ Para "${seg.term}" encontrei várias opções. Digite o nome completo.`);
      continue;
    }
    const best = results.items[0];
    if (!best.available) {
      lines.push(`⚠️ Sem estoque: ${best.name}`);
      continue;
    }
    const resAdd = orderMod.addProduct(db, phone, best.id, String(seg.qty));
    if (resAdd.ok) {
      lines.push(`✅ Adicionei ${resAdd.quantity}x ${resAdd.name}.`);
    } else if (resAdd.stockCap) {
      lines.push(`⚠️ ${best.name}: tenho apenas ${resAdd.available} disponível.`);
    } else {
      lines.push(`⚠️ ${resAdd.reply || best.name}`);
    }
  }

  ctx.state = STATES.MONTANDO_PEDIDO;
  ctx.pendingQuestion = null;

  const view = orderMod.viewCart(db, phone);
  let out = lines.join('\n');
  if (!view.empty) {
    const parsed = parseCartView(view.text!);
    out += `\n\n🛒 CARRINHO\n\n${parsed.lines.join('\n')}\n\n💰 Total: R$ ${parsed.total}`;
  }
  out += '\n\n1️⃣ Finalizar pedido\n2️⃣ Continuar comprando\n3️⃣ Alterar carrinho\n4️⃣ Limpar carrinho';
  return out;
}

function startCheckout(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }): string {
  const view = orderMod.viewCart(db, phone);
  if (view.empty) return getTexts(db).cartEmptyMenu;
  const cust = db.prepare('SELECT nome FROM clientes WHERE telefone = ?').get(phone) as { nome: string } | undefined;
  if (!cust?.nome) {
    ctx.state = STATES.CHECKOUT_NOME;
    return M(db, 'checkout_ask_name');
  }
  ctx.checkoutData = { ...(ctx.checkoutData || {}), nome: cust.nome };
  ctx.state = STATES.CHECKOUT_ENTREGA;
  return getTexts(db).checkoutDelivery;
}

function onCheckoutName(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, raw: string): string {
  if (raw.length < 2) return M(db, 'checkout_name_short');
  db.prepare('UPDATE clientes SET nome = ?, atualizado_em = ? WHERE telefone = ?').run(raw, new Date().toISOString(), phone);
  ctx.checkoutData = { ...(ctx.checkoutData || {}), nome: raw };
  ctx.state = STATES.CHECKOUT_ENTREGA;
  return getTexts(db).checkoutDelivery;
}

function onCheckoutDelivery(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  if (t === '1' || t.includes('retir')) {
    ctx.checkoutData = { ...(ctx.checkoutData || {}), entrega: 'Retirada na loja' };
    return gotoPayment(ctx);
  }
  if (t === '2' || t.includes('entreg')) {
    ctx.checkoutData = { ...(ctx.checkoutData || {}), entrega: 'Entrega' };
    ctx.state = STATES.CHECKOUT_ENDERECO;
    return '📍 Me envie seu endereço para calcular a entrega.\n\n(Dica: você pode compartilhar sua LOCALIZAÇÃO pelo WhatsApp.)';
  }
  return '🤔 Não consegui entender exatamente o que você precisa.\nDigite 1 (retirada) ou 2 (entrega).\nDigite menu para voltar ao início.';
}

function currentSubtotal(db: DatabaseSync, phone: string): number {
  const view = orderMod.viewCart(db, phone);
  if (view.empty) return 0;
  const parsed = parseCartView(view.text!);
  return Number(parsed.total.replace('.', '').replace(',', '.'));
}

function onCheckoutAddress(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, raw: string, event: WhatsAppEvent): string {
  const loc = event.location || null;
  if (raw.length < 8 && !loc) {
    return '📍 Para calcular a taxa de entrega, envie sua localização pelo WhatsApp ou digite o endereço completo.';
  }
  ctx.checkoutData = { ...(ctx.checkoutData || {}), endereco: raw || 'Localização compartilhada' };

  let feeInfo: any = { determined: false, fee: null };
  if (loc) {
    ctx.checkoutData.lat = loc.lat;
    ctx.checkoutData.lng = loc.lng;
    feeInfo = calculateDelivery(db, { subtotal: currentSubtotal(db, phone), lat: loc.lat, lng: loc.lng });
  }

  ctx.state = STATES.CHECKOUT_ENTREGA_CONFIRMA;

  if (feeInfo.determined) {
    ctx.checkoutData.entregaFee = feeInfo.fee;
    ctx.checkoutData.freeShipping = Boolean(feeInfo.freeShipping);
    const subtotal = currentSubtotal(db, phone);
    const total = feeInfo.freeShipping ? subtotal : subtotal + feeInfo.fee;
    return [
      `📍 Endereço: ${ctx.checkoutData.endereco}`,
      feeInfo.zone ? `🗺️ Área: ${feeInfo.zone}` : '',
      `🛵 Taxa de entrega: ${feeInfo.freeShipping ? 'GRÁTIS 🎉' : fmtBRL(feeInfo.fee)}`,
      '',
      `Subtotal: ${fmtBRL(subtotal)}`,
      `Entrega: ${feeInfo.freeShipping ? 'GRÁTIS' : fmtBRL(feeInfo.fee)}`,
      `Total: ${fmtBRL(total)}`,
      '',
      '1️⃣ Continuar',
      '2️⃣ Alterar endereço',
      '3️⃣ Falar com atendente',
    ].filter(Boolean).join('\n');
  }

  ctx.checkoutData.taxaACombinar = true;
  return [
    `📍 Endereço anotado: ${ctx.checkoutData.endereco}`,
    '',
    '🛵 Não consegui calcular a entrega automaticamente.',
    'Para a taxa exata, compartilhe sua LOCALIZAÇÃO pelo WhatsApp',
    'ou continue e confirmamos com você.',
    '',
    '1️⃣ Continuar (taxa a combinar)',
    '2️⃣ Alterar endereço',
    '3️⃣ Falar com atendente',
  ].join('\n');
}

function onDeliveryConfirm(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  if (t === '2') {
    ctx.state = STATES.CHECKOUT_ENDERECO;
    return M(db, 'delivery_ask_new_address');
  }
  if (t === '3' || t === 'atendente') {
    ctx.state = STATES.HUMAN_HANDOFF;
    ctx.attendanceStatus = 'AGUARDANDO_ATENDENTE';
    return T(db, 'handoff', getTexts(db).handoff);
  }
  if (!ctx.checkoutData) ctx.checkoutData = {};
  if (ctx.checkoutData.entregaFee == null) ctx.checkoutData.taxaACombinar = true;
  return gotoPayment(ctx);
}

function gotoPayment(ctx: ConversationContext): string {
  ctx.state = STATES.CHECKOUT_PAGAMENTO;
  return getTexts(_db).checkoutPayment;
}

function onCheckoutPayment(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  const settings = getSettings(db);
  const idx = Number.parseInt(t, 10);
  if (!(Number.isInteger(idx) && idx >= 1 && idx <= settings.paymentMethods.length)) {
    return '🤔 Não consegui entender exatamente o que você precisa.\nEscolha a forma de pagamento.\nDigite menu para voltar ao início.';
  }
  ctx.checkoutData = { ...(ctx.checkoutData || {}), pagamento: settings.paymentMethods[idx - 1] };
  const cust = db.prepare('SELECT cpf FROM clientes WHERE telefone = ?').get(phone) as { cpf: string } | undefined;
  if (cust?.cpf) {
    ctx.checkoutData.cpfRegistrado = true;
    return renderConfirmation(db, phone, ctx);
  }
  ctx.state = STATES.CHECKOUT_CPF;
  return getTexts(db).checkoutCpfAsk;
}

function onCheckoutCpf(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string, raw: string): string {
  if (['pular', 'nao', 'não'].includes(t)) {
    ctx.checkoutData = { ...(ctx.checkoutData || {}), cpf: null };
    return renderConfirmation(db, phone, ctx);
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return getTexts(db).cpfInvalid;
  db.prepare('UPDATE clientes SET cpf = ?, atualizado_em = ? WHERE telefone = ?').run(digits, new Date().toISOString(), phone);
  ctx.checkoutData = { ...(ctx.checkoutData || {}), cpfRegistrado: true };
  return renderConfirmation(db, phone, ctx);
}

function renderConfirmation(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }): string {
  ctx.state = STATES.CHECKOUT_CONFIRMAR;
  const view = orderMod.viewCart(db, phone);
  if (view.empty) return M(db, 'cart_empty');
  const parsed = parseCartView(view.text!);
  const d = ctx.checkoutData || {};
  const feeKnown = typeof d.entregaFee === 'number';
  const entregaTxt = feeKnown ? (d.freeShipping ? 'GRÁTIS 🎉' : fmtBRL(d.entregaFee as number)) : 'a combinar';
  let totalNum = Number(parsed.total.replace('.', '').replace(',', '.'));
  if (feeKnown) totalNum += d.entregaFee as number;
  const totalTxt = feeKnown ? fmtBRL(totalNum) : `${parsed.total} (+entrega)`;
  const entregaLinha = `${(d.entrega as string) || '-'} — Entrega: ${entregaTxt}`;
  return getTexts(db).orderSummary(parsed.lines, totalTxt, entregaLinha, (d.pagamento as string) || '-');
}

function onCheckoutConfirm(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  if (t === '1' || t === 'sim' || t === 'confirmar') {
    const res = orderMod.finalizeOrder(db, phone, ctx.checkoutData || {});
    Object.assign(ctx, defaultContext());
    if (!res.ok) {
      if (res.reason === 'todos_removidos') {
        return M(db, 'cart_stock_changed', { items: (res.removedNames || []).map((n) => `• ${n}`).join('\n') });
      }
      return M(db, 'cart_empty');
    }
    const removedNote = (res.removedNames && res.removedNames.length)
      ? `⚠️ Ficou sem estoque enquanto você montava o pedido — removi do fechamento:\n${res.removedNames.map((n) => `• ${n}`).join('\n')}\n\n`
      : '';
    return `${removedNote}${M(db, 'order_confirmed', { order_id: String(res.orderId) })}`;
  }
  return cartFlowHome(db, phone, ctx);
}

function openMyOrders(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }): string {
  ctx.state = STATES.MEUS_PEDIDOS;
  ctx.pendingQuestion = 'order';
  const orders = orderMod.listOrdersByPhone(db, phone, 5) as Array<{ id: number; total: number; status: string }>;
  if (orders.length === 0) {
    Object.assign(ctx, defaultContext());
    return `${getTexts(db).myOrdersEmpty}\n\n${goMenuText(db)}`;
  }
  ctx.list = { kind: 'pedidos', items: orders.map((o) => ({ id: o.id, name: '' })) };
  const body = orders
    .map((o, i) => `${i + 1}️⃣ #${o.id} — ${fmtBRL(o.total)}\n     Status: ${o.status}`)
    .join('\n\n');
  return getTexts(db).myOrdersHeader + body + getTexts(db).myOrdersFooter;
}

function onMyOrdersPick(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }, t: string): string {
  const idx = Number.parseInt(t, 10);
  const items = ctx.list?.items || [];
  if (!(Number.isInteger(idx) && idx >= 1 && idx <= items.length)) {
    return '🤔 Não consegui entender exatamente o que você precisa.\nDigite o número do pedido ou 0.\nDigite menu para voltar ao início.';
  }
  const det = orderMod.getOrderDetail(db, phone, items[idx - 1].id);
  if (!det) return getTexts(db).myOrdersEmpty;
  ctx.state = STATES.DETALHE_PEDIDO;
  const lines = (det.items as any[]).map((it) => `${it.quantity}x ${it.product_name} — ${fmtBRL(it.subtotal)}`);
  return (
    getTexts(db).orderDetail({
      id: (det.order as any).id,
      date: new Date((det.order as any).criado_em).toLocaleString('pt-BR'),
      lines,
      total: Number((det.order as any).total).toFixed(2).replace('.', ','),
      status: (det.order as any).status,
    }) + '\n\n0️⃣ Voltar'
  );
}

function goMenuDb(db: DatabaseSync, ctx: ConversationContext): string {
  Object.assign(ctx, defaultContext());
  return buildMenuText(db) || M(db, 'menu_principal');
}

function goMenuText(db: DatabaseSync): string {
  return buildMenuText(db) || getTexts(db).menuPrincipal;
}

function doBack(db: DatabaseSync, phone: string, ctx: ConversationContext & { phone: string }): string {
  switch (ctx.state) {
    case STATES.CATEGORIAS: return goMenuText(db);
    case STATES.PRODUTOS_CATEGORIA: return openCategories(db, ctx);
    case STATES.LISTA_RESULTADOS:
      if (ctx.list?.kind === 'aguardando_termo') return getTexts(db).askSearchTerm;
      if (ctx.list?.mode === 'add') return cartFlowHome(db, phone, ctx);
      return askSearch(ctx, 'consulta');
    case STATES.DETALHE_PRODUTO:
      if (ctx.list?.kind === 'produtos' && ctx.list.items?.length) {
        ctx.state = STATES.LISTA_RESULTADOS;
        return renderProductList(getTexts(db).searchResultsHeader, getTexts(db).searchResultsFooter, productsOf(ctx, db) as any);
      }
      return askSearch(ctx, 'consulta');
    case STATES.PEDIDO_QTD: return cartFlowHome(db, phone, ctx);
    case STATES.CHECKOUT_NOME:
    case STATES.CHECKOUT_ENTREGA:
    case STATES.CHECKOUT_ENDERECO:
    case STATES.CHECKOUT_ENTREGA_CONFIRMA:
    case STATES.CHECKOUT_PAGAMENTO:
    case STATES.CHECKOUT_CPF:
    case STATES.CHECKOUT_CONFIRMAR: return cartFlowHome(db, phone, ctx);
    default: return goMenuText(db);
  }
}

function backFromResultsOrSearch(db: DatabaseSync, phone: string, ctx: ConversationContext): string {
  if (ctx.list?.mode === 'add') return cartFlowHome(db, phone, ctx);
  Object.assign(ctx, defaultContext());
  return goMenuText(db);
}
