import { extractQuantity } from './normalize.js';

const LEAD_VERBS = /^(quero|queria|adiciona[r]?|coloca[r]?|poe|ponha|add|comprar?|manda[r]?|me ve|pego)\s+(?:um|uma|uns|umas)?\s*/i;

export function splitMultiOrder(text: string): string[] {
  let t = String(text || '').replace(/\r?\n/g, ' , ');
  t = t.replace(/\s+e\s+(?=(?:\d|[a-zà-ú]))/gi, ' , ');
  t = t.replace(LEAD_VERBS, '');
  return t
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function parseMultiOrder(textRaw: string): Array<{ qty: number; term: string }> | null {
  const segs = splitMultiOrder(textRaw);
  if (segs.length < 2) return null;

  const firstLooksLikeItem = /^(quero|queria|adiciona|coloca|poe|add|compra|um|uma|dois|duas|tres|\d{1,3})\b/i.test(segs[0]);
  if (!firstLooksLikeItem) return null;

  const out: Array<{ qty: number; term: string }> = [];
  for (const seg of segs) {
    const { qty, rest } = extractQuantity(seg.replace(/^(tambem|também|mais)\s+/i, ''));
    if (!rest || rest.length < 2) continue;
    out.push({ qty, term: rest });
  }
  if (out.length < 2) return null;
  return out;
}
