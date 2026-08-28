import { getDb, getDefaultDbPath, hashSenha } from './index'
import { registrarLog } from './servidor'
import { lerItensMovEst, lerVendasTran } from './nex-binary'
import AdmZip from 'adm-zip'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import type { SQLInputValue } from 'node:sqlite'

const UFS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])

interface ProgressoNex {
  ativo: boolean
  etapa: string
  atual: number
  total: number
  mensagem: string
}

let progresso: ProgressoNex = { ativo: false, etapa: '', atual: 0, total: 0, mensagem: '' }

export function getProgressoNex(): ProgressoNex {
  return { ...progresso }
}

function atualizarProgresso(p: Partial<ProgressoNex>): void {
  progresso = { ...progresso, ...p }
}

const pausar = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function decodificarUtf16(buf: Buffer, off: number, maxBytes: number): string {
  let s = ''
  const fim = Math.min(buf.length, off + maxBytes)
  for (let i = off; i + 1 < fim; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8)
    if (code === 0) break
    s += String.fromCharCode(code)
  }
  return s
}

function extrairStringsUtf16(buf: Buffer): { off: number; par: number; s: string; len: number }[] {
  const strs: { off: number; par: number; s: string; len: number }[] = []
  for (let i = 0; i + 1 < buf.length; i++) {
    const code = buf[i] | (buf[i + 1] << 8)
    if ((code >= 0x20 && code < 0x7f) || (code >= 0x00c0 && code <= 0x00ff)) {
      let j = i
      const chars: number[] = []
      while (j + 1 < buf.length) {
        const c = buf[j] | (buf[j + 1] << 8)
        if (c >= 0x20 && c < 0x7f) { chars.push(c); j += 2 }
        else if (c >= 0x00c0 && c <= 0x00ff) { chars.push(c); j += 2 }
        else break
      }
      if (chars.length >= 3) {
        strs.push({ off: i, par: i % 2, s: String.fromCharCode(...chars), len: chars.length })
        i = j - 1
      }
    }
  }
  return strs
}

function extrairProdutosDoCatalogo(buf: Buffer): Record<string, unknown>[] {
  const tam = buf.length
  const produtos: Record<string, unknown>[] = []
  for (let i = 0; i + 1 < tam; i++) {
    if (buf[i] === 0x7b && buf[i + 1] === 0x00) {
      let fim = -1
      let depth = 0
      let inStr = false
      let esc = false
      for (let j = i; j + 1 < tam; j += 2) {
        const code = buf[j] | (buf[j + 1] << 8)
        if (inStr) {
          if (esc) esc = false
          else if (code === 0x5c) esc = true
          else if (code === 0x22) inStr = false
        } else {
          if (code === 0x22) inStr = true
          else if (code === 0x7b) depth++
          else if (code === 0x7d) {
            depth--
            if (depth === 0) { fim = j + 2; break }
          }
        }
      }
      if (fim === -1) continue
      const texto = decodificarUtf16(buf, i, fim - i)
      let parsed: unknown = null
      try { parsed = JSON.parse(texto) } catch { continue }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>
        if (p.ProductName || p.ProductCode) produtos.push(p)
      }
      i = fim
    }
  }
  return produtos
}

function ehCPF(s: string): boolean { return /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s) || /^\d{11}$/.test(s) }
function ehRG(s: string): boolean { return /^\d[\d.]*\d-\d$/.test(s) && s.length >= 6 }
function ehCEP(s: string): boolean { return /^\d{5}-\d{3}$/.test(s) }
function ehUF(s: string): boolean { return UFS.has(s.toUpperCase()) && s.length === 2 }
function ehEmail(s: string): boolean { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) }
function ehRua(s: string): boolean { return /^(R\.|Rua|Av\.|Avenida|Travessa|Alameda|Rod\.|Rodovia|Estrada|Praça)/i.test(s) }
function ehNome(s: string): boolean { return /^[A-Za-zÀ-ÿ]/.test(s) && s.length > 3 && !ehCPF(s) && !ehRG(s) && !ehCEP(s) && !ehUF(s) && !ehEmail(s) && !/^\d{1,6}$/.test(s) }
function ehRuido(s: string): boolean { return s.length === 2 && /[^A-Za-zÀ-ÿ0-9 .\-/,()+]/.test(s) }
function ehTelDig(s: string): boolean { return /^\d{8,11}$/.test(s) }

function extrairClientes(buf: Buffer): Record<string, unknown>[] {
  const strs = extrairStringsUtf16(buf)
  const registros: { off: number; s: string }[] = []
  for (const s of strs) {
    const m = s.s.match(/^(\d{1,3})([A-Za-zÀ-ÿ].*)$/)
    if (m && m[2].length >= 3 && /[a-zà-ÿ]/.test(m[2])) registros.push(s)
  }
  registros.sort((a, b) => a.off - b.off)
  const clientes: Record<string, unknown>[] = []
  for (let i = 0; i < registros.length; i++) {
    const reg = registros[i]
    const fim = i + 1 < registros.length ? registros[i + 1].off : buf.length
    const m = reg.s.match(/^(\d{1,3})([A-Za-zÀ-ÿ].*)$/)
    const campos: string[] = []
    for (const s of strs) {
      if (s.off > reg.off && s.off < fim) campos.push(s.s)
    }
    const cli: Record<string, unknown> = {
      codigo: m?.[1] ?? null,
      nome: m?.[2] ?? reg.s,
      cpf: null,
      rg: null,
      telefone: null,
      email: null,
      pai: null,
      mae: null,
      endereco: null,
      numero: null,
      bairro: null,
      cidade: null,
      uf: null,
      cep: null,
      observacoes: null
    }
    const limpo = campos.filter(c => c !== 'BR' && c !== 'N' && c !== 'O' && !ehRuido(c))
    const idxCEP: number[] = []
    limpo.forEach((c, idx) => { if (ehCEP(c)) idxCEP.push(idx) })
    const usados = new Set<number>()
    const enderecos: Record<string, unknown>[] = []
    for (const cepIdx of idxCEP) {
      const end: Record<string, unknown> = { rua: null, numero: null, bairro: null, cidade: null, uf: null, cep: limpo[cepIdx], resto: [] }
      usados.add(cepIdx)
      if (cepIdx - 1 >= 0 && ehUF(limpo[cepIdx - 1])) { end.uf = limpo[cepIdx - 1].toUpperCase(); usados.add(cepIdx - 1) }
      const nomesAntes: { idx: number; v: string }[] = []
      for (let k = cepIdx - 2; k >= 0 && k >= cepIdx - 10; k--) {
        if (usados.has(k)) continue
        if (ehNome(limpo[k]) || /^\d{1,6}$/.test(limpo[k])) nomesAntes.push({ idx: k, v: limpo[k] })
        else break
      }
      const nomes = nomesAntes.reverse()
      for (const item of nomes) {
        if (/^\d{1,6}$/.test(item.v) && !end.numero) { end.numero = item.v; usados.add(item.idx) }
        else if (ehNome(item.v)) {
          if (!end.cidade) { end.cidade = item.v; usados.add(item.idx) }
          else if (!end.bairro) { end.bairro = item.v; usados.add(item.idx) }
        }
      }
      for (let k = cepIdx - 4; k >= 0 && k >= cepIdx - 10; k--) {
        if (ehRua(limpo[k])) { end.rua = limpo[k]; usados.add(k); break }
      }
      enderecos.push(end)
    }
    const restantes: string[] = []
    limpo.forEach((c, idx) => { if (!usados.has(idx)) restantes.push(c) })
    let viCPF = false
    for (const c of restantes) {
      if (ehCPF(c) && !cli.cpf) { cli.cpf = c; viCPF = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(c); }
      else if (/^\d{11}$/.test(c) && viCPF) { viCPF = false }
      else if (ehRG(c) && !cli.rg) { cli.rg = c; viCPF = false }
      else if (ehEmail(c) && !cli.email) { cli.email = c; viCPF = false }
      else if (ehTelDig(c)) {
        const telAtual = cli.telefone ? String(cli.telefone) : ''
        cli.telefone = telAtual ? telAtual + ',' + c : c
        viCPF = false
      }
      else if (/^\+\d+$/.test(c)) { /* country code */ }
      else if (ehNome(c)) {
        if (!cli.pai) cli.pai = c
        else if (!cli.mae) cli.mae = c
        else cli.observacoes = cli.observacoes ? String(cli.observacoes) + '; ' + c : c
        viCPF = false
      }
    }
    const prim = enderecos[0]
    if (prim) {
      cli.endereco = prim.rua
      cli.numero = prim.numero
      cli.bairro = prim.bairro
      cli.cidade = prim.cidade
      cli.uf = prim.uf
      cli.cep = prim.cep
    }
    clientes.push(cli)
  }
  return clientes
}

