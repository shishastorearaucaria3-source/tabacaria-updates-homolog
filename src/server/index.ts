import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdirSync, existsSync, copyFileSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import express from 'express'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { migrations, SCHEMA_VERSION } from '../shared/schema'
import { encontrarZona, Zona } from '../shared/geo'
import { getConfig, salvarConfig, getStatus, sincronizarAgora, testarConexao, temInternet, notificarAlteracaoProduto, getExibicao, salvarExibicao, backupConfigCatalogo, getBackupConfigCatalogo, restaurarBackupConfigCatalogo } from './catalogo'
import { getStatusServidor, getLogs, limparLogs, getBackupInfo, diagnosticar, corrigir, zerarDados, restaurarBackup, registrarLog, versaoSistema } from './servidor'
import { extrairZip, listarArquivosImportacao, lerArquivoImportacao, importarProdutos, limparPastaImportacao, getProgressoImportacao } from './importar'
import { importarNex, getProgressoNex, analisarNex } from './importar-nex'

function notificarProdutoSeNecessario(sql: string, params: unknown[]): void {
  try {
    const s = sql.toLowerCase()
    if (s.includes('update produtos') || s.includes('insert into produtos')) {
      // extrai id do where id = ?
      const m = sql.match(/where\s+id\s*=\s*(\?|\d+)/i)
      if (m) {
        const id = m[1] === '?' ? Number(params[0]) : Number(m[1])
        if (id) notificarAlteracaoProduto(id)
      } else if (s.includes('insert into produtos')) {
        const ultimo = getDb().prepare('SELECT last_insert_rowid() AS id').get() as { id: number }
        if (ultimo.id) notificarAlteracaoProduto(ultimo.id)
      }
    }
  } catch { /* ignore */ }
}

const MAX_BACKUPS = 30

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!db) throw new Error('DB not initialized')
  return db
}

