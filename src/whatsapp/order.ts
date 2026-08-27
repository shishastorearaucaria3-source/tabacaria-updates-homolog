import type { DatabaseSync } from 'node:sqlite';
import { effectivePrice, priceLabel } from './pricing.js';
import { getSettings } from './settings.js';

export interface CartItem {
  item_id: number;
  quantity: number;
  unit_price: number;
  product_id: number;
  name: string;
}

export function getOpenCart(db: DatabaseSync, phone: string) {
  let cart = db.prepare("SELECT * FROM whatsapp_carts WHERE customer_phone = ? AND status = 'OPEN' ORDER BY id DESC").get(phone) as Record<string, unknown> | undefined;
  if (!cart) {
    const ts = new Date().toISOString();
    const res = db.prepare('INSERT INTO whatsapp_carts (customer_phone, status, created_at, updated_at) VALUES (?, ?, ?, ?)').run(phone, 'OPEN', ts, ts);
    cart = db.prepare('SELECT * FROM whatsapp_carts WHERE id = ?').get(Number(res.lastInsertRowid)) as Record<string, unknown>;
  }
  return cart;
}

export function getCartItems(db: DatabaseSync, cartId: number): CartItem[] {
  return db
    .prepare(
      `SELECT ci.id AS item_id, ci.quantity, ci.unit_price,
              p.id AS product_id, p.nome AS name
       FROM whatsapp_cart_items ci
       LEFT JOIN produtos p ON p.id = ci.produto_id
       WHERE ci.cart_id = ?
       ORDER BY ci.id`
    )
    .all(cartId) as unknown as CartItem[];
}

function cartTotals(items: CartItem[]): { lines: string[]; total: string } {
  let total = 0;
  const lines = items.map((it) => {
    const subtotal = Number(it.unit_price) * it.quantity;
    total += subtotal;
    return `${it.quantity}x ${it.name || 'Produto removido'} — ${priceLabel(subtotal)}`;
  });
  return { lines, total: total.toFixed(2).replace('.', ',') };
}

export function viewCart(db: DatabaseSync, phone: string): { text: string | null; empty: boolean; items: CartItem[] } {
  const cart = getOpenCart(db, phone);
  const items = getCartItems(db, cart.id as number);
  if (items.length === 0) return { text: null, empty: true, items };
  const { lines, total } = cartTotals(items);
  return { text: `🛒 Seu pedido:\n\n${lines.join('\n')}\n\n💰 Total: R$ ${total}`, empty: false, items };
}