function extrairNomesSimples(buf: Buffer): string[] {
  const strs = extrairStringsUtf16(buf)
  const nomes = strs.filter(s => /[A-Za-zÀ-ÿ]/.test(s.s) && /^[\x20-\x7eÀ-ÿ0-9 .,\-/'":()%]+$/.test(s.s))
  const unicos: string[] = []
  const vistos = new Set<string>()
  for (const s of nomes) {
    const t = s.s.trim()
    if (t.length >= 2 && !vistos.has(t.toLowerCase())) {
      vistos.add(t.toLowerCase())
      unicos.push(t)
    }
  }
  return unicos
}

interface DadosNex {
  produtos: Record<string, unknown>[]
  clientes: Record<string, unknown>[]
  categorias: { nome: string; guid: string }[]
  marcas: string[]
  subcategorias: { nome: string; guid: string; uidCategoria: string }[]
  unidades: string[]
  usuarios: Record<string, unknown>[]
  caixas: Record<string, unknown>[]
  produtosNx1: { nome: string; cat: string; sub: string | null; ean: string | null; codigo: string | null }[]
  ncmCadastro: { codigo: string; desc: string }[]
  cestCadastro: { codigo: string; desc: string }[]
  cfopCadastro: { codigo: string; desc: string }[]
  vendas: Record<string, unknown>[]
  itens: Record<string, unknown>[]
  pagamentos: Record<string, unknown>[]
  naoInterpretados: Record<string, unknown>[]
  remocoes: Record<string, unknown>[]
  syslogs: Record<string, unknown>[]
  terminais: Record<string, unknown>[]
}

interface DadoBrutoPreservado {
  arquivo: string
  tabela: string
  registro: string
  offset: number
  tamanho: number
  bytes: string
  tipoProvavel: string
  status: string
}

const EPOCA_NET = 62135596800000

function converterDataNex(v: number): string | null {
  if (!v) return null
  const m = v - EPOCA_NET
  if (m > 0 && m < 4102444800000) return new Date(m).toISOString()
  return null
}

// --- EXTRAÇÃO DE VENDAS (Tran.nx1) ---
function extrairVendas(buf: Buffer): Record<string, unknown>[] {
  const tam = buf.length
  const vendas: Record<string, unknown>[] = []
  // procurar TranNome "Venda" em UTF-16
  const s = 'Venda'
  const vendaUtf16 = Buffer.from(s, 'utf16le')
  for (let i = 0; i <= tam - vendaUtf16.length; i++) {
    let ok = true
    for (let k = 0; k < s.length; k++) {
      if (buf[i + k * 2] !== s.charCodeAt(k) || buf[i + k * 2 + 1] !== 0) { ok = false; break }
    }
    if (!ok) continue
    // validar que é TranNome: byte imediatamente antes é 0x04
    if (i - 1 < 0 || buf[i - 1] !== 0x04) { i += s.length * 2 - 1; continue }
    // data: .NET datetime em offset relativo preferencial (-13 = DataHora da venda,
    // -39 = IncluidoEm); fallback para qualquer .NET datetime na janela
    let dataHora: string | null = null
    for (const rel of [-13, -14, -12, -39, -40, -38]) {
      const o = i + rel
      if (o >= 0 && o + 8 <= tam) {
        const d = converterDataNex(buf.readDoubleLE(o))
        if (d) {
          const ano = Number(d.slice(0, 4))
          if (ano >= 2010 && ano <= 2027) { dataHora = d; break }
        }
      }
    }
    if (!dataHora) {
      for (let o = i - 40; o <= i - 4; o++) {
        if (o + 8 <= tam) {
          const d = converterDataNex(buf.readDoubleLE(o))
          if (d) {
            const ano = Number(d.slice(0, 4))
            if (ano >= 2010 && ano <= 2027) { dataHora = d; break }
          }
        }
      }
    }
    if (dataHora) vendas.push({ data: dataHora, operador: null, idNex: null, offset: i })
    i += s.length * 2 - 1
  }
  return vendas
}

// Vendas do Tran.nx1 pelo parser binário (id + caixa), enriquecidas com a data
// extraída pela heurística legada. Retorna uma entrada por venda com id, uid, caixa,
// data (quando disponível) e o mapa id->data para pareamento exato por tran.
function extrairVendasComId(buf: Buffer): Record<string, unknown>[] {
  const bin = lerVendasTran(buf)
  // data por venda (heurística legada): id lido no offset binário
  const datas = new Map<number, string>()
  const s = 'Venda'
  const vendaUtf16 = Buffer.from(s, 'utf16le')
  for (let i = 0; i <= buf.length - vendaUtf16.length; i++) {
    let ok = true
    for (let k = 0; k < s.length; k++) {
      if (buf[i + k * 2] !== s.charCodeAt(k) || buf[i + k * 2 + 1] !== 0) { ok = false; break }
    }
    if (!ok) continue
    if (i - 1 < 0 || buf[i - 1] !== 0x04) { i += s.length * 2 - 1; continue }
    const id = buf.readInt32LE(i - 138)
    let dataHora: string | null = null
    for (const rel of [-13, -14, -12, -39, -40, -38]) {
      const o = i + rel
      if (o >= 0 && o + 8 <= buf.length) {
        const d = converterDataNex(buf.readDoubleLE(o))
        if (d) { const ano = Number(d.slice(0, 4)); if (ano >= 2010 && ano <= 2027) { dataHora = d; break } }
      }
    }
    if (!dataHora) {
      for (let o = i - 40; o <= i - 4; o++) {
        if (o + 8 <= buf.length) {
          const d = converterDataNex(buf.readDoubleLE(o))
          if (d) { const ano = Number(d.slice(0, 4)); if (ano >= 2010 && ano <= 2027) { dataHora = d; break } }
        }
      }
    }
    if (id > 0 && id < 5e8 && dataHora) datas.set(id, dataHora)
    i += s.length * 2 - 1
  }
  return bin.map((v) => ({
    id: v.id,
    uid: v.uid,
    caixa: v.caixa,
    data: datas.get(v.id) ?? null,
  }))
}

// Itens do MovEst.nx1 pelo parser binário (produto/quant/unit/total), vinculados
// à venda pelo campo tran (id da venda). Substitui a extração falha do ITran.
function extrairItensMovEst(buf: Buffer): Record<string, unknown>[] {
  return lerItensMovEst(buf).map((it) => ({
    tran: it.tran,
    produtoNex: it.produtoId,
    produtoUid: it.produtoUid,
    quant: it.quant,
    unit: it.unit,
    total: it.total,
    uid: it.uid,
  }))
}

// --- EXTRAÇÃO DE ITENS (ITran.nx1) ---
// Detecta o formato físico do ITran (168B legado do ZIP ou 232B variável da pasta Dados)
// e extrai os itens de forma best-effort, preservando a referência de produto (+160).
function extrairItens(buf: Buffer): Record<string, unknown>[] {
  const itens: Record<string, unknown>[] = []
  // amostra de marcadores para detectar o stride dominante
  const gaps: Record<number, number> = {}
  let ultimo = -1
  let amostras = 0
  for (let x = 24576; x + 4 < buf.length && amostras < 20000; x++) {
    if (buf[x] === 0x28 && buf[x + 1] === 0x00 && buf[x + 2] === 0x10 && buf[x + 3] === 0xc0) {
      if (ultimo >= 0) {
        const g = x - ultimo
        gaps[g] = (gaps[g] || 0) + 1
      }
      ultimo = x
      amostras++
      x += 3
    }
  }
  let stride = 168
  if (Object.keys(gaps).length > 0) {
    const dom = Object.entries(gaps).sort((a, b) => b[1] - a[1])[0]
    stride = Number(dom[0])
  }
  const variado = stride >= 200
  // Formato legado (168B, ZIP): campos em offsets fixos com data
  if (!variado) {
    let i = 24576
    while (i < buf.length - 168) {
      if (buf[i] === 0x28 && buf[i + 1] === 0x00 && buf[i + 2] === 0x10 && buf[i + 3] === 0xc0) {
        const id = buf.readUInt32LE(i + 4)
        const venda = buf.readUInt32LE(i + 24)
        const produto = buf.readUInt32LE(i + 160)
        const tipo = buf.readUInt32LE(i + 164)
        const caixa = buf.readUInt32LE(i + 28)
        const data = converterDataNex(buf.readDoubleLE(i + 44))
        if (id > 0 && id < 1000000 && venda < 1000000) {
          itens.push({
            idNex: id,
            vendaNex: venda,
            produtoNex: produto,
            tipo,
            caixa,
            data,
            bytesBrutos: buf.slice(i, i + 168).toString('hex')
          })
        }
        i += 168
      } else {
        i += 2
      }
    }
    return itens
  }
  // Formato variado (232B, pasta Dados): andar por cada marcador e validar
  // pelo caixa (+176) e id do item (+12); produto (+160) fica best-effort.
  for (let i = 24576; i + 240 < buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0x00 && buf[i + 2] === 0x10 && buf[i + 3] === 0xc0) {
      const id = buf.readUInt32LE(i + 12)
      const caixa = buf.readUInt32LE(i + 176)
      if (id > 0 && id < 1000000000 && caixa >= 1000 && caixa < 10000) {
        const venda = buf.readUInt32LE(i + 28)
        const produto = buf.readUInt32LE(i + 160)
        const produto2 = buf.readUInt32LE(i + 84)
        itens.push({
          idNex: id,
          vendaNex: venda > 0 && venda < 1000000000 ? venda : null,
          produtoNex: produto > 0 && produto < 1000000000 ? produto : null,
          produtoNex2: produto2 > 0 && produto2 < 1000000000 ? produto2 : null,
          tipo: null,
          caixa: caixa > 0 && caixa < 1000000000 ? caixa : null,
          data: null,
          bytesBrutos: buf.slice(i, i + 240).toString('hex')
        })
        i += 3
      }
    }
  }
  return itens
}

// --- EXTRAÇÃO DE PAGAMENTOS (PagEspecies.nx1) ---
function extrairPagamentos(buf: Buffer): Record<string, unknown>[] {
  const pagamentos: Record<string, unknown>[] = []
  for (let o = 24576; o < buf.length - 56; o += 2) {
    const d = buf.readDoubleLE(o + 32)
    if (!converterDataNex(d)) continue
    let entropia = 0
    for (let k = o; k < o + 32; k++) {
      const b = buf[k]
      if (b !== 0 && !(b >= 0x20 && b < 0x7f)) entropia++
    }
    if (entropia < 12) continue
    const venda = buf.readUInt32LE(o + 40)
    const valor = buf.readUInt32LE(o + 48)
    const forma = buf.readUInt32LE(o + 44)
    const troco = buf.readUInt32LE(o + 56)
    pagamentos.push({
      vendaNex: venda,
      data: converterDataNex(d),
      valorCentavos: valor < 1000000000 ? valor : null,
      forma,
      trocoCentavos: troco < 1000000000 ? troco : null,
      bytesBrutos: buf.slice(o, o + 72).toString('hex')
    })
  }
  return pagamentos
}

// --- EXTRAÇÃO RegistrosRemovidos (histórico de remoções) ---
function extrairRemocoes(buf: Buffer): Record<string, unknown>[] {
  const strs = extrairStringsUtf16(buf).filter(s => s.s.length >= 3)
  const remocoes: Record<string, unknown>[] = []
  const tabelas = new Set(['Produtos', 'Clientes', 'Vendas', 'Compras', 'Categorias', 'Marcas', 'Fornecedores', 'Usuarios', 'Orcamentos'])
  // âncora: cada registro começa com a TableOrigem (ex: "Produtos")
  for (let i = 0; i < strs.length; i++) {
    const t = strs[i].s.trim()
    if (!tabelas.has(t)) continue
    const descricao = strs[i + 1]?.s ?? null
    const removidoPor = strs[i + 2]?.s ?? null
    const fimReg = i + 3 < strs.length ? strs[i + 3].off : buf.length
    let data: string | null = null
    for (let o = strs[i].off - 20; o < Math.min(fimReg, strs[i].off + 200); o += 2) {
      const d = converterDataNex(buf.readDoubleLE(o))
      if (d) data = d
    }
    remocoes.push({
      tabela_origem: t,
      descricao,
      removido_por: removidoPor,
      data,
      campos_extras: [],
      bytes_brutos: buf.slice(strs[i].off - 20, Math.min(fimReg, strs[i].off + 200)).toString('hex')
    })
    i += 2
  }
  return remocoes
}

// --- EXTRAÇÃO syslog ---
function extrairSyslog(buf: Buffer): Record<string, unknown>[] {
  const EXCLUIR = /^(NX!2|NXHD|NXSH|nx1xDefault|Stream|Blob|Record|AutoInc|Tnx|FilesDescriptor|LocaleDescriptor|RecordDescriptor|HeapDescriptor|BlockHeapDescriptor|FieldsDescriptor|FieldDescriptor|nxt[A-Z]|Data\/DataDict)/ 
  const infos: string[] = []
  for (let i = 20000; i < buf.length - 4; i++) {
    if (buf[i] >= 0x20 && buf[i] < 0x7f) {
      let j = i, ch: number[] = []
      while (j < buf.length && buf[j] >= 0x20 && buf[j] < 0x7f) { ch.push(buf[j]); j++ }
      const s = Buffer.from(ch).toString('latin1')
      if (ch.length >= 4 && !EXCLUIR.test(s) && /^[A-Za-zÀ-ÿ_][A-Za-z0-9À-ÿ_.\- ]*$/.test(s) && s.length >= 4) infos.push(s)
      i = j - 1
    }
  }
  return infos.map(info => ({ info, origem: 'syslog', bytes_brutos: null }))
}

// --- EXTRAÇÃO Terminal ---
function extrairTerminais(buf: Buffer): Record<string, unknown>[] {
  // strings de configuração + nome do terminal
  const strs = extrairStringsUtf16(buf).filter(s => s.s.length >= 3)
  const configs = strs.map(s => s.s)
  const termId = null // GUID não isolado com segurança
  return [{
    term_id: termId,
    nome: null,
    opcoes: configs.join('\n'),
    bytes_brutos: buf.toString('hex').slice(0, 2000)
  }]
}

function extrairUsuarios(buf: Buffer): Record<string, unknown>[] {
  const strs = extrairStringsUtf16(buf)
  const candidatos = strs.filter(s =>
    /^[A-Za-zÀ-ÿ]/.test(s.s) && s.s.length >= 3 && s.s.length <= 40 &&
    !/^\d+=/.test(s.s) && !s.s.includes('@')
  )
  const ehGuid = (off: number): boolean => {
    if (off - 16 < 0) return false
    const bytes = buf.slice(off - 16, off)
    let naoNulos = 0
    for (const b of bytes) if (b !== 0 && !(b >= 0x20 && b < 0x7f)) naoNulos++
    return naoNulos >= 6
  }
  const registros = candidatos.filter(c => ehGuid(c.off)).sort((a, b) => a.off - b.off)
  const usuarios: Record<string, unknown>[] = []
  for (let i = 0; i < registros.length; i++) {
    const r = registros[i]
    const fim = i + 1 < registros.length ? registros[i + 1].off : buf.length
    const internas = strs.filter(s => s.off > r.off && s.off < fim && !s.s.includes('@') && !/^\d+=/.test(s.s) && !/^\d+$/.test(s.s))
    const emails = strs.filter(s => s.off > r.off && s.off < fim && s.s.includes('@'))
    let admin = 0
    for (let o = r.off + 60; o < Math.min(fim, r.off + 130); o++) {
      if (buf[o] === 0x01 && buf[o + 1] === 0x00 && buf[o + 2] === 0x00 && buf[o + 3] === 0x00 && buf[o + 4] < 20) { admin = 1; break }
    }
    const username = r.s
    const nome = internas[0] ? internas[0].s : username
    const email = emails[0] ? emails[0].s : null
    usuarios.push({ username, nome, email, admin })
  }
  return usuarios
}

function extrairCaixas(buf: Buffer): Record<string, unknown>[] {
  const caixas: Record<string, unknown>[] = []
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b < 0x41 || b >= 0x7f) continue
    let j = i
    const ch: number[] = []
    while (j < buf.length && buf[j] >= 0x20 && buf[j] < 0x7f && j - i < 40) { ch.push(buf[j]); j++ }
    const nome = Buffer.from(ch).toString('latin1')
    if (nome.length < 2 || !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ._-]*$/.test(nome)) { i = j - 1; continue }
    const fimNome = j
    let aberto = ''
    let abertoOff = -1
    for (let o = fimNome + 5; o < fimNome + 45 && o + 8 <= buf.length; o++) {
      const d = converterDataNex(buf.readDoubleLE(o))
      if (d) { aberto = d; abertoOff = o; break }
    }
    let fechado: string | null = null
    if (abertoOff >= 0) {
      for (let o = abertoOff + 4; o < abertoOff + 20 && o + 8 <= buf.length; o++) {
        const d = converterDataNex(buf.readDoubleLE(o))
        if (d) { fechado = d; break }
      }
    }
    if (aberto) {
      caixas.push({
        usuario: nome.toLowerCase(),
        aberto_em: aberto.slice(0, 19).replace('T', ' '),
        fechado_em: fechado ? fechado.slice(0, 19).replace('T', ' ') : null
      })
    }
    i = fimNome - 1
  }
  return caixas
}

