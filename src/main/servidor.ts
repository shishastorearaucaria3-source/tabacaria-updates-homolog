export type SqlValue = null | number | bigint | string

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'

let baseUrl = process.env.TABACARIA_SERVIDOR || ''

function caminhoBase(): string {
  return (
    process.env.TABACARIA_DB ||
    (process.platform === 'win32'
      ? join(process.env.APPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Roaming'), 'sistema-loja-tabacaria')
      : join(process.env.HOME || '.', '.sistema-loja-tabacaria'))
  )
}

function caminhoArquivoPorta(): string {
  return join(caminhoBase(), 'servidor.porta')
}

function caminhoArquivoUrl(): string {
  return join(caminhoBase(), 'servidor.url')
}

export function lerPortaGravada(): number {
  try {
    const f = caminhoArquivoPorta()
    if (!existsSync(f)) return 0
    const n = Number(readFileSync(f, 'utf8'))
    return Number.isInteger(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function lerUrlGravada(): string {
  try {
    const f = caminhoArquivoUrl()
    if (!existsSync(f)) return ''
    return readFileSync(f, 'utf8').trim()
  } catch {
    return ''
  }
}

export function configurarServidor(url: string): void {
  baseUrl = url.replace(/\/$/, '')
}

export function getServidorUrl(): string {
  if (baseUrl) return baseUrl
  const gravada = lerUrlGravada()
  if (gravada) return gravada
  const porta = lerPortaGravada() || 3210
  return `http://localhost:${porta}`
}

function ehIpPrivado(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p[0] === 10) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  if (p[0] === 192 && p[1] === 168) return true
  return false
}

function ehLinkLocal(ip: string): boolean {
  return ip.startsWith('169.254.')
}

export function obterIpsRede(): string[] {
  const ips: string[] = []
  try {
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue
        if (!ehLinkLocal(info.address)) ips.push(info.address)
      }
    }
  } catch { /* ignore */ }
  // IPs privados (rede local) primeiro, depois os demais
  return [...ips.filter(ehIpPrivado), ...ips.filter((ip) => !ehIpPrivado(ip))]
}

export function configurarConexaoServidor(opcoes: { local?: boolean; ip?: string }): { ok: boolean; url: string; ips: string[] } {
  const ips = obterIpsRede()
  let url: string
  if (opcoes.local) {
    url = `http://localhost:${lerPortaGravada() || 3210}`
  } else {
    const ip = (opcoes.ip || ips.find(ehIpPrivado) || ips[0] || 'localhost').replace(/^http:\/\//, '').replace(/\/.*$/, '')
    url = `http://${ip}:${lerPortaGravada() || 3210}`
  }
  try {
    mkdirSync(caminhoBase(), { recursive: true })
    writeFileSync(caminhoArquivoUrl(), url, 'utf8')
  } catch { /* ignore */ }
  configurarServidor(url)
  return { ok: true, url, ips }
}

export async function testarServidor(): Promise<{ ok: boolean; url: string; erro?: string }> {
  const url = getServidorUrl()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`${url}/api/servidor/status`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) return { ok: true, url }
    return { ok: false, url, erro: `Servidor respondeu com status ${res.status}` }
  } catch (e) {
    return { ok: false, url, erro: 'Não foi possível conectar ao servidor.' }
  }
}

