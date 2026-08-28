// Teste: carregarMovimentacaoEstoque respeita o período selecionado
import { DatabaseSync } from 'node:sqlite'
import { calcularPeriodo, clausulaSql, paraUtcSql } from '../src/renderer/src/features/relatorios/periodo.ts'
import type { ChavePeriodo } from '../src/renderer/src/features/relatorios/periodo.ts'

let passou = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { passou++; console.log(`  OK   ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ' -> ' + detalhe : ''}`) }
}

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE movimentacoes (id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER, tipo TEXT, quantidade REAL, criado_em TEXT);
  CREATE TABLE produtos (id INTEGER PRIMARY KEY, nome TEXT, estoque REAL);
`)

// produtos
db.exec(`INSERT INTO produtos (id, nome, estoque) VALUES (1, 'Produto Julho', 50), (2, 'Produto Agosto', 100), (3, 'Produto Hoje', 30), (4, 'Produto Antigo', 200)`)

// movimentações em datas diferentes
const agora = new Date()
const ano = agora.getFullYear()
const mes = agora.getMonth()
const hoje0 = new Date(ano, mes, agora.getDate())

function addDias(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function utc(d: Date): string { return d.toISOString().slice(0, 19).replace('T', ' ') }
function localDate(y: number, m: number, d: number, h = 10): Date { return new Date(y, m, d, h, 0, 0, 0) }

const insMov = db.prepare(`INSERT INTO movimentacoes (produto_id, tipo, quantidade, criado_em) VALUES (?, ?, ?, ?)`)

// movimentação em JULHO (mês passado)
const jul = localDate(ano, mes - 1, 15)
insMov.run(1, 'entrada', 50, utc(jul))

// movimentação em AGOSTO dia 10 (dentro de 30d, dentro do mês)
const ago10 = localDate(ano, mes, 10)
insMov.run(2, 'entrada', 100, utc(ago10))

// movimentação HOJE
const hoje = localDate(ano, mes, agora.getDate())
insMov.run(3, 'saida', 10, utc(hoje))

// movimentação a -40 dias (FORA dos últimos 30 dias)
const antigo = addDias(hoje0, -40)
insMov.run(4, 'entrada', 200, utc(antigo))

// movimentação a -5 dias (dentro de 30d, fora de "hoje")
const cinco = addDias(hoje0, -5)
insMov.run(2, 'saida', 20, utc(cinco))

const seeds = [
  { pid: 1, tipo: 'entrada', qtd: 50, local: jul },
  { pid: 2, tipo: 'entrada', qtd: 100, local: ago10 },
  { pid: 3, tipo: 'saida', qtd: 10, local: hoje },
  { pid: 4, tipo: 'entrada', qtd: 200, local: antigo },
  { pid: 2, tipo: 'saida', qtd: 20, local: cinco },
]

console.log('\nsementes:')
for (const s of seeds) console.log(`  pid=${s.pid} tipo=${s.tipo} qtd=${s.qtd} local=${s.local.toLocaleString('pt-BR')}`)

// helper: replica a query de data.ts
function carregarMov(p: Periodo) {
  const m = clausulaSql('m.criado_em', p)
  const rows = db.prepare(
    `SELECT p.nome AS produto,
            COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.quantidade ELSE 0 END),0) AS entradas,
            COALESCE(SUM(CASE WHEN m.tipo='saida' THEN m.quantidade ELSE 0 END),0) AS saidas,
            COALESCE(p.estoque,0) AS saldo
     FROM movimentacoes m
     JOIN produtos p ON p.id = m.produto_id
     WHERE 1=1${m.sql}
     GROUP BY p.id, p.nome, p.estoque
     ORDER BY saidas DESC
     LIMIT 200`
  ).all(...m.params) as { produto: string; entradas: number; saidas: number; saldo: number }[]
  return rows
}

// helper: esperado pela semântica local
function esperadoMov(p: Periodo) {
  const filtradas = seeds.filter(s => s.local >= p.inicio && s.local <= p.fim)
  const porProduto = new Map<number, { nome: string; entradas: number; saidas: number }>()
  for (const s of filtradas) {
    if (!porProduto.has(s.pid)) {
      const prod = db.prepare('SELECT nome FROM produtos WHERE id = ?').get(s.pid) as { nome: string }
      porProduto.set(s.pid, { nome: prod.nome, entradas: 0, saidas: 0 })
    }
    const e = porProduto.get(s.pid)!
    if (s.tipo === 'entrada') e.entradas += s.qtd
    else e.saidas += s.qtd
  }
  return porProduto
}

// ---------- testes ----------
console.log('\n[Hoje]')
{
  const p = calcularPeriodo('hoje')
  const r = carregarMov(p)
  const esp = esperadoMov(p)
  check('somente movimentações de hoje', r.length === esp.size, `retornou ${r.length}, esperado ${esp.size}`)
  const hojeMov = r.find(x => x.produto === 'Produto Hoje')
  check('Produto Hoje: saída = 10', hojeMov?.saidas === 10, JSON.stringify(hojeMov))
  check('Produto Agosto NÃO aparece (sem mov hoje)', !r.find(x => x.produto === 'Produto Agosto'))
}

console.log('\n[Este mês]')
{
  const p = calcularPeriodo('este_mes')
  const r = carregarMov(p)
  const esp = esperadoMov(p)
  check(`quantidade de produtos = ${esp.size}`, r.length === esp.size, `retornou ${r.length}`)
  // Produto Julho (mês passado) NÃO deve aparecer
  check('Produto Julho NÃO aparece (mês passado)', !r.find(x => x.produto === 'Produto Julho'))
  // Produto Antigo (-40 dias) pode ou não estar dependendo do dia do mês
  // Se hoje é dia 24, -40 dias = 15/jul → fora de agosto
  if (agora.getDate() <= 31 && agora.getDate() - 40 < 1) {
    check('Produto Antigo (-40d) NÃO aparece (fora do mês)', !r.find(x => x.produto === 'Produto Antigo'))
  }
  const agoMov = r.find(x => x.produto === 'Produto Agosto')
  check('Produto Agosto: entrada 100, saída 20', agoMov?.entradas === 100 && agoMov?.saidas === 20, JSON.stringify(agoMov))
  const hojeMov = r.find(x => x.produto === 'Produto Hoje')
  check('Produto Hoje: saída = 10', hojeMov?.saidas === 10, JSON.stringify(hojeMov))
}

console.log('\n[Mês passado]')
{
  const p = calcularPeriodo('mes_passado')
  const r = carregarMov(p)
  const esp = esperadoMov(p)
  check(`quantidade de produtos = ${esp.size}`, r.length === esp.size, `retornou ${r.length}`)
  const julMov = r.find(x => x.produto === 'Produto Julho')
  check('Produto Julho: entrada = 50', julMov?.entradas === 50, JSON.stringify(julMov))
  check('Produto Hoje NÃO aparece (hoje ≠ mês passado)', !r.find(x => x.produto === 'Produto Hoje'))
  check('Produto Agosto NÃO aparece (agosto ≠ mês passado)', !r.find(x => x.produto === 'Produto Agosto'))
}

console.log('\n[Últimos 30 dias]')
{
  const p = calcularPeriodo('ultimos_30')
  const r = carregarMov(p)
  const esp = esperadoMov(p)
  check(`quantidade de produtos = ${esp.size}`, r.length === esp.size, `retornou ${r.length}`)
  // -40 dias está FORA dos últimos 30
  check('Produto Antigo (-40d) NÃO aparece', !r.find(x => x.produto === 'Produto Antigo'))
  // Produto Julho (dia 15 do mês passado) pode estar dentro ou fora de 30d dependendo do dia atual
  const julDentro30 = jul >= p.inicio && jul <= p.fim
  if (!julDentro30) {
    check('Produto Julho NÃO aparece (fora dos 30d)', !r.find(x => x.produto === 'Produto Julho'))
  } else {
    check('Produto Julho aparece (dentro dos 30d)', r.find(x => x.produto === 'Produto Julho') !== undefined)
  }
  const agoMov = r.find(x => x.produto === 'Produto Agosto')
  check('Produto Agosto: entrada 100, saída 20', agoMov?.entradas === 100 && agoMov?.saidas === 20, JSON.stringify(agoMov))
}

console.log('\n[Personalizado — somente julho]')
{
  const p = calcularPeriodo('personalizado', { ini: `${ano}-${String(mes).padStart(2,'0')-1 < 1 ? '12' : String(mes).padStart(2,'0')}-01`, fim: `${ano}-${String(mes).padStart(2,'0')}-28` })
  // usa mês anterior explicitamente
  const pJul = calcularPeriodo('personalizado', {
    ini: `${mes === 0 ? ano - 1 : ano}-${String(mes === 0 ? 12 : mes).padStart(2, '0')}-01`,
    fim: `${mes === 0 ? ano - 1 : ano}-${String(mes === 0 ? 12 : mes).padStart(2, '0')}-28`
  })
  const r = carregarMov(pJul)
  const julMov = r.find(x => x.produto === 'Produto Julho')
  check('Personalizado julho: Produto Julho entrada = 50', julMov?.entradas === 50, JSON.stringify(julMov))
  check('Produto Agosto NÃO aparece (fora de julho)', !r.find(x => x.produto === 'Produto Agosto'))
  check('Produto Hoje NÃO aparece (fora de julho)', !r.find(x => x.produto === 'Produto Hoje'))
}

console.log(`\n===== MOVIMENTAÇÃO: ${passou} OK, ${falhou} FALHA =====`)
if (falhas.length) process.exit(1)
