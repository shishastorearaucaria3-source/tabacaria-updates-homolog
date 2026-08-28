// Parser binário NEX (.nx1) baseado em GUID + offsets comprovados (engenharia reversa 7/7).
// Fonte de itens = MovEst.nx1 (itens modernos com produto/quant/preço).
// Fonte de vendas = Tran.nx1 (id + caixa).
// Enumeração = slot walker determinístico por bloco de 4096 bytes.
// NÃO modifica arquivos; opera sobre buffers já carregados em memória.

export interface ItemMovEst {
  id: number
  uid: string
  tran: number
  produtoId: number
  produtoUid: string
  quant: number
  unit: number
  total: number
}

export interface VendaTran {
  id: number
  uid: string
  caixa: number
  caixa2: number
}

const BLOCK = 4096

// Converte 16 bytes (layout .NET) -> GUID string (formato canônico)
export function guidToNetString(buf16: Buffer): string {
  if (!buf16 || buf16.length !== 16) return ''
  const p = (o: number, n: number) => buf16[o + n].toString(16).padStart(2, '0')
  return `${p(3, 0)}${p(2, 0)}${p(1, 0)}${p(0, 0)}-${p(5, 0)}${p(4, 0)}-${p(7, 0)}${p(6, 0)}-${p(8, 0)}${p(9, 0)}-${p(10, 0)}${p(11, 0)}${p(12, 0)}${p(13, 0)}${p(14, 0)}${p(15, 0)}`.toUpperCase()
}

function isGuidV4(buf: Buffer, o: number, len: number): boolean {
  return o + len <= buf.length && (buf[o + 7] >>> 4) === 4 && (buf[o + 8] & 0xc0) === 0x80
}

// Config: stride, first slot, slots por bloco (DNA de cada tabela no .nx1).
interface SlotsCfg { stride: number; first: number; slots: number }

const CFG_MOVEST: SlotsCfg = { stride: 676, first: 40, slots: 6 }
const CFG_TRAN: SlotsCfg = { stride: 1280, first: 256, slots: 3 }

// --- MovEst.nx1 (ITEM): produto + quant + unit + total, vinculado por tran ---
export function lerItensMovEst(buf: Buffer): ItemMovEst[] {
  const { stride, first, slots } = CFG_MOVEST
  const totalBlocks = Math.floor(buf.length / BLOCK)
  const itens: ItemMovEst[] = []
  const vistos = new Set<string>()
  for (let blk = 8; blk < totalBlocks; blk++) {
    const base = blk * BLOCK
    for (let s = 0; s < slots; s++) {
      const gp = base + first + s * stride
      if (!isGuidV4(buf, gp, 16)) continue
      const itemId = buf.readInt32LE(gp - 4)
      const tran = buf.readInt32LE(gp + 20)
      const produtoId = buf.readInt32LE(gp + 71)
      const quant = buf.readDoubleLE(gp + 75)
      const unit = Number(buf.readBigInt64LE(gp + 83)) / 10000
      const total = Number(buf.readBigInt64LE(gp + 91)) / 10000
      if (!(itemId > 0 && itemId < 3e8 && tran > 0 && produtoId > 0 && quant > 0 && quant < 1e6 && unit > 0 && unit < 1e6 && total > 0
        && isGuidV4(buf, gp + 55, 16)
        && Math.abs(total - quant * unit) <= Math.max(0.02 * quant * unit, 0.01))) continue
      const uid = guidToNetString(buf.subarray(gp, gp + 16))
      if (vistos.has(uid)) continue
      vistos.add(uid)
      itens.push({
        id: itemId, uid, tran,
        produtoId,
        produtoUid: guidToNetString(buf.subarray(gp + 55, gp + 71)),
        quant, unit, total,
      })
    }
  }
  return itens
}

// --- Tran.nx1 (VENDA): id + caixa ---
export function lerVendasTran(buf: Buffer): VendaTran[] {
  const { stride, first, slots } = CFG_TRAN
  const totalBlocks = Math.floor(buf.length / BLOCK)
  const vendas: VendaTran[] = []
  const vistos = new Set<string>()
  for (let blk = 8; blk < totalBlocks; blk++) {
    const base = blk * BLOCK
    for (let s = 0; s < slots; s++) {
      const gp = base + first + s * stride
      if (!isGuidV4(buf, gp, 16)) continue
      const id = buf.readInt32LE(gp - 4)
      if (!(id > 0 && id < 5e8)) continue
      // valida id ASCII em rel +32
      let ascii = ''
      for (let k = gp + 32; k < gp + 44; k++) { const c = buf[k]; if (c === 0) break; ascii += String.fromCharCode(c) }
      if (ascii !== String(id)) continue
      const uid = guidToNetString(buf.subarray(gp, gp + 16))
      if (vistos.has(uid)) continue
      vistos.add(uid)
      vendas.push({
        id, uid,
        caixa: buf.readInt32LE(gp + 451),
        caixa2: buf.readInt32LE(gp + 455),
      })
    }
  }
  return vendas
}
