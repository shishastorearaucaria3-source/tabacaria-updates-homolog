import { useEffect, useState, useCallback, useRef } from 'react'
import { getDbApi } from '../../shared/db'
import Distribuicao from '../relatorios/Distribuicao'

interface Conta {
  id: number
  tipo: string
  descricao: string
  valor: number
  status: string
  vencimento: string | null
  fornecedor_id: number | null
  fornecedor: string | null
  categoria: string | null
  centro_custo: string | null
  origem: string | null
  compra_id: number | null
  forma_pagamento: string | null
  valor_pago: number
  data_pagamento: string | null
  prioridade: string
  observacao: string | null
  criado_em: string
  reservado: number
}

const COLUNAS: { chave: string; label: string }[] = [
  { chave: 'acao', label: 'Ação' },
  { chave: 'status', label: 'Status' },
  { chave: 'vencimento', label: 'Vencimento' },
  { chave: 'valor', label: 'Valor' },
  { chave: 'valor_pago', label: 'Valor pago' },
  { chave: 'saldo', label: 'Saldo' },
  { chave: 'fornecedor', label: 'Fornecedor' },
  { chave: 'categoria', label: 'Categoria' },
  { chave: 'descricao', label: 'Descrição' },
  { chave: 'origem', label: 'Origem' },
  { chave: 'criado_em', label: 'Data criação' },
  { chave: 'forma_pagamento', label: 'Forma pagamento' },
  { chave: 'observacao', label: 'Observação' },
  { chave: 'reservado', label: 'Valor reservado' },
  { chave: 'falta_reservar', label: 'Falta reservar' },
  { chave: 'prioridade', label: 'Prioridade' }
]

const COLUNAS_PADRAO: Record<string, boolean> = {
  acao: true, status: true, vencimento: true, valor: true, valor_pago: true, saldo: true,
  fornecedor: true, categoria: true, descricao: true, origem: true, criado_em: false,
  forma_pagamento: false, observacao: false, reservado: true, falta_reservar: true, prioridade: true
}

const contaVazia = {
  tipo: 'pagar',
  descricao: '',
  valor: '',
  vencimento: '',
  fornecedor_id: '',
  categoria: '',
  centro_custo: '',
  forma_pagamento: '',
  prioridade: 'media',
  observacao: ''
}

