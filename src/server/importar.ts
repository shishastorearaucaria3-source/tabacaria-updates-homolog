import { getDb, getDefaultDbPath } from './index'
import { registrarLog } from './servidor'
import AdmZip from 'adm-zip'
import * as XLSX from 'xlsx'
import { join } from 'node:path'
import { mkdirSync, rmSync, readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { SQLInputValue } from 'node:sqlite'

const EXTENSOES = ['.xlsx', '.xls', '.csv', '.json']

export interface ProgressoImportacao {
  ativo: boolean
  etapa: string
  atual: number
  total: number
  mensagem: string
}

let progressoImportacao: ProgressoImportacao = { ativo: false, etapa: '', atual: 0, total: 0, mensagem: '' }

export function getProgressoImportacao(): ProgressoImportacao {
  return { ...progressoImportacao }
}

function atualizarProgresso(parcial: Partial<ProgressoImportacao>): void {
  progressoImportacao = { ...progressoImportacao, ...parcial }
}

const pausar = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function pastaImportacao(): string {
  return join(getDefaultDbPath(), '..', 'importacao')
}

export function limparPastaImportacao(): void {
  try {
    const dir = pastaImportacao()
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  } catch { /* ignore */ }
}

export async function extrairZip(arquivo: Buffer | string, nomeZip: string): Promise<{ ok: boolean; arquivos: string[]; erro?: string }> {
  try {
    if (!arquivo) return { ok: false, arquivos: [], erro: 'Arquivo vazio.' }
    limparPastaImportacao()
    const buffer = Buffer.isBuffer(arquivo) ? arquivo : Buffer.from(arquivo as string, 'base64')
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries().filter((e) => !e.isDirectory)
    atualizarProgresso({ ativo: true, etapa: 'extraindo', atual: 0, total: entries.length, mensagem: 'Extraindo arquivos do ZIP...' })
    const dir = pastaImportacao()
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const destino = join(dir, entry.entryName)
      try {
        mkdirSync(join(destino, '..'), { recursive: true })
        const conteudo = entry.getData()
        if (conteudo) writeFileSync(destino, conteudo)
      } catch (e) {
        registrarLog('ERROR', `Falha ao extrair ${entry.entryName}: ${(e as Error).message}`)
      }
      atualizarProgresso({ atual: i + 1, mensagem: `Extraindo ${entry.entryName}...` })
      if ((i + 1) % 50 === 0) await pausar()
    }
    const arquivos = listarArquivosImportacao()
    atualizarProgresso({ ativo: false, etapa: 'extraido', atual: arquivos.length, total: arquivos.length, mensagem: `ZIP extraído (${arquivos.length} arquivo(s) de dados)` })
    registrarLog('SUCCESS', `ZIP importado: ${nomeZip} (${arquivos.length} arquivo(s) de dados)`)
    return { ok: true, arquivos }
  } catch (err) {
    atualizarProgresso({ ativo: false, etapa: 'erro', mensagem: `Falha ao ler o ZIP: ${(err as Error).message}` })
    registrarLog('ERROR', `Falha ao extrair ZIP: ${(err as Error).message}`)
    return { ok: false, arquivos: [], erro: `Falha ao ler o ZIP: ${(err as Error).message}` }
  }
}

