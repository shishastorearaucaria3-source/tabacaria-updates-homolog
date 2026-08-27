import type { DatabaseSync } from 'node:sqlite';
import { getAvailableCatalog, type CachedProduct } from './product-cache.js';
import { normalizeForSearch, tokenizeForSearch } from './normalize.js';

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function scoreItem(item: CachedProduct, qTokens: string[], qFull: string): number {
  let score = 0;

  if (item.normName === qFull) score += 120;
  else {
    if (qFull.length >= 3 && item.normName.includes(qFull)) score += 70;
  }

  let matchedTokens = 0;
  for (const tk of qTokens) {
    let tokenScore = 0;
    if (item.tokens.has(tk)) tokenScore = 12;
    else {
      for (const wt of item.tokens) {
        if (wt.startsWith(tk) && tk.length >= 3) { tokenScore = 8; break; }
        if (tk.length >= 4 && wt.includes(tk)) { tokenScore = 6; break; }
      }
    }
    if (!tokenScore && item.brand) {
      if (item.brand.includes(tk)) tokenScore = 9;
    }
    if (!tokenScore && item.subcategory && item.subcategory.includes(tk)) tokenScore = 5;
    if (!tokenScore && item.category && item.category.includes(tk)) tokenScore = 4;
    if (!tokenScore && item.description && item.description.includes(tk)) tokenScore = 2;
    matchedTokens += tokenScore > 0 ? 1 : 0;
    score += tokenScore;
  }
  if (qTokens.length > 1 && matchedTokens === qTokens.length) score += 15;

  if (score > 0) score -= item.normName.length / 200;
  return score;
}

export interface SearchResult {
  id: number;
  name: string;
  price: number;
  available: boolean;
  priceLabel: string;
  category: string;
  description: string | null;
  imageUrl: string | null;
  score?: number;
}

function itemToPublic(item: CachedProduct): SearchResult {
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    available: true,
    priceLabel: `R$ ${Number(item.price || 0).toFixed(2).replace('.', ',')}`,
    category: item.category,
    description: null,
    imageUrl: null,
  };
}

export const DEFAULT_SEARCH_SETTINGS = { limit: 10, min_score: 8, reco_count: 3 };
let _searchSettings: Record<string, number> = {};
export function setSearchSettings(obj: Record<string, number>): void {
  _searchSettings = obj || {};
}
function getSearchSetting(key: string): number {
  return _searchSettings[key] ?? (DEFAULT_SEARCH_SETTINGS as Record<string, number>)[key] ?? 0;
}

export function searchSmart(db: DatabaseSync, rawTerm: string): { mode: string; items: SearchResult[]; term: string } {
  const qFull = normalizeForSearch(rawTerm);
  const qTokens = tokenizeForSearch(rawTerm);
  const catalogItems = getAvailableCatalog(db);
  const limit = getSearchSetting('limit');

  if (qTokens.length === 0) return { mode: 'none', items: [], term: qFull };

  const tokenHasHit = new Map(qTokens.map((tk) => [tk, false]));
  const scored: SearchResult[] = [];
  for (const item of catalogItems) {
    for (const tk of qTokens) {
      if (item.tokens.has(tk)) tokenHasHit.set(tk, true);
    }
    const s = scoreItem(item, qTokens, qFull);
    if (s >= getSearchSetting('min_score')) scored.push({ ...itemToPublic(item), score: s });
  }
  const missingToken = [...tokenHasHit.values()].includes(false);
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
  const top = scored.slice(0, limit);

  if (top.length > 0 && !missingToken) {
    const best = top[0];
    const second = top[1];
    const dominant = !second || (best.score ?? 0) - (second.score ?? 0) >= 25;
    if (dominant) return { mode: 'exact', items: [best], term: qFull };
    return { mode: 'list', items: top, term: qFull };
  }

  const recos = recommendNear(catalogItems, qTokens);
  if (recos.length > 0) return { mode: 'recommend', items: recos.slice(0, getSearchSetting('reco_count')), term: qFull };

  const biggest = qTokens.reduce((a, b) => (b.length > a.length ? b : a), '');
  if (biggest.length >= 3) {
    const relaxed = catalogItems
      .map((item) => ({ item, s: scoreItem(item, [biggest], biggest) }))
      .filter((x) => x.s >= 10)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map((x) => ({ ...itemToPublic(x.item), score: x.s }));
    if (relaxed.length > 0) return { mode: 'recommend', items: relaxed, term: qFull };
  }

  return { mode: 'none', items: [], term: qFull };
}

function recommendNear(catalogItems: CachedProduct[], qTokens: string[]): SearchResult[] {
  const out: Array<SearchResult & { proximity: number }> = [];
  for (const item of catalogItems) {
    let proximity = 0;
    for (const tk of qTokens) {
      let bestTok = Infinity;
      for (const wt of item.tokens) {
        if (Math.abs(wt.length - tk.length) > 3) continue;
        const d = lev(tk, wt);
        if (d < bestTok) bestTok = d;
      }
      if (bestTok <= (tk.length >= 5 ? 2 : 1)) proximity += 1;
    }
    if (proximity > 0) {
      const pub = itemToPublic(item);
      out.push({ ...pub, proximity });
    }
  }
  out.sort((a, b) => b.proximity - a.proximity || a.name.localeCompare(b.name));
  return out.slice(0, 3).map(({ proximity, ...rest }) => rest);
}

export function search(db: DatabaseSync, term: string, limit = 10): SearchResult[] {
  return searchSmart(db, term).items.slice(0, limit);
}

export function listCategories(db: DatabaseSync, limit = 9): Array<{ key: string; label: string; total: number }> {
  const items = getAvailableCatalog(db);
  const counts = new Map<string, number>();
  for (const it of items) {
    const rawCat = it.categoryRaw || it.category;
    if (!rawCat) continue;
    counts.set(rawCat, (counts.get(rawCat) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, total]) => ({ key, label: key, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export function byCategory(db: DatabaseSync, category: string, limit = 15): SearchResult[] {
  const catNorm = normalizeForSearch(category);
  return getAvailableCatalog(db)
    .filter((it) => it.category === catNorm || it.category.includes(catNorm))
    .slice(0, limit)
    .map(itemToPublic);
}

export function getProductById(db: DatabaseSync, id: number): SearchResult | null {
  const row = db.prepare(
    `SELECT p.id, p.nome AS name,
            COALESCE(c.nome, '') AS category,
            COALESCE(sc.nome, '') AS subcategory,
            p.preco_venda AS price, p.preco_promo AS promotional_price,
            p.estoque AS stock, p.descricao AS description,
            p.imagem AS image_blob
     FROM produtos p
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN subcategorias sc ON sc.id = p.subcategoria_id
     WHERE p.id = ?`
  ).get(Number(id)) as {
    id: number; name: string; category: string; subcategory: string;
    price: number; promotional_price: number | null; stock: number;
    description: string | null; image_blob: Buffer | null;
  } | undefined;

  if (!row) return null;
  const price = row.promotional_price != null ? Number(row.promotional_price) : Number(row.price);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price,
    priceLabel: `R$ ${price.toFixed(2).replace('.', ',')}`,
    available: (row.stock == null || Number(row.stock) > 0),
    stock: Number(row.stock ?? 0),
    description: row.description || null,
    imageUrl: row.image_blob ? 'data:image/jpeg;base64,' + row.image_blob.toString('base64') : null,
  } as SearchResult & { stock: number; hasPromo: boolean };
}