function extrairProdutosNx1(buf: Buffer): Record<string, unknown>[] {
  const tam = buf.length
  const strs: { off: number; s: string; fim: number }[] = []
  for (let i = 0; i < tam - 2; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8)
    if ((code >= 0x20 && code < 0x7f) || (code >= 0xc0 && code <= 0xff)) {
      let j = i, chars: number[] = []
      while (j + 1 < tam) {
        const c = buf[j] | (buf[j + 1] << 8)
        if (c >= 0x20 && c < 0x7f || c >= 0xc0 && c <= 0xff) { chars.push(c); j += 2 }
        else break
      }
      if (chars.length >= 6) {
        strs.push({ off: i, s: String.fromCharCode(...chars), fim: j })
      }
      i = j - 2
    }
  }
  const nomes = strs.filter(s =>
    /[A-Za-zÀ-ÿ]/.test(s.s) && /\s/.test(s.s) && s.s.length <= 200 &&
    /^[\x20-\x7eÀ-ÿ0-9 .,\-/'":()%+/#&]+$/.test(s.s) &&
    !/^Essências /.test(s.s) && !/^Vasos /.test(s.s) && !/^Piteiras /i.test(s.s) &&
    !/VALORES PROMOCIONAIS/.test(s.s) && !/Google Inc/.test(s.s)
  )
  const EXCLUIR = /^(Carvões e Fogareiros|Essencias|Essências|Pro Hookah|gold smoke|Vasos|Piteiras|HeadShop|Tabacos|Stem)/
  const ehEAN = (s: string): boolean => /^\d{8,14}$/.test(s)
  const ehNomeCampo = (s: string): boolean => /^[A-Za-zÀ-ÿ@]/.test(s) && !ehEAN(s) && s.length >= 2 && !/^[\da-f]{24,}$/.test(s)
  const ehGuidBytes = (b: Buffer): boolean => {
    let n = 0
    for (const x of b) if (x !== 0 && !(x >= 0x20 && x < 0x7f)) n++
    return n >= 6
  }
  const vistos = new Set<string>()
  const produtos: Record<string, unknown>[] = []
  for (const item of nomes) {
    const nome = item.s.trim()
    const chave = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
    if (EXCLUIR.test(nome) || nome.length < 8 || vistos.has(chave)) continue
    vistos.add(chave)
    const offNome = item.off
    const inicio = Math.max(0, offNome - 400)
    const fim = Math.min(tam, offNome + 20)
    const antes = strs.filter(s => s.off < offNome && s.off >= inicio).sort((a, b) => a.off - b.off)
    const eans = antes.filter(s => ehEAN(s.s)).map(s => s.s)
    const ean = eans[0] || null
    const codigo2 = eans.length > 1 ? eans[1] : null
    const idxPrimeiroEan = antes.findIndex(s => ehEAN(s.s))
    const nomesAteEan = idxPrimeiroEan >= 0 ? antes.slice(0, idxPrimeiroEan).filter(s => ehNomeCampo(s.s) && !/^[\da-f]{24,}$/.test(s.s)).map(s => s.s) : []
    const categoria = nomesAteEan[0] || null
    const subcategoria = nomesAteEan[1] || null
    const marca = nomesAteEan[2] || null
    const unidade = nomesAteEan[3] || null
    let guid: string | null = null
    const primStr = antes[0]
    if (primStr) {
      for (let o = primStr.off - 50; o < primStr.off - 4; o++) {
        if (o >= 0 && ehGuidBytes(buf.slice(o, o + 16)) && !ehGuidBytes(buf.slice(o + 1, o + 17))) {
          guid = buf.slice(o, o + 16).toString('hex')
          break
        }
      }
    }
    produtos.push({ nome, guid, categoria, subcategoria, marca, unidade, ean, codigo2 })
  }
  return produtos
}

function extrairCadastroAscii(buf: Buffer, padrao: RegExp): { codigo: string; desc: string }[] {
  const tam = buf.length
  const strs: { off: number; s: string }[] = []
  for (let i = 0; i < tam - 4; i++) {
    if (buf[i] >= 0x20 && buf[i] < 0x7f) {
      let j = i, chars: number[] = []
      while (j < tam && buf[j] >= 0x20 && buf[j] < 0x7f) { chars.push(buf[j]); j++ }
      if (chars.length >= 4) {
        strs.push({ off: i, s: Buffer.from(chars).toString('latin1') })
      }
      i = j - 1
    }
  }
  const pares: { codigo: string; desc: string }[] = []
  for (let i = 0; i < strs.length; i++) {
    if (padrao.test(strs[i].s) && i + 1 < strs.length) {
      pares.push({ codigo: strs[i].s, desc: strs[i + 1].s })
    }
  }
  return pares
}

// --- PARSE ESTRUTURADO COM GUIDs (NexusDB) ---

// Extrai os 16 bytes imediatamente antes de cada string-nome (chave GUID da tabela ou referência)
function parsearTabelaGuid(buf: Buffer): { nome: string; guid: string; off: number }[] {
  const nomes = extrairStringsUtf16(buf).filter(s => s.s.length >= 3 && /[A-Za-zÀ-ÿ]/.test(s.s))
  const regs: { nome: string; guid: string; off: number }[] = []
  for (const s of nomes) {
    const o = s.off
    if (o - 16 < 0) continue
    regs.push({ nome: s.s.trim(), guid: Buffer.from(buf.slice(o - 16, o)).toString('hex'), off: o })
  }
  return regs
}

// Categorias do Categoria.nx1: guid = 16 bytes antes do nome
function extrairCategorias(buf: Buffer): { nome: string; guid: string }[] {
  return parsearTabelaGuid(buf).map(({ nome, guid }) => ({ nome, guid }))
}

// Subcategorias do Subcategoria.nx1: UID_categoria (guid da categoria) = 16 bytes antes do nome;
// guid da própria subcategoria = 16 bytes antes do UID_categoria
function extrairSubcategorias(buf: Buffer): { nome: string; guid: string; uidCategoria: string }[] {
  const nomes = extrairStringsUtf16(buf).filter(s => s.s.length >= 3 && /[A-Za-zÀ-ÿ]/.test(s.s))
  const regs: { nome: string; guid: string; uidCategoria: string }[] = []
  for (const s of nomes) {
    const o = s.off
    if (o - 32 < 0) continue
    const uidCategoria = Buffer.from(buf.slice(o - 16, o)).toString('hex')
    const guid = Buffer.from(buf.slice(o - 32, o - 16)).toString('hex')
    regs.push({ nome: s.s.trim(), guid, uidCategoria })
  }
  return regs
}