const formatarMoedaDigitos = (v: string) => {
  const digitos = v.replace(/\D/g, '').slice(0, 12)
  if (!digitos) return ''
  return (Number(digitos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Financeiro({ usuarioId }: { usuarioId?: number }) {
  const [contas, setContas] = useState<Conta[]>([])
  const [filtro, setFiltro] = useState<'abertas' | 'nao_pagas' | 'vencidas' | 'a_vencer' | 'hoje' | 'pagas' | 'todas'>('abertas')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState({ ...contaVazia })
  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<number | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [totais, setTotais] = useState({ aberto: 0, vencido: 0, venceHoje: 0, aVencer: 0, reservado: 0, faltaReservar: 0, entrouHoje: 0, saiuHoje: 0, disponivel: 0, comprometido: 0 })
  const [fornecedores, setFornecedores] = useState<{ id: number; nome: string }[]>([])
  const [categorias, setCategorias] = useState<string[]>([])
  const [menuColunas, setMenuColunas] = useState(false)
  const [colunasAtivas, setColunasAtivas] = useState<Record<string, boolean>>(() => {
    try { const s = localStorage.getItem('contas_colunas'); return s ? JSON.parse(s) : { ...COLUNAS_PADRAO } } catch { return { ...COLUNAS_PADRAO } }
  })
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [aba, setAba] = useState<'contas' | 'reposicao' | 'compromissos' | 'fornecedores' | 'distribuicao'>('contas')
  const [reserva, setReserva] = useState({ vendido: 0, custo: 0, recomendado: 0, jaReservado: 0, falta: 0 })
  const [reposicaoPorFor, setReposicaoPorFor] = useState<{ fornecedor: string; custo: number; reservado: number; falta: number }[]>([])
  const [reposicaoPorCat, setReposicaoPorCat] = useState<{ categoria: string; custo: number }[]>([])
  const [reposicaoProdutos, setReposicaoProdutos] = useState<{ produto: string; qtd: number; custo_total: number; vendido: number }[]>([])
  const [periodoRepo, setPeriodoRepo] = useState<'hoje' | 'ontem' | 'semana' | 'mes' | 'personalizado'>('hoje')
  const [repoIni, setRepoIni] = useState('')
  const [repoFim, setRepoFim] = useState('')
  const [repoAplicado, setRepoAplicado] = useState(false)
  const [repoPeriodoAberto, setRepoPeriodoAberto] = useState(false)
  const [repoLabel, setRepoLabel] = useState('')
  const [situacaoFornecedores, setSituacaoFornecedores] = useState<{ fornecedor: string; comprado: number; vendido_custo: number; em_aberto: number; vencidas: number; a_vencer: number; reservado: number; falta: number; proximo: string | null }[]>([])
  const [modalSeparar, setModalSeparar] = useState<Conta | null>(null)
  const [sepValor, setSepValor] = useState('')
  const [modalBaixa, setModalBaixa] = useState<Conta | null>(null)
  const [baixaValor, setBaixaValor] = useState('')
  const [baixaForma, setBaixaForma] = useState('')
  const [baixaData, setBaixaData] = useState('')
  const [proximas, setProximas] = useState<Conta[]>([])
  const [configFinanceira, setConfigFinanceira] = useState(false)
  const [regras, setRegras] = useState<Record<string, string>>({})
  const buscaRef = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const conds: string[] = []
    const params: unknown[] = []
    const hoje = new Date().toISOString().slice(0, 10)
    if (filtro === 'abertas') conds.push(`(c.status = 'aberta' OR c.status = 'parcial')`)
    else if (filtro === 'nao_pagas') conds.push(`c.status != 'paga'`)
    else if (filtro === 'vencidas') conds.push(`c.status != 'paga' AND c.vencimento < ?`)
    else if (filtro === 'a_vencer') conds.push(`c.status != 'paga' AND c.vencimento >= ?`)
    else if (filtro === 'hoje') conds.push(`c.status != 'paga' AND c.vencimento = ?`)
    else if (filtro === 'pagas') conds.push(`c.status = 'paga'`)
    if (filtro === 'vencidas' || filtro === 'a_vencer' || filtro === 'hoje') params.push(hoje)
    if (filtroCategoria) { conds.push(`c.categoria = ?`); params.push(filtroCategoria) }
    if (busca.trim()) { conds.push(`c.descricao LIKE ?`); params.push(`%${busca}%`) }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const rows = (await db.all(
      `SELECT c.*, f.nome AS fornecedor,
         (SELECT COALESCE(SUM(r.valor),0) FROM reservas_contas r WHERE r.conta_id = c.id) AS reservado
       FROM contas c
       LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
       ${where}
       ORDER BY CASE WHEN c.status != 'paga' THEN 0 ELSE 1 END, c.vencimento IS NULL, c.vencimento, c.id DESC`
    , params)) as unknown as Conta[]
    setContas(rows)

    const t = (await db.get(
      `SELECT
         (SELECT COALESCE(SUM(valor - COALESCE(valor_pago,0)),0) FROM contas WHERE status != 'paga') AS aberto,
         (SELECT COALESCE(SUM(valor - COALESCE(valor_pago,0)),0) FROM contas WHERE status != 'paga' AND vencimento < date('now')) AS vencido,
         (SELECT COALESCE(SUM(valor - COALESCE(valor_pago,0)),0) FROM contas WHERE status != 'paga' AND vencimento = date('now')) AS venceHoje,
         (SELECT COALESCE(SUM(valor - COALESCE(valor_pago,0)),0) FROM contas WHERE status != 'paga' AND vencimento > date('now')) AS aVencer,
         (SELECT COALESCE(SUM(r.valor),0) FROM reservas_contas r JOIN contas cc ON cc.id = r.conta_id WHERE cc.status != 'paga') AS reservado,
         (SELECT COALESCE(SUM(v.total),0) FROM vendas v WHERE v.status = 'concluida' AND date(v.created_at) = date('now')) AS entrouHoje,
         (SELECT COALESCE(SUM(cp.valor_pago),0) FROM contas cp WHERE cp.status = 'paga' AND cp.data_pagamento = date('now')) AS saiuHoje,
         (SELECT COALESCE(SUM(valor),0) FROM contas WHERE status = 'paga' AND data_pagamento >= datetime('now','-30 days') AND data_pagamento <= datetime('now')) AS pago30`
    )) as { aberto: number; vencido: number; venceHoje: number; aVencer: number; reservado: number; entrouHoje: number; saiuHoje: number; pago30: number }
    setTotais((prev) => ({
      ...prev,
      aberto: t.aberto, vencido: t.vencido, venceHoje: t.venceHoje, aVencer: t.aVencer,
      reservado: t.reservado, entrouHoje: t.entrouHoje, saiuHoje: t.saiuHoje,
      faltaReservar: Math.max(0, t.aberto - t.reservado),
      comprometido: t.aberto,
      disponivel: Math.max(0, t.entrouHoje - t.reservado)
    }))

    getDbApi().all(`SELECT DISTINCT categoria FROM contas WHERE categoria IS NOT NULL AND categoria != '' ORDER BY categoria`).then((r) => setCategorias((r as unknown as { categoria: string }[]).map((x) => x.categoria)))

    const prox = (await db.all(
      `SELECT c.*, f.nome AS fornecedor,
         (SELECT COALESCE(SUM(r.valor),0) FROM reservas_contas r WHERE r.conta_id = c.id) AS reservado
       FROM contas c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
       WHERE c.status != 'paga' AND c.vencimento >= date('now')
       ORDER BY c.vencimento, c.id LIMIT 8`
    )) as unknown as Conta[]
    setProximas(prox)

    // Situação dos fornecedores
    const sit = (await db.all(
      `SELECT COALESCE(f.nome,'Sem fornecedor') AS fornecedor,
              (SELECT COALESCE(SUM(cp.total),0) FROM compras cp WHERE cp.fornecedor_id = f.id) AS comprado,
              (SELECT COALESCE(SUM(cc.valor - COALESCE(cc.valor_pago,0)),0) FROM contas cc WHERE cc.fornecedor_id = f.id AND cc.status != 'paga') AS em_aberto,
              (SELECT COALESCE(SUM(cc.valor - COALESCE(cc.valor_pago,0)),0) FROM contas cc WHERE cc.fornecedor_id = f.id AND cc.status != 'paga' AND cc.vencimento < date('now')) AS vencidas,
              (SELECT MIN(cc.vencimento) FROM contas cc WHERE cc.fornecedor_id = f.id AND cc.status != 'paga') AS proximo,
              (SELECT COALESCE(SUM(r.valor),0) FROM reservas_contas r JOIN contas cc ON cc.id = r.conta_id WHERE cc.fornecedor_id = f.id AND cc.status != 'paga') AS reservado
       FROM fornecedores f
       ORDER BY em_aberto DESC`
    )) as unknown as { fornecedor: string; comprado: number; em_aberto: number; vencidas: number; proximo: string | null; reservado: number }[]
    setSituacaoFornecedores(sit.map((x) => ({
      ...x,
      a_vencer: Math.max(0, x.em_aberto - x.vencidas),
      falta: Math.max(0, x.em_aberto - x.reservado),
      vendido_custo: 0
    })))
  }, [filtro, filtroCategoria, busca])

  const carregarReposicao = useCallback(async () => {
    const db = getDbApi()
    const agora = new Date()
    const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let inicio: Date
    let fim: Date
    let label: string
    if (periodoRepo === 'hoje') {
      inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
      fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59)
      label = fmtD(agora)
    } else if (periodoRepo === 'ontem') {
      inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1)
      fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1, 23, 59, 59)
      label = fmtD(inicio)
    } else if (periodoRepo === 'semana') {
      const dia = agora.getDay()
      inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - dia)
      fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
      label = `${fmtD(inicio)} a ${fmtD(fim)}`
    } else if (periodoRepo === 'mes') {
      inicio = new Date(agora.getFullYear(), agora.getMonth(), 1)
      fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59)
      label = `${fmtD(inicio)} a ${fmtD(fim)}`
    } else {
      inicio = repoIni ? new Date(repoIni) : new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
      fim = repoFim ? new Date(repoFim + 'T23:59:59') : new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
      label = `${fmtD(inicio)} a ${fmtD(fim)}`
    }
    setRepoLabel(label)
    const iniStr = `${fmtD(inicio)} 00:00:00`
    const fimStr = `${fmtD(fim)} 23:59:59`

    const res = (await db.get(
      `SELECT COALESCE(SUM(v.total),0) AS vendido,
              COALESCE(SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade),0) AS margem
       FROM venda_itens vi
       JOIN vendas v ON v.id = vi.venda_id
       LEFT JOIN produtos p ON p.id = vi.produto_id
       WHERE v.status = 'concluida' AND v.created_at >= ? AND v.created_at <= ?`,
      [iniStr, fimStr]
    )) as { vendido: number; margem: number }
    const custo = Math.max(0, res.vendido - res.margem)
    const separadoRepos = (await db.get(
      `SELECT COALESCE(SUM(valor),0) AS total FROM separacoes_dinheiro WHERE data >= ? AND data <= ?`,
      [fmtD(inicio), fmtD(fim)]
    )) as { total: number }
    setReserva({
      vendido: res.vendido,
      custo,
      recomendado: custo,
      jaReservado: separadoRepos.total,
      falta: Math.max(0, custo - separadoRepos.total)
    })

    const porFor = (await db.all(
      `SELECT COALESCE(f.nome,'Sem fornecedor') AS fornecedor,
              COALESCE(SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade),0) AS custo
       FROM venda_itens vi
       JOIN vendas v ON v.id = vi.venda_id
       LEFT JOIN produtos p ON p.id = vi.produto_id
       LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
       WHERE v.status = 'concluida' AND v.created_at >= ? AND v.created_at <= ?
       GROUP BY f.nome ORDER BY custo DESC`,
      [iniStr, fimStr]
    )) as unknown as { fornecedor: string; custo: number }[]
    setReposicaoPorFor(porFor.map((x) => ({ ...x, reservado: 0, falta: x.custo })))

    const porCat = (await db.all(
      `SELECT COALESCE(cat.nome,'Sem categoria') AS categoria,
              COALESCE(SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade),0) AS custo
       FROM venda_itens vi
       JOIN vendas v ON v.id = vi.venda_id
       LEFT JOIN produtos p ON p.id = vi.produto_id
       LEFT JOIN categorias cat ON cat.id = p.categoria_id
       WHERE v.status = 'concluida' AND v.created_at >= ? AND v.created_at <= ?
       GROUP BY cat.nome ORDER BY custo DESC`,
      [iniStr, fimStr]
    )) as unknown as { categoria: string; custo: number }[]
    setReposicaoPorCat(porCat)

    const prods = (await db.all(
      `SELECT vi.nome_produto AS produto, SUM(vi.quantidade) AS qtd,
              COALESCE(SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade),0) AS custo_total,
              SUM(vi.subtotal) AS vendido
       FROM venda_itens vi
       JOIN vendas v ON v.id = vi.venda_id
       LEFT JOIN produtos p ON p.id = vi.produto_id
       WHERE v.status = 'concluida' AND v.created_at >= ? AND v.created_at <= ?
       GROUP BY vi.nome_produto ORDER BY custo_total DESC`,
      [iniStr, fimStr]
    )) as unknown as { produto: string; qtd: number; custo_total: number; vendido: number }[]
    setReposicaoProdutos(prods)
  }, [periodoRepo, repoIni, repoFim])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    if (aba === 'reposicao' && repoAplicado) carregarReposicao()
  }, [aba, repoAplicado, carregarReposicao])

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      const alvo = e.target as HTMLElement
      if (!alvo.closest('.dropdown-filtro')) { setMenuColunas(false); setFiltrosAbertos(false) }
      if (!alvo.closest('.repo-periodo-drop')) setRepoPeriodoAberto(false)
    }
    window.addEventListener('mousedown', fechar)
    return () => window.removeEventListener('mousedown', fechar)
  }, [])

  useEffect(() => {
    getDbApi().all(`SELECT id, nome FROM fornecedores ORDER BY nome`).then((r) => setFornecedores(r as unknown as { id: number; nome: string }[]))
    try { const s = localStorage.getItem('contas_regras'); if (s) setRegras(JSON.parse(s)) } catch { /* ignore */ }
  }, [])

  const salvar = async () => {
    if (!form.descricao.trim() || !Number(form.valor.replace(/\D/g, ''))) {
      setMensagem('Informe descrição e valor.')
      return
    }
    const valor = Number(form.valor.replace(/\D/g, '')) / 100
    const db = getDbApi()
    if (editandoId) {
      await db.run(
        `UPDATE contas SET descricao=?, valor=?, vencimento=?, fornecedor_id=?, categoria=?, centro_custo=?, forma_pagamento=?, prioridade=?, observacao=? WHERE id=?`,
        [form.descricao.trim(), valor, form.vencimento || null, form.fornecedor_id ? Number(form.fornecedor_id) : null,
         form.categoria || null, form.centro_custo || null, form.forma_pagamento || null, form.prioridade, form.observacao || null, editandoId]
      )
      setMensagem('Conta atualizada.')
    } else {
      await db.run(
        `INSERT INTO contas (tipo, descricao, valor, status, vencimento, fornecedor_id, categoria, centro_custo, forma_pagamento, prioridade, observacao)
         VALUES (?, ?, ?, 'aberta', ?, ?, ?, ?, ?, ?, ?)`,
        [form.tipo, form.descricao.trim(), valor, form.vencimento || null, form.fornecedor_id ? Number(form.fornecedor_id) : null,
         form.categoria || null, form.centro_custo || null, form.forma_pagamento || null, form.prioridade, form.observacao || null]
      )
      setMensagem('Conta criada.')
    }
    setFormAberto(false)
    setForm({ ...contaVazia })
    setEditandoId(null)
    carregar()
  }

  const editar = (c: Conta) => {
    setEditandoId(c.id)
    setForm({
      tipo: c.tipo, descricao: c.descricao, valor: formatarMoedaDigitos(String(Math.round(c.valor * 100))),
      vencimento: c.vencimento ?? '', fornecedor_id: c.fornecedor_id ? String(c.fornecedor_id) : '',
      categoria: c.categoria ?? '', centro_custo: c.centro_custo ?? '', forma_pagamento: c.forma_pagamento ?? '',
      prioridade: c.prioridade, observacao: c.observacao ?? ''
    })
    setFormAberto(true)
    setMensagem('')
  }

  const separar = async () => {
    if (!modalSeparar) return
    const valor = Number(sepValor.replace(/\D/g, '')) / 100
    if (!valor || valor <= 0) { setMensagem('Informe um valor válido.'); return }
    await getDbApi().run(
      `INSERT INTO reservas_contas (conta_id, valor, data, destinacao, observacao, usuario_id) VALUES (?, ?, date('now'), 'Conta a pagar', ?, ?)`,
      [modalSeparar.id, valor, `Reserva para ${modalSeparar.descricao}`, usuarioId ?? null]
    )
    setModalSeparar(null)
    setSepValor('')
    setMensagem('Reserva registrada.')
    carregar()
  }

  const baixar = async () => {
    if (!modalBaixa) return
    const valor = Number(baixaValor.replace(/\D/g, '')) / 100
    if (!valor || valor <= 0) { setMensagem('Informe o valor pago.'); return }
    const db = getDbApi()
    const saldoAtual = modalBaixa.valor - modalBaixa.valor_pago
    const novoPago = Math.min(saldoAtual, valor) + modalBaixa.valor_pago
    const novoStatus = novoPago >= modalBaixa.valor - 0.005 ? 'paga' : 'parcial'
    await db.run(
      `UPDATE contas SET valor_pago = ?, forma_pagamento = ?, data_pagamento = ?, status = ? WHERE id = ?`,
      [novoPago, baixaForma || null, baixaData || new Date().toISOString().slice(0, 10), novoStatus, modalBaixa.id]
    )
    // registra baixa na reserva
    await db.run(
      `INSERT INTO reservas_contas (conta_id, valor, data, destinacao, observacao, usuario_id) VALUES (?, ?, date('now'), 'Baixa de pagamento', ?, ?)`,
      [modalBaixa.id, valor, `Pagamento parcial/final de ${modalBaixa.descricao}`, usuarioId ?? null]
    )
    setModalBaixa(null)
    setBaixaValor('')
    setBaixaForma('')
    setBaixaData('')
    setMensagem(`Conta ${novoStatus === 'paga' ? 'paga' : 'atualizada'}.`)
    carregar()
  }

  const excluir = async (c: Conta) => {
    if (!confirm(`Excluir a conta "${c.descricao}"?`)) return
    await getDbApi().run(`DELETE FROM contas WHERE id = ?`, [c.id])
    setMensagem('Conta excluída.')
    carregar()
  }

  const salvarConfig = () => {
    try { localStorage.setItem('contas_regras', JSON.stringify(regras)) } catch { /* ignore */ }
    setConfigFinanceira(false)
    setMensagem('Configurações salvas.')
  }

  const fmt = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('/') : '-')

  const statusInfo = (c: Conta) => {
    if (c.status === 'paga') return { label: 'Pago', cor: 'rp-status ok', emoji: '🔵' }
    const falta = c.valor - c.reservado
    if (c.reservado >= c.valor - 0.005) return { label: 'Reservado', cor: 'rp-status ok', emoji: '🟢' }
    if (c.reservado > 0) return { label: 'Parcial', cor: 'rp-status pendente', emoji: '🟠' }
    return { label: 'Não reservado', cor: 'rp-status pendente', emoji: '🔴' }
  }

  const colunasVisiveis = COLUNAS.filter((c) => colunasAtivas[c.chave] !== false)

  const celula = (c: Conta, chave: string) => {
    switch (chave) {
      case 'status': { const s = statusInfo(c); return <span className={s.cor}>{s.emoji} {s.label}</span> }
      case 'vencimento': return <span className={c.status !== 'paga' && c.vencimento && c.vencimento.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'texto-vermelho' : ''}>{fmt(c.vencimento)}</span>
      case 'valor': return `R$ ${c.valor.toFixed(2)}`
      case 'valor_pago': return c.valor_pago > 0 ? `R$ ${c.valor_pago.toFixed(2)}` : '-'
      case 'saldo': { const s = c.valor - c.valor_pago; return <span className={s > 0 ? 'texto-vermelho' : 'texto-verde'}>R$ {s.toFixed(2)}</span> }
      case 'fornecedor': return c.fornecedor ?? '-'
      case 'categoria': return c.categoria ?? '-'
      case 'descricao': return c.descricao
      case 'origem': return c.origem ?? 'manual'
      case 'criado_em': return fmt(c.criado_em)
      case 'forma_pagamento': return c.forma_pagamento ?? '-'
      case 'observacao': return c.observacao ?? '-'
      case 'reservado': return c.reservado > 0 ? <span className="texto-verde">R$ {c.reservado.toFixed(2)}</span> : '-'
      case 'falta_reservar': { const f = Math.max(0, c.valor - c.reservado); return f > 0 ? <span className="texto-vermelho">R$ {f.toFixed(2)}</span> : <span className="texto-verde">R$ 0,00</span> }
      case 'prioridade': return c.prioridade === 'alta' ? <span className="rp-status pendente">Alta</span> : c.prioridade === 'baixa' ? <span className="rp-status ok">Baixa</span> : <span>Média</span>
      default: return '-'
    }
  }

  const cards = [
    { titulo: 'TOTAL EM ABERTO', valor: totais.aberto, cor: 'dist-cor-azul' },
    { titulo: 'VENCIDO', valor: totais.vencido, cor: 'dist-cor-vermelho' },
    { titulo: 'VENCE HOJE', valor: totais.venceHoje, cor: 'dist-cor-laranja' },
    { titulo: 'A VENCER', valor: totais.aVencer, cor: 'dist-cor-amarelo' },
    { titulo: 'VALOR RESERVADO', valor: totais.reservado, cor: 'dist-cor-verde' },
    { titulo: 'FALTA RESERVAR', valor: totais.faltaReservar, cor: 'dist-cor-roxo' }
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h2>Contas</h2>
        <div className="page-acoes">
          <div className="busca-pdv-caixa financeiro-busca">
            <input ref={buscaRef} className="busca-pdv" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar conta..." />
          </div>
          <div className="dropdown-filtro">
            <button className={`btn-secundario ${filtrosAbertos ? 'ativo' : ''}`} onClick={() => setFiltrosAbertos((v) => !v)} title="Filtrar por categoria">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
              {filtroCategoria || 'Todas as categorias'} <span className="seta-dropdown">▼</span>
            </button>
            {filtrosAbertos && (
              <div className="dropdown-colunas-menu financeiro-filtros-drop">
                <div className="dropdown-colunas-titulo">Filtrar por categoria</div>
                <button className={`dropdown-colunas-item ${filtroCategoria === '' ? 'ativo' : ''}`} onClick={() => { setFiltroCategoria(''); setFiltrosAbertos(false) }}>
                  Todas as categorias
                </button>
                {categorias.map((c) => (
                  <button key={c} className={`dropdown-colunas-item ${filtroCategoria === c ? 'ativo' : ''}`} onClick={() => { setFiltroCategoria(c); setFiltrosAbertos(false) }}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="dropdown-filtro">
            <button className="btn-secundario dropdown-periodo-btn" onClick={() => setMenuColunas((v) => !v)}>⋯ Colunas</button>
            {menuColunas && (
              <div className="dropdown-colunas-menu">
                <div className="dropdown-colunas-titulo">Adicionar ou remover colunas</div>
                {COLUNAS.map((c) => (
                  <label key={c.chave} className="dropdown-colunas-item">
                    <input type="checkbox" checked={colunasAtivas[c.chave] !== false} onChange={() => {
                      const novo = { ...colunasAtivas, [c.chave]: colunasAtivas[c.chave] === false }
                      setColunasAtivas(novo)
                      try { localStorage.setItem('contas_colunas', JSON.stringify(novo)) } catch { /* ignore */ }
                    }} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn-secundario" onClick={() => setConfigFinanceira(true)}>⚙ Config. Financeiras</button>
          <button className="btn-primario" onClick={() => { setForm({ ...contaVazia }); setEditandoId(null); setFormAberto(true); setMensagem('') }}>+ Nova conta</button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <div className="abas-vendas">
        <button className={`aba ${aba === 'contas' ? 'ativa' : ''}`} onClick={() => setAba('contas')}>Contas</button>
        <button className={`aba ${aba === 'distribuicao' ? 'ativa' : ''}`} onClick={() => setAba('distribuicao')}>Distribuição do Dinheiro</button>
        <button className={`aba ${aba === 'reposicao' ? 'ativa' : ''}`} onClick={() => setAba('reposicao')}>Reserva para Reposição</button>
        <button className={`aba ${aba === 'compromissos' ? 'ativa' : ''}`} onClick={() => setAba('compromissos')}>Compromissos Financeiros</button>
        <button className={`aba ${aba === 'fornecedores' ? 'ativa' : ''}`} onClick={() => setAba('fornecedores')}>Situação dos Fornecedores</button>
      </div>

      {aba === 'contas' && (
        <>
          <div className="rp-metricas">
            {cards.map((c) => (
              <div key={c.titulo} className={`rp-metrica ${c.cor}`}>
                <span className="rp-metrica-titulo">{c.titulo}</span>
                <strong>R$ {c.valor.toFixed(2)}</strong>
              </div>
            ))}
          </div>

          <div className="segmented financeiro-filtros-status">
            {([['abertas', 'Em aberto'], ['nao_pagas', 'Não pagas'], ['vencidas', 'Vencidas'], ['a_vencer', 'A vencer'], ['hoje', 'Hoje'], ['pagas', 'Pagas'], ['todas', 'Todas']] as const).map(([k, l]) => (
              <button key={k} className={filtro === k ? 'ativo' : ''} onClick={() => setFiltro(k)}>{l}</button>
            ))}
          </div>

          <div className="tabela-wrap">
            <table className="tabela tabela-financeiro">
              <thead>
                <tr>
                  {colunasVisiveis.map((c) => <th key={c.chave}>{c.label}</th>)}
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {contas.map((c) => {
                  const saldo = c.valor - c.valor_pago
                  const faltaRes = Math.max(0, c.valor - c.reservado)
                  return (
                    <tr key={c.id} className={c.status !== 'paga' && c.vencimento && c.vencimento.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'linha-vencida' : ''}>
                      {colunasVisiveis.map((col) => <td key={col.chave}>{celula(c, col.chave)}</td>)}
                      <td className="td-acoes">
                        {c.status !== 'paga' && (
                          <>
                            <button className="btn-mini" onClick={() => { setModalSeparar(c); setSepValor(formatarMoedaDigitos(String(Math.round(faltaRes * 100)))) }}>SEPARAR</button>
                            <button className="btn-mini" onClick={() => { setModalBaixa(c); setBaixaValor(formatarMoedaDigitos(String(Math.round(saldo * 100)))); setBaixaForma(''); setBaixaData(new Date().toISOString().slice(0, 10)) }}>Baixar <kbd>F2</kbd></button>
                          </>
                        )}
                        <button className="btn-mini" onClick={() => editar(c)}>Editar</button>
                        <button className="btn-mini btn-danger" onClick={() => excluir(c)}>Excluir</button>
                      </td>
                    </tr>
                  )
                })}
                {contas.length === 0 && (
                  <tr><td colSpan={colunasVisiveis.length + 1} className="sem-resultado">Nenhuma conta.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rp-tabela-card" style={{ marginTop: 16 }}>
            <h4>Próximos vencimentos</h4>
            <table className="rp-tabela">
              <thead><tr><th>Vencimento</th><th>Fornecedor</th><th>Valor</th><th>Reservado</th><th>Falta</th><th>Status</th></tr></thead>
              <tbody>
                {proximas.map((c) => {
                  const st = statusInfo(c)
                  return (
                    <tr key={c.id}>
                      <td>{fmt(c.vencimento)}</td>
                      <td>{c.fornecedor ?? '-'}</td>
                      <td>R$ {c.valor.toFixed(2)}</td>
                      <td className="texto-verde">R$ {c.reservado.toFixed(2)}</td>
                      <td className="texto-vermelho">R$ {Math.max(0, c.valor - c.reservado).toFixed(2)}</td>
                      <td><span className={st.cor}>{st.emoji} {st.label}</span></td>
                    </tr>
                  )
                })}
                {proximas.length === 0 && <tr><td colSpan={6} className="sem-resultado">Nenhum vencimento futuro.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rp-metricas" style={{ marginTop: 16 }}>
            <div className="rp-metrica dist-cor-verde"><span className="rp-metrica-titulo">Hoje — Entrou</span><strong>R$ {totais.entrouHoje.toFixed(2)}</strong></div>
            <div className="rp-metrica dist-cor-vermelho"><span className="rp-metrica-titulo">Hoje — Saiu</span><strong>R$ {totais.saiuHoje.toFixed(2)}</strong></div>
            <div className="rp-metrica dist-cor-roxo"><span className="rp-metrica-titulo">Hoje — Reservado</span><strong>R$ {totais.reservado.toFixed(2)}</strong></div>
            <div className="rp-metrica dist-cor-azul"><span className="rp-metrica-titulo">Hoje — Disponível</span><strong>R$ {totais.disponivel.toFixed(2)}</strong></div>
          </div>
        </>
      )}

      {aba === 'reposicao' && (
        <>
          <div className="repo-filtro-destaque">
            <span className="repo-filtro-titulo">Período da análise:</span>
            <div className="dropdown-filtro repo-periodo-drop">
              <button className="btn-secundario dropdown-periodo-btn" onClick={() => setRepoPeriodoAberto((v) => !v)}>
                {periodoRepo === 'hoje' ? 'Hoje' : periodoRepo === 'ontem' ? 'Ontem' : periodoRepo === 'semana' ? 'Esta semana' : periodoRepo === 'mes' ? 'Este mês' : 'Personalizado'} <span className="seta-dropdown">▼</span>
              </button>
              {repoPeriodoAberto && (
                <div className="dropdown-periodo-menu">
                  {([['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana', 'Esta semana'], ['mes', 'Este mês'], ['personalizado', 'Personalizado']] as const).map(([k, l]) => (
                    <button key={k} className={`dropdown-periodo-item ${periodoRepo === k ? 'ativo' : ''}`} onClick={() => { setPeriodoRepo(k); setRepoPeriodoAberto(false) }}>
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {periodoRepo === 'personalizado' && (
              <div className="repo-datas">
                <input type="date" value={repoIni} onChange={(e) => setRepoIni(e.target.value)} />
                <span>até</span>
                <input type="date" value={repoFim} onChange={(e) => setRepoFim(e.target.value)} />
              </div>
            )}
            <button className="btn-primario" onClick={() => { setRepoAplicado(true); carregarReposicao() }}>Aplicar filtro</button>
            <button className="btn-secundario" onClick={() => { setPeriodoRepo('hoje'); setRepoIni(''); setRepoFim(''); setRepoAplicado(true); carregarReposicao() }}>Limpar filtro</button>
          </div>
          {repoAplicado && repoLabel && (
            <div className="repo-periodo-analisado">
              <strong>Período analisado: {periodoRepo === 'personalizado' ? 'personalizado' : ''} {repoLabel}</strong>
            </div>
          )}
          <div className="rp-metricas">
            <div className="rp-metrica dist-cor-azul"><span className="rp-metrica-titulo">Vendas no período</span><strong>R$ {reserva.vendido.toFixed(2)}</strong></div>
            <div className="rp-metrica dist-cor-cinza"><span className="rp-metrica-titulo">Custo dos produtos vendidos</span><strong>R$ {reserva.custo.toFixed(2)}</strong></div>
            <div className="rp-metrica dist-cor-vermelho"><span className="rp-metrica-titulo">Necessário para reposição</span><strong>R$ {reserva.recomendado.toFixed(2)}</strong></div>
            <div className="rp-metrica dist-cor-verde"><span className="rp-metrica-titulo">Já reservado</span><strong>R$ {reserva.jaReservado.toFixed(2)}</strong></div>
            <div className="rp-metrica dist-cor-laranja"><span className="rp-metrica-titulo">Falta reservar</span><strong className={reserva.falta > 0 ? 'texto-vermelho' : ''}>R$ {reserva.falta.toFixed(2)}</strong></div>
          </div>
          <div className="rp-tabela-card">
            <h4>Reposição por fornecedor</h4>
            <table className="rp-tabela">
              <thead><tr><th>Fornecedor</th><th>Custo vendido</th><th>Necessário reservar</th></tr></thead>
              <tbody>
                {reposicaoPorFor.map((f, i) => (
                  <tr key={i}>
                    <td>{f.fornecedor}</td>
                    <td>R$ {f.custo.toFixed(2)}</td>
                    <td className="texto-vermelho">R$ {f.falta.toFixed(2)}</td>
                  </tr>
                ))}
                {reposicaoPorFor.length === 0 && <tr><td colSpan={3} className="sem-resultado">Sem vendas no período.</td></tr>}
              </tbody>
              <tfoot>
                <tr><td>TOTAL</td><td>R$ {reserva.custo.toFixed(2)}</td><td className="texto-vermelho">R$ {reserva.falta.toFixed(2)}</td></tr>
              </tfoot>
            </table>
          </div>
          <div className="rp-tabela-card">
            <h4>Reposição por categoria</h4>
            <table className="rp-tabela">
              <thead><tr><th>Categoria</th><th>Custo vendido</th></tr></thead>
              <tbody>
                {reposicaoPorCat.map((c, i) => (
                  <tr key={i}><td>{c.categoria}</td><td>R$ {c.custo.toFixed(2)}</td></tr>
                ))}
                {reposicaoPorCat.length === 0 && <tr><td colSpan={2} className="sem-resultado">Sem vendas no período.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="rp-tabela-card">
            <h4>Produtos vendidos no período (precisam ser repostos)</h4>
            <table className="rp-tabela">
              <thead><tr><th>Produto</th><th>Qtd vendida</th><th>Faturamento</th><th>Custo total</th><th>Necessário repor</th></tr></thead>
              <tbody>
                {reposicaoProdutos.map((p, i) => (
                  <tr key={i}>
                    <td>{p.produto}</td>
                    <td>{p.qtd}</td>
                    <td>R$ {(p.vendido || 0).toFixed(2)}</td>
                    <td>R$ {p.custo_total.toFixed(2)}</td>
                    <td className="texto-vermelho">R$ {p.custo_total.toFixed(2)}</td>
                  </tr>
                ))}
                {reposicaoProdutos.length === 0 && <tr><td colSpan={5} className="sem-resultado">Sem vendas no período.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === 'compromissos' && (
        <div className="rp-tabela-card">
          <h4>Compromissos Financeiros</h4>
          <div className="resumo-linhas">
            <div className="linha"><span>Contas a pagar (em aberto)</span><strong>R$ {totais.aberto.toFixed(2)}</strong></div>
            <div className="linha"><span>Reserva para reposição (mês)</span><strong>R$ {reserva.falta.toFixed(2)}</strong></div>
            <div className="linha total-periodo"><span>Total comprometido</span><strong className="texto-vermelho">R$ {(totais.aberto + reserva.falta).toFixed(2)}</strong></div>
            <div className="linha"><span>Dinheiro disponível (entrada do dia)</span><strong className="texto-verde">R$ {totais.entrouHoje.toFixed(2)}</strong></div>
            <div className="linha total-periodo"><span>Disponível real</span><strong className="texto-verde">R$ {Math.max(0, totais.entrouHoje - totais.aberto - reserva.falta).toFixed(2)}</strong></div>
          </div>
          <p className="nota-config" style={{ marginTop: 12 }}>Atenção: não contar o mesmo valor duas vezes. A conta a pagar gerada por uma compra representa a obrigação; a reposição considera o que precisa ser recomprado para manter o estoque.</p>
        </div>
      )}

      {aba === 'fornecedores' && (
        <div className="rp-tabela-card">
          <h4>Situação dos Fornecedores</h4>
          <table className="rp-tabela">
            <thead>
              <tr><th>Fornecedor</th><th>Total comprado</th><th>Contas em aberto</th><th>Vencidas</th><th>A vencer</th><th>Reservado</th><th>Falta reservar</th><th>Próximo venc.</th></tr>
            </thead>
            <tbody>
              {situacaoFornecedores.map((f, i) => (
                <tr key={i}>
                  <td>{f.fornecedor}</td>
                  <td>R$ {f.comprado.toFixed(2)}</td>
                  <td className="texto-vermelho">R$ {f.em_aberto.toFixed(2)}</td>
                  <td className="texto-vermelho">R$ {f.vencidas.toFixed(2)}</td>
                  <td>R$ {f.a_vencer.toFixed(2)}</td>
                  <td className="texto-verde">R$ {f.reservado.toFixed(2)}</td>
                  <td className={f.falta > 0 ? 'texto-vermelho' : 'texto-verde'}>R$ {f.falta.toFixed(2)}</td>
                  <td>{f.proximo ? fmt(f.proximo) : '-'}</td>
                </tr>
              ))}
              {situacaoFornecedores.length === 0 && <tr><td colSpan={8} className="sem-resultado">Nenhum fornecedor.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {aba === 'distribuicao' && (
        <Distribuicao usuarioId={usuarioId} />
      )}

      {formAberto && (
        <div className="modal-overlay" onClick={() => setFormAberto(false)}>
          <div className="modal modal-grande" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>{editandoId ? 'Editar conta' : 'Nova conta'}</h3>
              <button className="btn-icone" onClick={() => setFormAberto(false)}>✕</button>
            </div>
            <div className="form-grid">
              <label>Tipo
                <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
                  <option value="pagar">A pagar (despesa)</option>
                  <option value="receber">A receber (entrada)</option>
                </select>
              </label>
              <label>Valor (R$)
                <input value={form.valor} inputMode="decimal" onChange={(e) => setForm({ ...form, valor: formatarMoedaDigitos(e.target.value) })} placeholder="0,00" />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Descrição
                <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} autoFocus placeholder="Ex: compra de estoque, aluguel..." />
              </label>
              <label>Vencimento
                <input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} />
              </label>
              <label>Fornecedor
                <select value={form.fornecedor_id} onChange={(e) => setForm({ ...form, fornecedor_id: e.target.value })}>
                  <option value="">Nenhum</option>
                  {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </label>
              <label>Categoria
                <input value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} placeholder="Ex: estoque, aluguel..." />
              </label>
              <label>Centro de custo
                <input value={form.centro_custo} onChange={(e) => setForm({ ...form, centro_custo: e.target.value })} placeholder="Ex: loja, delivery..." />
              </label>
              <label>Forma de pagamento
                <input value={form.forma_pagamento} onChange={(e) => setForm({ ...form, forma_pagamento: e.target.value })} placeholder="Pix, boleto..." />
              </label>
              <label>Prioridade
                <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value })}>
                  <option value="alta">Alta</option>
                  <option value="media">Média</option>
                  <option value="baixa">Baixa</option>
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Observação
                <input value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setFormAberto(false)}>Cancelar</button>
              <button className="btn-primario" onClick={salvar}>Salvar <kbd>F2</kbd></button>
            </div>
          </div>
        </div>
      )}

      {modalSeparar && (
        <div className="modal-overlay" onClick={() => setModalSeparar(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Separar dinheiro — {modalSeparar.descricao}</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Valor da conta</span><strong>R$ {modalSeparar.valor.toFixed(2)}</strong></div>
              <div className="linha"><span>Já reservado</span><strong className="texto-verde">R$ {modalSeparar.reservado.toFixed(2)}</strong></div>
              <div className="linha total-periodo"><span>Valor restante</span><strong className="texto-vermelho">R$ {Math.max(0, modalSeparar.valor - modalSeparar.reservado).toFixed(2)}</strong></div>
            </div>
            <div className="form-grid">
              <label>Valor a separar (R$)
                <input autoFocus inputMode="decimal" value={sepValor} onChange={(e) => setSepValor(formatarMoedaDigitos(e.target.value))} placeholder="0,00" />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalSeparar(null)}>Cancelar</button>
              <button className="btn-primario" onClick={separar}>CONFIRMAR RESERVA</button>
            </div>
          </div>
        </div>
      )}

      {modalBaixa && (
        <div className="modal-overlay" onClick={() => setModalBaixa(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Baixar conta — {modalBaixa.descricao}</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Valor da conta</span><strong>R$ {modalBaixa.valor.toFixed(2)}</strong></div>
              <div className="linha"><span>Já pago</span><strong>R$ {modalBaixa.valor_pago.toFixed(2)}</strong></div>
              <div className="linha total-periodo"><span>Saldo</span><strong>R$ {(modalBaixa.valor - modalBaixa.valor_pago).toFixed(2)}</strong></div>
            </div>
            <div className="form-grid">
              <label>Valor pago (R$)
                <input autoFocus inputMode="decimal" value={baixaValor} onChange={(e) => setBaixaValor(formatarMoedaDigitos(e.target.value))} />
              </label>
              <label>Forma de pagamento
                <input value={baixaForma} onChange={(e) => setBaixaForma(e.target.value)} placeholder="Pix, dinheiro, boleto..." />
              </label>
              <label>Data do pagamento
                <input type="date" value={baixaData} onChange={(e) => setBaixaData(e.target.value)} />
              </label>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setModalBaixa(null)}>Cancelar</button>
              <button className="btn-primario" onClick={baixar}>Confirmar baixa</button>
            </div>
          </div>
        </div>
      )}

      {configFinanceira && (
        <div className="modal-overlay" onClick={() => setConfigFinanceira(false)}>
          <div className="modal modal-grande" onClick={(e) => e.stopPropagation()}>
            <h3>Configurações Financeiras</h3>
            <p className="nota-config">Regras de distribuição do dinheiro das vendas (percentual do faturamento). A reposição usa o custo real dos produtos vendidos.</p>
            <div className="form-grid">
              {([['reposicao', 'Reposição de estoque'], ['contas', 'Contas a pagar'], ['funcionarios', 'Funcionários'], ['despesas', 'Despesas'], ['retiradas', 'Retiradas'], ['reserva', 'Reserva/lucro']] as const).map(([k, l]) => (
                <label key={k}>{l} (%)
                  <input type="number" step="0.1" min="0" max="100" value={regras[k] ?? ''} onChange={(e) => setRegras({ ...regras, [k]: e.target.value })} placeholder="0" />
                </label>
              ))}
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setConfigFinanceira(false)}>Cancelar</button>
              <button className="btn-primario" onClick={salvarConfig}>Salvar configurações</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
