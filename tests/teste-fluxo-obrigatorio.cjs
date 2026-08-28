// TESTE OBRIGATÓRIO — fluxo real do terminal (nova arquitetura, sem API Key)
//   1. terminal inicia SEM chave (não existe servidor.key no cliente);
//   2. detecta/descobre o servidor (ping);
//   3. carrega usuários via rota pública /api/auth/usuarios (sem sessão);
//   4. NÃO chama /api/db/all antes do login (o novo Login usa auth/usuarios);
//   5. usuário faz login (usuário/senha) → token de sessão;
//   6. /api/db/all com sessão → 200 e usuários aparecem;
//   7. /api/db/all sem sessão → 401; rota admin remota → 403.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

;(async function main() {
  const ISOLADO = 'C:/fase1-ui-teste/teste-fluxo-obrigatorio'
  fs.mkdirSync(ISOLADO, { recursive: true })
  const DB = path.join(ISOLADO, 'tabacaria.sqlite')
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f) } catch {} }
  const PORTA = 3279

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

  const base = `http://127.0.0.1:${PORTA}`
  const R = (method, p, body, headers = {}) => fetch(base + p, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  })

  const out = {}

  // ---- 1. Cliente NÃO tem chave (servidor.key não existe) ----
  out.semArquivoChave = !fs.existsSync(path.join(ISOLADO, 'servidor.key'))

  // ---- 2. Descobre o servidor (ping) ----
  out.ping = (await R('GET', '/api/ping')).status

  // ---- 3. Carrega usuários pela rota pública (sem sessão) — novo Login ----
  const usuariosPub = await fetch(`${base}/api/auth/usuarios`).then(r => r.json())
  out.usuariosPub = (usuariosPub || []).map(u => u.login)

  // ---- 4. NÃO chama /api/db/all antes do login (verifica que sem sessão é 401) ----
  out.dbAllSemSessao = (await R('POST', '/api/db/all', { sql: 'SELECT 1' })).status

  // ---- 5. Login → token de sessão ----
  const rLogin = await R('POST', '/api/auth/login', { login: 'admin', senha: 'admin123' })
  const lj = await rLogin.json()
  out.login = rLogin.status
  out.loginOk = lj.ok === true && lj.usuario?.login === 'admin'
  const token = lj.token || ''

  // ---- 6. Com sessão → 200 + usuários ----
  const rUsers = await R('POST', '/api/db/all', { sql: 'SELECT id, nome, login, perfil FROM usuarios' }, { 'X-Sessao-Token': token })
  out.sessaoOk = rUsers.status
  const usuarios = await rUsers.json()
  out.usuarios = Array.isArray(usuarios) ? usuarios.map(u => u.login) : []
  out.temAdmin = Array.isArray(usuarios) && usuarios.some(u => u.login === 'admin')

  // ---- 7. Segurança ----
  out.adminRemoto = (await R('GET', '/api/servidor/apikey', undefined, { 'X-Sessao-Token': token })).status

  console.log(JSON.stringify(out, null, 2))

  let ok = 0, falha = 0
  const check = (n, cond, det) => { if (cond) { ok++; console.log(`TESTE ${n}: OK`) } else { falha++; console.log(`TESTE ${n}: FALHA ${det}`) } }
  check(1, out.semArquivoChave === true, `semArquivoChave=${out.semArquivoChave}`)
  check(2, out.ping === 200, `ping=${out.ping}`)
  check(3, Array.isArray(out.usuariosPub) && out.usuariosPub.includes('admin'), `usuariosPub=${JSON.stringify(out.usuariosPub)}`)
  check(4, out.dbAllSemSessao === 401, `dbAllSemSessao=${out.dbAllSemSessao}`)
  check(5, out.login === 200 && out.loginOk === true, `login=${out.login} loginOk=${out.loginOk}`)
  check(6, out.sessaoOk === 200 && out.temAdmin === true, `sessaoOk=${out.sessaoOk} usuarios=${JSON.stringify(out.usuarios)}`)
  check(7, out.adminRemoto === 403, `adminRemoto=${out.adminRemoto}`)
  console.log(`\nTOTAL: ${ok} OK, ${falha} FALHA`)

  serverProc.kill()
  process.exit(falha > 0 ? 1 : 0)
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })