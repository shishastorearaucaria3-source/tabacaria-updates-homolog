// TESTE FINAL — valida o fluxo do Login (nova arquitetura, sem API Key)
// Confirma que:
//   - o terminal NÃO envia chave; usuários vêm da rota pública /api/auth/usuarios
//   - login cria sessão; /api/db/all sem sessão → 401; com sessão → 200
//   - rota admin remota → 403
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

;(async function main() {
  const ISOLADO = 'C:/fase1-ui-teste/teste-login-final'
  fs.mkdirSync(ISOLADO, { recursive: true })
  const DB = path.join(ISOLADO, 'tabacaria.sqlite')
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f) } catch {} }
  const PORTA = 3281

  const script = `
const { initDb, getDb, seed, iniciarServidor } = require('${process.cwd().replace(/\\/g, '/')}/out/server/server/index.js')
initDb(${JSON.stringify(DB)})
seed(getDb())
iniciarServidor(${PORTA})
setTimeout(() => { console.log('PRONTO'); setInterval(() => {}, 1000) }, 800)
`
  const serverFile = path.join(ISOLADO, 'servidor.cjs')
  fs.writeFileSync(serverFile, script, 'utf8')
  const serverProc = spawn(process.execPath, [serverFile], {
    env: { ...process.env, TABACARIA_TEST_FORCE_REMOTE: '1', TABACARIA_DB: DB },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await new Promise((resolve) => {
    let buf = ''
    const t = setTimeout(resolve, 15000)
    serverProc.stdout.on('data', (d) => { buf += d.toString(); if (buf.includes('PRONTO')) { clearTimeout(t); resolve() } })
    serverProc.stderr.on('data', () => {})
  })

  const baseUrl = `http://127.0.0.1:${PORTA}`
  let sessaoToken = ''
  const headersComSessao = (extra) => {
    const h = { 'Content-Type': 'application/json', ...(extra || {}) }
    if (sessaoToken) h['X-Sessao-Token'] = sessaoToken
    return h
  }
  const post = async (caminho, corpo, headers) => {
    const res = await fetch(`${baseUrl}${caminho}`, { method: 'POST', headers: headers || headersComSessao(), body: JSON.stringify(corpo) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  let ok = 0, falha = 0
  const check = (n, cond, det) => { if (cond) { ok++; console.log(`TESTE ${n}: OK`) } else { falha++; console.log(`TESTE ${n}: FALHA ${det}`) } }

  const out = {}

  // 1. Usuários carregam via rota pública (sem sessão) — o novo Login usa isso
  const usuariosPub = await fetch(`${baseUrl}/api/auth/usuarios`).then(r => r.json())
  out.usuariosPub = (usuariosPub || []).map(u => u.login)
  check(1, Array.isArray(usuariosPub) && usuariosPub.some(u => u.login === 'admin'), `usuários públicos=${JSON.stringify(out.usuariosPub)}`)

  // 2. Sem sessão, /api/db/all bloqueado (o Login NÃO depende mais disso no mount)
  const semSessao = await fetch(`${baseUrl}/api/db/all`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT 1' }) })
  out.semSessao = semSessao.status
  check(2, semSessao.status === 401, `semSessao=${semSessao.status}`)

  // 3. Login (usuário/senha) — SEM API Key
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', senha: 'admin123' }) })
  const lj = await login.json()
  out.login = login.status
  out.loginOk = lj.ok === true
  out.token = lj.token || ''
  check(3, login.status === 200 && lj.ok === true && !!lj.token, `login=${login.status} ok=${lj.ok} token=${!!lj.token}`)

  // 4. Sessão define o token; /api/db/all agora funciona
  sessaoToken = lj.token
  const rows = await post('/api/db/all', { sql: 'SELECT id, nome, login, perfil FROM usuarios' })
  const logins = (rows || []).map(u => u.login)
  out.logins = logins
  check(4, Array.isArray(rows) && logins.includes('admin'), `usuários=${JSON.stringify(logins)}`)

  // 5. Rota admin remota → 403
  const adm = await fetch(`${baseUrl}/api/servidor/apikey`, { headers: { 'X-Sessao-Token': lj.token } })
  out.adminRemoto = adm.status
  check(5, adm.status === 403, `adminRemoto=${adm.status}`)

  console.log(JSON.stringify(out, null, 2))
  console.log(`\nTOTAL: ${ok} OK, ${falha} FALHA`)
  serverProc.kill()
  process.exit(falha > 0 ? 1 : 0)
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })