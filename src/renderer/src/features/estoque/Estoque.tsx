import { useCallback, useEffect, useState } from 'react'
import { getDbApi, getImagemApi } from '../../shared/db'
import Movimentacoes, { MovimentoModal } from './Movimentacoes'
import Validade from './Validade'
import Inventario from './Inventario'

interface ProdutoEstoque {
  id: number
  nome: string
  codigo_barras: string | null
  codigo_interno: string | null
  categoria_nome: string | null
  preco_custo: number
  preco_venda: number
  estoque: number
  estoque_minimo: number
  unidade: string
  ativo: number
  controla_estoque: number
  pedidos: number
}

type AbaEstoque = 'produtos' | 'transacoes' | 'validade' | 'inventario'

type Situacao = 'todos' | 'ativos' | 'com_estoque' | 'sem_estoque' | 'baixo' | 'negativo'
type Ordenacao = 'nome' | 'estoque_asc' | 'estoque_desc' | 'custo' | 'venda'

const SITUACOES: { id: Situacao; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'ativos', label: 'Ativos' },
  { id: 'com_estoque', label: 'Com estoque' },
  { id: 'sem_estoque', label: 'Sem estoque' },
  { id: 'baixo', label: 'Estoque baixo' },
  { id: 'negativo', label: 'Estoque negativo' }
]

const ORDENS: { id: Ordenacao; label: string }[] = [
  { id: 'nome', label: 'Nome' },
  { id: 'estoque_asc', label: 'Estoque (menor→maior)' },
  { id: 'estoque_desc', label: 'Estoque (maior→menor)' },
  { id: 'custo', label: 'Custo total' },
  { id: 'venda', label: 'Valor de venda' }
]

