export function baseNormalize(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,;:!?"'´`^~ºª()\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeUnits(text: string): string {
  let t = String(text || '');
  t = t.replace(/(\d)[\s.-]*mil\b/g, '$1000 ');
  t = t.replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n: string) => {
    const num = Number(n);
    return Number.isInteger(num) ? `${num}000 ` : `${Math.round(num * 1000)} `;
  });
  t = t.replace(/(\d)\.(\d{3})\b/g, '$1$2');
  return t.replace(/\s+/g, ' ').trim();
}

export function normalizeForSearch(text: string): string {
  return normalizeUnits(baseNormalize(text));
}

const STOPWORDS = new Set(['tem', 'temos', 'quero', 'queria', 'quanto', 'custa', 'custo', 'valor', 'preco',
  'da', 'do', 'das', 'dos', 'de', 'para', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'uns', 'umas',
  'o', 'a', 'os', 'as', 'e', 'voces', 'vc', 'voce', 'algum', 'alguma', 'qual', 'quais']);

export function tokenizeForSearch(text: string): string[] {
  return normalizeForSearch(text)
    .split(' ')
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

const QTY_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3 };

export function extractQuantity(textRaw: string): { qty: number; rest: string; moreOnly: boolean } {
  let t = baseNormalize(textRaw);
  t = t.replace(/^(quero|queria|adiciona[r]?|coloca[r]?|poe|por|add|comprar?)\s+/i, '');
  let qty = 1;

  let m = t.match(/^(\d{1,3})\s*(?:x\s*)?(.+)$/);
  if (!m) m = t.match(/^(\d{1,3})\s*$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isInteger(n) && n >= 1 && n <= 999) {
      qty = n;
      t = (m[2] || '').trim();
    }
  } else {
    const word = t.match(/^(um|uma|dois|duas|tres)\s+(.+)$/);
    if (word) {
      qty = QTY_WORDS[word[1]] || 1;
      t = word[2].trim();
    } else {
      const trailing = t.match(/(.+?)\s+(\d{1,3})$/);
      if (trailing && Number(trailing[2]) >= 1) {
        qty = Number(trailing[2]);
        t = trailing[1].trim();
      }
    }
  }

  const mais = t.match(/^mais\s+(\d{1,3})$/);
  if (mais) {
    const n = Number.parseInt(mais[1], 10);
    if (n >= 1) return { qty: n, rest: '', moreOnly: true };
  }

  return { qty, rest: normalizeForSearch(t), moreOnly: false };
}