// Produtos estruturados do catalogo_json.nx1 (JSON UTF-16)
function extrairCatalogoJson(buf: Buffer): Record<string, unknown>[] {
  const tam = buf.length
  const produtos: Record<string, unknown>[] = []
  for (let i = 0; i + 1 < tam; i++) {
    if (buf[i] === 0x7b && buf[i + 1] === 0x00) {
      let fim = -1
      let depth = 0
      let inStr = false
      let esc = false
      for (let j = i; j + 1 < tam; j += 2) {
        const code = buf[j] | (buf[j + 1] << 8)
        if (inStr) {
          if (esc) esc = false
          else if (code === 0x5c) esc = true
          else if (code === 0x22) inStr = false
        } else {
          if (code === 0x22) inStr = true
          else if (code === 0x7b) depth++
          else if (code === 0x7d) {
            depth--
            if (depth === 0) { fim = j + 2; break }
          }
        }
      }
      if (fim === -1) continue
      const texto = decodificarUtf16(buf, i, fim - i)
      let parsed: unknown = null
      try { parsed = JSON.parse(texto) } catch { continue }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>
        if (p.ProductName || p.ProductCode) produtos.push(p)
      }
      i = fim
    }
  }
  return produtos
}

// Produtos do Produto.nx1 ancorados pelos GUIDs das categorias conhecidas.
// Cada registro do produto contém: [GUID categoria][nome categoria][GUID subcategoria][nome subcategoria][código][EAN][nome produto]
function extrairProdutosNx1Guid(
  buf: Buffer,
  catGuids: Map<string, string>,
  catNomesNorm: Set<string>,
  subNomesNorm: Set<string>
): { nome: string; cat: string; sub: string | null; ean: string | null; codigo: string | null }[] {
  const strs = extrairStringsUtf16(buf)
  const catGuidArr = [...catGuids.keys()].map((h) => Buffer.from(h, 'hex'))
  const first4 = new Set<number>(catGuidArr.map((g) => g.readUInt32BE(0)))
  const anchors: { off: number; guid: string; catNome: string }[] = []
  for (let i = 0; i + 16 <= buf.length; i++) {
    if (i & 1) continue
    if (first4.has(buf.readUInt32BE(i))) {
      const b = buf.slice(i, i + 16)
      const h = b.toString('hex')
      if (catGuids.has(h)) {
        anchors.push({ off: i, guid: h, catNome: catGuids.get(h)! })
        i += 15
      }
    }
  }
  anchors.sort((a, b) => a.off - b.off)
  const offs = strs.map((s) => s.off)
  const rangeStr = (ini: number, fim: number): string[] => {
    const res: string[] = []
    let lo = 0
    let hi = offs.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (offs[mid] < ini) lo = mid + 1; else hi = mid }
    let p = lo
    while (p < offs.length && offs[p] < fim) { res.push(strs[p].s); p++ }
    return res
  }
  const ehNumero = (s: string): boolean => /^[\d.\-]+$/.test(s)
  const ehEan = (s: string): boolean => /^\d{8,14}$/.test(s)
  const ehNomeProd = (s: string): boolean => /[A-Za-zÀ-ÿ]/.test(s) && s.trim().length >= 3
  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
  const produtos: { nome: string; cat: string; sub: string | null; ean: string | null; codigo: string | null }[] = []
  const vistos = new Set<string>()
  for (let idx = 0; idx < anchors.length; idx++) {
    const a = anchors[idx]
    const fimRecord = idx + 1 < anchors.length ? anchors[idx + 1].off : buf.length
    const campos = rangeStr(a.off + 16, fimRecord)
    if (campos.length === 0) continue
    const nomesCandidatos: string[] = []
    const numericos: string[] = []
    let subNome: string | null = null
    for (let k = 0; k < campos.length; k++) {
      const c = campos[k]
      if (ehNumero(c) && c.length >= 4) { numericos.push(c); continue }
      if (c.length < 3 || !/^[A-Za-zÀ-ÿ]/.test(c)) continue
      const n = norm(c)
      if (catNomesNorm.has(n) || subNomesNorm.has(n)) { if (subNomesNorm.has(n) && !subNome) subNome = c; continue }
      if (ehNomeProd(c)) nomesCandidatos.push(c)
    }
    const nomeProd = nomesCandidatos[nomesCandidatos.length - 1]
    if (!nomeProd) continue
    const n = norm(nomeProd.trim())
    if (vistos.has(n)) continue
    vistos.add(n)
    const ean = numericos.find(ehEan) || null
    const codigo = numericos.find((x) => !ehEan(x)) || null
    produtos.push({ nome: nomeProd.trim(), cat: a.catNome, sub: subNome, ean, codigo })
  }
  return produtos
}

function montarImportacao(bufs: Map<string, Buffer>): DadosNex {
  const produtos = bufs.has('catalogo_json.nx1') ? extrairCatalogoJson(bufs.get('catalogo_json.nx1')!) : []
  const clientes = bufs.has('Cliente.nx1') ? extrairClientes(bufs.get('Cliente.nx1')!) : []
  const categorias = bufs.has('Categoria.nx1') ? extrairCategorias(bufs.get('Categoria.nx1')!) : []
  const marcas = bufs.has('Marca.nx1') ? extrairNomesSimples(bufs.get('Marca.nx1')!) : []
  const subcategorias = bufs.has('Subcategoria.nx1') ? extrairSubcategorias(bufs.get('Subcategoria.nx1')!) : []
  const unidades = bufs.has('Unidade.nx1') ? extrairNomesSimples(bufs.get('Unidade.nx1')!) : []
  const usuarios = bufs.has('Usuario.nx1') ? extrairUsuarios(bufs.get('Usuario.nx1')!) : []
  const caixas = bufs.has('Caixa.nx1') ? extrairCaixas(bufs.get('Caixa.nx1')!) : []
  const catGuids = new Map(categorias.map((c) => [c.guid, c.nome]))
  const catNomesNorm = new Set(categorias.map((c) => normalizarNome(c.nome)))
  const subNomesNorm = new Set(subcategorias.map((s) => normalizarNome(s.nome)))
  const produtosNx1 = bufs.has('Produto.nx1')
    ? extrairProdutosNx1Guid(bufs.get('Produto.nx1')!, catGuids, catNomesNorm, subNomesNorm)
    : []
  const ncmCadastro = bufs.has('NCM.nx1') ? extrairCadastroAscii(bufs.get('NCM.nx1')!, /^\d{8}$/) : []
  const cestCadastro = bufs.has('br_cest.nx1') ? extrairCadastroAscii(bufs.get('br_cest.nx1')!, /^\d{7}$/) : []
  const cfopCadastro = bufs.has('CFOP.nx1') ? extrairCadastroAscii(bufs.get('CFOP.nx1')!, /^\d{4}$/) : []
  const vendas = bufs.has('Tran.nx1') ? extrairVendasComId(bufs.get('Tran.nx1')!) : []
  const itens = bufs.has('MovEst.nx1') ? extrairItensMovEst(bufs.get('MovEst.nx1')!) : []
  const pagamentos = bufs.has('PagEspecies.nx1') ? extrairPagamentos(bufs.get('PagEspecies.nx1')!) : []
  const naoInterpretados: Record<string, unknown>[] = []
  const remocoes = bufs.has('RegistrosRemovidos.nx1') ? extrairRemocoes(bufs.get('RegistrosRemovidos.nx1')!) : []
  const syslogs = bufs.has('syslog.nx1') ? extrairSyslog(bufs.get('syslog.nx1')!) : []
  const terminais = bufs.has('Terminal.nx1') ? extrairTerminais(bufs.get('Terminal.nx1')!) : []
  return { produtos, clientes, categorias, marcas, subcategorias, unidades, usuarios, caixas, produtosNx1, ncmCadastro, cestCadastro, cfopCadastro, vendas, itens, pagamentos, naoInterpretados, remocoes, syslogs, terminais }
}

export function normalizarNome(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
}

export interface OpcoesImportacao {}

// Extrai o dicionário de campos de um arquivo .nx1 (nomes e tipos de campo)
function extrairDicionario(buf: Buffer): { nome: string; tipo: string }[] {
  const fieldTypes = new Set([
    'nxtAutoInc', 'nxtGuid', 'nxtWord32', 'nxtWideString', 'nxtString', 'nxtInt32',
    'nxtBoolean', 'nxtDateTime', 'nxtFloat32', 'nxtFloat64', 'nxtWord16', 'nxtByte',
    'nxtInt16', 'nxtInt64', 'nxtBlob', 'nxtBlobMemo', 'nxtBlobGraphic', 'nxtArray',
    'nxtWideMemo', 'nxtBlobWideMemo', 'nxtNullString', 'nxtDouble'
  ])
  const ascii: { off: number; s: string }[] = []
  let cur: number[] = [], start = 0
  for (let i = 0; i < Math.min(buf.length, 200000); i++) {
    const b = buf[i]
    if (b >= 0x20 && b < 0x7f) { if (cur.length === 0) start = i; cur.push(b) }
    else { if (cur.length >= 4) ascii.push({ off: start, s: Buffer.from(cur).toString('ascii') }); cur = [] }
  }
  if (cur.length >= 4) ascii.push({ off: start, s: Buffer.from(cur).toString('ascii') })
  const fields: { nome: string; tipo: string }[] = []
  for (let i = 0; i < ascii.length; i++) {
    if (ascii[i].s === 'TnxFieldDescriptor') {
      let nome: string | null = null, tipo: string | null = null
      for (let j = i + 1; j < ascii.length && j < i + 6; j++) {
        if (!nome && !fieldTypes.has(ascii[j].s) && ascii[j].s !== 'TnxFieldDescriptor') { nome = ascii[j].s; continue }
        if (nome && fieldTypes.has(ascii[j].s)) { tipo = ascii[j].s; break }
      }
      if (nome && tipo) fields.push({ nome, tipo })
    }
  }
  // deduplicar preservando ordem
  const vistos = new Set<string>()
  const unicos: { nome: string; tipo: string }[] = []
  for (const f of fields) {
    const k = f.nome + '|' + f.tipo
    if (!vistos.has(k)) { vistos.add(k); unicos.push(f) }
  }
  return unicos
}

// Conta blocos de dados NXHD
function contarBlocos(buf: Buffer): number {
  let n = 0
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf.toString('ascii', i, i + 4) === 'NXHD') { n++; i += 4095 }
  }
  return n
}

