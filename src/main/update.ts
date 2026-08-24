import { app } from 'electron'
import { join, dirname, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { validarManifesto, deveAtualizar, urlCanalValida, ManifestoAtualizacao } from '../shared/update'
import { servidorClient } from './servidor'
import { gravarLogServidor } from './log'

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
  // Canal externo de atualização exige HTTPS; HTTP vale só para endpoints
  // locais/LAN (parte da arquitetura — a API :3210 não é afetada).
  if (!urlCanalValida(base)) {
    console.warn(`[update] canal ignorado (externo exige HTTPS): ${base}`)
    gravarLogServidor(`[update] canal ignorado (externo exige HTTPS): ${base}`)
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

// URL final do instalador: "baixar" absoluto (GitHub Releases) ou relativo ao canal.
function urlDownload(base: string, m: ManifestoAtualizacao): string {
  if (/^https?:\/\//i.test(m.baixar)) return m.baixar
  return `${base}/${m.baixar}`
}

// Diagnóstico (B): descreve erro de rede/fetch com causa raiz visível
// (ENOTFOUND / ECONNRESET / CERT / timeout / abort), inclusive a cadeia `cause`
// que o undici esconde dentro do TypeError genérico "fetch failed".
function descreverErroFetch(e: unknown): string {
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string; name?: string } }
  const partes = [err?.name, err?.message, err?.code ? `code=${err.code}` : '']
  if (err?.cause) {
    const c = err.cause
    partes.push(`cause=${c.name || ''}:${c.message || ''}${c.code ? ` (${c.code})` : ''}`)
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /aborted|timeout/i.test(err?.message || '')
  if (timeout) partes.push('ABORT/TIMEOUT')
  return partes.filter(Boolean).join(' | ')
}

async function buscarManifesto(): Promise<ManifestoAtualizacao | null> {
  const base = getUpdateBaseUrl()
  if (!base) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(`${base}/manifest.json`, { signal: ctrl.signal })
    gravarLogServidor(`[update] manifesto: ${base}/manifest.json -> HTTP ${res.status}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return validarManifesto(await res.json())
  } catch (e) {
    gravarLogServidor(`[update] falha ao buscar manifesto em ${base}: ${descreverErroFetch(e)}`)
    console.warn('[update] falha ao buscar manifesto:', descreverErroFetch(e))
    throw e
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
    if (!m) {
      gravarLogServidor('[update] manifesto baixado mas REJEITADO por validarManifesto (conteúdo inválido)')
      return { ativo: true, atual, disponivel: false, obrigatoria: false, notas: [], erro: 'Manifesto inválido.' }
    }
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
    gravarLogServidor(`[update] verificarAtualizacao: ${descreverErroFetch(e)}`)
    return { ativo: true, atual, disponivel: false, obrigatoria: false, notas: [], erro: descreverErroFetch(e) }
  }
}

function sha256Arquivo(caminho: string): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const { createReadStream } = require('node:fs') as typeof import('node:fs')
    const hash = createHash('sha256')
    const stream = createReadStream(caminho)
    stream.on('error', rejectP)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('end', () => resolveP(hash.digest('hex')))
  })
}

async function baixarInstalador(url: string, tamanhoEsperado: number, sha256Esperado: string): Promise<string> {
  // Nome único por tentativa: evita colisão com arquivo antigo travado por AV/
  // instalação anterior (EBUSY) e permite tentativas seguras.
  const destino = join(app.getPath('temp'), `${APLICATIVO_NOME}-setup-download-${Date.now()}.exe`)
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

interface ResultadoExecucao {
  code: number | null
  sinal: 'exit' | 'timeout' | 'erro'
  erro?: string
}

// Executa um processo esperando o fim (com timeout), mantendo o handle para
// observar o exit code enquanto este processo estiver vivo.
function rodarComCaptura(arquivo: string, args: string[], timeoutMs: number, envExtra?: Record<string, string>): Promise<ResultadoExecucao> {
  return new Promise((resolveP) => {
    const filho = spawn(arquivo, args, {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ...(envExtra || {}) }
    })
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { filho.kill() } catch { /* ignore */ }
      resolveP({ code: null, sinal: 'timeout', erro: `tempo esgotado (${Math.round(timeoutMs / 1000)}s)` })
    }, timeoutMs)
    filho.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveP({ code: null, sinal: 'erro', erro: e.message })
    })
    filho.on('exit', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveP({ code, sinal: 'exit' })
    })
  })
}

function caminhoMarcador(): string {
  return join(app.getPath('userData'), 'atualizacao-pendente.json')
}

function gravarMarcador(dados: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(caminhoMarcador()), { recursive: true })
    writeFileSync(caminhoMarcador(), JSON.stringify(dados, null, 2), 'utf8')
  } catch { /* ignore */ }
}

// Lança um comando FORA do Job Object do Electron via WMI — único escape
// confiável: spawn detached NÃO quebra o job (breakaway bloqueado), e o
// Windows mata o processo lançado junto com o app no meio da cópia.
function lancarForaDoJob(psScript: string): boolean {
  try {
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64')
    // spawnSync DIRETO (sem cmd /c): o execSync embrulha em shell e o cmd
    // engole o parêntese inicial do comando — causa da falha anterior.
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    const saida = (r.stdout || '').trim()
    gravarLogServidor(`[update] wmi ReturnValue=[${saida}] status=${r.status} err=${(r.stderr || '').trim().slice(0, 120)}`)
    return r.status === 0 && saida === '0'
  } catch (e) {
    gravarLogServidor(`[update] falha ao lançar fora do job: ${descreverErroFetch(e)}`)
    return false
  }
}

export async function instalarAtualizacao(manifesto?: ManifestoAtualizacao | null): Promise<{ ok: boolean; erro?: string; etapa?: string }> {
  try {
    if (!manifesto) {
      manifesto = await buscarManifesto()
      if (!manifesto) return { ok: false, etapa: 'manifesto', erro: 'Manifesto indisponível.' }
    }
    const base = getUpdateBaseUrl()
    if (!base) return { ok: false, etapa: 'canal', erro: 'Canal de atualização não configurado.' }
    const alvo = urlDownload(base, manifesto)
    if (!urlCanalValida(alvo)) {
      return { ok: false, etapa: 'canal', erro: 'Download bloqueado: canal externo exige HTTPS (HTTP apenas local/LAN).' }
    }
    // 1. Download + validação SHA-256/tamanho ANTES de qualquer alteração
    const arquivo = await baixarInstalador(alvo, manifesto.tamanho, manifesto.sha256)
    gravarLogServidor(`[update] payload validado: ${arquivo}`)
    // 2. Backup do banco antes de instalar (o servidor cria backup local)
    try {
      const b = await servidorClient.backup()
      if (!b.ok) console.warn('[update] backup falhou (continua):', b.arquivo)
      else gravarLogServidor(`[update] backup pré-atualização ok: ${b.arquivo}`)
    } catch (e) {
      console.warn('[update] backup falhou (continua):', (e as Error).message)
    }
    const tipo = tipoInstalacaoAtual()
    const dirInstalacao = dirname(resolve(process.execPath))
    const versaoEsperada = manifesto.versao
    const etapas: string[] = ['download-validado', 'backup']
    // 3. Lança o launcher VIA WMI (fora do Job Object) passando o caminho
    //    do payload baixado. O launcher fará: kill app -> extrair NSIS -> copiar -> relançar.
    //    Isso evita a extração NSIS no processo principal (que falha com exit=2
    //    quando o app ainda está rodando).
    const payloadPath = arquivo.replace(/'/g, "''")
    const autoupdateNode = join(dirInstalacao, 'autoupdate', 'node.exe').replace(/'/g, "''")
    const autoupdateScript = join(dirInstalacao, 'autoupdate', 'autoupdate.js').replace(/'/g, "''")
    const updateUrl = getUpdateBaseUrl()?.replace(/'/g, "''") || ''
    const psScript = [
      `$env:SETUP_INSTALL_DIR='${dirInstalacao.replace(/'/g, "''")}'`,
      `$env:SETUP_PAYLOAD_PATH='${payloadPath}'`,
      `$env:SETUP_TIPO='${tipo}'`,
      `$env:SETUP_VERSAO_ESPERADA='${versaoEsperada}'`,
      `$env:SETUP_UPDATE_URL='${updateUrl}'`,
      `& '${autoupdateNode}' '${autoupdateScript}'\n`
    ].join('\r\n')
    const runPs = join(tmpdir(), `run-autoupdate-${Date.now()}.ps1`)
    writeFileSync(runPs, psScript, 'utf8')
    gravarLogServidor(`[update] lançando autoupdate (via WMI) -> dir=${dirInstalacao} tipo=${tipo} versão=${versaoEsperada} payload=${arquivo}`)
    const cmdWmi = `(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${runPs.replace(/'/g, "''")}"' }).ReturnValue`
    const b64 = Buffer.from(cmdWmi, 'utf16le').toString('base64')
    let okLancou = false
    {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
      const saida = (r.stdout || '').trim()
      gravarLogServidor(`[update] wmi ReturnValue=[${saida}] status=${r.status} err=${(r.stderr || '').trim().slice(0, 120)}`)
      okLancou = r.status === 0 && saida === '0'
    }
    if (!okLancou) {
      const msgF = 'Falha ao lançar autoupdate fora do job (WMI)'
      gravarLogServidor(`[update] ${msgF}`)
      return { ok: false, etapa: 'aplicacao', erro: msgF }
    }
    // Aguarda marker de resultado do autoupdate (poll 2s, timeout 5 min = 300000ms)
    // O autoupdate escreve marker atômico ao concluir (sucesso ou falha)
    const fimPoll = Date.now() + 300000
    let markerPath: string | null = null
    while (Date.now() < fimPoll) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        // Procura marker mais recente em %TEMP%
        const fs = require('node:fs')
        const os = require('node:os')
        const path = require('node:path')
        const files = fs.readdirSync(os.tmpdir())
          .filter((f: string) => f.startsWith('nos-autoupdate-resultado-') && f.endsWith('.json'))
          .map((f: string) => ({ f, time: fs.statSync(path.join(os.tmpdir(), f)).mtimeMs }))
          .sort((a: { time: number }, b: { time: number }) => b.time - a.time)
        if (files.length > 0) {
          markerPath = path.join(os.tmpdir(), files[0].f)
          const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as { ok: boolean; versao: string; estagio: string; erro?: string }
          if (marker.versao === versaoEsperada) {
            gravarLogServidor(`[update] marker encontrado: ok=${marker.ok} estagio=${marker.estagio}`)
            if (marker.ok) {
              gravarLogServidor(`[update] aplicada (via marker): v${versaoEsperada}`)
              return { ok: true }
            } else {
              const msg = `Autoupdate falhou (estagio=${marker.estagio}): ${marker.erro || 'erro desconhecido'}`
              gravarLogServidor(`[update] ${msg}`)
              return { ok: false, etapa: 'aplicacao', erro: msg }
            }
          }
        }
      } catch { /* marker momentaneamente indisponível */ }
    }
    const msg = 'Autoupdate não concluiu dentro do tempo limite (5 min)'
    gravarLogServidor(`[update] ${msg}`)
    return { ok: false, etapa: 'aplicacao', erro: msg }
  } catch (e) {
    const msg = descreverErroFetch(e)
    gravarLogServidor(`[update] instalarAtualizacao ERRO: ${msg}`)
    return { ok: false, etapa: 'inesperado', erro: msg }
  }
}