function getDefaultDbPath(): string {
  const base =
    process.env.TABACARIA_DB ||
    (process.platform === 'win32'
      ? join(process.env.APPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Roaming'), 'sistema-loja-tabacaria', 'tabacaria.sqlite')
      : join(process.env.HOME || '.', '.sistema-loja-tabacaria', 'tabacaria.sqlite'))
  return base
}

export { getDefaultDbPath }

export function reabrirBanco(): DatabaseSync {
  const path = getDefaultDbPath()
  db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function initDb(path = getDefaultDbPath()): DatabaseSync {
  if (db) return db
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

function migrate(database: DatabaseSync): void {
  const existing = database.prepare('PRAGMA user_version').get() as { user_version: number }
  let current = existing.user_version ?? 0
  while (current < SCHEMA_VERSION) {
    const next = current + 1
    const sql = migrations[next]
    if (!sql) throw new Error(`Migration ${next} not found`)
    database.exec('BEGIN')
    try {
      database.exec(sql)
      database.exec(`PRAGMA user_version = ${next}`)
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      throw err
    }
    current = next
  }
}

export function hashSenha(senha: string): string {
  return createHash('sha256').update(senha).digest('hex')
}

export function seed(database: DatabaseSync): void {
  // Garantir que o usuário admin/admin123 sempre exista (idempotente)
  const senha = hashSenha('admin123')
  const adminExiste = database.prepare('SELECT id FROM usuarios WHERE login = ?').get('admin') as { id: number } | undefined
  if (adminExiste) {
    database.prepare("UPDATE usuarios SET nome = 'Administrador', senha_hash = ?, perfil = 'admin', ativo = 1 WHERE login = 'admin'").run(senha)
  } else {
    database.prepare("INSERT INTO usuarios (nome, login, senha_hash, perfil, comissao_percent) VALUES (?, ?, ?, 'admin', 0)").run('Administrador', 'admin', senha)
  }
  // Guarda por CATEGORIAS (não por contagem de usuários): bancos com um único
  // usuário voltavam a reinserir categorias no segundo boot e morriam com
  // UNIQUE constraint. Idempotente: semeia somente quando não há nenhuma.
  const cats = database.prepare('SELECT COUNT(*) AS c FROM categorias').get() as { c: number }
  if (cats.c > 0) return
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Cigarros')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Charutos')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Tabaco')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Acessorios')
  database.prepare('INSERT INTO categorias (nome) VALUES (?)').run('Bebidas')
}

function backupDir(): string {
  const dir = join(getDefaultDbPath(), '..', 'backups')
  mkdirSync(dir, { recursive: true })
  return dir
}

function backupName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.sqlite`
}

export function fazerBackup(): { ok: boolean; arquivo: string } {
  try {
    const d = getDb()
    d.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const dir = backupDir()
    const arquivo = join(dir, backupName())
    copyFileSync(getDefaultDbPath(), arquivo)

    const arquivos = readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort()
    while (arquivos.length > MAX_BACKUPS) {
      const antigo = arquivos.shift()!
      rmSync(join(dir, antigo))
    }
    return { ok: true, arquivo }
  } catch (err) {
    return { ok: false, arquivo: String((err as Error).message) }
  }
}

let server: Server | null = null
let portaAtual = 0

export function getPorta(): number {
  return portaAtual
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

function ehLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.startsWith('::ffff:192.168.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:172.')
}

function mesmaSubnet(a: string, b: string): boolean {
  const pa = a.split('.')
  const pb = b.split('.')
  if (pa.length !== 4 || pb.length !== 4) return false
  return pa[0] === pb[0] && pa[1] === pb[1]
}

export function getIpRede(): string {
  try {
    const candidatos: string[] = []
    for (const infos of Object.values(networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue
        candidatos.push(info.address)
      }
    }
    // Prioriza IP privado (rede local/Wi-Fi/Ethernet), ignora link-local (169.254)
    const privados = candidatos.filter((ip) => ehIpPrivado(ip) && !ehLinkLocal(ip))
    if (privados.length > 0) return privados[0]
    const normais = candidatos.filter((ip) => !ehLinkLocal(ip))
    if (normais.length > 0) return normais[0]
    return candidatos[0] || '127.0.0.1'
  } catch { /* ignore */ }
  return '127.0.0.1'
}

function caminhoArquivoPorta(): string {
  const base =
    process.env.TABACARIA_DB ||
    (process.platform === 'win32'
      ? join(process.env.APPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Roaming'), 'sistema-loja-tabacaria')
      : join(process.env.HOME || '.', '.sistema-loja-tabacaria'))
  return join(base, 'servidor.porta')
}

function gravarPorta(porta: number): void {
  try {
    const arquivo = caminhoArquivoPorta()
    mkdirSync(join(arquivo, '..'), { recursive: true })
    writeFileSync(arquivo, String(porta), 'utf8')
  } catch { /* ignore */ }
}

function lerPortaGravada(): number {
  try {
    return Number(readFileSync(caminhoArquivoPorta(), 'utf8')) || 0
  } catch {
    return 0
  }
}

export function iniciarServidor(porta = 3210): void {
  const database = getDb()
  const app = express()
  app.use(express.json({ limit: '100mb' }))

  // Restringe acesso à rede local (e ao próprio computador). Conexões de fora da
  // subnet do servidor são bloqueadas — o servidor só é acessível dentro do roteador.
  const ipLocal = getIpRede()
  app.use((req, res, next) => {
    const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    if (ehLoopback(req.socket.remoteAddress || '') || remote === ipLocal || ehIpPrivado(remote) && mesmaSubnet(remote, ipLocal)) {
      next()
      return
    }
    res.status(403).json({ erro: 'Acesso permitido apenas na rede local.' })
  })

  app.post('/api/db/all', (req, res) => {
    const { sql, params } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    try {
      res.json(database.prepare(sql).all(...(Array.isArray(params) ? params : [])))
    } catch (err) {
      registrarLog('ERROR', `SQL (/all) ${sql.slice(0, 120)}: ${(err as Error).message}`)
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  app.post('/api/db/get', (req, res) => {
    const { sql, params } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    try {
      const result = database.prepare(sql).get(...(Array.isArray(params) ? params : []))
      res.json(result ?? null)
    } catch (err) {
      registrarLog('ERROR', `SQL (/get) ${sql.slice(0, 120)}: ${(err as Error).message}`)
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  app.post('/api/db/run', (req, res) => {
    const { sql, params } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    try {
      const result = database.prepare(sql).run(...(Array.isArray(params) ? params : []))
      notificarProdutoSeNecessario(sql, Array.isArray(params) ? params : [])
      res.json({ changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) })
    } catch (err) {
      registrarLog('ERROR', `SQL (/run) ${sql.slice(0, 120)}: ${(err as Error).message}`)
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  app.post('/api/db/exec', (req, res) => {
    const { sql } = req.body ?? {}
    if (typeof sql !== 'string') {
      res.status(400).json({ erro: 'sql obrigatório' })
      return
    }
    try {
      database.exec(sql)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ erro: (err as Error).message })
    }
  })

  app.post('/api/auth/login', (req, res) => {
    const { login, senha } = req.body ?? {}
    const user = database
      .prepare(`SELECT id, nome, login, perfil, comissao_percent FROM usuarios WHERE login = ? AND ativo = 1`)
      .get(login) as { id: number; nome: string; login: string; perfil: string; comissao_percent: number } | undefined
    if (!user) {
      res.json({ ok: false, erro: 'Usuário não encontrado' })
      return
    }
    const row = database.prepare(`SELECT senha_hash FROM usuarios WHERE id = ?`).get(user.id) as { senha_hash: string }
    if (row.senha_hash !== hashSenha(senha ?? '')) {
      res.json({ ok: false, erro: 'Senha incorreta' })
      return
    }
    res.json({ ok: true, usuario: user })
  })

  app.post('/api/auth/criarUsuario', (req, res) => {
    const dados = req.body ?? {}
    const hash = hashSenha(String(dados.senha ?? ''))
    const result = database
      .prepare(`INSERT INTO usuarios (nome, login, senha_hash, perfil, comissao_percent) VALUES (?, ?, ?, ?, ?)`)
      .run(String(dados.nome), String(dados.login), hash, String(dados.perfil), Number(dados.comissao) || 0)
    res.json({ ok: true, id: Number(result.lastInsertRowid) })
  })

  app.post('/api/auth/alterarSenha', (req, res) => {
    const { usuarioId, novaSenha } = req.body ?? {}
    const hash = hashSenha(String(novaSenha ?? ''))
    database.prepare(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`).run(hash, Number(usuarioId))
    res.json({ ok: true })
  })

  app.post('/api/auth/atualizarUsuario', (req, res) => {
    const { usuarioId, nome, login, perfil, comissao, senha } = req.body ?? {}
    if (senha) {
      const hash = hashSenha(String(senha))
      database
        .prepare(`UPDATE usuarios SET nome = ?, login = ?, perfil = ?, comissao_percent = ?, senha_hash = ? WHERE id = ?`)
        .run(String(nome), String(login), String(perfil), Number(comissao) || 0, hash, Number(usuarioId))
    } else {
      database
        .prepare(`UPDATE usuarios SET nome = ?, login = ?, perfil = ?, comissao_percent = ? WHERE id = ?`)
        .run(String(nome), String(login), String(perfil), Number(comissao) || 0, Number(usuarioId))
    }
    res.json({ ok: true })
  })

  app.get('/api/imagem/:id', (req, res) => {
    const row = database
      .prepare(`SELECT imagem FROM produtos WHERE id = ?`)
      .get(Number(req.params.id)) as { imagem: Uint8Array | null } | undefined
    if (!row?.imagem || row.imagem.length === 0) {
      res.json(null)
      return
    }
    res.json(Buffer.from(row.imagem).toString('base64'))
  })

  app.get('/api/imagem/list', (_req, res) => {
    const rows = database
      .prepare(`SELECT id, imagem FROM produtos WHERE imagem IS NOT NULL AND length(imagem) > 0`)
      .all() as { id: number; imagem: Uint8Array }[]
    const mapa: Record<number, string> = {}
    for (const r of rows) {
      mapa[r.id] = Buffer.from(r.imagem).toString('base64')
    }
    res.json(mapa)
  })

  app.post('/api/imagem/listPorIds', (req, res) => {
    const { ids } = req.body ?? {}
    if (!Array.isArray(ids) || ids.length === 0) {
      res.json({})
      return
    }
    const mapa: Record<number, string> = {}
    const placeholders = ids.map(() => '?').join(',')
    const rows = database
      .prepare(`SELECT id, imagem FROM produtos WHERE id IN (${placeholders}) AND imagem IS NOT NULL AND length(imagem) > 0`)
      .all(...ids) as { id: number; imagem: Uint8Array }[]
    for (const row of rows) {
      mapa[row.id] = Buffer.from(row.imagem).toString('base64')
    }
    res.json(mapa)
  })

  app.post('/api/imagem/definir', (req, res) => {
    const { produtoId, base64 } = req.body ?? {}
    const buf = Buffer.from(String(base64 ?? ''), 'base64')
    database.prepare(`UPDATE produtos SET imagem = ? WHERE id = ?`).run(buf, Number(produtoId))
    res.json({ ok: true })
  })

  app.post('/api/imagem/remover', (req, res) => {
    const { produtoId } = req.body ?? {}
    database.prepare(`UPDATE produtos SET imagem = NULL WHERE id = ?`).run(Number(produtoId))
    res.json({ ok: true })
  })

  app.post('/api/backup', (_req, res) => {
    res.json(fazerBackup())
  })

  app.get('/api/config', (_req, res) => {
    const rows = database.prepare(`SELECT chave, valor FROM config`).all() as { chave: string; valor: string }[]
    const config: Record<string, string> = {}
    for (const r of rows) config[r.chave] = r.valor
    res.json(config)
  })

  app.get('/api/versao', (_req, res) => {
    res.json({
      versao: versaoSistema(),
      schema: (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      schema_atual: SCHEMA_VERSION
    })
  })

  app.get('/api/zonas', (_req, res) => {
    const rows = database.prepare(`SELECT id, nome, preco, poligono, ativo FROM zonas_entrega ORDER BY nome`).all()
    res.json(rows)
  })

  app.get('/api/taxa', (req, res) => {
    const lat = Number(req.query.lat)
    const lng = Number(req.query.lng)
    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ erro: 'Informe lat e lng' })
      return
    }
    const zonas = database.prepare(`SELECT id, nome, preco, poligono, ativo FROM zonas_entrega`).all() as unknown as Zona[]
    const zona = encontrarZona({ lat, lng }, zonas)
    if (!zona) {
      res.json({ zona: null, taxa: null, erro: 'Fora da área de entrega' })
      return
    }
    res.json({ zona: zona.nome, taxa: zona.preco })
  })

  app.get('/api/catalogo/status', (_req, res) => {
    res.json(getStatus())
  })

  app.post('/api/catalogo/config', (req, res) => {
    const { github_token, github_repo, github_branch, site_url, nome_loja } = req.body ?? {}
    // Se o token vier mascarado (••••••) ou vazio, preserva o token atual (não sobrescreve)
    let token: string | undefined
    if (typeof github_token === 'string' && github_token && !github_token.includes('•')) {
      token = github_token
    }
    const novo = salvarConfig({
      github_token: token,
      github_repo: typeof github_repo === 'string' ? github_repo : undefined,
      github_branch: typeof github_branch === 'string' ? github_branch : undefined,
      site_url: typeof site_url === 'string' ? site_url : undefined,
      nome_loja: typeof nome_loja === 'string' ? nome_loja : undefined
    })
    res.json({ ok: true, config: novo })
  })

  app.get('/api/catalogo/config', (_req, res) => {
    const cfg = getConfig()
    res.json({ github_token: cfg.github_token ? '••••••' : '', github_repo: cfg.github_repo, github_branch: cfg.github_branch, site_url: cfg.site_url, nome_loja: cfg.nome_loja })
  })

  app.post('/api/catalogo/sync', async (_req, res) => {
    const r = await sincronizarAgora()
    res.json(r)
  })

  app.post('/api/catalogo/testar', async (_req, res) => {
    res.json(await testarConexao())
  })

  app.post('/api/catalogo/backup-config', (_req, res) => {
    const r = backupConfigCatalogo()
    if (r.ok) {
      registrarLog('SUCCESS', `Backup da configuração do catálogo salvo em ${r.arquivo}`)
      res.json({ ok: true, arquivo: r.arquivo, data: r.data })
    } else {
      res.status(400).json({ ok: false, erro: 'Falha ao salvar o backup da configuração.' })
    }
  })

  app.get('/api/catalogo/backup-config', (_req, res) => {
    res.json(getBackupConfigCatalogo())
  })

  app.post('/api/catalogo/restaurar-backup-config', (_req, res) => {
    const r = restaurarBackupConfigCatalogo()
    if (r.ok) {
      registrarLog('SUCCESS', 'Configuração do catálogo restaurada do backup')
      res.json({ ok: true, config: r.config })
    } else {
      res.status(400).json({ ok: false, erro: r.erro })
    }
  })

  app.get('/api/catalogo/exibicao', (_req, res) => {
    res.json(getExibicao())
  })

  app.post('/api/catalogo/exibicao', (req, res) => {
    const { mostrar_estoque, sem_estoque, aceitar_pedidos_sem_estoque, destacar_promocoes } = req.body ?? {}
    const salvo = salvarExibicao({
      mostrar_estoque: typeof mostrar_estoque === 'boolean' ? mostrar_estoque : undefined,
      sem_estoque: sem_estoque === 'manter' ? 'manter' : undefined,
      aceitar_pedidos_sem_estoque: typeof aceitar_pedidos_sem_estoque === 'boolean' ? aceitar_pedidos_sem_estoque : undefined,
      destacar_promocoes: typeof destacar_promocoes === 'boolean' ? destacar_promocoes : undefined
    })
    res.json({ ok: true, exibicao: salvo })
  })

  // Módulo Servidor
  app.get('/api/servidor/status', (_req, res) => {
    try {
      res.json({ ok: true, ...getStatusServidor() })
    } catch (err) {
      res.status(500).json({ ok: false, erro: (err as Error).message })
    }
  })

  app.get('/api/servidor/logs', (_req, res) => {
    res.json({ ok: true, logs: getLogs() })
  })

  app.post('/api/servidor/logs/limpar', (_req, res) => {
    limparLogs()
    res.json({ ok: true })
  })

  app.get('/api/servidor/backup/info', (_req, res) => {
    res.json({ ok: true, ...getBackupInfo() })
  })

  app.post('/api/servidor/diagnostico', (_req, res) => {
    res.json(diagnosticar())
  })

  app.post('/api/servidor/corrigir', (_req, res) => {
    const r = corrigir()
    res.json({ ok: r.ok, correcoes: r.correcoes })
  })

  app.post('/api/servidor/zerar', (req, res) => {
    const { alvos } = req.body ?? {}
    if (!Array.isArray(alvos) || alvos.length === 0) {
      res.status(400).json({ ok: false, erro: 'Selecione ao menos um alvo para zerar.' })
      return
    }
    const r = zerarDados(alvos)
    res.json(r)
  })

  app.post('/api/servidor/restaurar', (req, res) => {
    const { arquivo } = req.body ?? {}
    if (typeof arquivo !== 'string' || !arquivo) {
      res.status(400).json({ ok: false, erro: 'Arquivo de backup obrigatório.' })
      return
    }
    const r = restaurarBackup(arquivo)
    if (r.ok) {
      res.json({ ok: true })
    } else {
      res.status(400).json({ ok: false, erro: r.erro })
    }
  })

  app.post('/api/servidor/encerrar', (_req, res) => {
    res.json({ ok: true })
    setTimeout(() => {
      try { process.exit(0) } catch { /* ignore */ }
    }, 300)
  })

  // ---------- Estoque (movimentações e inventário) ----------
  const CATEGORIAS_ENTRADA = new Set([
    'compra', 'devolucao_cliente', 'transferencia_entrada', 'retorno_remessa', 'ajuste_entrada', 'outras_entradas'
  ])
  const CATEGORIAS_SAIDA = new Set([
    'devolucao_fornecedor', 'transferencia_saida', 'uso_interno', 'remessa_conserto', 'ajuste_saida', 'outras_saidas', 'bonificacao'
  ])

  const PREFIXOS_DOCUMENTO: Record<string, string> = {
    compra: 'C', devolucao_cliente: 'DC', transferencia_entrada: 'TE', retorno_remessa: 'RR',
    ajuste_entrada: 'AE', outras_entradas: 'OE', devolucao_fornecedor: 'DF', transferencia_saida: 'TS',
    uso_interno: 'UI', remessa_conserto: 'RC', ajuste_saida: 'AS', outras_saidas: 'OS', bonificacao: 'BO'
  }

  function produtoParaMovimento(id: number): { id: number; preco_custo: number; preco_venda: number; estoque: number; controla_estoque: number } | undefined {
    return database.prepare(`SELECT id, preco_custo, preco_venda, estoque, controla_estoque FROM produtos WHERE id = ?`).get(id) as
      | { id: number; preco_custo: number; preco_venda: number; estoque: number; controla_estoque: number }
      | undefined
  }

  app.post('/api/estoque/movimentar', (req, res) => {
    const corpo = req.body ?? {}
    const tipo = corpo.tipo
    const categoria = String(corpo.categoria ?? '')
    const itens = corpo.itens
    if (tipo !== 'entrada' && tipo !== 'saida') {
      res.status(400).json({ ok: false, erro: 'Tipo inválido (use entrada ou saida).' })
      return
    }
    const categoriasValidas = tipo === 'entrada' ? CATEGORIAS_ENTRADA : CATEGORIAS_SAIDA
    if (!categoriasValidas.has(categoria)) {
      res.status(400).json({ ok: false, erro: `Categoria "${categoria}" inválida para ${tipo}.` })
      return
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      res.status(400).json({ ok: false, erro: 'Informe ao menos um item.' })
      return
    }
    if (itens.length > 500) {
      res.status(400).json({ ok: false, erro: 'Máximo de 500 itens por movimentação.' })
      return
    }
    if (corpo.usuario_id != null) {
      const u = database.prepare('SELECT id FROM usuarios WHERE id = ?').get(Number(corpo.usuario_id)) as { id: number } | undefined
      if (!u) {
        res.status(400).json({ ok: false, erro: 'Usuário não encontrado.' })
        return
      }
    }
    if (corpo.fornecedor_id != null) {
      const f = database.prepare('SELECT id FROM fornecedores WHERE id = ?').get(Number(corpo.fornecedor_id)) as { id: number } | undefined
      if (!f) {
        res.status(400).json({ ok: false, erro: 'Fornecedor não encontrado.' })
        return
      }
    }
    if (corpo.cliente_id != null) {
      const c = database.prepare('SELECT id FROM clientes WHERE id = ?').get(Number(corpo.cliente_id)) as { id: number } | undefined
      if (!c) {
        res.status(400).json({ ok: false, erro: 'Cliente não encontrado.' })
        return
      }
    }

    const linhas = new Map<number, { quantidade: number; preco_custo: number | null; lote: string | null; data_validade: string | null; data_fabricacao: string | null }>()
    for (const item of itens) {
      const pid = Number(item?.produto_id)
      const qtd = Number(item?.quantidade)
      if (!Number.isInteger(pid) || pid <= 0 || !produtoParaMovimento(pid)) {
        res.status(400).json({ ok: false, erro: 'Produto inválido na movimentação.' })
        return
      }
      if (!Number.isFinite(qtd) || qtd <= 0) {
        res.status(400).json({ ok: false, erro: 'Quantidade deve ser um número maior que zero.' })
        return
      }
      const existente = linhas.get(pid)
      const custo = item.preco_custo == null || item.preco_custo === '' ? null : Number(item.preco_custo)
      if (existente) {
        existente.quantidade += qtd
        if (custo != null && Number.isFinite(custo)) existente.preco_custo = custo
      } else {
        linhas.set(pid, {
          quantidade: qtd,
          preco_custo: custo != null && Number.isFinite(custo) ? custo : null,
          lote: item.lote ? String(item.lote) : null,
          data_validade: item.data_validade ? String(item.data_validade) : null,
          data_fabricacao: item.data_fabricacao ? String(item.data_fabricacao) : null
        })
      }
    }

    const agora = corpo.data ? String(corpo.data) : new Date().toISOString()
    const documento = String(corpo.documento ?? '').trim() || `${PREFIXOS_DOCUMENTO[categoria] ?? 'M'}${Date.now()}`
    const usuarioId = corpo.usuario_id != null ? Number(corpo.usuario_id) : null
    const fornecedorId = corpo.fornecedor_id != null ? Number(corpo.fornecedor_id) : null
    const clienteId = corpo.cliente_id != null ? Number(corpo.cliente_id) : null
    const motivo = corpo.motivo ? String(corpo.motivo) : null
    const origem = corpo.origem ? String(corpo.origem) : null
    const destino = corpo.destino ? String(corpo.destino) : null

    let total = 0
    let aplicados = 0
    database.exec('BEGIN')
    try {
      for (const [pid, linha] of linhas) {
        const p = produtoParaMovimento(pid)!
        const custo = linha.preco_custo ?? p.preco_custo
        const valor = linha.quantidade * custo
        total += valor
        if (tipo === 'entrada') {
          if (linha.preco_custo != null) {
            database.prepare(`UPDATE produtos SET estoque = estoque + ?, preco_custo = ? WHERE id = ?`).run(linha.quantidade, custo, pid)
          } else {
            database.prepare(`UPDATE produtos SET estoque = estoque + ? WHERE id = ?`).run(linha.quantidade, pid)
          }
        } else {
          database.prepare(`UPDATE produtos SET estoque = estoque - ? WHERE id = ?`).run(linha.quantidade, pid)
        }
        if (linha.lote || linha.data_validade || linha.data_fabricacao) {
          database.prepare(
            `UPDATE produtos SET lote = COALESCE(?, lote), data_validade = COALESCE(?, data_validade), data_fabricacao = COALESCE(?, data_fabricacao) WHERE id = ?`
          ).run(linha.lote, linha.data_validade, linha.data_fabricacao, pid)
        }
        database.prepare(
          `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, valor, origem, destino, cliente_id, fornecedor_id, usuario_id, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(pid, tipo, categoria, linha.quantidade, motivo, documento, valor, origem, destino, clienteId, fornecedorId, usuarioId, agora)
        notificarAlteracaoProduto(pid)
        aplicados++
      }
      if (categoria === 'compra') {
        const compraId = Number(database.prepare(`INSERT INTO compras (fornecedor_id, numero, total, status) VALUES (?, ?, ?, 'paga')`).run(fornecedorId, documento, total).lastInsertRowid)
        for (const [pid, linha] of linhas) {
          const p = produtoParaMovimento(pid)!
          const custo = linha.preco_custo ?? p.preco_custo
          database.prepare(`INSERT INTO compra_itens (compra_id, produto_id, quantidade, preco_custo, subtotal) VALUES (?, ?, ?, ?, ?)`)
            .run(compraId, pid, linha.quantidade, custo, linha.quantidade * custo)
        }
      }
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      registrarLog('ERROR', `Estoque/movimentar: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
      return
    }
    res.json({ ok: true, documento, total, itens: aplicados, tipo, categoria })
  })

  app.post('/api/estoque/inventario/abrir', (req, res) => {
    const corpo = req.body ?? {}
    const ids = corpo.produtos
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ ok: false, erro: 'Selecione ao menos um produto para o inventário.' })
      return
    }
    if (ids.length > 10000) {
      res.status(400).json({ ok: false, erro: 'Inventário limitado a 10.000 produtos.' })
      return
    }
    if (corpo.usuario_id != null) {
      const u = database.prepare('SELECT id FROM usuarios WHERE id = ?').get(Number(corpo.usuario_id)) as { id: number } | undefined
      if (!u) {
        res.status(400).json({ ok: false, erro: 'Usuário não encontrado.' })
        return
      }
    }
    const numeros = ids.map(() => '?').join(',')
    const produtos = database.prepare(
      `SELECT id, estoque FROM produtos WHERE id IN (${numeros}) AND controla_estoque = 1`
    ).all(...ids.map(Number)) as { id: number; estoque: number }[]
    if (produtos.length === 0) {
      res.status(400).json({ ok: false, erro: 'Nenhum produto válido selecionado.' })
      return
    }
    const numero = `INV-${Date.now()}`
    database.exec('BEGIN')
    try {
      const invId = Number(
        database.prepare(`INSERT INTO inventarios (numero, usuario_id, observacao, total_itens, status) VALUES (?, ?, ?, ?, 'aberto')`)
          .run(numero, corpo.usuario_id != null ? Number(corpo.usuario_id) : null, corpo.observacao ? String(corpo.observacao) : null, produtos.length)
          .lastInsertRowid
      )
      const ins = database.prepare(`INSERT INTO inventario_itens (inventario_id, produto_id, estoque_sistema) VALUES (?, ?, ?)`)
      for (const p of produtos) ins.run(invId, p.id, p.estoque)
      database.exec('COMMIT')
      res.json({ ok: true, inventario_id: invId, numero, itens: produtos.length })
    } catch (err) {
      database.exec('ROLLBACK')
      res.status(500).json({ ok: false, erro: (err as Error).message })
    }
  })

  app.post('/api/estoque/inventario/finalizar', (req, res) => {
    const corpo = req.body ?? {}
    const invId = Number(corpo.inventario_id)
    const inv = database.prepare(`SELECT * FROM inventarios WHERE id = ?`).get(invId) as
      | { id: number; numero: string; status: string; observacao: string | null }
      | undefined
    if (!inv) {
      res.status(400).json({ ok: false, erro: 'Inventário não encontrado.' })
      return
    }
    if (inv.status !== 'aberto') {
      res.status(400).json({ ok: false, erro: 'Inventário já finalizado ou cancelado.' })
      return
    }
    if (corpo.usuario_id != null) {
      const u = database.prepare('SELECT id FROM usuarios WHERE id = ?').get(Number(corpo.usuario_id)) as { id: number } | undefined
      if (!u) {
        res.status(400).json({ ok: false, erro: 'Usuário não encontrado.' })
        return
      }
    }
    const itens = database.prepare(`SELECT * FROM inventario_itens WHERE inventario_id = ?`).all(invId) as {
      id: number
      produto_id: number
      estoque_sistema: number
      quantidade_fisica: number | null
      conferido: number
    }[]
    const usuarioId = corpo.usuario_id != null ? Number(corpo.usuario_id) : null
    const documento = `INV-${inv.numero.replace(/^INV-/, '')}`
    let divergencias = 0
    let ajustados = 0
    database.exec('BEGIN')
    try {
      const updItem = database.prepare(`UPDATE inventario_itens SET diferenca = ?, conferido = 1 WHERE id = ?`)
      const updEstoque = database.prepare(`UPDATE produtos SET estoque = ? WHERE id = ?`)
      const insMov = database.prepare(
        `INSERT INTO movimentacoes (produto_id, tipo, categoria, quantidade, motivo, documento, valor, usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const item of itens) {
        if (!item.conferido || item.quantidade_fisica == null) continue
        const dif = item.quantidade_fisica - item.estoque_sistema
        updItem.run(dif, item.id)
        if (Math.abs(dif) < 0.0001) continue
        divergencias++
        const p = produtoParaMovimento(item.produto_id)!
        updEstoque.run(item.quantidade_fisica, item.produto_id)
        const ajuste = dif > 0 ? 'ajuste_entrada' : 'ajuste_saida'
        const tipo = dif > 0 ? 'entrada' : 'saida'
        insMov.run(
          item.produto_id, tipo, ajuste, Math.abs(dif),
          `Inventário ${inv.numero}${inv.observacao ? ` — ${inv.observacao}` : ''}`,
          documento, Math.abs(dif) * p.preco_custo, usuarioId, new Date().toISOString()
        )
        notificarAlteracaoProduto(item.produto_id)
        ajustados++
      }
      database.prepare(
        `UPDATE inventarios SET status = 'finalizado', total_itens = ?, total_conferidos = ?, total_divergencias = ?, finalizado_em = ? WHERE id = ?`
      ).run(itens.length, itens.filter((i) => i.conferido).length, divergencias, new Date().toISOString(), invId)
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      registrarLog('ERROR', `Estoque/inventario/finalizar: ${(err as Error).message}`)
      res.status(500).json({ ok: false, erro: (err as Error).message })
      return
    }
    res.json({ ok: true, inventario_id: invId, numero: inv.numero, divergencias, ajustados, conferidos: itens.filter((i) => i.conferido).length })
  })

  app.post('/api/estoque/inventario/cancelar', (req, res) => {
    const invId = Number(req.body?.inventario_id)
    const r = database.prepare(`UPDATE inventarios SET status = 'cancelado' WHERE id = ? AND status = 'aberto'`).run(invId)
    if (Number(r.changes) === 0) {
      res.status(400).json({ ok: false, erro: 'Inventário não encontrado ou já finalizado.' })
      return
    }
    res.json({ ok: true })
  })

  // ---------- Importação via ZIP ----------
  app.post('/api/importar/zip', express.raw({ type: 'application/octet-stream', limit: '600mb' }), async (req, res) => {
    const nome = (() => {
      try { return decodeURIComponent(req.get('x-zip-nome') || 'arquivo.zip') } catch { return req.get('x-zip-nome') || 'arquivo.zip' }
    })()
    const buffer = Buffer.isBuffer(req.body) ? req.body : null
    if (!buffer || buffer.length === 0) {
      res.status(400).json({ ok: false, erro: 'Arquivo ZIP obrigatório.' })
      return
    }
    const r = await extrairZip(buffer, nome)
    if (!r.ok) {
      res.status(400).json({ ok: false, erro: r.erro })
      return
    }
    res.json({ ok: true, arquivos: r.arquivos })
  })

  app.get('/api/importar/arquivos', (_req, res) => {
    res.json({ ok: true, arquivos: listarArquivosImportacao() })
  })

  app.get('/api/importar/progresso', (_req, res) => {
    res.json({ ok: true, ...getProgressoImportacao() })
  })

  app.post('/api/importar/arquivo', (req, res) => {
    const { arquivo } = req.body ?? {}
    if (typeof arquivo !== 'string' || !arquivo) {
      res.status(400).json({ ok: false, erro: 'Arquivo obrigatório.' })
      return
    }
    const r = lerArquivoImportacao(arquivo)
    if (!r.ok) {
      res.status(400).json({ ok: false, erro: r.erro })
      return
    }
    res.json({ ok: true, colunas: r.colunas, linhas: r.linhas, arquivo })
  })

  app.post('/api/importar/produtos', async (req, res) => {
    const { arquivo } = req.body ?? {}
    if (typeof arquivo !== 'string' || !arquivo) {
      res.status(400).json({ ok: false, erro: 'Arquivo obrigatório.' })
      return
    }
    const r = await importarProdutos(arquivo)
    res.json(r)
  })

  app.post('/api/importar/limpar', (_req, res) => {
    limparPastaImportacao()
    res.json({ ok: true })
  })

  app.post('/api/importar/nex', express.raw({ type: 'application/octet-stream', limit: '600mb' }), async (req, res) => {
    const nome = (() => {
      try { return decodeURIComponent(req.get('x-zip-nome') || 'backup.zip') } catch { return req.get('x-zip-nome') || 'backup.zip' }
    })()
    const buffer = Buffer.isBuffer(req.body) ? req.body : null
    if (!buffer || buffer.length === 0) {
      res.status(400).json({ ok: false, erro: 'Arquivo ZIP obrigatório.' })
      return
    }
    const modoSimulacao = req.get('x-simular') === '1' || req.get('x-simular') === 'true'
    const r = await importarNex(buffer, nome, { simular: modoSimulacao })
    res.json(r)
  })

  app.get('/api/importar/nex/progresso', (_req, res) => {
    res.json({ ok: true, ...getProgressoNex() })
  })

  app.post('/api/importar/nex/analisar', express.raw({ type: 'application/octet-stream', limit: '600mb' }), async (req, res) => {
    const nome = (() => {
      try { return decodeURIComponent(req.get('x-zip-nome') || 'backup.zip') } catch { return req.get('x-zip-nome') || 'backup.zip' }
    })()
    const buffer = Buffer.isBuffer(req.body) ? req.body : null
    if (!buffer || buffer.length === 0) {
      res.status(400).json({ ok: false, erro: 'Arquivo ZIP obrigatório.' })
      return
    }
    const r = await analisarNex(buffer, nome)
    res.json(r)
  })

  // Registra erros de todas as rotas da API no log
  registrarErrosApi(app)

  const tentarPorta = (p: number) => {
    const srv = createServer(app)
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && p < porta + 50) {
        console.log(`[servidor] Porta ${p} em uso — tentando ${p + 1}...`)
        tentarPorta(p + 1)
      } else {
        console.error(`[servidor] Falha ao iniciar servidor na porta ${p}: ${err.message}`)
      }
    })
    srv.listen(p, '0.0.0.0', () => {
      server = srv
      portaAtual = p
      gravarPorta(p)
      const ip = getIpRede()
      registrarLog('SUCCESS', `Servidor iniciado na porta ${p}`)
      registrarLog('INFO', `Banco conectado`)
      registrarLog('SUCCESS', `API iniciada em http://${ip}:${p}`)
      console.log(`[servidor] API em http://${ip}:${p} (local: http://localhost:${p})`)
      dispararSyncAutomatica()
    })
  }

  // Se já houver uma porta gravada de execução anterior, usa; senão começa da padrão.
  const gravada = lerPortaGravada()
  tentarPorta(gravada || porta)
}