export function addProduct(db: DatabaseSync, phone: string, productId: number, rawQuantity: string | number): {
  ok: boolean; reply?: string; noStock?: boolean; stockCap?: boolean;
  productId?: number; available?: number; requested?: number; name?: string;
  quantity?: number; unitPrice?: number; capped?: boolean;
} {
  if (!Number.isInteger(productId)) {
    return { ok: false, reply: '⚠️ Produto inválido.' };
  }
  const product = db.prepare('SELECT * FROM produtos WHERE id = ?').get(productId) as Record<string, unknown> | undefined;
  if (!product) return { ok: false, reply: '⚠️ Produto não encontrado no catálogo atual.' };

  const settings = getSettings(db);
  let qty = Number.parseInt(String(rawQuantity), 10);
  if (!Number.isInteger(qty) || qty < 1 || qty > settings.maxQuantityPerItem) {
    return { ok: false, reply: `⚠️ Quantidade inválida. Informe um número de 1 a ${settings.maxQuantityPerItem}.` };
  }

  let capped = false;

  const ativo = product.ativo as number;
  const publicado = product.publicado as number;
  const estoque = product.estoque as number | null;
  const isAvailable = ativo === 1 && publicado === 1;
  if (!isAvailable) {
    return { ok: false, noStock: true, name: product.nome as string };
  }

  const hasStockLimit = estoque != null && Number(estoque) > 0;
  const stockMax = hasStockLimit ? Math.floor(Number(estoque)) : settings.maxQuantityPerItem;

  if (qty > stockMax && hasStockLimit) {
    return { ok: false, stockCap: true, productId, available: stockMax, requested: qty, name: product.nome as string };
  }
  if (qty < 1) {
    return { ok: false, noStock: true, name: product.nome as string };
  }

  const cart = getOpenCart(db, phone);
  const ts = new Date().toISOString();

  const existing = db
    .prepare('SELECT id, quantity FROM whatsapp_cart_items WHERE cart_id = ? AND produto_id = ?')
    .get(cart.id as number, productId) as { id: number; quantity: number } | undefined;

  const price = effectivePrice({
    price: Number(product.preco_venda),
    promotional_price: product.preco_promo != null ? Number(product.preco_promo) : null,
  });

  let newQty = qty;
  if (existing) {
    newQty = existing.quantity + qty;
    if (newQty > settings.maxQuantityPerItem) newQty = settings.maxQuantityPerItem;
    db.prepare('UPDATE whatsapp_cart_items SET quantity = ?, unit_price = ?, updated_at = ? WHERE id = ?')
      .run(newQty, price, ts, existing.id);
  } else {
    const count = (db.prepare('SELECT COUNT(*) c FROM whatsapp_cart_items WHERE cart_id = ?').get(cart.id as number) as { c: number }).c;
    if (count >= settings.maxDistinctItems) {
      return { ok: false, reply: '⚠️ Seu carrinho atingiu o limite de produtos diferentes.' };
    }
    db.prepare('INSERT INTO whatsapp_cart_items (cart_id, produto_id, quantity, unit_price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cart.id as number, productId, newQty, price, ts, ts);
  }

  const subtotal = priceLabel(price * newQty);
  return { ok: true, reply: `✅ Adicionado: ${newQty}x ${product.nome} — R$ ${subtotal}`, productId, quantity: newQty, name: product.nome as string, unitPrice: price, capped };
}

export function removeByIndex(db: DatabaseSync, phone: string, indexStr: string): { ok: boolean } {
  const idx = Number.parseInt(indexStr, 10);
  if (!Number.isInteger(idx) || idx < 1) return { ok: false };
  const cart = getOpenCart(db, phone);
  const items = getCartItems(db, cart.id as number);
  const target = items[idx - 1];
  if (!target || !target.item_id) return { ok: false };
  db.prepare('DELETE FROM whatsapp_cart_items WHERE id = ?').run(target.item_id);
  return { ok: true };
}

export function cancelCart(db: DatabaseSync, phone: string): void {
  db.prepare("UPDATE whatsapp_carts SET status = 'CANCELED', updated_at = ? WHERE customer_phone = ? AND status = 'OPEN'")
    .run(new Date().toISOString(), phone);
}

export function finalizeOrder(db: DatabaseSync, phone: string, checkoutData: Record<string, unknown>): {
  ok: boolean; orderId?: number; reason?: string; removedNames?: string[];
} {
  const cart = getOpenCart(db, phone);
  let items = getCartItems(db, cart.id as number);
  if (items.length === 0) return { ok: false, reason: 'carrinho vazio' };

  const removedNames: string[] = [];
  for (const it of items) {
    if (!it.product_id) continue;
    const p = db.prepare('SELECT ativo, publicado, estoque FROM produtos WHERE id = ?').get(it.product_id) as { ativo: number; publicado: number; estoque: number | null } | undefined;
    const dead = !p || p.ativo !== 1 || p.publicado !== 1 || !(p.estoque == null || Number(p.estoque) > 0);
    if (dead) {
      db.prepare('DELETE FROM whatsapp_cart_items WHERE id = ?').run(it.item_id);
      removedNames.push(it.name || 'Produto');
    }
  }
  if (removedNames.length > 0) {
    items = getCartItems(db, cart.id as number);
    if (items.length === 0) return { ok: false, reason: 'todos_removidos', removedNames };
  }

  const ts = new Date().toISOString();
  let total = 0;
  for (const it of items) total += Number(it.unit_price) * it.quantity;

  db.exec('BEGIN');
  try {
    // Gerar numero do pedido
    const seqRow = db.prepare("SELECT valor FROM sequencias WHERE chave = 'pedido'").get() as { valor: string } | undefined;
    let pedidoNum = 1;
    if (seqRow) {
      pedidoNum = Number(seqRow.valor) + 1;
      db.prepare("UPDATE sequencias SET valor = ? WHERE chave = 'pedido'").run(String(pedidoNum));
    } else {
      db.prepare("INSERT INTO sequencias (chave, valor) VALUES ('pedido', '1')").run();
    }

    const res = db
      .prepare(`INSERT INTO pedidos (numero, cliente_nome, cliente_telefone, subtotal, taxa_entrega, total, status, criado_em, origem)
                VALUES (?, ?, ?, ?, 0, ?, 'novo', ?, 'whatsapp')`)
      .run(String(pedidoNum), String(checkoutData.nome || ''), phone, Number(total.toFixed(2)), Number(total.toFixed(2)), ts);
    const orderId = Number(res.lastInsertRowid);

    const insertItem = db.prepare(
      'INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const it of items) {
      insertItem.run(orderId, it.product_id, it.name || 'Produto', it.quantity, it.unit_price, Number((Number(it.unit_price) * it.quantity).toFixed(2)));
    }

    // Baixar estoque
    for (const it of items) {
      if (it.product_id) {
        db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND estoque IS NOT NULL').run(it.quantity, it.product_id);
      }
    }

    db.prepare("UPDATE whatsapp_carts SET status = 'ORDERED', updated_at = ? WHERE id = ?").run(ts, cart.id as number);
    db.exec('COMMIT');
    return { ok: true, orderId, removedNames };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listOrdersByPhone(db: DatabaseSync, phone: string, limit = 5) {
  return db
    .prepare('SELECT id, total, status, criado_em AS created_at FROM pedidos WHERE cliente_telefone = ? AND origem = ? ORDER BY id DESC LIMIT ?')
    .all(phone, 'whatsapp', limit);
}

export function getOrderDetail(db: DatabaseSync, phone: string, orderId: number) {
  if (!/^\d+$/.test(String(orderId))) return null;
  const order = db
    .prepare('SELECT * FROM pedidos WHERE id = ? AND cliente_telefone = ? AND origem = ?')
    .get(Number(orderId), phone, 'whatsapp') as Record<string, unknown> | undefined;
  if (!order) return null;
  const items = db.prepare('SELECT nome_produto AS product_name, quantidade AS quantity, preco_unitario AS unit_price, subtotal FROM pedido_itens WHERE pedido_id = ?').all(Number(order.id));
  return { order, items };
}

export function changeQtyByName(db: DatabaseSync, phone: string, term: string, newQtyRaw: string): {
  ok: boolean; reply?: string; removed?: boolean; name?: string; qty?: number;
} {
  const view = viewCart(db, phone);
  if (view.empty) return { ok: false, reply: '🛒 Seu carrinho está vazio.' };

  const tn = String(term || '').toLowerCase().trim();
  const target = view.items.find((it) => (it.name || '').toLowerCase().includes(tn));
  if (!target) return { ok: false, reply: `Não encontrei "${term}" no carrinho.` };

  const n = Number.parseInt(newQtyRaw, 10);
  if (!Number.isInteger(n)) return { ok: false, reply: '⚠️ Quantidade inválida.' };

  if (n < 1) {
    db.prepare('DELETE FROM whatsapp_cart_items WHERE id = ?').run(target.item_id);
    return { ok: true, removed: true };
  }

  const settings = getSettings(db);
  const p = db.prepare('SELECT estoque, ativo, publicado FROM produtos WHERE id = ?').get(target.product_id) as { estoque: number | null; ativo: number; publicado: number } | undefined;
  const max = p && p.estoque != null && Number(p.estoque) > 0 ? Math.floor(Number(p.estoque)) : settings.maxQuantityPerItem;
  if (!p || p.ativo !== 1 || p.publicado !== 1) return { ok: false, reply: '⚠️ Esse produto ficou indisponível.' };
  if (n > max) return { ok: false, reply: `⚠️ Tenho apenas ${max} unidade(s).` };

  const ts = new Date().toISOString();
  db.prepare('UPDATE whatsapp_cart_items SET quantity = ?, updated_at = ? WHERE cart_id = ? AND produto_id = ?')
    .run(n, ts, (getOpenCart(db, phone)).id as number, target.product_id);
  return { ok: true, name: target.name, qty: n };
}

export function adjustQtyByName(db: DatabaseSync, phone: string, term: string, deltaRaw: string): {
  ok: boolean; reply?: string; removed?: boolean;
} {
  const view = viewCart(db, phone);
  if (view.empty) return { ok: false, reply: '🛒 Seu carrinho está vazio.' };
  const tn = String(term || '').toLowerCase().trim();
  const target = view.items.find((it) => (it.name || '').toLowerCase().includes(tn));
  if (!target) return { ok: false, reply: `Não encontrei "${term}" no carrinho.` };
  const d = Number.parseInt(deltaRaw, 10);
  if (!Number.isInteger(d)) return { ok: false, reply: '⚠️ Quantidade inválida.' };
  const newQ = target.quantity + d;
  if (newQ < 1) {
    db.prepare('DELETE FROM whatsapp_cart_items WHERE id = ?').run(target.item_id);
    return { ok: true, removed: true };
  }
  return changeQtyByName(db, phone, term, String(newQ));
}
