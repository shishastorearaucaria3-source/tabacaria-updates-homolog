// Teste unitário do utilitário de períodos (roda em Node 24 com type-stripping)
import { calcularPeriodo, clausulaSql, paraUtcSql, dataLocalDe } from '../src/renderer/src/features/relatorios/periodo.ts'

let passou = 0
let falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { passou++; console.log(`  OK   ${nome}`) }
  else { falhou++; falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ' -> ' + detalhe : ''}`) }
}

const TZ = -new Date().getTimezoneOffset() / 60 // ex.: -3 → 3h atrás do UTC
console.log(`fuso da máquina: UTC${TZ >= 0 ? '+' : ''}${TZ}`)

// ref fixa: quarta-feira 20/08/2025 (não bissexto)
const REF = new Date(2025, 7, 20) // local

function fmt(p: { inicio: Date; fim: Date }) {
  return `${paraUtcSql(p.inicio)} .. ${paraUtcSql(p.fim)}`
}

console.log('\n[Hoje]')
{
  const p = calcularPeriodo('hoje', { ref: REF })
  check('início = 00:00 local de hoje', p.inicio.getHours() === 0 && p.inicio.getMinutes() === 0)
  check('fim = 23:59:59.999 local', p.fim.getHours() === 23 && p.fim.getSeconds() === 59 && p.fim.getMilliseconds() === 999)
  check('mesmo dia', p.inicio.toDateString() === p.fim.toDateString())
}

console.log('\n[Ontem]')
{
  const p = calcularPeriodo('ontem', { ref: REF })
  check('dia anterior completo', p.inicio.getDate() === 19 && p.inicio.getMonth() === 7 && p.fim.getDate() === 19 && p.fim.getHours() === 23)
}

console.log('\n[Esta semana] — ref quarta 20/08/2025')
{
  const p = calcularPeriodo('esta_semana', { ref: REF })
  check('início segunda 18/08/2025', p.inicio.getDay() === 1 && p.inicio.getDate() === 18 && p.inicio.getMonth() === 7)
  check('fim hoje 23:59', p.fim.getDate() === 20 && p.fim.getHours() === 23)
}

console.log('\n[Esta semana] domingo como "hoje" (24/08/2025)')
{
  const dom = new Date(2025, 7, 24)
  const p = calcularPeriodo('esta_semana', { ref: dom })
  check('segunda 18/08 → domingo 24/08 completo', p.inicio.getDate() === 18 && p.fim.getDate() === 24 && p.fim.getHours() === 23)
}

console.log('\n[Semana passada] — ref qua 20/08/2025')
{
  const p = calcularPeriodo('semana_passada', { ref: REF })
  check('segunda 11/08', p.inicio.getDay() === 1 && p.inicio.getDate() === 11)
  check('domingo 17/08 23:59', p.inicio.getDate() === 11 && p.fim.getDay() === 0 && p.fim.getDate() === 17 && p.fim.getHours() === 23)
}

console.log('\n[Este mês] — ref 20/08/2025')
{
  const p = calcularPeriodo('este_mes', { ref: REF })
  check('01/08 00:00', p.inicio.getDate() === 1 && p.inicio.getMonth() === 7 && p.inicio.getHours() === 0)
  check('fim = HOJE 23:59 (não fim do mês)', p.fim.getDate() === 20 && p.fim.getHours() === 23)
}

console.log('\n[Mês passado] — ref 20/08/2025')
{
  const p = calcularPeriodo('mes_passado', { ref: REF })
  check('01/07 00:00', p.inicio.getDate() === 1 && p.inicio.getMonth() === 6 && p.inicio.getHours() === 0)
  check('31/07 23:59', p.fim.getDate() === 31 && p.fim.getMonth() === 6 && p.fim.getHours() === 23)
}

console.log('\n[Mês passado] virada de ano — ref 15/01/2025')
{
  const p = calcularPeriodo('mes_passado', { ref: new Date(2025, 0, 15) })
  check('01/12/2024 → 31/12/2024', p.inicio.getFullYear() === 2024 && p.inicio.getMonth() === 11 && p.inicio.getDate() === 1 && p.fim.getDate() === 31 && p.fim.getMonth() === 11)
}

console.log('\n[Mês passado] fevereiro BISSEXTO — ref 15/03/2024')
{
  const p = calcularPeriodo('mes_passado', { ref: new Date(2024, 2, 15) })
  check('01/02/2024 → 29/02/2024', p.inicio.getDate() === 1 && p.inicio.getMonth() === 1 && p.fim.getDate() === 29 && p.fim.getMonth() === 1, fmt(p))
}

console.log('\n[Mês passado] fevereiro NÃO-bissexto — ref 15/03/2025')
{
  const p = calcularPeriodo('mes_passado', { ref: new Date(2025, 2, 15) })
  check('01/02/2025 → 28/02/2025', p.fim.getDate() === 28, fmt(p))
}

console.log('\n[Últimos 7/15/30] janelas móveis')
{
  const p7 = calcularPeriodo('ultimos_7', { ref: REF })
  const p15 = calcularPeriodo('ultimos_15', { ref: REF })
  const p30 = calcularPeriodo('ultimos_30', { ref: REF })
  check('7 dias inclui hoje e vai até 14/08', p7.inicio.getDate() === 14 && p7.fim.getDate() === 20)
  check('15 dias começa em 06/08', p15.inicio.getDate() === 6)
  check('30 dias atravessa mês (22/07 → 20/08)', p30.inicio.getDate() === 22 && p30.inicio.getMonth() === 6 && p30.fim.getDate() === 20)
  const dias7 = Math.floor((p7.fim.getTime() - p7.inicio.getTime()) / 86400000) + 1
  const dias30 = Math.floor((p30.fim.getTime() - p30.inicio.getTime()) / 86400000) + 1
  check('duração exata: 7 e 30 dias corridos', dias7 === 7 && dias30 === 30, `7=${dias7} 30=${dias30}`)
}

console.log('\n[Personalizado]')
{
  const umDia = calcularPeriodo('personalizado', { ini: '2025-05-10', fim: '2025-05-10' })
  check('um único dia inteiro', umDia.inicio.getHours() === 0 && umDia.fim.getHours() === 23 && umDia.inicio.getDate() === 10 && umDia.fim.getDate() === 10)
  const doisMeses = calcularPeriodo('personalizado', { ini: '2025-01-20', fim: '2025-03-05' })
  check('atravessa meses', doisMeses.inicio.getMonth() === 0 && doisMeses.fim.getMonth() === 2)
  const doisAnos = calcularPeriodo('personalizado', { ini: '2024-12-25', fim: '2025-01-05' })
  check('atravessa anos', doisAnos.inicio.getFullYear() === 2024 && doisAnos.fim.getFullYear() === 2025)
}

console.log('\n[Venda às 23:30 locais pertence ao dia LOCAL]')
{
  // venda local 2025-08-20 23:30 → gravada no banco como UTC 2025-08-21 02:30
  const vendaLocal = new Date(2025, 7, 20, 23, 30)
  const gravadoUtc = paraUtcSql(vendaLocal)
  check('gravada como 2025-08-21 02:30 UTC', gravadoUtc === '2025-08-21 02:30:00', gravadoUtc)
  // o período HOJE (local) deve cobrir essa gravação
  const p = calcularPeriodo('hoje', { ref: REF })
  const cl = clausulaSql('v.created_at', p)
  const dentro = gravadoUtc >= cl.params[0] && gravadoUtc <= cl.params[1]
  check(`cláusula Hoje cobre a venda noturna [${cl.params.join(' .. ')}]`, dentro)
  // e ONTEM não deve pegar uma venda das 09:00 de hoje
  const vendaManha = paraUtcSql(new Date(2025, 7, 20, 9, 0)) // 12:00 UTC
  const ontem = calcularPeriodo('ontem', { ref: REF })
  const clOntem = clausulaSql('v.created_at', ontem)
  check('Ontem NÃO pega venda de hoje 09:00 local', !(vendaManha >= clOntem.params[0] && vendaManha <= clOntem.params[1]))
}

console.log(`\n===== UNITÁRIO: ${passou} OK, ${falhou} FALHA =====`)
if (falhas.length) process.exit(1)
