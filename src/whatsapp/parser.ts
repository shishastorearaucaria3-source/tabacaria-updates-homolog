export interface WhatsAppEvent {
  messageId: string | null;
  type: string;
  phone: string;
  phoneRaw: string;
  isGroup: boolean;
  groupName: string | null;
  name: string | null;
  text: string | null;
  timestampIso: string | null;
  order: unknown;
  location: { lat: number; lng: number } | null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function unwrapValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = unwrapValue(item);
      if (r !== null && r !== undefined) return r;
    }
    return null;
  }
  if (t === 'object') {
    const obj = v as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, 'value')) {
      const inner = unwrapValue(obj.value);
      if (inner !== null && inner !== undefined) return inner;
    }
    for (const key of Object.keys(obj)) {
      if (key === 'value') continue;
      const r = unwrapValue(obj[key]);
      if (r !== null && r !== undefined) return r;
    }
  }
  return null;
}

function pick(...sources: unknown[]): string | null {
  return firstString(...sources.map((s) => unwrapValue(s)));
}

export function parseEvent(body: unknown): { ok: false; reason: string } | { ok: true; event: WhatsAppEvent } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'payload nao e um objeto JSON' };
  }

  const b = body as Record<string, unknown>;
  const rawPhone = pick(b.phone, b.m_user, b.m_phone);
  const groupId = pick(b.m_gid);
  const groupName = pick(b.m_gname);
  const isGroup = Boolean(groupId || groupName) || (rawPhone ? rawPhone.includes('@g.us') : false);

  const digits = rawPhone ? String(rawPhone).replace(/\D/g, '') : '';
  if (!rawPhone || (!isGroup && digits.length < 10)) {
    return { ok: false, reason: 'telefone ausente ou invalido' };
  }
  if (digits.length > 15) {
    return { ok: false, reason: 'telefone com tamanho invalido' };
  }

  const messageId = pick(b.id, b.message_id, b.messageId, b.m_id);
  const type = pick(b.type, b.m_type) || 'unknown';
  const name = pick(b.name, b.m_cname, b.m_uname);
  const text = pick(b.text, b.m_text, b.m_content);
  const order = b.order !== undefined ? b.order : b.m_order;

  let timestampIso: string | null = null;
  const tsRaw = unwrapValue(b.timestamp) ?? unwrapValue(b.m_timestamp);
  if (tsRaw !== null && tsRaw !== '') {
    const n = Number(tsRaw);
    if (Number.isFinite(n)) {
      const ms = n > 1e12 ? n : n * 1000;
      timestampIso = new Date(ms).toISOString();
    }
  }
  if (!timestampIso) {
    const dt = pick(b.datetime, b.m_datetime);
    if (dt) {
      const d = new Date(dt);
      if (!Number.isNaN(d.getTime())) timestampIso = d.toISOString();
    }
  }

  let location: { lat: number; lng: number } | null = null;
  const locRaw = (b as Record<string, unknown>).location ?? (b as Record<string, unknown>).m_location;
  if (locRaw) {
    if (typeof locRaw === 'object' && !Array.isArray(locRaw)) {
      const locObj = locRaw as Record<string, unknown>;
      const la = Number(locObj.latitude ?? locObj.lat);
      const ln = Number(locObj.longitude ?? locObj.lng);
      if (Number.isFinite(la) && Number.isFinite(ln)) location = { lat: la, lng: ln };
    } else {
      const mloc = String(locRaw).match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
      if (mloc) {
        const la = Number(mloc[1]);
        const ln = Number(mloc[2]);
        if (Math.abs(la) <= 90 && Math.abs(ln) <= 180) location = { lat: la, lng: ln };
      }
    }
  }

  return {
    ok: true,
    event: {
      messageId,
      type: type as string,
      phone: digits,
      phoneRaw: rawPhone,
      isGroup,
      groupName,
      name,
      text,
      timestampIso,
      order: order === undefined ? null : order,
      location,
    },
  };
}