const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Estoque({
  usuarioId,
  onAbrirProduto
}: {
  usuarioId: number
  onAbrirProduto?: (id: number) => void
}) {
  const [aba, setAba] = useState<AbaEstoque>('produtos')
  const [produtos, setProdutos] = useState<ProdutoEstoque[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(50)
  const [busca, setBusca] = useState('')
  const [categoriaSel, setCategoriaSel] = useState('')
  const [categorias, setCategorias] = useState<{ id: number; nome: string }[]>([])
  const [situacao, setSituacao] = useState<Situacao>('todos')
  const [ordem, setOrdem] = useState<Ordenacao>('nome')
  const [carregando, setCarregando] = useState(true)
  const [imagens, setImagens] = useState<Record<number, string>>({})
  const [mensagem, setMensagem] = useState('')

  const [modalMov, setModalMov] = useState<{ tipo: 'entrada' | 'saida'; produtoId?: number } | null>(null)
  const [produtoMovFiltro, setProdutoMovFiltro] = useState<number | null>(null)

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM categorias ORDER BY nome').then((rows) => {
      setCategorias(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    const conds: string[] = []
    const params: unknown[] = []
    const termo = busca.trim()
    if (termo) {
      conds.push(`(p.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?)`)
      const like = `%${termo}%`
      params.push(like, like, like)
    }
    if (categoriaSel) { conds.push(`p.categoria_id = ?`); params.push(Number(categoriaSel)) }
    if (situacao === 'ativos') conds.push(`p.ativo = 1`)
    if (situacao === 'com_estoque') conds.push(`p.estoque > 0`)
    if (situacao === 'sem_estoque') conds.push(`p.estoque <= 0`)
    if (situacao === 'baixo') conds.push(`p.controla_estoque = 1 AND p.estoque <= p.estoque_minimo AND p.estoque > 0`)
    if (situacao === 'negativo') conds.push(`p.estoque < 0`)
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
    let orderBy = 'p.nome ASC'
    if (ordem === 'estoque_asc') orderBy = 'p.estoque ASC'
    if (ordem === 'estoque_desc') orderBy = 'p.estoque DESC'
    if (ordem === 'custo') orderBy = '(p.estoque * p.preco_custo) DESC'
    if (ordem === 'venda') orderBy = '(p.estoque * p.preco_venda) DESC'
    const sql = `
      SELECT p.id, p.nome, p.codigo_barras, p.codigo_interno, p.preco_custo, p.preco_venda, p.estoque,
             p.estoque_minimo, p.unidade, p.ativo, p.controla_estoque, c.nome AS categoria_nome,
             (SELECT COALESCE(SUM(pi.quantidade), 0) FROM pedido_itens pi
              JOIN pedidos p2 ON p2.id = pi.pedido_id
              WHERE pi.produto_id = p.id AND p2.status NOT IN ('entregue', 'cancelado')) AS pedidos
      FROM produtos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `
    const sqlCount = `
      SELECT COUNT(*) AS c FROM produtos p ${where}
    `
    try {
      const db = getDbApi()
      const contagem = (await db.get(sqlCount, params)) as { c: number }
      setTotal(contagem.c)
      const rows = (await db.all(sql, [...params, tamanhoPagina, pagina * tamanhoPagina])) as unknown as ProdutoEstoque[]
      setProdutos(rows)
      const ids = rows.map((r) => r.id)
      if (ids.length > 0) {
        const imgs = (await getImagemApi().listPorIds(ids).catch(() => ({}))) as Record<number, string>
        setImagens(imgs)
      } else {
        setImagens({})
      }
    } catch {
      setProdutos([])
      setTotal(0)
    } finally {
      setCarregando(false)
    }
  }, [busca, categoriaSel, situacao, ordem, tamanhoPagina, pagina])

  useEffect(() => { carregar() }, [carregar])

  const totalPaginas = Math.max(Math.ceil(total / tamanhoPagina), 1)

  const resumo = produtos.reduce(
    (acc, p) => {
      acc.qtd += p.estoque
      acc.custo += p.estoque * p.preco_custo
      acc.venda += p.estoque * p.preco_venda
      return acc
    },
    { qtd: 0, custo: 0, venda: 0 }
  )

  const baixo = (p: ProdutoEstoque) => p.controla_estoque === 1 && p.estoque <= p.estoque_minimo

  return (
    <div className="page">
      <div className="page-header">
        <h2>Estoque</h2>
        <div className="page-acoes">
          <span className="est-plano" title="Plano atual">Plano Premium</span>
        </div>
      </div>

      <div className="est-abas">
        {(['produtos', 'transacoes', 'validade', 'inventario'] as AbaEstoque[]).map((a) => (
          <button
            key={a}
            className={`aba-estoque ${aba === a ? 'ativa' : ''}`}
            onClick={() => setAba(a)}
          >
            {a === 'produtos' ? 'Estoque por Produto' : a === 'transacoes' ? 'Transações' : a === 'validade' ? 'Controle de Validade' : 'Inventário'}
          </button>
        ))}
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {aba === 'produtos' && (
        <div className="est-abas-conteudo">
          <div className="est-toolbar">
            <input
              className="busca"
              placeholder="Pesquisar por nome, código ou código interno..."
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setPagina(0) }}
            />
            <select value={categoriaSel} onChange={(e) => { setCategoriaSel(e.target.value); setPagina(0) }}>
              <option value="">Todas as categorias</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <select value={situacao} onChange={(e) => { setSituacao(e.target.value as Situacao); setPagina(0) }}>
              {SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={ordem} onChange={(e) => { setOrdem(e.target.value as Ordenacao); setPagina(0) }}>
              {ORDENS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <select value={tamanhoPagina} onChange={(e) => { setTamanhoPagina(Number(e.target.value)); setPagina(0) }}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
            <div className="est-toolbar-acoes">
              <button className="btn-primario est-btn-entrada" onClick={() => setModalMov({ tipo: 'entrada' })} title="Nova entrada">+ Entrada</button>
              <button className="btn-primario est-btn-saida" onClick={() => setModalMov({ tipo: 'saida' })} title="Nova saída">− Saída</button>
            </div>
          </div>

          <div className="est-resumo">
            <div className="est-resumo-item">
              <span>Produtos exibidos</span>
              <strong>{total}</strong>
            </div>
            <div className="est-resumo-item">
              <span>Unidades em estoque</span>
              <strong>{resumo.qtd.toLocaleString('pt-BR')}</strong>
            </div>
            <div className="est-resumo-item">
              <span>Custo total do estoque</span>
              <strong>R$ {fmt(resumo.custo)}</strong>
            </div>
            <div className="est-resumo-item">
              <span>Valor de venda do estoque</span>
              <strong>R$ {fmt(resumo.venda)}</strong>
            </div>
          </div>

          {carregando && produtos.length === 0 ? (
            <p className="sem-resultado">Carregando produtos...</p>
          ) : produtos.length === 0 ? (
            <p className="sem-resultado">Nenhum produto encontrado com os filtros atuais.</p>
          ) : (
            <div className="tabela-wrap" style={{ maxHeight: 'calc(100vh - 340px)' }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Ação</th>
                    <th className="th-centro">Imagem</th>
                    <th>Produto</th>
                    <th className="th-centro">Estoque atual</th>
                    <th className="th-centro">Pedidos</th>
                    <th className="th-centro">Disponível</th>
                    <th className="th-direita">Custo unit.</th>
                    <th className="th-direita">Custo total</th>
                    <th className="th-direita">Venda total</th>
                    <th className="th-centro">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {produtos.map((p) => {
                    const disponivel = p.estoque - p.pedidos
                    const repor = baixo(p)
                    return (
                      <tr key={p.id} className={!p.ativo ? 'linha-cancelada' : ''}>
                        <td>
                          <div className="est-acoes">
                            <button className="btn-mini" title="Editar produto" onClick={() => onAbrirProduto?.(p.id)}>Editar</button>
                            <button className="btn-mini" title="Ajustar estoque" onClick={() => setModalMov({ tipo: 'entrada', produtoId: p.id })}>Ajustar</button>
                            <button className="btn-mini" title="Ver movimentações" onClick={() => { setProdutoMovFiltro(p.id); setAba('transacoes') }}>Mov.</button>
                          </div>
                        </td>
                        <td className="td-centro">
                          {imagens[p.id] ? (
                            <img className="est-imagem" src={`data:image/png;base64,${imagens[p.id]}`} alt={p.nome} />
                          ) : (
                            <span className="est-imagem est-imagem-placeholder" title="Sem imagem">
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="3" y="3" width="18" height="18" rx="2" />
                                <circle cx="8.5" cy="8.5" r="1.5" />
                                <path d="M21 15l-5-5L5 21" />
                              </svg>
                            </span>
                          )}
                        </td>
                        <td>
                          <strong>{p.nome}</strong>
                          <div className="est-sub">
                            {[p.codigo_barras, p.codigo_interno].filter(Boolean).join(' · ') || 'sem código'}
                            {p.categoria_nome ? ` · ${p.categoria_nome}` : ''}
                          </div>
                        </td>
                        <td className="td-centro">
                          <strong>{p.estoque} {p.unidade}</strong>
                        </td>
                        <td className="td-centro">{p.pedidos > 0 ? p.pedidos : '—'}</td>
                        <td className={`td-centro ${disponivel <= 0 ? 'est-neg' : ''}`}>
                          <strong>{disponivel} {p.unidade}</strong>
                        </td>
                        <td className="td-direita">R$ {fmt(p.preco_custo)}</td>
                        <td className="td-direita">R$ {fmt(p.estoque * p.preco_custo)}</td>
                        <td className="td-direita">R$ {fmt(p.estoque * p.preco_venda)}</td>
                        <td className="td-centro">
                          {!p.ativo ? (
                            <span className="est-val-status vencido">Inativo</span>
                          ) : p.estoque < 0 ? (
                            <span className="est-val-status vencido">Negativo</span>
                          ) : repor ? (
                            <span className="est-val-status proximo">Repor</span>
                          ) : (
                            <span className="est-val-status ok">OK</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {total > tamanhoPagina && (
            <div className="est-paginacao">
              <button className="btn-mini" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(p - 1, 0))}>← Anterior</button>
              <span>Página {pagina + 1} de {totalPaginas} ({total} produtos)</span>
              <button className="btn-mini" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)}>Próxima →</button>
            </div>
          )}
        </div>
      )}

      {aba === 'transacoes' && (
        <Movimentacoes
          usuarioId={usuarioId}
          produtoFiltro={produtoMovFiltro}
          onLimparFiltro={() => setProdutoMovFiltro(null)}
          onNova={(tipo) => setModalMov({ tipo })}
        />
      )}

      {aba === 'validade' && <Validade onAbrirProduto={onAbrirProduto} />}

      {aba === 'inventario' && <Inventario usuarioId={usuarioId} />}

      {modalMov && (
        <MovimentoModal
          usuarioId={usuarioId}
          tipoInicial={modalMov.tipo}
          produtoInicialId={modalMov.produtoId}
          onFechar={() => setModalMov(null)}
          onConcluido={(msg) => { setMensagem(msg); setProdutoMovFiltro(null); carregar() }}
        />
      )}
    </div>
  )
}