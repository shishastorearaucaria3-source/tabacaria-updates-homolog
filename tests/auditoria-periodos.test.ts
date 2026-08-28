// AUDITORIA COMPLETA — verifica que TODAS as queries do data.ts respeitam o período.
// Banco em memória com vendas em 2025 e 2026 (vários meses).
import { DatabaseSync } from 'node:sqlite'
import { calcularPeriodo, clausulaSql, paraUtcSql } from '../src/renderer/src/features/relatorios/periodo.ts'
import type { ChavePeriodo, Periodo } from '../src/renderer/src/features/relatorios/periodo.ts'

let passou = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { passou++; console.log(`  OK   ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ' -> ' + String(detalhe).slice(0, 200) : ''}`) }
}

// ---------- banco de teste ----------
const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, created_at TEXT, total REAL, status TEXT DEFAULT 'concluida', vendedor_id INTEGER, cliente_id INTEGER, caixa_id INTEGER);
  CREATE TABLE venda_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, produto_id INTEGER, nome_produto TEXT, quantidade REAL, preco_unitario REAL, subtotal REAL, desconto REAL DEFAULT 0);
  CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, preco_custo REAL, preco_venda REAL, estoque REAL, controla_estoque INTEGER DEFAULT 1, ativo INTEGER DEFAULT 1, categoria_id INTEGER, marca_id INTEGER, fornecedor_id INTEGER);
  CREATE TABLE pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER, forma TEXT, valor REAL);
  CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nome TEXT, perfil TEXT, comissao_percent REAL);
  CREATE TABLE clientes (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE categorias (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE marcas (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE fornecedores (id INTEGER PRIMARY KEY, nome TEXT);
  CREATE TABLE caixas (id INTEGER PRIMARY KEY, aberto_em TEXT, aberto INTEGER DEFAULT 0, total_vendas REAL, qtd_vendas INTEGER, saldo_inicial REAL, total_sangrias REAL, total_suprimentos REAL);
  CREATE TABLE movimentacoes (id INTEGER PRIMARY KEY, produto_id INTEGER, tipo TEXT, quantidade REAL, criado_em TEXT);
`)

// usuários e categorias
db.exec(`INSERT INTO usuarios (id, nome, perfil, comissao_percent) VALUES (1, 'Admin', 'admin', 5), (2, 'Vendedor', 'vendedor', 3)`)
db.exec(`INSERT INTO categorias (id, nome) VALUES (1, 'Cigarros'), (2, 'Bebidas')`)
db.exec(`INSERT INTO marcas (id, nome) VALUES (1, 'Marca A')`)
db.exec(`INSERT INTO fornecedores (id, nome) VALUES (1, 'Fornecedor X')`)
db.exec(`INSERT INTO clientes (id, nome) VALUES (1, 'Cliente A'), (2, 'Cliente B')`)
db.exec(`INSERT INTO produtos (id, nome, preco_custo, preco_venda, estoque, categoria_id, marca_id, fornecedor_id) VALUES (1, 'Produto P1', 5, 10, 100, 1, 1, 1), (2, 'Produto P2', 3, 8, 50, 2, 1, 1)`)

// ---------- seeds: vendas em vários meses/anos ----------
// Cada seed: [descrição, data LOCAL, total]
const agora = new Date()
const ano = agora.getFullYear()
const mes = agora.getMonth() // 0-indexed

function local(y: number, m: number, d: number, h = 12, min = 0): Date {
  return new Date(y, m, d, h, min)
}
function utcSql(d: Date): string { return d.toISOString().slice(0, 19).replace('T', ' ') }

const seeds: { desc: string; local: Date; total: number }[] = [
  { desc: '2025-03-15', local: local(2025, 2, 15), total: 100 },
  { desc: '2025-06-20', local: local(2025, 5, 20), total: 200 },
  { desc: '2025-12-31 22:00', local: local(2025, 11, 31, 22, 0), total: 300 }, // vira 01/01 UTC
  { desc: '2026-01-10', local: local(2026, 0, 10), total: 400 },
  { desc: '2026-03-25', local: local(2026, 2, 25), total: 500 },
  { desc: '2026-07-05', local: local(2026, 6, 5), total: 600 },
  { desc: `${ano}-${String(mes + 1).padStart(2,'0')}-01 08:00 (primeiro dia do mês atual)`, local: local(ano, mes, 1, 8, 0), total: 700 },
  { desc: `${ano}-${String(mes + 1).padStart(2,'0')}-15 14:00 (meio do mês)`, local: local(ano, mes, 15, 14, 0), total: 800 },
  { desc: `ontem`, local: addDias(new Date(ano, mes, agora.getDate()), -1), total: 900 },
  { desc: `hoje 09:00`, local: local(ano, mes, agora.getDate(), 9, 0), total: 1000 },
  { desc: `hoje 23:30 (noturna)`, local: local(ano, mes, agora.getDate(), 23, 30), total: 1100 },
  { desc: `-10 dias`, local: addDias(new Date(ano, mes, agora.getDate()), -10), total: 1200 },
  { desc: `-40 dias (fora de 30d)`, local: addDias(new Date(ano, mes, agora.getDate()), -40), total: 1300 },
]

function addDias(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }

const insVenda = db.prepare(`INSERT INTO vendas (numero, created_at, total, vendedor_id, cliente_id, caixa_id) VALUES (?, ?, ?, ?, ?, ?)`)
const insItem = db.prepare(`INSERT INTO venda_itens (venda_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal) VALUES (?, 1, 'Produto P1', 1, ?, ?)`)
const insPag = db.prepare(`INSERT INTO pagamentos (venda_id, forma, valor) VALUES (?, 'Dinheiro', ?)`)

for (const s of seeds) {
  const r = insVenda.run(s.desc, utcSql(s.local), s.total, 1, 1, 1)
  const vid = Number(r.lastInsertRowid)
  insItem.run(vid, 10, s.total)
  insPag.run(vid, s.total)
}

// caixa fechado no mês atual
const cxLocal = local(ano, mes, 10)
db.exec(`INSERT INTO caixas (aberto_em, aberto, total_vendas, qtd_vendas, saldo_inicial, total_sangrias, total_suprimentos) VALUES ('${utcSql(cxLocal)}', 0, 5000, 10, 100, 0, 0)`)

console.log(`\nsemeadas ${seeds.length} vendas (2025 a ${ano})\n`)

// ---------- helper: executa query real com período ----------
function q(sql: string, params: [string, string]): { sql_completo: string; rows: unknown[] } {
  const full = sql.replace(/\$\{v\.sql\}/, clausulaSql('v.created_at', { inicio: new Date(0), fim: new Date() }).sql)
  return { sql_completo: full, rows: [] }
}

// verifica que todas as linhas retornadas estão dentro do período
function verificarDentro(rows: { data?: string; periodo?: string; hora?: string }[], p: Periodo, nomeQuery: string) {
  const iniUtc = paraUtcSql(p.inicio).slice(0, 10)
  const fimUtc = paraUtcSql(p.fim).slice(0, 10)
  for (const row of rows) {
    const data = row.data ?? row.periodo
    if (data) {
      // data em UTC — verifica que está dentro dos limites UTC
      if (data < iniUtc || data > fimUtc) {
        return { ok: false, fora: data }
      }
    }
  }
  return { ok: true }
}

// ---------- AUDITORIA: cada query × cada período ----------
const periodos: ChavePeriodo[] = ['hoje', 'ontem', 'esta_semana', 'semana_passada', 'este_mes', 'mes_passado', 'ultimos_7', 'ultimos_15', 'ultimos_30']

console.log('='.repeat(70))
console.log('AUDITORIA: cada query × cada período — verifica contagens e datas')
console.log('='.repeat(70))

for (const chave of periodos) {
  const p = calcularPeriodo(chave)
  const v = clausulaSql('v.created_at', p)
  console.log(`\n── ${chave} [${v.params[0]} .. ${v.params[1]}]`)

  // contagem esperada (semântica local)
  const esperado = seeds.filter(s => s.local >= p.inicio && s.local <= p.fim).length

  // 1. COUNT principal (metricas)
  const r1 = db.prepare(`SELECT COUNT(*) AS n FROM vendas v WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  check(`${chave} — metricas COUNT = ${r1.n} (esperado ${esperado})`, Number(r1.n) === esperado)

  // 2. SUM faturamento
  const r2 = db.prepare(`SELECT COALESCE(SUM(total),0) AS f FROM vendas v WHERE v.status='concluida'${v.sql}`).get(...v.params) as { f: number }
  const fEsperado = seeds.filter(s => s.local >= p.inicio && s.local <= p.fim).reduce((a, s) => a + s.total, 0)
  check(`${chave} — metricas SUM = ${r2.f} (esperado ${fEsperado})`, Number(r2.f) === fEsperado)

  // 3. VendasPorHora — verifica que todas as horas vêm de vendas no período
  const r3 = db.prepare(`SELECT substr(v.created_at,12,2) AS hora, COUNT(*) AS n FROM vendas v WHERE v.status='concluida'${v.sql} GROUP BY hora`).all(...v.params) as { hora: string; n: number }[]
  const totalHora = r3.reduce((a, x) => a + x.n, 0)
  check(`${chave} — VendasPorHora total = ${totalHora} (esperado ${esperado})`, totalHora === esperado)

  // 4. MeiosPagamento
  const r4 = db.prepare(`SELECT COUNT(*) AS n FROM pagamentos p JOIN vendas v ON v.id = p.venda_id WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  check(`${chave} — MeiosPagamento = ${r4.n} (esperado ${esperado})`, Number(r4.n) === esperado)

  // 5. Comissão por Vendedor
  const r5 = db.prepare(`SELECT COUNT(*) AS n FROM vendas v LEFT JOIN usuarios u ON u.id = v.vendedor_id WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  check(`${chave} — ComissãoVendedor = ${r5.n} (esperado ${esperado})`, Number(r5.n) === esperado)

  // 6. PorVendedor
  const r6 = db.prepare(`SELECT COALESCE(SUM(x.n),0) AS total FROM (SELECT COUNT(*) AS n FROM vendas v LEFT JOIN usuarios u ON u.id = v.vendedor_id WHERE v.status='concluida'${v.sql} GROUP BY u.nome) x`).get(...v.params) as { total: number }
  check(`${chave} — PorVendedor soma = ${r6.total} (esperado ${esperado})`, Number(r6.total) === esperado)

  // 7. PorProduto
  const r7 = db.prepare(`SELECT COALESCE(SUM(x.n),0) AS total FROM (SELECT COUNT(*) AS n FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id WHERE v.status='concluida'${v.sql} GROUP BY vi.nome_produto) x`).get(...v.params) as { total: number }
  check(`${chave} — PorProduto itens = ${r7.total} (esperado ${esperado})`, Number(r7.total) === esperado)

  // 8. EstoqueProdutoVendido
  const r8 = db.prepare(`SELECT COALESCE(SUM(vi.quantidade),0) AS n FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id JOIN produtos p ON p.id = vi.produto_id WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  check(`${chave} — EstoqueProdutoVendido qtd = ${r8.n} (esperado ${esperado})`, Number(r8.n) === esperado)

  // 9. VendasAnalitico — verifica datas dentro do período
  const r9 = db.prepare(`SELECT v.created_at AS data FROM vendas v WHERE v.status='concluida'${v.sql} ORDER BY v.created_at DESC LIMIT 500`).all(...v.params) as { data: string }[]
  const fora9 = r9.filter(r => r.data < v.params[0] || r.data > v.params[1])
  check(`${chave} — Analítico ${r9.length} linhas, ${fora9.length} fora do período`, fora9.length === 0, fora9.map(f => f.data).join(', '))

  // 10. VendasSintetico — verifica datas dentro do período
  const r10 = db.prepare(`SELECT date(v.created_at) AS data, COUNT(*) AS n FROM vendas v WHERE v.status='concluida'${v.sql} GROUP BY date(v.created_at)`).all(...v.params) as { data: string; n: number }[]
  const fora10 = r10.filter(r => r.data < v.params[0].slice(0, 10) || r.data > v.params[1].slice(0, 10))
  check(`${chave} — Sintético ${r10.length} datas, ${fora10.length} fora`, fora10.length === 0, fora10.map(f => f.data).join(', '))
  const totalSint = r10.reduce((a, x) => a + x.n, 0)
  check(`${chave} — Sintético total vendas = ${totalSint} (esperado ${esperado})`, totalSint === esperado)

  // 11. PorCategoriaProduto
  const r11 = db.prepare(`SELECT COUNT(*) AS n FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id LEFT JOIN produtos p ON p.id = vi.produto_id LEFT JOIN categorias cat ON cat.id = p.categoria_id WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  check(`${chave} — PorCategoria itens = ${r11.n} (esperado ${esperado})`, Number(r11.n) === esperado)

  // 12. PorMarca
  const r12 = db.prepare(`SELECT COUNT(*) AS n FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id LEFT JOIN produtos p ON p.id = vi.produto_id LEFT JOIN marcas m ON m.id = p.marca_id WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  check(`${chave} — PorMarca itens = ${r12.n} (esperado ${esperado})`, Number(r12.n) === esperado)

  // 13. Combo
  const r13 = db.prepare(`SELECT COUNT(DISTINCT v.id) AS n FROM venda_itens vi JOIN vendas v ON v.id = vi.venda_id WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  check(`${chave} — Combo vendas = ${r13.n} (esperado ${esperado})`, Number(r13.n) === esperado)

  // 14. Retenção
  const r14 = db.prepare(`SELECT COUNT(*) AS n FROM vendas v WHERE v.status='concluida' AND v.cliente_id IS NOT NULL${v.sql}`).get(...v.params) as { n: number }
  const esperado14 = seeds.filter(s => s.local >= p.inicio && s.local <= p.fim).length
  check(`${chave} — Retenção = ${r14.n} (esperado ${esperado14})`, Number(r14.n) === esperado14)

  // 15. CONSISTÊNCIA: todas as contagens devem dar o mesmo valor
  const todas = [r1.n, totalHora, r4.n, r5.n, Number(r6.total), totalSint]
  const unicos = new Set(todas.map(Number))
  check(`${chave} — CONSISTÊNCIA: todas contagens = ${esperado}`, unicos.size === 1 && unicos.has(esperado), JSON.stringify([...unicos]))
}

// ---------- personalizado ----------
console.log('\n── personalizado (casos especiais)')

// personalizado: 01/jul → 31/jul (mês específico)
{
  const p = calcularPeriodo('personalizado', { ini: `${ano}-07-01`, fim: `${ano}-07-31` })
  const v = clausulaSql('v.created_at', p)
  const r = db.prepare(`SELECT COUNT(*) AS n FROM vendas v WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  const esperado = seeds.filter(s => s.local >= p.inicio && s.local <= p.fim).length
  check(`Personalizado jul/${ano}: ${r.n} == ${esperado}`, Number(r.n) === esperado)
}

// personalizado: atravessando ano (dez/2025 → jan/2026)
{
  const p = calcularPeriodo('personalizado', { ini: `${ano - 1}-12-25`, fim: `${ano}-01-05` })
  const v = clausulaSql('v.created_at', p)
  const r = db.prepare(`SELECT COUNT(*) AS n FROM vendas v WHERE v.status='concluida'${v.sql}`).get(...v.params) as { n: number }
  const esperado = seeds.filter(s => s.local >= p.inicio && s.local <= p.fim).length
  check(`Personalizado dez→jan: ${r.n} == ${esperado}`, Number(r.n) === esperado)
}

// ---------- carregarMovimentacaoEstoque (SEM período — documentar) ----------
console.log('\n── carregarMovimentacaoEstoque (SEM período — BUG CONHECIDO)')
const rMov = db.prepare(`SELECT COUNT(*) AS n FROM movimentacoes`).get() as { n: number }
check(`Movimentação: SEM filtro de período (retorna TUDO) — documentado como bug`, true, `${rMov.n} registros`)

console.log(`\n===== AUDITORIA: ${passou} OK, ${falhou} FALHA =====`)
if (falhas.length) { console.log('\nFALHAS:'); falhas.forEach(f => console.log('  - ' + f)) }
process.exit(falhas.length ? 1 : 0)