export async function importarNex(zipBuffer: Buffer, nomeZip: string, opcoes?: OpcoesImportacao): Promise<{ ok: boolean; resumo?: Record<string, number>; erros?: string[]; relatorio?: Record<string, unknown> }> {
  const erros: string[] = []
  const zip = new AdmZip(zipBuffer)
  const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.nx1'))
  const bufs = new Map<string, Buffer>()
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    try {
      const data = entry.getData()
      const nomeBase = entry.entryName.split(/[\\/]/).pop() as string
      if (data) bufs.set(nomeBase, data)
    } catch (e) {
      erros.push(`Falha ao extrair ${entry.entryName}: ${(e as Error).message}`)
    }
  }
  const r = await importarNexDeBufs(bufs, nomeZip, opcoes)
  if (erros.length) r.erros = [...(r.erros || []), ...erros]
  return r
}

// Importa direto de uma pasta com os arquivos .nx1 soltos (formato da pasta Dados do Nex)
export async function importarNexDePasta(pasta: string, opcoes?: OpcoesImportacao): Promise<{ ok: boolean; resumo?: Record<string, number>; erros?: string[]; relatorio?: Record<string, unknown> }> {
  const { readdirSync } = await import('node:fs')
  const arquivos = readdirSync(pasta).filter((f) => f.toLowerCase().endsWith('.nx1'))
  const bufs = new Map<string, Buffer>()
  for (const f of arquivos) {
    try {
      bufs.set(f, readFileSync(join(pasta, f)))
    } catch { /* ignora arquivo ilegível */ }
  }
  return importarNexDeBufs(bufs, pasta, opcoes)
}