export function listarArquivosImportacao(): string[] {
  const dir = pastaImportacao()
  if (!existsSync(dir)) return []
  const resultado: string[] = []
  const percorrer = (atual: string): void => {
    for (const item of readdirSync(atual)) {
      const caminho = join(atual, item)
      const st = statSync(caminho)
      if (st.isDirectory()) {
        percorrer(caminho)
      } else {
        const nome = item.toLowerCase()
        if (EXTENSOES.some((e) => nome.endsWith(e))) {
          resultado.push(caminho.replace(dir, '').replace(/\\/g, '/').replace(/^\//, ''))
        }
      }
    }
  }
  percorrer(dir)
  return resultado.sort()
}

function resolverCaminho(arquivo: string): string | null {
  const dir = pastaImportacao()
  const caminho = join(dir, arquivo)
  if (!caminho.startsWith(dir)) return null
  if (!existsSync(caminho)) return null
  return caminho
}

function lerPlanilha(caminho: string): Record<string, unknown>[] {
  const ext = caminho.toLowerCase().split('.').pop()
  if (ext === 'json') {
    const raw = readFileSync(caminho, 'utf-8')
    const dados = JSON.parse(raw)
    const arr = Array.isArray(dados) ? dados : (Array.isArray(dados?.produtos) ? dados.produtos : [])
    return arr.filter((l: unknown) => l && typeof l === 'object') as Record<string, unknown>[]
  }
  const buffer = readFileSync(caminho)
  if (ext === 'csv') {
    const wb = XLSX.read(buffer.toString('utf-8'), { type: 'string' })
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
  }
  const wb = XLSX.read(buffer, { type: 'buffer' })
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
}

export function lerArquivoImportacao(arquivo: string): { ok: boolean; colunas: string[]; linhas: Record<string, unknown>[]; erro?: string } {
  const caminho = resolverCaminho(arquivo)
  if (!caminho) return { ok: false, colunas: [], linhas: [], erro: 'Arquivo não encontrado no ZIP.' }
  try {
    const linhas = lerPlanilha(caminho)
    const colunas = linhas.length ? Object.keys(linhas[0]) : []
    return { ok: true, colunas, linhas }
  } catch (err) {
    return { ok: false, colunas: [], linhas: [], erro: `Falha ao ler o arquivo: ${(err as Error).message}` }
  }
}

function norm(v: unknown): string {
  return String(v ?? '').trim()
}

function chaveNorm(v: string): string {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_\-]+/g, '').replace(/[^a-z0-9]/g, '')
}

function paraNumero(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  if (v == null) return 0
  let s = String(v).replace('R$', '').replace(/[^\d,.-]/g, '').trim()
  if (!s) return 0
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    const partes = s.split('.')
    if (partes.length > 2) s = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1]
  }
  const n = Number(s)
  return isNaN(n) ? 0 : n
}

function valorPorChave(linha: Record<string, unknown>, colunas: string[], chaves: string[]): unknown {
  for (const c of colunas) {
    const nc = norm(c).toLowerCase()
    if (chaves.some((k) => nc === k || nc.includes(k))) {
      const v = linha[c]
      if (norm(v) !== '') return v
    }
  }
  return ''
}