let syncJaDisparada = false

async function dispararSyncAutomatica(): Promise<void> {
  if (syncJaDisparada) return
  syncJaDisparada = true
  try {
    const cfg = getConfig()
    if (!cfg.github_token || !cfg.github_repo) {
      console.log('[catalogo] Não configurado — sincronização automática ignorada.')
    } else {
      const online = await temInternet()
      if (!online) {
        console.log('[catalogo] Sem internet no boot — sincronização ficará pendente.')
      } else {
        console.log('[catalogo] Internet OK — sincronizando catálogo...')
        const r = await sincronizarAgora()
        if (r.ok) registrarLog('SUCCESS', 'Catálogo sincronizado com sucesso')
        else registrarLog('ERROR', `Falha na sincronização: ${r.erro}`)
        console.log(r.ok ? '[catalogo] Sincronizado com sucesso.' : `[catalogo] Falha: ${r.erro}`)
      }
    }
  } catch (err) {
    console.error('[catalogo] Erro na sincronização automática:', (err as Error).message)
  }
  agendarSyncPeriodica()
}

// Sincroniza automaticamente a cada intervalo se houver alterações pendentes.
// Mantém o catálogo online atualizado sem depender do cliente chamar sync manual.
function agendarSyncPeriodica(): void {
  const INTERVALO_MS = 2 * 60 * 1000
  setInterval(async () => {
    try {
      const cfg = getConfig()
      if (!cfg.github_token || !cfg.github_repo) return
      const pendentes = (getDb().prepare(`SELECT COUNT(*) AS c FROM catalogo_fila`).get() as { c: number }).c
      if (pendentes === 0) return
      console.log(`[catalogo] ${pendentes} alteração(ões) pendente(s) — sincronizando...`)
      const r = await sincronizarAgora()
      if (r.ok) registrarLog('SUCCESS', `Catálogo sincronizado automaticamente (${pendentes} pendente(s))`)
      else registrarLog('ERROR', `Sincronização automática falhou: ${r.erro}`)
    } catch (err) {
      console.error('[catalogo] Erro na sincronização periódica:', (err as Error).message)
    }
  }, INTERVALO_MS)
}

export function pararServidor(): void {
  if (server) {
    server.close()
    server = null
  }
}

// Captura erros não tratados e os registra no log do servidor (área "console").
process.on('uncaughtException', (err) => {
  try {
    registrarLog('ERROR', `Erro não tratado: ${(err as Error).message}\n${(err as Error).stack ?? ''}`)
  } catch { /* ignore */ }
  console.error('[servidor] uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
  try {
    registrarLog('ERROR', `Rejeição não tratada: ${String(reason)}`)
  } catch { /* ignore */ }
  console.error('[servidor] unhandledRejection:', reason)
})

// Registra erros de rotas da API no log (qualquer erro que o sistema encontre).
function registrarErrosApi(app: express.Express): void {
  app.use((err: Error, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    try {
      registrarLog('ERROR', `Erro em ${req.method} ${req.path}: ${err.message}`)
    } catch { /* ignore */ }
    next(err)
  })
}

if (require.main === module) {
  initDb()
  seed(getDb())
  iniciarServidor(Number(process.env.TABACARIA_PORTA) || 3210)
}