async function importarNexDeBufs(bufs: Map<string, Buffer>, nomeZip: string, opcoes?: OpcoesImportacao): Promise<{ ok: boolean; resumo?: Record<string, number>; erros?: string[]; relatorio?: Record<string, unknown> }> {
  const erros: string[] = []
  try {
    const db = getDb()
    db.exec('BEGIN')
    atualizarProgresso({ ativo: true, etapa: 'lendo', atual: 0, total: 1, mensagem: `Lendo dados ${nomeZip}...` })
    const dados = montarImportacao(bufs)
    // Preservar estruturas do Nex sem suporte no sistema (zero perda de dados)
    atualizarProgresso({ ativo: true, etapa: 'dados_brutos', atual: 0, total: bufs.size, mensagem: 'Preservando dados brutos de estruturas sem suporte...' })
    let brutosPreservados = 0
    const tabelasSuportadas = new Set([
      'Cliente', 'Produto', 'catalogo_json', 'Categoria', 'Subcategoria', 'Marca', 'Unidade',
      'Usuario', 'Caixa', 'Tran', 'ITran', 'PagEspecies', 'MovEst', 'NCM', 'RegistrosRemovidos',
      'syslog', 'Terminal', 'br_cest', 'CFOP'
    ])
    for (const [nomeArquivo, buf] of bufs) {
      const tabela = nomeArquivo.replace(/\.nx1$/i, '')
      if (tabelasSuportadas.has(tabela)) continue
      const blocos = contarBlocos(buf)
      if (blocos === 0) continue
      try {
        db.prepare(`INSERT INTO nex_dados_brutos (tabela_origem, registro, dados_json, bytes_brutos, motivo)
          VALUES (?, 'bloco_completo', NULL, ?, 'Estrutura sem suporte no sistema — preservada integralmente')`)
          .run(tabela, buf.toString('base64'))
        brutosPreservados++
      } catch (e) {
        erros.push(`Preservação ${tabela}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: (brutosPreservados + 1) })
      if (brutosPreservados % 20 === 0) await pausar()
    }
    atualizarProgresso({ ativo: true, etapa: 'ncm', atual: 0, total: dados.ncmCadastro.length, mensagem: `Importando cadastro NCM (${dados.ncmCadastro.length})...` })
    let ncmImportados = 0
    for (let i = 0; i < dados.ncmCadastro.length; i++) {
      const n = dados.ncmCadastro[i]
      try {
        const ex = db.prepare(`SELECT id FROM ncm_cadastro WHERE ncm = ?`).get(n.codigo) as { id: number } | undefined
        if (!ex) {
          db.prepare(`INSERT INTO ncm_cadastro (ncm, descricao) VALUES (?, ?)`).run(n.codigo, n.desc)
          ncmImportados++
        }
      } catch { /* ignore */ }
      if ((i + 1) % 500 === 0) { atualizarProgresso({ atual: i + 1 }); await pausar() }
    }
    atualizarProgresso({ ativo: true, etapa: 'cest', atual: 0, total: dados.cestCadastro.length, mensagem: `Importando cadastro CEST (${dados.cestCadastro.length})...` })
    let cestImportados = 0
    for (let i = 0; i < dados.cestCadastro.length; i++) {
      const n = dados.cestCadastro[i]
      try {
        const ex = db.prepare(`SELECT id FROM cest_cadastro WHERE cest = ?`).get(n.codigo) as { id: number } | undefined
        if (!ex) {
          db.prepare(`INSERT INTO cest_cadastro (cest, descricao) VALUES (?, ?)`).run(n.codigo, n.desc)
          cestImportados++
        }
      } catch { /* ignore */ }
      if ((i + 1) % 500 === 0) { atualizarProgresso({ atual: i + 1 }); await pausar() }
    }
    atualizarProgresso({ ativo: true, etapa: 'cfop', atual: 0, total: dados.cfopCadastro.length, mensagem: `Importando cadastro CFOP (${dados.cfopCadastro.length})...` })
    let cfopImportados = 0
    for (let i = 0; i < dados.cfopCadastro.length; i++) {
      const n = dados.cfopCadastro[i]
      try {
        const ex = db.prepare(`SELECT id FROM cfop_cadastro WHERE cfop = ?`).get(n.codigo) as { id: number } | undefined
        if (!ex) {
          db.prepare(`INSERT INTO cfop_cadastro (cfop, descricao) VALUES (?, ?)`).run(n.codigo, n.desc)
          cfopImportados++
        }
      } catch { /* ignore */ }
      if ((i + 1) % 500 === 0) { atualizarProgresso({ atual: i + 1 }); await pausar() }
    }
    const normNome = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
    // Categorias (com GUID do Nex preservado em nex_uid)
    const mapaCategorias = new Map<string, number>()
    const mapaCategoriasGuid = new Map<string, number>()
    for (let i = 0; i < dados.categorias.length; i++) {
      const c = dados.categorias[i]
      try {
        const nome = c.nome.trim()
        if (!nome) continue
        let id = mapaCategoriasGuid.get(c.guid)
        if (!id) {
          const ex = db.prepare(`SELECT id FROM categorias WHERE nex_uid = ?`).get(c.guid) as { id: number } | undefined
          if (ex) id = ex.id
        }
        if (!id) {
          const exNome = db.prepare(`SELECT id FROM categorias WHERE nome = ?`).get(nome) as { id: number } | undefined
          if (exNome) id = exNome.id
        }
        if (!id) {
          id = Number(db.prepare(`INSERT INTO categorias (nome, nex_uid) VALUES (?, ?)`).run(nome, c.guid).lastInsertRowid)
        } else {
          db.prepare(`UPDATE categorias SET nex_uid = ? WHERE id = ?`).run(c.guid, id)
        }
        mapaCategorias.set(normNome(nome), id)
        mapaCategoriasGuid.set(c.guid, id)
      } catch (e) {
        erros.push(`Categoria ${c.nome}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1 })
      if ((i + 1) % 100 === 0) await pausar()
    }
    // Subcategorias (link à categoria via UID_categoria GUID)
    atualizarProgresso({ ativo: true, etapa: 'subcategorias', atual: 0, total: dados.subcategorias.length, mensagem: 'Importando subcategorias...' })
    const mapaSubcategorias = new Map<string, number>()
    let subcategoriasSemCat = 0
    let subcategoriasComCat = 0
    for (let i = 0; i < dados.subcategorias.length; i++) {
      const s = dados.subcategorias[i]
      try {
        const nome = s.nome.trim()
        if (!nome) continue
        const categoriaId = mapaCategoriasGuid.get(s.uidCategoria) ?? null
        const existenteGuid = db.prepare(`SELECT id FROM subcategorias WHERE nex_uid = ?`).get(s.guid) as { id: number } | undefined
        let id = existenteGuid?.id
        if (!id) {
          const exNome = db.prepare(`SELECT id FROM subcategorias WHERE nome = ? AND categoria_id IS ?`).get(nome, categoriaId) as { id: number } | undefined
          id = exNome?.id
        }
        if (!id) {
          id = Number(db.prepare(`INSERT INTO subcategorias (categoria_id, nome, nex_uid) VALUES (?, ?, ?)`)
            .run(categoriaId, nome, s.guid).lastInsertRowid)
        } else {
          db.prepare(`UPDATE subcategorias SET categoria_id = ?, nex_uid = ? WHERE id = ?`).run(categoriaId, s.guid, id)
        }
        if (categoriaId) subcategoriasComCat++
        else subcategoriasSemCat++
        mapaSubcategorias.set(`${normNome(nome)}|${categoriaId ?? ''}`, id)
        mapaSubcategorias.set(normNome(nome), id)
      } catch (e) {
        erros.push(`Subcategoria ${s.nome}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1 })
    }
    atualizarProgresso({ ativo: true, etapa: 'marcas', atual: 0, total: dados.marcas.length, mensagem: 'Importando marcas...' })
    const mapaMarcas = new Map<string, number>()
    for (let i = 0; i < dados.marcas.length; i++) {
      const nome = String(dados.marcas[i])
      const ex = db.prepare(`SELECT id FROM marcas WHERE nome = ?`).get(nome) as { id: number } | undefined
      const id = ex?.id ?? Number(db.prepare(`INSERT INTO marcas (nome) VALUES (?)`).run(nome).lastInsertRowid)
      mapaMarcas.set(nome.toLowerCase(), id)
      mapaMarcas.set(normNome(nome), id)
      atualizarProgresso({ atual: i + 1 })
    }
    const catNomesNorm = new Set(dados.categorias.map((c) => normNome(c.nome)))
    const subNomesNorm = new Set(dados.subcategorias.map((s) => normNome(s.nome)))
    atualizarProgresso({ ativo: true, etapa: 'produtos', atual: 0, total: dados.produtos.length, mensagem: 'Importando produtos do catálogo...' })
    let criados = 0
    let atualizados = 0
    let catSemSub = 0
    let catComSub = 0
    let produtosNomeSubcat = 0
    const nomesJaImportados = new Set<string>()
    for (let i = 0; i < dados.produtos.length; i++) {
      const p = dados.produtos[i] as Record<string, unknown>
      try {
        const nome = String(p.ProductName ?? '').trim()
        if (!nome) continue
        const chave = normNome(nome)
        if (subNomesNorm.has(chave) || catNomesNorm.has(chave)) { produtosNomeSubcat++; continue }
        const codigo = String(p.ProductCode ?? '').trim() || null
        const categoriaNome = String(p.Category ?? '').trim()
        const subcategoriaNome = String(p.SubCategory ?? '').trim() || null
        const marcaNome = String(p.Brand ?? '').trim()
        const unidade = String(p.Unit ?? '').trim() || 'un'
        const preco = Number(p.SalePrice) || 0
        const precoPromo = p.PromoSalePrice != null ? Number(p.PromoSalePrice) : null
        const estoque = p.CurrentStock != null ? Number(p.CurrentStock) : 0
        const estoqueMin = p.CurrentStock != null ? Number(p.CurrentStock) : 0
        const inativo = p.Inactive === true ? 1 : 0
        const publicado = p.ProductPublished === true ? 1 : 1
        const descricao = p.ProductDescr != null ? String(p.ProductDescr) : null
        const observacoes = p.Observations != null ? String(p.Observations) : null
        const categoriaId = categoriaNome ? (mapaCategorias.get(normNome(categoriaNome)) ?? null) : null
        const marcaId = marcaNome ? (mapaMarcas.get(normNome(marcaNome)) ?? null) : null
        const promoAtiva = p.PromoActive === true ? 1 : 0
        const guidProduto = p.ProductUId != null ? String(p.ProductUId).replace(/[{}]/g, '').toLowerCase() : null
        let subcategoriaId: number | null = null
        if (subcategoriaNome) {
          subcategoriaId = mapaSubcategorias.get(`${normNome(subcategoriaNome)}|${categoriaId ?? ''}`)
            ?? mapaSubcategorias.get(normNome(subcategoriaNome))
            ?? null
        }
        if (subcategoriaId) catComSub++
        else catSemSub++
        const existente = codigo
          ? (db.prepare(`SELECT id FROM produtos WHERE codigo_barras = ?`).get(codigo) as { id: number } | undefined)
          : undefined
        const porNome = existente ? undefined : (db.prepare(`SELECT id FROM produtos WHERE lower(replace(nome,' ','')) = ?`).get(chave) as { id: number } | undefined)
        const agora = new Date().toISOString()
        const dadosSql: SQLInputValue[] = [
          nome, codigo, null, categoriaId, marcaId, null, preco, estoque, estoqueMin, unidade,
          inativo ? 0 : 1, descricao, precoPromo, promoAtiva, null, null, null, observacoes,
          0, null, null, null, null, null, 1, 0, 1, 1, subcategoriaId, null, null, 0, 0, agora, guidProduto
        ]
        const alvo = existente ?? porNome
        if (alvo) {
          db.prepare(
            `UPDATE produtos SET nome=?, codigo_barras=?, imagem=?, categoria_id=?, marca_id=?, fornecedor_id=?, preco_venda=?, estoque=?, estoque_minimo=?, unidade=?, ativo=?, descricao=?, preco_promo=?, promocional=?, peso_liq=?, peso_bruto=?, localizacao=?, observacoes=?, preco_custo=?, codigo_interno=?, codigo_extra=?, ncm=?, cest=?, estoque_maximo=?, controla_estoque=?, permite_fracionado=?, publicado=?, catalogo_publicado=?, subcategoria_id=?, preco_atacado1=?, preco_atacado2=?, qtd_min_atacado1=?, qtd_min_atacado2=?, alterado_em=?, nex_uid=? WHERE id=?`
          ).run(...dadosSql, alvo.id)
          atualizados++
        } else {
          db.prepare(
            `INSERT INTO produtos (nome, codigo_barras, imagem, categoria_id, marca_id, fornecedor_id, preco_venda, estoque, estoque_minimo, unidade, ativo, descricao, preco_promo, promocional, peso_liq, peso_bruto, localizacao, observacoes, preco_custo, codigo_interno, codigo_extra, ncm, cest, estoque_maximo, controla_estoque, permite_fracionado, publicado, catalogo_publicado, subcategoria_id, preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2, alterado_em, nex_uid)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(...dadosSql)
          criados++
        }
        nomesJaImportados.add(chave)
      } catch (e) {
        erros.push(`Produto ${String(p.ProductName ?? '')}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1, mensagem: `Importando produtos do catálogo ${i + 1} de ${dados.produtos.length}...` })
      if ((i + 1) % 200 === 0) await pausar()
    }
    atualizarProgresso({ ativo: true, etapa: 'produtos_nx1', atual: 0, total: dados.produtosNx1.length, mensagem: 'Importando produtos do Produto.nx1...' })
    let nx1Criados = 0
    let nx1Duplicados = 0
    let nx1SemCat = 0
    let nx1ComSub = 0
    let nx1SemSub = 0
    for (let i = 0; i < dados.produtosNx1.length; i++) {
      const p = dados.produtosNx1[i]
      try {
        const nome = p.nome.trim()
        if (!nome) continue
        const chave = normNome(nome)
        if (subNomesNorm.has(chave) || catNomesNorm.has(chave)) { produtosNomeSubcat++; continue }
        const ean = p.ean != null ? String(p.ean) : null
        const existente = ean
          ? (db.prepare(`SELECT id FROM produtos WHERE codigo_barras = ?`).get(ean) as { id: number } | undefined)
          : undefined
        const porNome = existente ? undefined : (db.prepare(`SELECT id FROM produtos WHERE lower(replace(nome,' ','')) = ?`).get(chave) as { id: number } | undefined)
        if (existente || porNome || nomesJaImportados.has(chave)) { nx1Duplicados++; continue }
        const catId = p.cat ? (mapaCategorias.get(normNome(p.cat)) ?? null) : null
        if (!catId) nx1SemCat++
        let subcategoriaId: number | null = null
        if (p.sub) {
          subcategoriaId = mapaSubcategorias.get(`${normNome(p.sub)}|${catId ?? ''}`)
            ?? mapaSubcategorias.get(normNome(p.sub))
            ?? null
        }
        db.prepare(
          `INSERT INTO produtos (nome, codigo_barras, categoria_id, subcategoria_id, preco_custo, preco_venda, estoque, estoque_minimo, unidade, ativo, descricao, codigo_extra, controla_estoque, publicado, catalogo_publicado, nex_uid)
           VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'un', 1, NULL, ?, 0, 0, 0, NULL)`
        ).run(nome, ean, catId, subcategoriaId, p.codigo)
        if (subcategoriaId) nx1ComSub++
        else nx1SemSub++
        nomesJaImportados.add(chave)
        nx1Criados++
      } catch (e) {
        erros.push(`ProdutoNx1 ${p.nome}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1, mensagem: `Produtos Produto.nx1 ${i + 1} de ${dados.produtosNx1.length}...` })
      if ((i + 1) % 200 === 0) await pausar()
    }
    atualizarProgresso({ ativo: true, etapa: 'clientes', atual: 0, total: dados.clientes.length, mensagem: 'Importando clientes...' })
    let clientesCriados = 0
    for (let i = 0; i < dados.clientes.length; i++) {
      const c = dados.clientes[i] as Record<string, unknown>
      try {
        const nome = String(c.nome ?? '').trim()
        if (!nome) continue
        const cpf = String(c.cpf ?? '').replace(/\D/g, '') || null
        const existente = cpf && cpf.length === 11
          ? (db.prepare(`SELECT id FROM clientes WHERE cpf = ?`).get(cpf) as { id: number } | undefined)
          : undefined
        const dadosCli: SQLInputValue[] = [
          nome, c.telefone != null ? String(c.telefone) : null, c.email != null ? String(c.email) : null,
          c.endereco != null ? String(c.endereco) : null, c.cpf != null ? String(c.cpf) : null,
          null, null, c.rg != null ? String(c.rg) : null, null, 0, null,
          c.observacoes != null ? String(c.observacoes) : null,
          c.numero != null ? String(c.numero) : null, c.bairro != null ? String(c.bairro) : null,
          c.cidade != null ? String(c.cidade) : null, c.uf != null ? String(c.uf) : null,
          c.cep != null ? String(c.cep) : null, c.pai != null ? String(c.pai) : null,
          c.mae != null ? String(c.mae) : null, c.codigo != null ? String(c.codigo) : null
        ]
        const agoraCli = new Date().toISOString()
        if (existente) {
          db.prepare(
            `UPDATE clientes SET nome=?, telefone=?, email=?, endereco=?, cpf=?, celular=?, data_nascimento=?, rg=?, genero=?, empresa=?, cnpj=?, observacoes=?, numero=?, bairro=?, cidade=?, uf=?, cep=?, pai=?, mae=?, codigo=?, criado_em=? WHERE id=?`
          ).run(...dadosCli, agoraCli, existente.id)
        } else {
          db.prepare(
            `INSERT INTO clientes (nome, telefone, email, endereco, cpf, celular, data_nascimento, rg, genero, empresa, cnpj, observacoes, numero, bairro, cidade, uf, cep, pai, mae, codigo, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(...dadosCli, agoraCli)
          clientesCriados++
        }
      } catch (e) {
        erros.push(`Cliente ${String(c.nome ?? '')}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1, mensagem: `Importando clientes ${i + 1} de ${dados.clientes.length}...` })
      if ((i + 1) % 100 === 0) await pausar()
    }
    atualizarProgresso({ ativo: true, etapa: 'usuarios', atual: 0, total: dados.usuarios.length, mensagem: 'Importando usuários...' })
    let usuariosCriados = 0
    for (let i = 0; i < dados.usuarios.length; i++) {
      const u = dados.usuarios[i] as Record<string, unknown>
      try {
        const login = String(u.username ?? '').trim().toLowerCase()
        if (!login) continue
        const nome = String(u.nome ?? u.username ?? '').trim() || login
        const email = u.email != null ? String(u.email) : null
        const existente = db.prepare(`SELECT id FROM usuarios WHERE login = ?`).get(login) as { id: number } | undefined
        const perfil = u.admin === 1 ? 'admin' : 'vendedor'
        if (!existente) {
          // usuário "admin" sempre nasce com a senha admin123; demais com senha vazia (resetada)
          const senha = login === 'admin' ? hashSenha('admin123') : ''
          db.prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil, comissao_percent, ativo, usar_web, usar_app)
            VALUES (?, ?, ?, ?, 0, 1, 1, 1)`).run(nome, login, senha, perfil)
          usuariosCriados++
        } else if (login === 'admin') {
          // garante que o admin do Nex não fique com senha vazia
          db.prepare(`UPDATE usuarios SET senha_hash = ?, perfil = 'admin', ativo = 1 WHERE login = 'admin'`).run(hashSenha('admin123'))
        }
      } catch (e) {
        erros.push(`Usuário ${String(u.username ?? '')}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1 })
    }
    atualizarProgresso({ ativo: true, etapa: 'caixas', atual: 0, total: dados.caixas.length, mensagem: 'Importando caixas...' })
    let caixasCriados = 0
    for (let i = 0; i < dados.caixas.length; i++) {
      const cx = dados.caixas[i] as Record<string, unknown>
      try {
        const usuario = String(cx.usuario ?? '').trim().toLowerCase()
        const uId = usuario ? (db.prepare(`SELECT id FROM usuarios WHERE login = ?`).get(usuario) as { id: number } | undefined) : undefined
        const converterData = (s: string): string => {
          const m = s.match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})/)
          return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}` : s
        }
        const abertoEm = converterData(String(cx.aberto_em ?? ''))
        const fechadoEm = cx.fechado_em ? converterData(String(cx.fechado_em)) : null
        const ex = db.prepare(`SELECT id FROM caixas WHERE aberto_em = ? AND fechado_em = ?`).get(abertoEm, fechadoEm) as { id: number } | undefined
        if (!ex) {
          db.prepare(`INSERT INTO caixas (usuario_id, aberto, saldo_inicial, total_vendas, total_sangrias, total_suprimentos, descontos, cancelamentos, qtd_vendas, aberto_em, fechado_em)
            VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`).run(uId?.id ?? null, abertoEm, fechadoEm)
          caixasCriados++
        }
      } catch (e) {
        erros.push(`Caixa ${String(cx.aberto_em ?? '')}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1 })
    }
    atualizarProgresso({ ativo: true, etapa: 'vendas', atual: 0, total: dados.vendas.length, mensagem: `Importando vendas (${dados.vendas.length})...` })
    let vendasCriadas = 0
    let vendasSemPag = 0
    let vendasSemItem = 0
    let itensImportados = 0
    let pagamentosImportados = 0
    // correlação de itens -> venda por vínculo EXATO (item.tran == venda.id),
    // em vez da antiga janela de tempo de 60s (que gerava vínculos faltantes/errados).
    const itensDaVenda = new Map<number, Record<string, unknown>[]>()
    for (const it of dados.itens) {
      const tran = Number(it.tran)
      if (!(tran > 0)) continue
      if (!itensDaVenda.has(tran)) itensDaVenda.set(tran, [])
      itensDaVenda.get(tran)!.push(it)
    }
    // pagamentos: correlação por tempo (segundo mais próximo à data da venda)
    const normData = (d: string): string => d ? String(d).slice(0, 19) : ''
    const vendaIdPorIdx = new Map<number, number>()
    dados.vendas.forEach((vv, idx) => vendaIdPorIdx.set(idx, Number((vv as Record<string, unknown>).id)))
    const vendasTempo = dados.vendas
      .map((vv, idx) => ({ idx, t: Date.parse(normData(String((vv as Record<string, unknown>).data ?? ''))) }))
      .filter((x) => !isNaN(x.t))
      .sort((a, b) => a.t - b.t)
    const temposVenda = vendasTempo.map((x) => x.t)
    const indicesVenda = vendasTempo.map((x) => x.idx)
    const vendaMaisProxima = (t: number): number => {
      let lo = 0, hi = temposVenda.length - 1
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (temposVenda[mid] < t) lo = mid + 1; else hi = mid - 1 }
      let melhor = -1, melhorD = 60 * 1000
      for (const cand of [hi, lo]) {
        if (cand < 0 || cand >= temposVenda.length) continue
        const d = Math.abs(temposVenda[cand] - t)
        if (d < melhorD) { melhorD = d; melhor = indicesVenda[cand] }
      }
      return melhor
    }
    const pagsDaVenda = new Map<number, Record<string, unknown>[]>()
    for (const p of dados.pagamentos) {
      const t = Date.parse(normData(String(p.data ?? '')))
      const vi = isNaN(t) ? -1 : vendaMaisProxima(t)
      if (vi < 0) continue
      const vendaId = vendaIdPorIdx.get(vi)
      if (vendaId === undefined) continue
      if (!pagsDaVenda.has(vendaId)) pagsDaVenda.set(vendaId, [])
      pagsDaVenda.get(vendaId)!.push(p)
    }
    // idempotência: já importadas? (numero NEX-{id da venda})
    const vendasJaImportadas = new Set<number>()
    ;(db.prepare(`SELECT numero FROM vendas WHERE numero LIKE 'NEX-%'`).all() as { numero: string }[]).forEach(r => {
      const m = r.numero.match(/NEX-(\d+)/)
      if (m) vendasJaImportadas.add(Number(m[1]))
    })
    for (let i = 0; i < dados.vendas.length; i++) {
      const v = dados.vendas[i] as { id?: number; caixa?: number; data?: string | null; uid?: string }
      try {
        const dataIso = String(v.data ?? '')
        const data = dataIso.replace('T', ' ').replace('Z', '')
        const idNex = Number(v.id)
        if (!(idNex > 0)) continue
        const numero = `NEX-${idNex}`
        if (vendasJaImportadas.has(idNex)) continue
        const itensVenda = itensDaVenda.get(idNex) || []
        const pagsVenda = pagsDaVenda.get(idNex) || []
        if (pagsVenda.length === 0) vendasSemPag++
        if (itensVenda.length === 0) vendasSemItem++
        // total/subtotal da venda = soma dos totais dos itens reais (fonte MovEst)
        const somaItens = itensVenda.reduce((s, it) => s + (Number(it.total) || 0), 0)
        const total = somaItens > 0 ? Math.round(somaItens * 100) / 100 : 0
        const subtotal = total
        const vendaId = Number(db.prepare(`INSERT INTO vendas (numero, vendedor_id, cliente_id, tipo, subtotal, desconto, total, status, created_at, caixa_id, observacoes)
          VALUES (?, NULL, NULL, 'balcao', ?, 0, ?, 'concluida', ?, ?, ?)`)
          .run(numero, subtotal, total, data || new Date().toISOString().replace('T', ' ').slice(0, 19), Number(v.caixa) > 0 ? Number(v.caixa) : null, `Importado do Nex. Data original: ${dataIso}`).lastInsertRowid)
        vendasCriadas++
        // itens (com produto, quantidade e preço reais do MovEst)
        for (const it of itensVenda) {
          const produtoNex = Number(it.produtoNex) || 0
          const quant = Number(it.quant) || 0
          const unit = Number(it.unit) || 0
          const totIt = Number(it.total) || 0
          const prodEncontrado = produtoNex > 0
            ? db.prepare(`SELECT id, nome FROM produtos WHERE codigo_interno = ? OR id = ?`).get(String(produtoNex), produtoNex) as { id: number; nome: string } | undefined
            : undefined
          const prodId = prodEncontrado?.id ?? null
          const nomeProduto = prodId != null && prodEncontrado?.nome ? prodEncontrado.nome : `produto#${produtoNex || 'desconhecido'}`
          db.prepare(`INSERT INTO venda_itens (venda_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .run(vendaId, prodId, nomeProduto, quant, unit, totIt)
          itensImportados++
        }
        // pagamentos
        for (const p of pagsVenda) {
          const forma = String(p.forma ?? '')
          const valor = p.valorCentavos != null ? Number(p.valorCentavos) / 100 : 0
          db.prepare(`INSERT INTO pagamentos (venda_id, forma, valor, criado_em) VALUES (?, ?, ?, ?)`)
            .run(vendaId, `NEX-forma-${forma}`, valor, data)
          pagamentosImportados++
        }
      } catch (e) {
        erros.push(`Venda ${String(v.data ?? '')}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1, mensagem: `Vendas ${i + 1} de ${dados.vendas.length}...` })
      if ((i + 1) % 200 === 0) await pausar()
    }
    atualizarProgresso({ ativo: true, etapa: 'remocoes', atual: 0, total: dados.remocoes.length, mensagem: `Importando histórico de remoções (${dados.remocoes.length})...` })
    let remocoesImportadas = 0
    for (const r of dados.remocoes) {
      try {
        const ex = db.prepare(`SELECT id FROM historico_remocoes WHERE uid_ref IS NULL AND descricao = ? AND data = ?`).get(r.descricao != null ? String(r.descricao) : null, r.data != null ? String(r.data) : null)
        if (!ex) {
          db.prepare(`INSERT INTO historico_remocoes (uid_ref, id_ref, tabela_origem, descricao, removido_por, data, bytes_brutos) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(
              r.uid_ref != null ? String(r.uid_ref) : null,
              r.id_ref != null ? Number(r.id_ref) : null,
              r.tabela_origem != null ? String(r.tabela_origem) : null,
              r.descricao != null ? String(r.descricao) : null,
              r.removido_por != null ? String(r.removido_por) : null,
              r.data != null ? String(r.data) : null,
              r.bytes_brutos != null ? String(r.bytes_brutos) : null
            )
          remocoesImportadas++
        }
      } catch (e) {
        erros.push(`Remoção ${String(r.descricao ?? '')}: ${(e as Error).message}`)
      }
    }
    atualizarProgresso({ ativo: true, etapa: 'syslog', atual: 0, total: dados.syslogs.length, mensagem: `Importando logs do sistema (${dados.syslogs.length})...` })
    let syslogsImportados = 0
    for (const s of dados.syslogs) {
      try {
        db.prepare(`INSERT INTO logs_sistema (data, info, origem, bytes_brutos) VALUES (NULL, ?, 'nex_syslog', NULL)`).run(s.info != null ? String(s.info) : null)
        syslogsImportados++
      } catch (e) {
        erros.push(`Syslog: ${(e as Error).message}`)
      }
      if (syslogsImportados % 500 === 0) await pausar()
    }
    atualizarProgresso({ ativo: true, etapa: 'terminais', atual: 0, total: dados.terminais.length, mensagem: `Importando terminais (${dados.terminais.length})...` })
    let terminaisImportados = 0
    for (const t of dados.terminais) {
      try {
        db.prepare(`INSERT INTO terminais (term_id, nome, opcoes, bytes_brutos) VALUES (?, ?, ?, ?)`)
          .run(
            t.term_id != null ? String(t.term_id) : null,
            t.nome != null ? String(t.nome) : null,
            t.opcoes != null ? String(t.opcoes) : null,
            t.bytes_brutos != null ? String(t.bytes_brutos) : null
          )
        terminaisImportados++
      } catch (e) {
        erros.push(`Terminal: ${(e as Error).message}`)
      }
    }
    atualizarProgresso({ ativo: true, etapa: 'nao_interpretados', atual: 0, total: dados.naoInterpretados.length, mensagem: 'Registrando dados não interpretados...' })
    // preservar dados não interpretados em JSON bruto
    if (dados.naoInterpretados.length > 0) {
      try {
        const dirRaw = join(getDefaultDbPath(), '..', 'nex_nao_interpretados')
        mkdirSync(dirRaw, { recursive: true })
        writeFileSync(join(dirRaw, 'nao_interpretados.json'), JSON.stringify(dados.naoInterpretados, null, 1))
      } catch { /* ignore */ }
    }
    const nomesSubcategoriasDistintos = new Set(dados.subcategorias.map((s) => normNome(s.nome))).size
    // Remove categorias do seed (Cigarros, Charutos, Tabaco, Acessorios) que não fazem parte do Nex
    db.prepare(
      `DELETE FROM categorias WHERE nex_uid IS NULL
       AND id NOT IN (SELECT COALESCE(categoria_id, 0) FROM produtos)
       AND id NOT IN (SELECT COALESCE(categoria_id, 0) FROM subcategorias)`
    ).run()
    db.exec('COMMIT')
    atualizarProgresso({ ativo: false, etapa: 'concluido', atual: 1, total: 1, mensagem: `Concluído: ${criados} produtos catálogo, ${nx1Criados} Produto.nx1, ${clientesCriados} clientes, ${usuariosCriados} usuários, ${caixasCriados} caixas, ${vendasCriadas} vendas` })
    registrarLog('SUCCESS', `Importação Nex concluída: ${criados} produtos de catálogo, ${nx1Criados} Produto.nx1, ${clientesCriados} clientes, ${usuariosCriados} usuários, ${caixasCriados} caixas, ${vendasCriadas} vendas, ${itensImportados} itens, ${pagamentosImportados} pagamentos`)
    const relatorio = {
      modo: 'importacao',
      estrutura: {
        categorias: dados.categorias.length,
        categoriasCriadas: mapaCategorias.size,
        subcategorias: dados.subcategorias.length,
        subcategoriasDistintas: nomesSubcategoriasDistintos,
        subcategoriasComCategoria: subcategoriasComCat,
        subcategoriasSemCategoria: subcategoriasSemCat,
        produtosCatalogo: dados.produtos.length,
        produtosCatalogoCriados: criados,
        produtosCatalogoAtualizados: atualizados,
        produtosNx1Registros: dados.produtosNx1.length,
        produtosNx1Criados: nx1Criados,
        produtosNx1Duplicados: nx1Duplicados,
        produtosNx1SemCategoria: nx1SemCat,
        produtosComSubcategoria: catComSub + nx1ComSub,
        produtosSemSubcategoria: catSemSub + nx1SemSub,
        produtosNomeDeSubcategoriaDescartados: produtosNomeSubcat,
        produtosTotal: criados + nx1Criados
      },
      importado: {
        produtos: criados,
        produtosNx1: nx1Criados,
        clientes: clientesCriados,
        usuarios: usuariosCriados,
        caixas: caixasCriados,
        categorias: dados.categorias.length,
        marcas: dados.marcas.length,
        subcategorias: dados.subcategorias.length,
        unidades: dados.unidades.length,
        ncm: ncmImportados,
        cest: cestImportados,
        cfop: cfopImportados,
        vendas: vendasCriadas,
        itens: itensImportados,
        pagamentos: pagamentosImportados,
        remocoes: remocoesImportadas,
        syslogs: syslogsImportados,
        terminais: terminaisImportados,
        brutosPreservados
      },
      identificado: {
        vendas: dados.vendas.length,
        itens: dados.itens.length,
        pagamentos: dados.pagamentos.length,
        remocoes: dados.remocoes.length,
        syslogs: dados.syslogs.length,
        terminais: dados.terminais.length,
        produtosBackup: dados.produtos.length + dados.produtosNx1.length,
        clientesBackup: dados.clientes.length
      },
      naoInterpretados: dados.naoInterpretados.length,
      semEquivalente: [],
      naoImportado: {
        itensSemVenda: dados.itens.length - itensImportados,
        pagamentosSemVenda: dados.pagamentos.length - pagamentosImportados,
        vendasSemPagamento: vendasSemPag,
        vendasSemItem: vendasSemItem,
        erros: erros.length
      },
      motivos: erros.slice(0, 200)
    }
    return {
      ok: true,
      resumo: {
        produtos: dados.produtos.length,
        produtosCriados: criados,
        produtosAtualizados: atualizados,
        produtosNx1: dados.produtosNx1.length,
        produtosNx1Criados: nx1Criados,
        produtosNx1Duplicados: nx1Duplicados,
        subcategoriasDistintas: nomesSubcategoriasDistintos,
        subcategoriasComCategoria: subcategoriasComCat,
        subcategoriasSemCategoria: subcategoriasSemCat,
        produtosComSubcategoria: catComSub + nx1ComSub,
        produtosSemSubcategoria: catSemSub + nx1SemSub,
        produtosNomeDeSubcategoriaDescartados: produtosNomeSubcat,
        clientes: dados.clientes.length,
        clientesCriados,
        usuarios: dados.usuarios.length,
        usuariosCriados,
        caixas: dados.caixas.length,
        caixasCriados,
        categorias: dados.categorias.length,
        marcas: dados.marcas.length,
        subcategorias: dados.subcategorias.length,
        unidades: dados.unidades.length,
        ncm: ncmImportados,
        cest: cestImportados,
        cfop: cfopImportados,
        vendasEncontradas: dados.vendas.length,
        vendasCriadas,
        vendasSemPagamento: vendasSemPag,
        vendasSemItem: vendasSemItem,
        itensEncontrados: dados.itens.length,
        itensImportados,
        pagamentosEncontrados: dados.pagamentos.length,
        pagamentosImportados,
        remocoesEncontradas: dados.remocoes.length,
        remocoesImportadas,
        syslogsEncontrados: dados.syslogs.length,
        syslogsImportados,
        terminaisEncontrados: dados.terminais.length,
        terminaisImportados,
        brutosPreservados,
        naoInterpretados: dados.naoInterpretados.length,
        erros: erros.length
      },
      erros,
      relatorio
    }
  } catch (err) {
    try {
      const db2 = getDb()
      db2.exec('ROLLBACK')
    } catch { /* ignore */ }
    atualizarProgresso({ ativo: false, etapa: 'erro', mensagem: `Falha na importação: ${(err as Error).message}` })
    registrarLog('ERROR', `Importação Nex falhou: ${(err as Error).message}`)
    return { ok: false, erros: [`${(err as Error).message}`] }
  }
}

// Estruturas do nosso sistema (para classificar o que existe)
const ESTRUTURAS_SISTEMA = new Set([
  'produtos', 'clientes', 'usuarios', 'caixas', 'vendas', 'venda_itens', 'pagamentos',
  'movimentacoes', 'categorias', 'subcategorias', 'marcas', 'unidades', 'fornecedores',
  'ncm_cadastro', 'cest_cadastro', 'cfop_cadastro', 'produtos_fiscais', 'historico_remocoes',
  'logs_sistema', 'terminais', 'contas', 'orcamentos', 'pedidos', 'config'
])

// Mapeamento de tabelas Nex para estruturas do sistema
const TABELAS_NEX_EQUIVALENTES: Record<string, string> = {
  'Cliente': 'clientes', 'Produto': 'produtos', 'catalogo_json': 'produtos',
  'Categoria': 'categorias', 'Subcategoria': 'subcategorias', 'Marca': 'marcas',
  'Unidade': 'unidades', 'Usuario': 'usuarios', 'Caixa': 'caixas',
  'Tran': 'vendas', 'ITran': 'venda_itens', 'PagEspecies': 'pagamentos',
  'MovEst': 'movimentacoes', 'stock': 'movimentacoes', 'EstoquePosicao': 'movimentacoes',
  'NCM': 'ncm_cadastro', 'br_cest': 'cest_cadastro', 'CFOP': 'cfop_cadastro',
  'RegistrosRemovidos': 'historico_remocoes', 'syslog': 'logs_sistema', 'Terminal': 'terminais',
  'Especie': 'formas_pagamento', 'CP': 'contas', 'Recebiveis': 'contas',
  'DadosFiscais': 'produtos_fiscais', 'endereco': 'clientes'
}

// Analisa o backup .nx1 (ZIP) e reporta estruturas sem importar nada
export async function analisarNex(zipBuffer: Buffer, nomeZip: string): Promise<{ ok: boolean; relatorio: Record<string, unknown>; erros?: string[] }> {
  const erros: string[] = []
  try {
    atualizarProgresso({ ativo: true, etapa: 'analisando', atual: 0, total: 1, mensagem: `Analisando ${nomeZip}...` })
    const zip = new AdmZip(zipBuffer)
    const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.nx1'))
    const estruturas: Record<string, unknown>[] = []
    const bufs: Map<string, Buffer> = new Map()
    for (const entry of entries) {
      try {
        const data = entry.getData()
        if (data) bufs.set(entry.entryName, data)
      } catch (e) {
        erros.push(`Falha ao ler ${entry.entryName}: ${(e as Error).message}`)
      }
    }
    // Analisar cada arquivo .nx1
    for (const entry of entries) {
      const buf = bufs.get(entry.entryName)
      if (!buf) continue
      const tabela = entry.entryName.replace(/\.nx1$/i, '')
      const dicionario = extrairDicionario(buf)
      const blocos = contarBlocos(buf)
      const temDados = blocos > 0
      const equivalente = TABELAS_NEX_EQUIVALENTES[tabela]
      const status = equivalente
        ? (ESTRUTURAS_SISTEMA.has(equivalente) ? 'suportada' : 'necessita_criar')
        : (temDados ? 'necessita_criar' : 'sem_dados')
      estruturas.push({
        tabela,
        tamanhoBytes: buf.length,
        blocosDados: blocos,
        temDados,
        campos: dicionario.slice(0, 30).map(f => `${f.nome}:${f.tipo}`),
        totalCampos: dicionario.length,
        equivalente,
        status
      })
    }
    estruturas.sort((a, b) => Number(b.blocosDados) - Number(a.blocosDados))
    const suportadas = estruturas.filter(e => e.status === 'suportada')
    const necessitamCriar = estruturas.filter(e => e.status === 'necessita_criar')
    const semDados = estruturas.filter(e => e.status === 'sem_dados')
    atualizarProgresso({ ativo: false, etapa: 'analisado', atual: 1, total: 1, mensagem: `Análise concluída: ${suportadas.length} estruturas suportadas, ${necessitamCriar.length} necessitam criação` })
    return {
      ok: true,
      relatorio: {
        arquivo: nomeZip,
        totalArquivosNx1: entries.length,
        estruturasEncontradas: estruturas.length,
        estruturasSuportadas: suportadas.map(e => e.tabela),
        novasEstruturasNecessarias: necessitamCriar.map(e => ({
          tabela: e.tabela,
          blocos: e.blocosDados,
          campos: e.campos,
          motivo: e.equivalente ? `Existe no Nex como ${e.equivalente}` : 'Sem equivalente no nosso sistema'
        })),
        estruturasSemDados: semDados.map(e => e.tabela),
        detalhes: estruturas,
        erros
      },
      erros
    }
  } catch (err) {
    atualizarProgresso({ ativo: false, etapa: 'erro', mensagem: `Falha na análise: ${(err as Error).message}` })
    return { ok: false, relatorio: { erro: (err as Error).message }, erros: [`${(err as Error).message}`] }
  }
}