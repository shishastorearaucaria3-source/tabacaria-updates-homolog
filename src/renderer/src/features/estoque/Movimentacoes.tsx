import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDbApi, getEstoqueApi } from '../../shared/db'
import { TIPOS_POR_DIRECAO, TipoMov, labelCategoria } from './tipos'

interface ProdutoLite {
  id: number
  nome: string
  codigo_barras: string | null
  preco_custo: number
  preco_venda: number
  estoque: number
  unidade: string
}

interface ItemMov {
  produto_id: number
  nome: string
  quantidade: string
  preco_custo: string
  lote: string
  data_validade: string
}

interface GrupoTransacao {
  chave: string
  documento: string | null
  criado_em: string
  tipo: string
  categoria: string | null
  motivo: string | null
  venda_id: number | null
  usuario_nome: string | null
  fornecedor_nome: string | null
  cliente_nome: string | null
  origem: string | null
  destino: string | null
  qtd_itens: number
  quantidade_total: number
  valor_total: number
  canceladas: number
}

interface DetalheTransacao {
  id: number
  produto_id: number
  produto_nome: string
  tipo: string
  categoria: string | null
  quantidade: number
  valor: number
  motivo: string | null
  documento: string | null
  origem: string | null
  destino: string | null
  lote: string | null
  data_validade: string | null
  criado_em: string
}

