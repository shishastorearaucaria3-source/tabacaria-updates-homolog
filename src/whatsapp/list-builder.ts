import type { DatabaseSync } from 'node:sqlite';
import { getAvailableCatalog, type CachedProduct } from './product-cache.js';
import { categoryLabels } from './repo.js';

function isLaunch(item: CachedProduct, launchDays: number): boolean {
  if (!item.createdAt) return false;
  const ageMs = Date.now() - new Date(item.createdAt).getTime();
  return ageMs <= launchDays * 24 * 60 * 60 * 1000;
}

const LAUNCH_TAG = ' 🔥 LANÇAMENTO';

function fmt(v: number): string {
  return Number(v || 0).toFixed(2).replace('.', ',');
}

function normalize(s: string): string {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function buildFullList(db: DatabaseSync, opts: { launchDays?: number; maxLines?: number; onlyCategory?: string | null } = {}): string | null {
  const { launchDays = 7, maxLines = 120, onlyCategory = null } = opts;
  const items = getAvailableCatalog(db);
  const labels = (() => { try { return categoryLabels(db); } catch { return {}; } })();

  let pool = items;
  if (onlyCategory) {
    const catNorm = normalize(onlyCategory);
    pool = items.filter((i) => i.category === catNorm || i.categoryRaw.toLowerCase().includes(catNorm));
    if (pool.length === 0) return null;
  }

  const groups = new Map<string, CachedProduct[]>();
  for (const it of pool) {
    const raw = it.categoryRaw || 'Outros';
    if (!groups.has(raw)) groups.set(raw, []);
    groups.get(raw)!.push(it);
  }

  const header = [
    `*LISTA ATUALIZADA ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}*`,
    '',
    'Consulte a disponibilidade.',
    'Produtos podem acabar sem aviso prévio.',
    '',
  ].join('\n');

  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const blocks: string[] = [];
  let lineCount = 0;
  let truncated = false;

  for (const [rawCat, list] of ordered) {
    if (lineCount >= maxLines) { truncated = true; break; }
    const label = labels[rawCat] || rawCat;
    const sorted = list.slice().sort((a, b) => Number(b.hasPromo) - Number(a.hasPromo) || a.name.localeCompare(b.name));
    const lines: string[] = [];
    for (const it of sorted) {
      if (lineCount >= maxLines) { truncated = true; break; }
      const tag = isLaunch(it, launchDays) ? LAUNCH_TAG : '';
      lines.push(`${it.name} — R$ ${fmt(it.price)}${it.hasPromo ? ' 🔥' : ''}${tag}`);
      lineCount += 1;
    }
    if (lines.length === 0) continue;
    blocks.push(`\n*${label.toUpperCase()}*\n${lines.join('\n')}`);
  }

  const footer = truncated
    ? `\n\n_Mensagem truncada para caber no WhatsApp._\n_Digite "lista <categoria>" para ver completa._`
    : `\n\n_Para pedir, digite o nome do produto com a quantidade._\n_Ex.: quero 2 zomo tropical_`;

  return header + blocks.join('\n') + footer;
}
