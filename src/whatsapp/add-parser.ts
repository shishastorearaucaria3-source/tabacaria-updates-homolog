function norm(t: string): string {
  return String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const LEAD_VERBS =
  /^(?:quero|queria|me ve|me da|manda|mande|manda pra mim|manda pra|traz|traz pra mim|traz pra|adiciona|adicionar|add|coloca|colocar|poe|ponha|pego|compra|comprar|tem|temos|vc tem|voces tem|voce tem|quanto custa|qual o valor|qual a preco|qual o preco|preco da|preco do|preco de|valor da|valor do)\s+/i;

const WORD_QTY: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };

export function parseAdd(rawText: string): { qty: number; term: string; explicit?: boolean } | null {
  const t = norm(rawText);
  if (!t) return null;
  if (/^\d{1,3}$/.test(t)) return null;

  let s = t;
  s = s.replace(/(\d{1,3})\s*x\b/g, '$1 ');
  let prev: string;
  do {
    prev = s;
    s = s.replace(LEAD_VERBS, '');
  } while (s !== prev);
  s = s.replace(/^(mais|mais um|mais uma)\s+/, '').trim();
  if (!s) return { qty: 1, term: '' };

  if (/^(compra[r]?|fazer (um )?pedido|fechar (o )?pedido|finalizar)$/.test(s)) {
    return { qty: 1, term: '', explicit: false };
  }

  let m = s.match(/^(\d{1,3})\s+(.+)$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n >= 1 && n <= 999) {
      const rest = cleanTerm(m[2]);
      if (rest) return { qty: n, term: rest, explicit: true };
    }
  }

  m = s.match(/^(um|uma|dois|duas|tres|quatro|cinco|seis)\s+(.+)$/);
  if (m) {
    const rest = cleanTerm(m[2]);
    if (rest) return { qty: WORD_QTY[m[1]], term: rest, explicit: true };
  }

  m = s.match(/^(.+?)\s+(\d{1,2})$/);
  if (m && /[a-z]/i.test(m[1]) && m[1].length >= 2) {
    const n = Number.parseInt(m[2], 10);
    if (n >= 1 && n <= 99) {
      const rest = cleanTerm(m[1]);
      if (rest) return { qty: n, term: rest, explicit: true };
    }
  }

  const clean = cleanTerm(s);
  if (!clean) return null;
  if (!/[a-z]/i.test(clean)) return null;
  return { qty: 1, term: clean, explicit: false };
}

function cleanTerm(term: string): string {
  let t = String(term || '').trim();
  let prev: string;
  do {
    prev = t;
    t = t.replace(/^(unidade|unidades?|de um|de uma|de)\s+/i, '');
    t = t.replace(/\s+(unidade|unidades?)$/i, '');
  } while (t !== prev);
  t = t.replace(/[?!.,]+$/, '').trim();
  return t;
}