async function post<T>(caminho: string, corpo: unknown): Promise<T> {
  const res = await fetch(`${getServidorUrl()}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  })
  if (!res.ok) {
    const texto = await res.text()
    throw new Error(`Servidor ${caminho}: HTTP ${res.status} ${texto.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export const servidorClient = {
  all: (sql: string, params: unknown[] = []) => post<unknown[]>('/api/db/all', { sql, params }),
  get: (sql: string, params: unknown[] = []) => post<unknown>('/api/db/get', { sql, params }),
  run: (sql: string, params: unknown[] = []) =>
    post<{ changes: number; lastInsertRowid: number }>('/api/db/run', { sql, params }),
  exec: (sql: string) => post<{ ok: boolean }>('/api/db/exec', { sql }),
  authLogin: (login: string, senha: string) =>
    post<{ ok: boolean; erro?: string; usuario?: { id: number; nome: string; login: string; perfil: string; comissao_percent: number } }>(
      '/api/auth/login',
      { login, senha }
    ),
  authCriarUsuario: (dados: { nome: string; login: string; senha: string; perfil: string; comissao: number }) =>
    post<{ ok: boolean; id: number }>('/api/auth/criarUsuario', dados),
  authAlterarSenha: (usuarioId: number, novaSenha: string) =>
    post<{ ok: boolean }>('/api/auth/alterarSenha', { usuarioId, novaSenha }),
  authAtualizarUsuario: (dados: { usuarioId: number; nome: string; login: string; perfil: string; comissao: number; senha?: string }) =>
    post<{ ok: boolean }>('/api/auth/atualizarUsuario', dados),
  imagemGet: (produtoId: number) => fetch(`${getServidorUrl()}/api/imagem/${produtoId}`).then((r) => r.json() as Promise<string | null>),
  imagemList: () => fetch(`${getServidorUrl()}/api/imagem/list`).then((r) => r.json() as Promise<Record<number, string>>),
  imagemListPorIds: (ids: number[]) => post<Record<number, string>>('/api/imagem/listPorIds', { ids }),
  imagemDefinir: (produtoId: number, base64: string) => post<{ ok: boolean }>('/api/imagem/definir', { produtoId, base64 }),
  imagemRemover: (produtoId: number) => post<{ ok: boolean }>('/api/imagem/remover', { produtoId }),
  backup: () => post<{ ok: boolean; arquivo: string }>('/api/backup', {}),
  catalogoStatus: () => fetch(`${getServidorUrl()}/api/catalogo/status`).then((r) => r.json() as Promise<unknown>),
  catalogoConfig: (dados: Record<string, string | undefined>) => post<{ ok: boolean; config: unknown }>('/api/catalogo/config', dados),
  catalogoGetConfig: () => fetch(`${getServidorUrl()}/api/catalogo/config`).then((r) => r.json() as Promise<unknown>),
  catalogoSync: () => post<{ ok: boolean; erro?: string }>('/api/catalogo/sync', {}),
  catalogoTestar: () => post<{ ok: boolean; mensagem: string }>('/api/catalogo/testar', {}),
  catalogoGetExibicao: () => fetch(`${getServidorUrl()}/api/catalogo/exibicao`).then((r) => r.json() as Promise<unknown>),
  catalogoSalvarExibicao: (dados: Record<string, unknown>) => post<{ ok: boolean; exibicao: unknown }>('/api/catalogo/exibicao', dados),
  servidorStatus: () => fetch(`${getServidorUrl()}/api/servidor/status`).then((r) => r.json() as Promise<Record<string, unknown>>),
  servidorLogs: () => fetch(`${getServidorUrl()}/api/servidor/logs`).then((r) => r.json() as Promise<{ ok: boolean; logs: { hora: string; nivel: string; msg: string }[] }>),
  servidorLimparLogs: () => post<{ ok: boolean }>('/api/servidor/logs/limpar', {}),
  servidorBackupInfo: () => fetch(`${getServidorUrl()}/api/servidor/backup/info`).then((r) => r.json() as Promise<{ ok: boolean; dir: string; backups: { nome: string; data: string; tamanho: number }[] }>),
  servidorDiagnostico: () => post<{ ok: boolean; itens: { nome: string; status: string; detalhe: string }[] }>('/api/servidor/diagnostico', {}),
  servidorCorrigir: () => post<{ ok: boolean; correcoes: string[] }>('/api/servidor/corrigir', {}),
  servidorZerar: (alvos: string[]) => post<{ ok: boolean; removidos: string[]; erro?: string }>('/api/servidor/zerar', { alvos }),
  servidorRestaurar: (arquivo: string) => post<{ ok: boolean; erro?: string }>('/api/servidor/restaurar', { arquivo }),
  estoqueMovimentar: (dados: Record<string, unknown>) =>
    post<{ ok: boolean; documento: string; total: number; itens: number; tipo: string; categoria: string; erro?: string }>(
      '/api/estoque/movimentar',
      dados
    ),
  estoqueInventarioAbrir: (dados: { produtos: number[]; usuario_id?: number | null; observacao?: string | null }) =>
    post<{ ok: boolean; inventario_id: number; numero: string; itens: number; erro?: string }>('/api/estoque/inventario/abrir', dados),
  estoqueInventarioFinalizar: (dados: { inventario_id: number; usuario_id?: number | null }) =>
    post<{ ok: boolean; inventario_id: number; numero: string; divergencias: number; ajustados: number; conferidos: number; erro?: string }>(
      '/api/estoque/inventario/finalizar',
      dados
    ),
  estoqueInventarioCancelar: (dados: { inventario_id: number }) =>
    post<{ ok: boolean; erro?: string }>('/api/estoque/inventario/cancelar', dados)
}