export function MovimentoModal({
  usuarioId,
  tipoInicial,
  produtoInicialId,
  onFechar,
  onConcluido
}: {
  usuarioId: number
  tipoInicial: 'entrada' | 'saida'
  produtoInicialId?: number
  onFechar: () => void
  onConcluido: (msg: string) => void
}) {
  const [tipo, setTipo] = useState<'entrada' | 'saida'>(tipoInicial)
  const [categoria, setCategoria] = useState('')
  const tipos = TIPOS_POR_DIRECAO[tipo]
  const tipoObj: TipoMov | undefined = tipos.find((t) => t.id === categoria)

  const [fornecedores, setFornecedores] = useState<{ id: number; nome: string }[]>([])
  const [clientes, setClientes] = useState<{ id: number; nome: string }[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [origem, setOrigem] = useState('')
  const [destino, setDestino] = useState('')
  const [documento, setDocumento] = useState('')
  const [data, setData] = useState('')
  const [motivo, setMotivo] = useState('')
  const [itens, setItens] = useState<ItemMov[]>([])
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoLite[]>([])
  const [erro, setErro] = useState('')
  const [gravando, setGravando] = useState(false)
  const buscaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM fornecedores WHERE ativo = 1 ORDER BY nome').then((rows) => {
      setFornecedores(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
    getDbApi().all('SELECT id, nome FROM clientes ORDER BY nome').then((rows) => {
      setClientes(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!produtoInicialId) return
    getDbApi().get(`SELECT id, nome, codigo_barras, preco_custo, preco_venda, estoque, unidade FROM produtos WHERE id = ?`, [produtoInicialId])
      .then((p) => {
        if (p) adicionar(p as unknown as ProdutoLite)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtoInicialId])

  useEffect(() => {
    const termo = busca.trim()
    if (termo.length < 2) {
      setResultados([])
      return
    }
    const t = setTimeout(() => {
      getDbApi()
        .all(
          `SELECT id, nome, codigo_barras, preco_custo, preco_venda, estoque, unidade FROM produtos
           WHERE ativo = 1 AND (nome LIKE ? OR codigo_barras LIKE ? OR codigo_interno LIKE ?)
           ORDER BY nome LIMIT 10`,
          [`%${termo}%`, `%${termo}%`, `%${termo}%`]
        )
        .then((rows) => setResultados(rows as unknown as ProdutoLite[]))
        .catch(() => setResultados([]))
    }, 200)
    return () => clearTimeout(t)
  }, [busca])

  const adicionar = (p: ProdutoLite) => {
    setItens((prev) => {
      if (prev.some((i) => i.produto_id === p.id)) return prev
      return [...prev, { produto_id: p.id, nome: p.nome, quantidade: '1', preco_custo: p.preco_custo ? String(p.preco_custo) : '', lote: '', data_validade: '' }]
    })
    setResultados([])
    setBusca('')
    buscaRef.current?.focus()
  }

  const totalCusto = itens.reduce((s, i) => s + (Number(i.quantidade) || 0) * (Number(i.preco_custo) || 0), 0)
  const totalItens = itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0)

  const confirmar = async () => {
    setErro('')
    if (itens.length === 0) {
      setErro('Adicione ao menos um produto.')
      return
    }
    if (!tipoObj) {
      setErro('Selecione o tipo de movimentação.')
      return
    }
    if (tipoObj.precisaFornecedor && !fornecedorId) {
      setErro('Selecione o fornecedor.')
      return
    }
    if (tipoObj.precisaCliente && !clienteId) {
      setErro('Selecione o cliente.')
      return
    }
    if (tipoObj.requerMotivo && !motivo.trim()) {
      setErro('Informe o motivo da movimentação.')
      return
    }
    const itensEnviar = itens.map((i) => ({
      produto_id: i.produto_id,
      quantidade: Number(i.quantidade),
      preco_custo: i.preco_custo ? Number(i.preco_custo) : null,
      lote: i.lote.trim() ? i.lote.trim() : null,
      data_validade: i.data_validade || null
    }))
    setGravando(true)
    try {
      const r = await getEstoqueApi().movimentar({
        tipo,
        categoria: categoria as string,
        itens: itensEnviar,
        fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
        cliente_id: clienteId ? Number(clienteId) : null,
        origem: origem.trim() || undefined,
        destino: destino.trim() || undefined,
        documento: documento.trim() || undefined,
        motivo: motivo.trim() || undefined,
        data: data || undefined,
        usuario_id: usuarioId
      })
      if (!r.ok) {
        setErro(r.erro || 'Falha ao registrar a movimentação.')
        return
      }
      onConcluido(`Movimentação registrada (${r.documento}) — ${r.itens} item(ns), total R$ ${r.total.toFixed(2)}.`)
      onFechar()
    } catch (e) {
      setErro(`Erro: ${(e as Error).message}`)
    } finally {
      setGravando(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !gravando && onFechar()}>
      <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h3>{tipo === 'entrada' ? 'Entrada de estoque' : 'Saída de estoque'}</h3>
          <button className="modal-fechar" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        <div className="est-mov-corpo">
          <div className="segmented est-mov-tipo">
            <button className={tipo === 'entrada' ? 'ativo' : ''} onClick={() => { setTipo('entrada'); setCategoria(''); setFornecedorId(''); setClienteId(''); setOrigem(''); setDestino('') }}>+ Entrada</button>
            <button className={tipo === 'saida' ? 'ativo' : ''} onClick={() => { setTipo('saida'); setCategoria(''); setFornecedorId(''); setClienteId(''); setOrigem(''); setDestino('') }}>− Saída</button>
          </div>

          <label className="config-campo">Tipo de movimentação
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">— selecione —</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          {tipoObj?.precisaFornecedor && (
            <label className="config-campo">Fornecedor
              <select value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
                <option value="">— selecione —</option>
                {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
          )}
          {tipoObj?.precisaCliente && (
            <label className="config-campo">Cliente
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">— selecione —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </label>
          )}
          {tipoObj?.origem && (
            <label className="config-campo">Origem
              <input value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Loja / depósito de origem" />
            </label>
          )}
          {tipoObj?.destino && (
            <label className="config-campo">Destino
              <input value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Loja / local de destino" />
            </label>
          )}

          <div className="est-mov-cabecalho">
            <label className="config-campo">Documento (opcional)
              <input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="NF, número, referência..." />
            </label>
            <label className="config-campo">Data (opcional)
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>
          <label className="config-campo">Observação / motivo
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipoObj?.requerMotivo ? 'Obrigatório para este tipo' : 'Opcional'} />
          </label>

          <div className="est-mov-produtos">
            <div className="est-mov-busca">
              <input
                ref={buscaRef}
                className="busca"
                placeholder="Buscar produto por nome ou código..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              {resultados.length > 0 && (
                <div className="resultados-inline">
                  {resultados.map((p) => (
                    <button key={p.id} type="button" onClick={() => adicionar(p)}>
                      {p.nome} — est: {p.estoque} {p.unidade}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {itens.length === 0 ? (
              <p className="sem-resultado">Nenhum produto adicionado.</p>
            ) : (
              <div className="tabela-wrap" style={{ maxHeight: 240 }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="th-centro">Qtd</th>
                      {tipoObj?.usaCusto && <th className="th-centro">Custo</th>}
                      <th className="th-centro">Lote</th>
                      <th className="th-centro">Validade</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={i.produto_id}>
                        <td>{i.nome}</td>
                        <td className="td-centro">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            style={{ width: 80 }}
                            value={i.quantidade}
                            onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, quantidade: e.target.value } : x))}
                          />
                        </td>
                        {tipoObj?.usaCusto && (
                          <td className="td-centro">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              style={{ width: 90 }}
                              value={i.preco_custo}
                              onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, preco_custo: e.target.value } : x))}
                            />
                          </td>
                        )}
                        <td className="td-centro">
                          <input
                            style={{ width: 90 }}
                            value={i.lote}
                            onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, lote: e.target.value } : x))}
                          />
                        </td>
                        <td className="td-centro">
                          <input
                            type="date"
                            style={{ width: 130 }}
                            value={i.data_validade}
                            onChange={(e) => setItens((prev) => prev.map((x) => x.produto_id === i.produto_id ? { ...x, data_validade: e.target.value } : x))}
                          />
                        </td>
                        <td className="td-centro">
                          <button className="btn-mini" onClick={() => setItens((prev) => prev.filter((x) => x.produto_id !== i.produto_id))}>x</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {erro && <div className="mensagem" style={{ color: '#dc2626' }}>{erro}</div>}
          <div className="est-mov-rodape">
            <div className="est-mov-totais">
              <span><b>{itens.length}</b> produto(s) · <b>{totalItens}</b> unidade(s)</span>
              {tipoObj?.usaCusto && <strong>Custo total: R$ {totalCusto.toFixed(2)}</strong>}
            </div>
            <button className="btn-primario" onClick={confirmar} disabled={gravando}>
              {gravando ? 'Registrando...' : 'Registrar movimentação'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Movimentacoes({
  usuarioId,
  produtoFiltro,
  onLimparFiltro,
  onNova
}: {
  usuarioId: number
  produtoFiltro: number | null
  onLimparFiltro: () => void
  onNova: (tipo: 'entrada' | 'saida') => void
}) {
  const [grupos, setGrupos] = useState<GrupoTransacao[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'entrada' | 'saida'>('todos')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [detalhe, setDetalhe] = useState<{ documento: string | null; venda_id: number | null; id: number } | null>(null)
  const [detalheItens, setDetalheItens] = useState<DetalheTransacao[]>([])
  const [detalheMeta, setDetalheMeta] = useState<GrupoTransacao | null>(null)
  const [mensagem, setMensagem] = useState('')
  const POR_PAGINA = 25

  const carregar = useCallback(async () => {
    setCarregando(true)
    const conds: string[] = []
    const params: unknown[] = []
    if (filtroTipo === 'entrada') conds.push(`m.tipo = 'entrada'`)
    if (filtroTipo === 'saida') conds.push(`m.tipo = 'saida'`)
    if (filtroCategoria) { conds.push(`m.categoria = ?`); params.push(filtroCategoria) }
    const termo = busca.trim()
    if (termo) {
      conds.push(`(m.documento LIKE ? OR m.motivo LIKE ? OR EXISTS (
        SELECT 1 FROM movimentacoes mx JOIN produtos px ON px.id = mx.produto_id
        WHERE ((mx.documento IS NOT NULL AND mx.documento = m.documento) OR (mx.documento IS NULL AND mx.venda_id = m.venda_id AND m.documento IS NULL))
        AND px.nome LIKE ?))`)
      const like = `%${termo}%`
      params.push(like, like, like)
    }
    if (produtoFiltro != null) {
      conds.push(`EXISTS (
        SELECT 1 FROM movimentacoes mx WHERE mx.produto_id = ?
        AND ((mx.documento IS NOT NULL AND mx.documento = m.documento) OR (mx.documento IS NULL AND mx.venda_id = m.venda_id AND m.documento IS NULL))
      )`)
      params.push(produtoFiltro)
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    const base = `
      SELECT
        COALESCE(m.documento, CASE WHEN m.venda_id IS NOT NULL THEN 'V-'||m.venda_id ELSE 'M-'||m.id END) AS chave,
        MAX(m.documento) AS documento,
        MAX(m.criado_em) AS criado_em,
        MAX(m.tipo) AS tipo,
        MAX(m.categoria) AS categoria,
        MAX(m.motivo) AS motivo,
        MAX(m.venda_id) AS venda_id,
        MAX(u.nome) AS usuario_nome,
        MAX(f.nome) AS fornecedor_nome,
        MAX(c.nome) AS cliente_nome,
        MAX(m.origem) AS origem,
        MAX(m.destino) AS destino,
        COUNT(*) AS qtd_itens,
        SUM(m.quantidade) AS quantidade_total,
        SUM(m.valor) + COALESCE(SUM(CASE WHEN m.venda_id IS NOT NULL THEN
          (SELECT vi.subtotal FROM venda_itens vi WHERE vi.venda_id = m.venda_id AND vi.produto_id = m.produto_id LIMIT 1) ELSE 0 END), 0) AS valor_total,
        COUNT(CASE WHEN m.tipo = 'cancelamento' THEN 1 END) AS canceladas
      FROM movimentacoes m
      LEFT JOIN usuarios u ON u.id = m.usuario_id
      LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
      LEFT JOIN clientes c ON c.id = m.cliente_id
      ${where}
      GROUP BY chave
    `
    try {
      const db = getDbApi()
      const contagem = (await db.get(`SELECT COUNT(*) AS c FROM (${base})`, params)) as { c: number }
      setTotal(contagem.c)
      const limite = Math.min(POR_PAGINA, Math.max(contagem.c - pagina * POR_PAGINA, 0))
      if (limite > 0) {
        const rows = (await db.all(`${base} ORDER BY MAX(m.criado_em) DESC LIMIT ? OFFSET ?`, [...params, POR_PAGINA, pagina * POR_PAGINA])) as unknown as GrupoTransacao[]
        setGrupos(rows)
      } else {
        setGrupos([])
      }
    } catch {
      setGrupos([])
      setTotal(0)
    } finally {
      setCarregando(false)
    }
  }, [filtroTipo, filtroCategoria, busca, produtoFiltro, pagina])

  useEffect(() => { carregar() }, [carregar])

  const abrirDetalhe = async (g: GrupoTransacao) => {
    setDetalheMeta(g)
    setDetalheItens([])
    setDetalhe({ documento: g.documento, venda_id: g.venda_id, id: Number(g.chave.split('-')[1]) })
    try {
      let sql: string
      let params: unknown[]
      if (g.documento) {
        sql = `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.tipo, m.categoria, m.quantidade, m.valor, m.motivo, m.documento, m.origem, m.destino, p.lote, p.data_validade, m.criado_em
               FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE m.documento = ? ORDER BY m.id`
        params = [g.documento]
      } else if (g.venda_id) {
        sql = `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.tipo, m.categoria, m.quantidade, m.valor, m.motivo, m.documento, m.origem, m.destino, p.lote, p.data_validade, m.criado_em
               FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE m.venda_id = ? ORDER BY m.id`
        params = [g.venda_id]
      } else {
        sql = `SELECT m.id, m.produto_id, p.nome AS produto_nome, m.tipo, m.categoria, m.quantidade, m.valor, m.motivo, m.documento, m.origem, m.destino, p.lote, p.data_validade, m.criado_em
               FROM movimentacoes m JOIN produtos p ON p.id = m.produto_id WHERE m.id = ? ORDER BY m.id`
        params = [Number(g.chave.split('-')[1])]
      }
      const rows = (await getDbApi().all(sql, params)) as unknown as DetalheTransacao[]
      setDetalheItens(rows)
    } catch {
      setDetalheItens([])
    }
  }

  const totalPaginas = Math.max(Math.ceil(total / POR_PAGINA), 1)

  const fmtDataHora = (dt: string) => {
    const d = new Date(dt)
    if (isNaN(d.getTime())) return dt
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const label = (g: GrupoTransacao) => {
    if (g.categoria) return labelCategoria(g.categoria)
    if (g.tipo === 'saida') return 'Venda'
    if (g.tipo === 'cancelamento') return 'Cancelamento'
    return g.tipo
  }

  const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const categoriasDisponiveis = useMemo(() => {
    const set = new Set<string>()
    TIPOS_POR_DIRECAO.entrada.forEach((t) => set.add(t.id))
    TIPOS_POR_DIRECAO.saida.forEach((t) => set.add(t.id))
    return Array.from(set)
  }, [])

  return (
    <div className="est-abas-conteudo">
      <div className="est-toolbar">
        <div className="segmented">
          <button className={filtroTipo === 'todos' ? 'ativo' : ''} onClick={() => { setFiltroTipo('todos'); setPagina(0) }}>Todos</button>
          <button className={filtroTipo === 'entrada' ? 'ativo' : ''} onClick={() => { setFiltroTipo('entrada'); setPagina(0) }}>Entradas</button>
          <button className={filtroTipo === 'saida' ? 'ativo' : ''} onClick={() => { setFiltroTipo('saida'); setPagina(0) }}>Saídas</button>
        </div>
        <select value={filtroCategoria} onChange={(e) => { setFiltroCategoria(e.target.value); setPagina(0) }}>
          <option value="">Todas as categorias</option>
          {categoriasDisponiveis.map((c) => <option key={c} value={c}>{labelCategoria(c)}</option>)}
        </select>
        <input className="busca" placeholder="Buscar documento, produto ou observação..." value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0) }} />
        <div className="est-toolbar-acoes">
          <button className="btn-primario est-btn-entrada" onClick={() => onNova('entrada')} title="Nova entrada">+ Entrada</button>
          <button className="btn-primario est-btn-saida" onClick={() => onNova('saida')} title="Nova saída">− Saída</button>
        </div>
      </div>

      {produtoFiltro != null && (
        <div className="est-filtro-produto">
          Filtrando por produto — <button className="btn-mini" onClick={onLimparFiltro}>limpar filtro</button>
        </div>
      )}

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {carregando && grupos.length === 0 ? (
        <p className="sem-resultado">Carregando movimentações...</p>
      ) : grupos.length === 0 ? (
        <p className="sem-resultado">Nenhuma movimentação encontrada.</p>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Tipo</th>
                <th>Documento</th>
                <th className="th-centro">Itens</th>
                <th className="th-centro">Qtd</th>
                <th className="th-direita">Valor</th>
                <th>Fornecedor / Cliente</th>
                <th>Funcionário</th>
                <th>Origem / Destino</th>
                <th className="th-centro">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const ehEntrada = g.tipo === 'entrada'
                const ehSaida = g.tipo === 'saida'
                const cancelada = g.canceladas > 0
                return (
                  <tr key={g.chave} className={cancelada ? 'linha-cancelada' : ''}>
                    <td>{fmtDataHora(g.criado_em)}</td>
                    <td>
                      <span className={`est-tipo ${ehEntrada ? 'entrada' : ehSaida ? 'saida' : ''}`}>
                        {ehEntrada ? '▲' : ehSaida ? '▼' : ''} {label(g)}
                      </span>
                    </td>
                    <td>{g.documento || (g.venda_id ? `Venda #${g.venda_id}` : g.chave)}</td>
                    <td className="td-centro">{g.qtd_itens}</td>
                    <td className="td-centro">{g.quantidade_total}</td>
                    <td className="td-direita">R$ {fmtNum(g.valor_total)}</td>
                    <td>{g.fornecedor_nome || g.cliente_nome || '—'}</td>
                    <td>{g.usuario_nome || '—'}</td>
                    <td>{g.origem || g.destino || '—'}</td>
                    <td className="td-centro">{cancelada ? <span className="rp-status erro">Cancelada</span> : <span className="rp-status ok">OK</span>}</td>
                    <td className="td-centro">
                      <button className="btn-mini" onClick={() => abrirDetalhe(g)}>Ver</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > POR_PAGINA && (
        <div className="est-paginacao">
          <button className="btn-mini" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(p - 1, 0))}>← Anterior</button>
          <span>Página {pagina + 1} de {totalPaginas} ({total} movimentações)</span>
          <button className="btn-mini" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
        </div>
      )}

      {detalhe && (
        <div className="modal-overlay" onClick={() => setDetalhe(null)}>
          <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Detalhes da movimentação</h3>
              <button className="modal-fechar" onClick={() => setDetalhe(null)} aria-label="Fechar">✕</button>
            </div>
            {detalheMeta && (
              <div className="est-detalhe-meta">
                <div className="linha"><span>Tipo</span><strong>{label(detalheMeta)}</strong></div>
                <div className="linha"><span>Data/hora</span><strong>{fmtDataHora(detalheMeta.criado_em)}</strong></div>
                <div className="linha"><span>Documento</span><strong>{detalheMeta.documento || (detalheMeta.venda_id ? `Venda #${detalheMeta.venda_id}` : detalheMeta.chave)}</strong></div>
                {detalheMeta.usuario_nome && <div className="linha"><span>Funcionário</span><strong>{detalheMeta.usuario_nome}</strong></div>}
                {detalheMeta.fornecedor_nome && <div className="linha"><span>Fornecedor</span><strong>{detalheMeta.fornecedor_nome}</strong></div>}
                {detalheMeta.cliente_nome && <div className="linha"><span>Cliente</span><strong>{detalheMeta.cliente_nome}</strong></div>}
                {detalheMeta.origem && <div className="linha"><span>Origem</span><strong>{detalheMeta.origem}</strong></div>}
                {detalheMeta.destino && <div className="linha"><span>Destino</span><strong>{detalheMeta.destino}</strong></div>}
                {detalheMeta.motivo && <div className="linha"><span>Observação</span><strong>{detalheMeta.motivo}</strong></div>}
              </div>
            )}
            <div className="tabela-wrap" style={{ maxHeight: 300 }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="th-centro">Qtd</th>
                    <th className="th-direita">Valor</th>
                    <th className="th-centro">Lote</th>
                    <th className="th-centro">Validade</th>
                  </tr>
                </thead>
                <tbody>
                  {detalheItens.map((i) => (
                    <tr key={i.id}>
                      <td>{i.produto_nome}</td>
                      <td className="td-centro">{i.quantidade}</td>
                      <td className="td-direita">R$ {fmtNum(i.valor)}</td>
                      <td className="td-centro">{i.lote || '—'}</td>
                      <td className="td-centro">{i.data_validade || '—'}</td>
                    </tr>
                  ))}
                  {detalheItens.length === 0 && <tr><td colSpan={5} className="sem-resultado">Carregando...</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setDetalhe(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}