export async function importarProdutos(arquivo: string): Promise<{ ok: boolean; criados: number; atualizados: number; semPreco: number; erros: string[] }> {
  const caminho = resolverCaminho(arquivo)
  const resultado = { ok: false, criados: 0, atualizados: 0, semPreco: 0, erros: [] as string[] }
  if (!caminho) {
    resultado.erros.push('Arquivo não encontrado no ZIP.')
    return resultado
  }
  const db = getDb()
  let linhas: Record<string, unknown>[]
  try {
    linhas = lerPlanilha(caminho)
  } catch (err) {
    resultado.erros.push(`Falha ao ler o arquivo: ${(err as Error).message}`)
    return resultado
  }
  if (linhas.length === 0) {
    resultado.erros.push('Planilha vazia.')
    return resultado
  }
  const colunas = Object.keys(linhas[0])
  const campos: { campo: string; chaves: string[] }[] = [
    { campo: 'nome', chaves: ['nome', 'produto'] },
    { campo: 'observacoes', chaves: ['observação', 'observacao', 'obs', 'descricao', 'descrição', 'description'] },
    { campo: 'codigo_barras', chaves: ['ean', 'gtin', 'código', 'codigo', 'codigo_barras', 'ean/gtin', 'código de barras', 'codigo de barras'] },
    { campo: 'codigo_extra', chaves: ['código extra', 'codigo extra'] },
    { campo: 'preco_venda', chaves: ['preço', 'preco', 'preço de venda', 'preco de venda', 'valor'] },
    { campo: 'estoque', chaves: ['estoque atual', 'estoque', 'saldo'] },
    { campo: 'estoque_minimo', chaves: ['estoque min', 'estoque mín', 'estoque mínimo', 'estoque minimo'] },
    { campo: 'estoque_maximo', chaves: ['estoque max', 'estoque máx', 'estoque máximo', 'estoque maximo'] },
    { campo: 'categoria', chaves: ['categoria', 'departamento'] },
    { campo: 'subcategoria', chaves: ['sub categoria', 'subcategoria', 'sub-categoria'] },
    { campo: 'marca', chaves: ['marca'] },
    { campo: 'fornecedor', chaves: ['fornecedor principal', 'fornecedor'] },
    { campo: 'unidade', chaves: ['unidade', 'unid', 'und'] },
    { campo: 'peso_liq', chaves: ['peso líq', 'peso liq', 'peso líquido', 'peso liquido'] },
    { campo: 'peso_bruto', chaves: ['peso bruto'] },
    { campo: 'localizacao', chaves: ['localização', 'localizacao'] },
    { campo: 'preco_promo', chaves: ['preço promocional', 'preco promocional'] },
    { campo: 'preco_atacado1', chaves: ['preço atacado 1', 'preco atacado 1', 'preço atacado1', 'preco atacado1'] },
    { campo: 'qtd_min_atacado1', chaves: ['qtd min atacado 1', 'qtd mín atacado 1', 'qtd min atacado1'] },
    { campo: 'preco_atacado2', chaves: ['preço atacado 2', 'preco atacado 2', 'preço atacado2', 'preco atacado2'] },
    { campo: 'qtd_min_atacado2', chaves: ['qtd min atacado 2', 'qtd mín atacado 2', 'qtd min atacado2'] },
    { campo: 'ncm', chaves: ['ncm'] },
    { campo: 'cest', chaves: ['cest'] }
  ]
  const mapa: Record<string, string> = {}
  const usadas = new Set<number>()
  const colunasNorm = colunas.map(chaveNorm)
  for (const f of campos) {
    let idx = -1
    for (let i = 0; i < colunasNorm.length; i++) {
      if (usadas.has(i)) continue
      if (f.chaves.some((k) => colunasNorm[i] === chaveNorm(k))) { idx = i; break }
    }
    if (idx >= 0) { mapa[f.campo] = colunas[idx]; usadas.add(idx) }
  }
  for (const f of campos) {
    if (mapa[f.campo]) continue
    let melhorIdx = -1
    let melhorScore = 0
    for (let i = 0; i < colunasNorm.length; i++) {
      if (usadas.has(i)) continue
      for (const k of f.chaves) {
        const nk = chaveNorm(k)
        if (nk.length < 3) continue
        if (colunasNorm[i].includes(nk) && nk.length > melhorScore) { melhorScore = nk.length; melhorIdx = i }
      }
    }
    if (melhorIdx >= 0) { mapa[f.campo] = colunas[melhorIdx]; usadas.add(melhorIdx) }
  }
  const val = (l: Record<string, unknown>, campo: string): unknown => {
    const col = mapa[campo]
    return col ? l[col] : ''
  }
  atualizarProgresso({ ativo: true, etapa: 'importando', atual: 0, total: linhas.length, mensagem: 'Importando produtos...' })
  try {
    for (let li = 0; li < linhas.length; li++) {
      const linha = linhas[li]
      try {
        const nome = norm(val(linha, 'nome'))
        if (!nome) continue
        const codigo = norm(val(linha, 'codigo_barras'))
        const precoVenda = paraNumero(val(linha, 'preco_venda'))
        if (precoVenda <= 0) resultado.semPreco++
        let categoriaId: number | null = null
        const categoria = norm(val(linha, 'categoria'))
        if (categoria) {
          const cat = db.prepare(`SELECT id FROM categorias WHERE nome = ?`).get(categoria) as { id: number } | undefined
          categoriaId = cat?.id ?? Number(db.prepare(`INSERT INTO categorias (nome) VALUES (?)`).run(categoria).lastInsertRowid)
          const subcategoria = norm(val(linha, 'subcategoria'))
          if (subcategoria) {
            const sub = db.prepare(`SELECT id FROM subcategorias WHERE nome = ? AND categoria_id = ?`).get(subcategoria, categoriaId) as { id: number } | undefined
            if (!sub) db.prepare(`INSERT INTO subcategorias (categoria_id, nome) VALUES (?, ?)`).run(categoriaId, subcategoria)
          }
        }
        let marcaId: number | null = null
        const marca = norm(val(linha, 'marca'))
        if (marca) {
          const mar = db.prepare(`SELECT id FROM marcas WHERE nome = ?`).get(marca) as { id: number } | undefined
          marcaId = mar?.id ?? Number(db.prepare(`INSERT INTO marcas (nome) VALUES (?)`).run(marca).lastInsertRowid)
        }
        let fornecedorId: number | null = null
        const fornecedor = norm(val(linha, 'fornecedor'))
        if (fornecedor) {
          const forn = db.prepare(`SELECT id FROM fornecedores WHERE nome = ?`).get(fornecedor) as { id: number } | undefined
          fornecedorId = forn?.id ?? Number(db.prepare(`INSERT INTO fornecedores (nome) VALUES (?)`).run(fornecedor).lastInsertRowid)
        }
        const existente = codigo
          ? (db.prepare(`SELECT id FROM produtos WHERE codigo_barras = ?`).get(codigo) as { id: number } | undefined)
          : undefined
        const dados = [
          nome,
          codigo || null,
          norm(val(linha, 'codigo_extra')) || null,
          precoVenda,
          paraNumero(val(linha, 'estoque')),
          paraNumero(val(linha, 'estoque_minimo')),
          paraNumero(val(linha, 'estoque_maximo')) || null,
          categoriaId,
          marcaId,
          fornecedorId,
          norm(val(linha, 'unidade')) || 'un',
          paraNumero(val(linha, 'peso_liq')) || null,
          paraNumero(val(linha, 'peso_bruto')) || null,
          norm(val(linha, 'localizacao')) || null,
          paraNumero(val(linha, 'preco_promo')) || null,
          paraNumero(val(linha, 'preco_atacado1')) || null,
          paraNumero(val(linha, 'preco_atacado2')) || null,
          paraNumero(val(linha, 'qtd_min_atacado1')),
          paraNumero(val(linha, 'qtd_min_atacado2')),
          norm(val(linha, 'ncm')) || null,
          norm(val(linha, 'cest')) || null,
          norm(val(linha, 'observacoes')) || null
        ] as SQLInputValue[]
        if (existente) {
          db.prepare(
            `UPDATE produtos SET nome=?, codigo_barras=?, codigo_extra=?, preco_venda=?, estoque=?, estoque_minimo=?, estoque_maximo=?,
               categoria_id=?, marca_id=?, fornecedor_id=?, unidade=?, peso_liq=?, peso_bruto=?, localizacao=?,
               preco_promo=?, preco_atacado1=?, preco_atacado2=?, qtd_min_atacado1=?, qtd_min_atacado2=?,
               ncm=?, cest=?, observacoes=? WHERE id=?`
          ).run(...dados, existente.id)
          resultado.atualizados++
        } else {
          db.prepare(
            `INSERT INTO produtos (nome, codigo_barras, codigo_extra, preco_venda, estoque, estoque_minimo, estoque_maximo,
               categoria_id, marca_id, fornecedor_id, unidade, peso_liq, peso_bruto, localizacao,
               preco_promo, preco_atacado1, preco_atacado2, qtd_min_atacado1, qtd_min_atacado2, ncm, cest, observacoes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(...dados)
          resultado.criados++
        }
      } catch (err) {
        resultado.erros.push((err as Error).message)
      }
      atualizarProgresso({ atual: li + 1, mensagem: `Importando ${li + 1} de ${linhas.length}...` })
      if ((li + 1) % 200 === 0) await pausar()
    }
    resultado.ok = true
    atualizarProgresso({ ativo: false, etapa: 'concluido', atual: linhas.length, total: linhas.length, mensagem: `Concluído: ${resultado.criados} criados, ${resultado.atualizados} atualizados` })
    registrarLog('SUCCESS', `Importação concluída: ${resultado.criados} criados, ${resultado.atualizados} atualizados`)
  } catch (err) {
    atualizarProgresso({ ativo: false, etapa: 'erro', mensagem: `Falha na importação: ${(err as Error).message}` })
    registrarLog('ERROR', `Falha na importação de produtos: ${(err as Error).message}`)
    resultado.erros.push((err as Error).message)
  }
  return resultado
}