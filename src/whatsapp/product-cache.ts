import type { DatabaseSync } from 'node:sqlite';
import { normalizeForSearch } from './normalize.js';

export interface CachedProduct {
  id: number;
  name: string;
  normName: string;
  tokens: Set<string>;
  categoryRaw: string;
  category: string;
  subcategory: string;
  brand: string;
  description: string;
  price: number;
  hasPromo: boolean;
  stock: number;
  createdAt: string | null;
}

const TTL_MS = 60 * 1000;

const caches = new WeakMap<DatabaseSync, { ts: number; items: CachedProduct[] }>();

export function invalidateProductCache(db: DatabaseSync): void {
  caches.delete(db);
}

function rebuild(db: DatabaseSync): { ts: number; items: CachedProduct[] } {
  const rows = db
    .prepare(
      `SELECT p.id, p.nome AS name,
              COALESCE(c.nome, '') AS category,
              COALESCE(sc.nome, '') AS subcategory,
              COALESCE(m.nome, '') AS brand,
              p.preco_venda AS price, p.preco_promo AS promotional_price,
              p.estoque AS stock, p.descricao AS description,
              p.criado_em AS created_at
       FROM produtos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN subcategorias sc ON sc.id = p.subcategoria_id
       LEFT JOIN marcas m ON m.id = p.marca_id
       WHERE p.ativo = 1 AND p.publicado = 1 AND (p.estoque IS NULL OR p.estoque > 0)`
    )
    .all() as Array<{
      id: number; name: string; category: string; subcategory: string; brand: string;
      price: number; promotional_price: number | null; stock: number; description: string; created_at: string | null;
    }>;

  const items: CachedProduct[] = rows.map((row) => {
    const normName = normalizeForSearch(row.name);
    return {
      id: row.id,
      name: row.name,
      normName,
      tokens: new Set(normName.split(' ').filter(Boolean)),
      categoryRaw: row.category || '',
      category: normalizeForSearch(row.category || ''),
      subcategory: normalizeForSearch(row.subcategory || ''),
      brand: normalizeForSearch(row.brand || ''),
      description: normalizeForSearch(row.description || ''),
      price: row.promotional_price != null ? Number(row.promotional_price) : Number(row.price),
      hasPromo: row.promotional_price != null,
      stock: Number(row.stock ?? 0),
      createdAt: row.created_at || null,
    };
  });

  return { ts: Date.now(), items };
}

export function getAvailableCatalog(db: DatabaseSync, forceRefresh = false): CachedProduct[] {
  let cache = caches.get(db);
  if (!cache || forceRefresh || Date.now() - cache.ts > TTL_MS) {
    cache = rebuild(db);
    caches.set(db, cache);
  }
  return cache.items;
}
