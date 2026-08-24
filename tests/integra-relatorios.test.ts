// Teste de integração dos filtros de período dos relatórios.
// Valida que a cláusula SQL gerada (local→UTC) seleciona EXATAMENTE as vendas
// cuja data LOCAL cai no período — o coração da correção UTC×local.
// Roda com: node tests/integra-relatorios.test.ts
import { DatabaseSync } from 'node:sqlite'
import { calcularPeriodo, clausulaSql, paraUtcSql } from '../src/renderer/src/features/relatorios/periodo.ts'
import type { ChavePeriodo } from '../src/renderer/src/features/relatorios/periodo.ts'

let passou = 0
let falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { passou++; console.log(`  OK   ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ' -> ' + detalhe : ''}`) }
}

function addDias(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, total REAL, status TEXT DEFAULT 'concluida', vendedor_id INTEGER, cliente_id INTEGER);
  CREATE TABLE venda_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, subtotal REAL);
  CREATE TABLE pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, forma TEXT, valor REAL);
`)

// Sementes: datas LOCAIS pretendidas; grava no banco como UTC (como o app faz).
const agora = new Date()
const hoje0 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
const sementes: { id: number; local: Date; total: number }[] = [
  { id: 1, local: new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 30), total: 230 }, // hoje à noite
  { id: 2, local: new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 8, 0), total: 80 },   // hoje de manhã
  { id: 3, local: new Date(addDias(hoje0, -1).getFullYear(), addDias(hoje0, -1).getMonth(), addDias(hoje0, -1).getDate(), 9, 0), total: 90 }, // ontem
  { id: 4, local: new Date(addDias(hoje0, -14).getFullYear(), addDias(hoje0, -14).getMonth(), addDias(hoje0, -14).getDate(), 12, 0), total: 140 }, // dentro de 15d
  { id: 5, local: new Date(addDias(hoje0, -16).getFullYear(), addDias(hoje0, -16).getMonth(), addDias(hoje0, -16).getDate(), 10, 0), total: 160 }, // fora de 15d, dentro de 30d
  { id: 6, local: (() => { const d = new Date(agora.getFullYear(), agora.getMonth() - 1, 15, 10, 0); return d })(), total: 150 }, // mês passado
  { id: 7, local: new Date(agora.getFullYear() - 1, 11, 31, 18, 0), total: 180 } // 31/dez do ano passado
]
const ins = db.prepare(`INSERT INTO vendas (created_at, total) VALUES (?, ?)`)
for (const s of sementes) {
  ins.run(paraUtcSql(s.local), s.total)
  console.log(`  seed v${s.id}: local=${s.local.toLocaleString('pt-BR')} -> utc=${paraUtcSql(s.local)} total=${s.total}`)
}
// itens/pagamentos espelhando cada venda (p/ consistência entre relatórios)
const insItem = db.prepare(`INSERT INTO venda_itens (venda_id, subtotal) VALUES (?, ?)`)
const insPag = db.prepare(`INSERT INTO pagamentos (venda_id, forma, valor) VALUES (?, ?, ?)`)
for (const s of sementes) {
  insItem.run(s.id, s.total)
  insPag.run(s.id, s.id % 2 === 0 ? 'Pix' : 'Dinheiro', s.total)
}

// pertence ao período segundo a SEMÂNTICA LOCAL (referência independente)
const membroLocal = (s: { local: Date }, p: { inicio: Date; fim: Date }) => s.local >= p.inicio && s.local <= p.fim

console.log('\n[contagem por período — SQL vs semântica local]')
const casos: ChavePeriodo[] = ['hoje', 'ontem', 'esta_semana', 'semana_passada', 'este_mes', 'mes_passado', 'ultimos_7', 'ultimos_15', 'ultimos_30']
for (const chave of casos) {
  const p = calcularPeriodo(chave)
  const cl = clausulaSql('v.created_at', p)
  const r = db.prepare(`SELECT COUNT(*) AS n FROM vendas v WHERE status='concluida'${cl.sql}`).get(...cl.params) as { n: number }
  const esperado = sementes.filter((s) => membroLocal(s, p)).length
  check(`${chave}: SQL=${r.n} == local=${esperado}`, Number(r.n) === esperado, JSON.stringify({ sql: cl.params }))
}

console.log('\n[personalizado — casos especiais]')
{
  // um único dia: hoje
  const isoHoje = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`
  const p = calcularPeriodo('personalizado', { ini: isoHoje, fim: isoHoje })
  const cl = clausulaSql('v.created_at', p)
  const r = db.prepare(`SELECT COUNT(*) AS n FROM vendas v WHERE status='concluida'${cl.sql}`).get(...cl.params) as { n: number }
  const esperado = sementes.filter((s) => membroLocal(s, p)).length
  check(`um único dia (hoje): ${r.n} == ${esperado}`, Number(r.n) === esperado)
}
{
  // atravessando meses E anos: 25/dez do ano passado → 05/jan atual
  const iniIso = `${agora.getFullYear() - 1}-12-25`
  const fimIso = `${agora.getFullYear()}-01-05`
  const p = calcularPeriodo('personalizado', { ini: iniIso, fim: fimIso })
  const cl = clausulaSql('v.created_at', p)
  const r = db.prepare(`SELECT COUNT(*) AS n FROM vendas v WHERE status='concluida'${cl.sql}`).get(...cl.params) as { n: number }
  const esperado = sementes.filter((s) => membroLocal(s, p)).length
  check(`atravessa meses+anos: ${r.n} == ${esperado}`, Number(r.n) === esperado)
}

console.log('\n[consistência entre relatórios — mesmo período, mesmo número]')
for (const chave of ['hoje', 'este_mes', 'mes_passado', 'ultimos_7'] as ChavePeriodo[]) {
  const p = calcularPeriodo(chave)
  const v = clausulaSql('v.created_at', p)

  const met = db.prepare(`SELECT COALESCE(SUM(total),0) AS f, COUNT(*) AS q FROM vendas v WHERE v.status='concluida'${v.sql}`).get(...v.params) as { f: number; q: number }

  const sint = db.prepare(
    `SELECT COALESCE(SUM(faturamento),0) AS f, COALESCE(SUM(vendas),0) AS q FROM (
       SELECT date(v.created_at) AS data, COUNT(*) AS vendas, SUM(v.total) AS faturamento
       FROM vendas v WHERE v.status='concluida'${v.sql} GROUP BY date(v.created_at)
     )`
  ).get(...v.params) as { f: number; q: number }

  const meios = db.prepare(
    `SELECT COALESCE(SUM(valor),0) AS f FROM pagamentos p
     JOIN vendas v ON v.id = p.venda_id WHERE v.status='concluida'${v.sql}`
  ).get(...v.params) as { f: number }

  const ana = db.prepare(
    `SELECT COALESCE(SUM(total),0) AS f FROM (
       SELECT v.total AS total FROM vendas v WHERE v.status='concluida'${v.sql} ORDER BY v.created_at DESC LIMIT 500
     )`
  ).get(...v.params) as { f: number }

  check(
    `${chave}: métricas==sintético==meios==analítico (R$ ${met.f})`,
    Number(met.f) === Number(sint.f) && Number(met.f) === Number(meios.f) && Number(met.f) === Number(ana.f) && Number(met.q) === Number(sint.q),
    JSON.stringify({ met, sint, meios: meios.f, ana: ana.f })
  )
}

console.log(`\n===== INTEGRAÇÃO: ${passou} OK, ${falhou} FALHA =====`)
if (falhas.length) process.exit(1)
