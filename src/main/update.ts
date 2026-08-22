import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { validarManifesto, deveAtualizar, urlCanalValida, ManifestoAtualizacao } from '../shared/update'
import { servidorClient } from './servidor'

export const APLICATIVO_NOME = 'NossoSistema'

function pastaDados(): string {
  return join(app.getPath('userData'))
}

function caminhoUrlConfig(): string {
  return join(pastaDados(), 'update.url')
}

export function getUpdateBaseUrl(): string {
  let candidato = process.env.TABACARIA_UPDATE_URL || ''
  if (!candidato) {
    try {
      if (existsSync(caminhoUrlConfig())) {
        const v = readFileSync(caminhoUrlConfig(), 'utf8').trim()
        if (v) candidato = v
      }
    } catch { /* ignore */ }
  }
  const base = candidato.trim().replace(/\/$/, '')
  if (!base) return ''
  // Canal externo de atualização exige HTTPS; HTTP vale só para
  // endpoints locais/LAN (parte da arquitetura — API :3210 não é afetada).
  if (!urlCanalValida(base)) {
    console.warn(`[update] canal ignorado (externo exige HTTPS): ${base}`)
    return ''
  }
  return base
}

export function setUpdateBaseUrl(url: string): { ok: boolean; erro?: string } {
  const base = String(url ?? '').trim().replace(/\/$/, '')
  try {
    mkdirSync(pastaDados(), { recursive: true })
    if (base && !urlCanalValida(base)) {
      return { ok: false, erro: 'Canal externo exige HTTPS (HTTP aceito apenas em localhost/rede local).' }
    }
    writeFileSync(caminhoUrlConfig(), base, 'utf8')
  } catch { /* ignore */ }
  return { ok: true }
}

export function versaoAtual(): string {
  return app.getVersion()
}

export interface ResultadoVerificacao {
  ativo: boolean
  atual: string
  nova?: string
  disponivel: boolean
  obrigatoria: boolean
  rollback?: boolean
  notas: string[]
  downloadUrl?: string
  erro?: string
}

// URL final do instalador: "baixar" absoluto (GitHub Releases) ou relativo
// ao canal (hospedagem local/pasta release/).
function urlDownload(base: string, m: ManifestoAtualizacao): string {
  if (/^https?:\/\//i.test(m.baixar)) return m.baixar
  return `${base}/${m.baixar}`
}

async function buscarManifesto(): Promise<ManifestoAtualizacao | null> {
  const base = getUpdateBaseUrl()
  if (!base) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${base}/manifest.json`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return validarManifesto(await res.json())
  } finally {
    clearTimeout(timer)
  }
}

export async function verificarAtualizacao(): Promise<ResultadoVerificacao> {
  const atual = versaoAtual()
  const base = getUpdateBaseUrl()
  if (!base) return { ativo: false, atual, disponivel: false, obrigatoria: false, notas: [] }
  try {
    const m = await buscarManifesto()
    if (!m) return { ativo: true, atual, disponivel: false, obrigatoria: false, notas: [], erro: 'Manifesto inválido.' }
    // versão maior → atualiza; igual → nada; menor → só com rollback: true
    const disponivel = deveAtualizar(atual, m.versao, m.rollback)
    return {
      ativo: true,
      atual,
      nova: m.versao,
      disponivel,
      obrigatoria: m.obrigatoria,
      rollback: m.rollback,
      notas: m.notas,
      downloadUrl: urlDownload(base, m)
    }
  } catch (e) {
    return { ativo: true, atual, disponivel: false, obrigatoria: false, notas: [], erro: (e as Error).message }
  }
}

function sha256Arquivo(caminho: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { createReadStream } = require('node:fs') as typeof import('node:fs')
    const hash = createHash('sha256')
    const stream = createReadStream(caminho)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function baixarInstalador(url: string, tamanhoEsperado: number, sha256Esperado: string): Promise<string> {
  const destino = join(app.getPath('temp'), `${APLICATIVO_NOME}-setup-download.exe`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ao baixar: HTTP ${res.status}`)
  const body = Buffer.from(await res.arrayBuffer())
  if (tamanhoEsperado && body.length !== tamanhoEsperado) {
    throw new Error(`Tamanho inválido: esperado ${tamanhoEsperado}, recebido ${body.length}`)
  }
  const hash = createHash('sha256').update(body).digest('hex')
  if (sha256Esperado && hash !== sha256Esperado) {
    throw new Error(`Checksum inválido: esperado ${sha256Esperado}, recebido ${hash}`)
  }
  writeFileSync(destino, body)
  return destino
}

function caminhoInstalacaoAtual(): string {
  // Em instalação real, process.resourcesPath aponta para <instalacao>/resources
  // e instalacao.json fica na raiz da instalação (junto ao executável).
  return join(process.resourcesPath, '..')
}

export function tipoInstalacaoAtual(): string {
  try {
    const cfg = join(caminhoInstalacaoAtual(), 'instalacao.json')
    if (existsSync(cfg)) {
      const j = JSON.parse(readFileSync(cfg, 'utf8')) as { tipo?: string }
      if (j.tipo === 'servidor' || j.tipo === 'cliente') return j.tipo
    }
  } catch { /* ignore */ }
  return 'servidor'
}

export async function instalarAtualizacao(manifesto?: ManifestoAtualizacao | null): Promise<{ ok: boolean; erro?: string }> {
  try {
    if (!manifesto) {
      manifesto = await buscarManifesto()
      if (!manifesto) return { ok: false, erro: 'Manifesto indisponível.' }
    }
    const base = getUpdateBaseUrl()
    if (!base) return { ok: false, erro: 'Canal de atualização não configurado.' }
    const alvo = urlDownload(base, manifesto)
    if (!urlCanalValida(alvo)) {
      return { ok: false, erro: 'Download bloqueado: canal externo exige HTTPS (HTTP apenas local/LAN).' }
    }
    const arquivo = await baixarInstalador(
      alvo,
      manifesto.tamanho,
      manifesto.sha256
    )
    // Backup do banco antes de instalar (o servidor cria backup local)
    try {
      const b = await servidorClient.backup()
      if (!b.ok) console.warn('[update] backup falhou (continua):', b.arquivo)
    } catch (e) {
      console.warn('[update] backup falhou (continua):', (e as Error).message)
    }
    const tipo = tipoInstalacaoAtual()
    const args = ['/S', `/TIPO=${tipo}`, '/AUTOUPDATE=1']
    if (process.env.TABACARIA_UPDATE_URL) args.push(`/UPDATE_URL=${process.env.TABACARIA_UPDATE_URL}`)
    try {
      spawn(arquivo, args, { detached: true, stdio: 'ignore' }).unref()
    } catch (e) {
      return { ok: false, erro: `Não foi possível iniciar o instalador: ${(e as Error).message}` }
    }
    setTimeout(() => app.quit(), 1500)
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}