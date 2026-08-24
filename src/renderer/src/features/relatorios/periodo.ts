// Utilitário central de períodos dos relatórios.
// REGRA DE OURO: todos os limites são calculados em HORÁRIO LOCAL do computador
// e convertidos para o formato UTC gravado no banco ('YYYY-MM-DD HH:MM:SS',
// produzido por datetime('now')) apenas na hora de montar o SQL parametrizado.
// Assim uma venda feita às 23:30 locais pertence ao dia LOCAL em que ocorreu.

export type ChavePeriodo =
  | 'hoje'
  | 'ontem'
  | 'esta_semana'
  | 'semana_passada'
  | 'este_mes'
  | 'mes_passado'
  | 'ultimos_7'
  | 'ultimos_15'
  | 'ultimos_30'
  | 'personalizado'

export interface Periodo {
  inicio: Date
  fim: Date
}

export const PERIODOS_UI: { chave: ChavePeriodo; label: string }[] = [
  { chave: 'hoje', label: 'Hoje' },
  { chave: 'ontem', label: 'Ontem' },
  { chave: 'esta_semana', label: 'Esta semana' },
  { chave: 'semana_passada', label: 'Semana passada' },
  { chave: 'este_mes', label: 'Este mês' },
  { chave: 'mes_passado', label: 'Mês passado' },
  { chave: 'ultimos_7', label: 'Últimos 7 dias' },
  { chave: 'ultimos_15', label: 'Últimos 15 dias' },
  { chave: 'ultimos_30', label: 'Últimos 30 dias' },
  { chave: 'personalizado', label: 'Personalizado' }
]

function inicioDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

function fimDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function addDias(d: Date, dias: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + dias)
  return x
}

// Segunda-feira da semana à qual o dia pertence (semana inicia na segunda).
function segundaFeiraDaSemana(d: Date): Date {
  const x = inicioDia(d)
  const dow = x.getDay() // 0 = domingo ... 6 = sábado
  const desdeSegunda = dow === 0 ? 6 : dow - 1
  return addDias(x, -desdeSegunda)
}

// Interpreta 'YYYY-MM-DD' como data LOCAL (00:00). O construtor Date(y,m,d)
// usa horário local — nunca usar new Date('YYYY-MM-DD'), que parseia em UTC.
export function dataLocalDe(iso: string): Date {
  const [y, m, dd] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, dd ?? 1, 0, 0, 0, 0)
}

export function calcularPeriodo(
  chave: ChavePeriodo,
  opcoes?: { ref?: Date; ini?: string; fim?: string }
): Periodo {
  const hoje = opcoes?.ref ? inicioDia(new Date(opcoes.ref)) : inicioDia(new Date())

  switch (chave) {
    case 'hoje':
      return { inicio: inicioDia(hoje), fim: fimDia(hoje) }

    case 'ontem': {
      const ontem = addDias(hoje, -1)
      return { inicio: inicioDia(ontem), fim: fimDia(ontem) }
    }

    case 'esta_semana': {
      // Segunda-feira da semana atual até o fim de hoje.
      return { inicio: segundaFeiraDaSemana(hoje), fim: fimDia(hoje) }
    }

    case 'semana_passada': {
      // Segunda→domingo da semana anterior, completos.
      const segEsta = segundaFeiraDaSemana(hoje)
      const domAnterior = fimDia(addDias(segEsta, -1))
      const segAnterior = addDias(segEsta, -7)
      return { inicio: segAnterior, fim: domAnterior }
    }

    case 'este_mes': {
      // Dia 1º do mês atual 00:00 → fim do DIA ATUAL (não o fim do mês).
      const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0)
      return { inicio: primeiro, fim: fimDia(hoje) }
    }

    case 'mes_passado': {
      // Primeiro ao último dia do mês anterior (bissexto resolvido por Date).
      const primeiroMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      const primeiroAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1, 0, 0, 0, 0)
      const ultimoAnterior = fimDia(new Date(primeiroMesAtual.getFullYear(), primeiroMesAtual.getMonth(), 0))
      return { inicio: primeiroAnterior, fim: ultimoAnterior }
    }

    case 'ultimos_7':
    case 'ultimos_15':
    case 'ultimos_30': {
      // Janela móvel: dias corridos completos INCLUINDO hoje.
      const n = chave === 'ultimos_7' ? 7 : chave === 'ultimos_15' ? 15 : 30
      return { inicio: addDias(hoje, -(n - 1)), fim: fimDia(hoje) }
    }

    case 'personalizado': {
      // Inclui o dia inteiro da data inicial E da final.
      const ini = opcoes?.ini ? dataLocalDe(opcoes.ini) : inicioDia(hoje)
      const fim = opcoes?.fim ? fimDia(dataLocalDe(opcoes.fim)) : fimDia(hoje)
      return { inicio: ini, fim }
    }
  }
}

// Converte um instante LOCAL para o formato UTC gravado pelo banco
// ('YYYY-MM-DD HH:MM:SS' — saída de datetime('now')).
export function paraUtcSql(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

// Cláusula parametrizada reutilizável por qualquer coluna de data/hora.
// Ex.: clausulaSql('v.created_at', p) → { sql:' AND v.created_at >= ? AND v.created_at <= ?', params:[utcIni, utcFim] }
export function clausulaSql(coluna: string, p: Periodo): { sql: string; params: [string, string] } {
  return {
    sql: ` AND ${coluna} >= ? AND ${coluna} <= ?`,
    params: [paraUtcSql(p.inicio), paraUtcSql(p.fim)]
  }
}
