import { useCallback, useEffect, useState } from 'react'
import { getDbApi, getEstoqueApi } from '../../shared/db'

interface Inventario {
  id: number
  numero: string
  status: string
  observacao: string | null
  total_itens: number
  total_conferidos: number
  total_divergencias: number
  criado_em: string
  finalizado_em: string | null
  usuario_nome: string | null
}

interface ItemContagem {
  id: number
  produto_id: number
  nome: string
  unidade: string
  estoque_sistema: number
  quantidade_fisica: number | null
  diferenca: number
  conferido: number
}

type EscopoInv = 'todos' | 'com_estoque' | 'baixo'

export default function Inventario({ usuarioId }: { usuarioId: number }) {
  const [lista, setLista] = useState<Inventario[]>([])
  const [carregando, setCarregando] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')

  const [criando, setCriando] = useState(false)
  const [escopo, setEscopo] = useState<EscopoInv>('todos')
  const [categoriaSel, setCategoriaSel] = useState('')
  const [categorias, setCategorias] = useState<{ id: number; nome: string }[]>([])
  const [buscaNovo, setBuscaNovo] = useState('')
  const [qtdSelecao, setQtdSelecao] = useState<number | null>(null)
  const [obs, setObs] = useState('')
  const [abrindo, setAbrindo] = useState(false)

  const [contagem, setContagem] = useState<Inventario | null>(null)
  const [itens, setItens] = useState<ItemContagem[]>([])
  const [buscaContagem, setBuscaContagem] = useState('')
  const [filtroConf, setFiltroConf] = useState<'todos' | 'nao' | 'div'>('todos')
  const [carregandoItens, setCarregandoItens] = useState(false)
  const [paginaItens, setPaginaItens] = useState(0)
  const [temMais, setTemMais] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [confirmarFinal, setConfirmarFinal] = useState(false)
  const [resumo, setResumo] = useState<{ numero: string; divergencias: number; ajustados: number; conferidos: number } | null>(null)

  const [detalhe, setDetalhe] = useState<Inventario | null>(null)
  const [detalheItens, setDetalheItens] = useState<ItemContagem[]>([])
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false)

  const POR_PAGINA = 300

  const carregarLista = useCallback(async () => {
    setCarregando(true)
    try {
      const rows = (await getDbApi().all(
        `SELECT i.id, i.numero, i.status, i.observacao, i.total_itens, i.total_conferidos, i.total_divergencias, i.criado_em, i.finalizado_em, u.nome AS usuario_nome
         FROM inventarios i LEFT JOIN usuarios u ON u.id = i.usuario_id
         ORDER BY i.id DESC LIMIT 100`
      )) as unknown as Inventario[]
      setLista(rows)
    } catch {
      setLista([])
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregarLista() }, [carregarLista])

  useEffect(() => {
    getDbApi().all('SELECT id, nome FROM categorias ORDER BY nome').then((rows) => {
      setCategorias(rows as unknown as { id: number; nome: string }[])
    }).catch(() => {})
  }, [])

  const calcularSelecao = useCallback(async () => {
    const conds: string[] = [`p.controla_estoque = 1`, `p.ativo = 1`]
    const params: unknown[] = []
    if (escopo === 'com_estoque') conds.push(`p.estoque > 0`)
    if (escopo === 'baixo') conds.push(`p.estoque <= p.estoque_minimo`)
    if (categoriaSel) { conds.push(`p.categoria_id = ?`); params.push(Number(categoriaSel)) }
    const termo = buscaNovo.trim()
    if (termo) {
      conds.push(`(p.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?)`)
      const like = `%${termo}%`
      params.push(like, like, like)
    }
    try {
      const row = (await getDbApi().get(`SELECT COUNT(*) AS c FROM produtos p WHERE ${conds.join(' AND ')}`, params)) as { c: number }
      setQtdSelecao(row.c)
    } catch {
      setQtdSelecao(0)
    }
  }, [escopo, categoriaSel, buscaNovo])

  useEffect(() => {
    if (!criando) return
    const t = setTimeout(() => calcularSelecao(), 250)
    return () => clearTimeout(t)
  }, [criando, calcularSelecao])

  const criar = async () => {
    if (qtdSelecao == null || qtdSelecao === 0) {
      setErro('Nenhum produto corresponde ao escopo selecionado.')
      return
    }
    const conds: string[] = [`p.controla_estoque = 1`, `p.ativo = 1`]
    const params: unknown[] = []
    if (escopo === 'com_estoque') conds.push(`p.estoque > 0`)
    if (escopo === 'baixo') conds.push(`p.estoque <= p.estoque_minimo`)
    if (categoriaSel) { conds.push(`p.categoria_id = ?`); params.push(Number(categoriaSel)) }
    const termo = buscaNovo.trim()
    if (termo) {
      conds.push(`(p.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?)`)
      const like = `%${termo}%`
      params.push(like, like, like)
    }
    setAbrindo(true)
    setErro('')
    try {
      const ids = (await getDbApi().all(`SELECT id FROM produtos p WHERE ${conds.join(' AND ')} LIMIT 10000`, params)) as unknown as { id: number }[]
      const r = await getEstoqueApi().inventarioAbrir({ produtos: ids.map((x) => x.id), usuario_id: usuarioId, observacao: obs.trim() || null })
      if (!r.ok) {
        setErro(r.erro || 'Falha ao criar inventário.')
        setAbrindo(false)
        return
      }
      setCriando(false)
      setObs('')
      setResumo(null)
      setContagem({ id: r.inventario_id, numero: r.numero, status: 'aberto', observacao: obs.trim() || null, total_itens: r.itens, total_conferidos: 0, total_divergencias: 0, criado_em: '', finalizado_em: null, usuario_nome: null })
      carregarLista()
    } catch (e) {
      setErro(`Erro: ${(e as Error).message}`)
    } finally {
      setAbrindo(false)
    }
  }

  const carregarItens = useCallback(async () => {
    if (!contagem) return
    setCarregandoItens(true)
    const conds: string[] = [`ii.inventario_id = ?`]
    const params: unknown[] = [contagem.id]
    const termo = buscaContagem.trim()
    if (termo) {
      conds.push(`p.nome LIKE ?`)
      params.push(`%${termo}%`)
    }
    if (filtroConf === 'nao') conds.push(`ii.conferido = 0`)
    if (filtroConf === 'div') conds.push(`ABS(ii.diferenca) > 0.0001`)
    try {
      const total = (await getDbApi().get(
        `SELECT COUNT(*) AS c FROM inventario_itens ii JOIN produtos p ON p.id = ii.produto_id WHERE ${conds.join(' AND ')}`,
        params
      )) as { c: number }
      const pagina = paginaItens
      const rows = (await getDbApi().all(
        `SELECT ii.id, ii.produto_id, p.nome, p.unidade, ii.estoque_sistema, ii.quantidade_fisica, ii.diferenca, ii.conferido
         FROM inventario_itens ii JOIN produtos p ON p.id = ii.produto_id
         WHERE ${conds.join(' AND ')} ORDER BY p.nome LIMIT ? OFFSET ?`,
        [...params, POR_PAGINA, pagina * POR_PAGINA]
      )) as unknown as ItemContagem[]
      setItens(rows)
      setTemMais((pagina + 1) * POR_PAGINA < total.c)
    } catch {
      setItens([])
    } finally {
      setCarregandoItens(false)
    }
  }, [contagem, buscaContagem, filtroConf, paginaItens])

  useEffect(() => { carregarItens() }, [carregarItens])

  const atualizarItem = async (item: ItemContagem, quantidade_fisica: number | null) => {
    setItens((prev) => prev.map((x) => x.id === item.id ? { ...x, quantidade_fisica, conferido: quantidade_fisica != null ? 1 : x.conferido, diferenca: quantidade_fisica != null ? quantidade_fisica - x.estoque_sistema : x.diferenca } : x))
    try {
      await getDbApi().run(
        `UPDATE inventario_itens SET quantidade_fisica = ?, conferido = ?, diferenca = ? WHERE id = ?`,
        [quantidade_fisica, quantidade_fisica != null ? 1 : 0, quantidade_fisica != null ? quantidade_fisica - item.estoque_sistema : 0, item.id]
      )
    } catch { /* offline — mantém local */ }
  }

  const [naoConferidosTotal, setNaoConferidosTotal] = useState<number | null>(null)

  useEffect(() => {
    if (!confirmarFinal || !contagem) return
    getDbApi().get(`SELECT COUNT(*) AS c FROM inventario_itens WHERE inventario_id = ? AND conferido = 0`, [contagem.id])
      .then((r) => setNaoConferidosTotal((r as { c: number }).c))
      .catch(() => setNaoConferidosTotal(0))
  }, [confirmarFinal, contagem])

  const finalizar = async () => {
    if (!contagem) return
    setFinalizando(true)
    setErro('')
    try {
      const r = await getEstoqueApi().inventarioFinalizar({ inventario_id: contagem.id, usuario_id: usuarioId })
      if (!r.ok) {
        setErro(r.erro || 'Falha ao finalizar inventário.')
        setFinalizando(false)
        return
      }
      setResumo({ numero: r.numero, divergencias: r.divergencias, ajustados: r.ajustados, conferidos: r.conferidos })
      setContagem(null)
      setConfirmarFinal(false)
      carregarLista()
    } catch (e) {
      setErro(`Erro: ${(e as Error).message}`)
    } finally {
      setFinalizando(false)
    }
  }

  const cancelar = async () => {
    if (!contagem) return
    if (!confirm(`Cancelar o inventário ${contagem.numero}? Nenhum ajuste será aplicado.`)) return
    try {
      await getEstoqueApi().inventarioCancelar({ inventario_id: contagem.id })
      setContagem(null)
      setMensagem('Inventário cancelado.')
      carregarLista()
    } catch (e) {
      setErro(`Erro: ${(e as Error).message}`)
    }
  }

  const abrirDetalhe = async (inv: Inventario) => {
    setDetalhe(inv)
    setDetalheItens([])
    setCarregandoDetalhe(true)
    try {
      const rows = (await getDbApi().all(
        `SELECT ii.id, ii.produto_id, p.nome, p.unidade, ii.estoque_sistema, ii.quantidade_fisica, ii.diferenca, ii.conferido
         FROM inventario_itens ii JOIN produtos p ON p.id = ii.produto_id
         WHERE ii.inventario_id = ? ORDER BY p.nome LIMIT 1000`,
        [inv.id]
      )) as unknown as ItemContagem[]
      setDetalheItens(rows)
    } catch {
      setDetalheItens([])
    } finally {
      setCarregandoDetalhe(false)
    }
  }

  const fmtDataHora = (dt: string | null) => {
    if (!dt) return '—'
    const d = new Date(dt)
    if (isNaN(d.getTime())) return dt
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  if (contagem) {
    return (
      <div className="est-abas-conteudo">
        <div className="inv-topo">
          <div>
            <h3>Inventário {contagem.numero}</h3>
            <div className="inv-sub">Conferindo estoque registrado × estoque físico</div>
          </div>
          <div className="est-toolbar-acoes">
            <button className="btn-secundario" onClick={cancelar}>Cancelar inventário</button>
            {!confirmarFinal ? (
              <button className="btn-primario" onClick={() => setConfirmarFinal(true)}>
                Finalizar inventário
              </button>
            ) : (
              <button className="btn-primario btn-perigo" onClick={finalizar} disabled={finalizando}>
                {finalizando ? 'Finalizando...' : 'Confirmar finalizar'}
              </button>
            )}
          </div>
        </div>

        {confirmarFinal && (
          <div className="mensagem">
            <strong>Confirmação:</strong> ao finalizar, os produtos conferidos terão o estoque ajustado para a contagem física.
            {naoConferidosTotal != null && naoConferidosTotal > 0 && ` ${naoConferidosTotal} item(ns) não conferido(s) NÃO serão alterados.`}
          </div>
        )}

        {erro && <div className="mensagem" style={{ color: '#dc2626' }}>{erro}</div>}

        <div className="est-toolbar">
          <input className="busca" placeholder="Buscar produto..." value={buscaContagem} onChange={(e) => { setBuscaContagem(e.target.value); setPaginaItens(0) }} />
          <div className="segmented">
            <button className={filtroConf === 'todos' ? 'ativo' : ''} onClick={() => { setFiltroConf('todos'); setPaginaItens(0) }}>Todos</button>
            <button className={filtroConf === 'nao' ? 'ativo' : ''} onClick={() => { setFiltroConf('nao'); setPaginaItens(0) }}>Não conferidos</button>
            <button className={filtroConf === 'div' ? 'ativo' : ''} onClick={() => { setFiltroConf('div'); setPaginaItens(0) }}>Divergências</button>
          </div>
        </div>

        {carregandoItens ? (
          <p className="sem-resultado">Carregando itens...</p>
        ) : itens.length === 0 ? (
          <p className="sem-resultado">Nenhum item nesta visualização.</p>
        ) : (
          <div className="tabela-wrap" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="th-centro">Estoque no sistema</th>
                  <th className="th-centro">Quantidade física</th>
                  <th className="th-centro">Diferença</th>
                  <th className="th-centro">Status</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.id} className={i.diferenca !== 0 ? 'est-divergencia' : ''}>
                    <td>{i.nome}</td>
                    <td className="td-centro">{i.estoque_sistema} {i.unidade}</td>
                    <td className="td-centro">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        style={{ width: 90 }}
                        value={i.quantidade_fisica ?? ''}
                        placeholder="—"
                        onChange={(e) => atualizarItem(i, e.target.value === '' ? null : Number(e.target.value))}
                      />
                    </td>
                    <td className={`td-centro ${i.diferenca < 0 ? 'est-neg' : i.diferenca > 0 ? 'est-pos' : ''}`}>
                      {i.conferido ? (i.diferenca > 0 ? `+${i.diferenca}` : i.diferenca) : '—'}
                    </td>
                    <td className="td-centro">
                      {i.conferido ? <span className="est-val-status ok">Conferido</span> : <span className="est-val-status sem-validade">Pendente</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {temMais && (
          <div className="cat-carregar-mais">
            <button className="btn-primario" onClick={() => setPaginaItens((p) => p + 1)}>Carregar mais</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="est-abas-conteudo">
      {resumo && (
        <div className="mensagem">
          Inventário <strong>{resumo.numero}</strong> finalizado: {resumo.conferidos} conferido(s), {resumo.divergencias} divergência(s), {resumo.ajustados} ajuste(s) aplicado(s) ao estoque.
        </div>
      )}
      {mensagem && <div className="mensagem">{mensagem}</div>}
      {erro && <div className="mensagem" style={{ color: '#dc2626' }}>{erro}</div>}

      <div className="est-toolbar">
        <h3>Inventários</h3>
        <div className="est-toolbar-acoes">
          <button className="btn-primario" onClick={() => { setCriando(true); setErro(''); setQtdSelecao(null); setEscopo('todos'); setCategoriaSel(''); setBuscaNovo(''); setObs('') }}>+ Novo inventário</button>
        </div>
      </div>

      {carregando ? (
        <p className="sem-resultado">Carregando...</p>
      ) : lista.length === 0 ? (
        <p className="sem-resultado">Nenhum inventário realizado ainda.</p>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Número</th>
                <th>Data</th>
                <th className="th-centro">Itens</th>
                <th className="th-centro">Conferidos</th>
                <th className="th-centro">Divergências</th>
                <th>Funcionário</th>
                <th className="th-centro">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.numero}</td>
                  <td>{fmtDataHora(inv.criado_em)}</td>
                  <td className="td-centro">{inv.total_itens}</td>
                  <td className="td-centro">{inv.total_conferidos}</td>
                  <td className="td-centro">{inv.total_divergencias}</td>
                  <td>{inv.usuario_nome || '—'}</td>
                  <td className="td-centro">
                    <span className={`est-val-status ${inv.status === 'finalizado' ? 'ok' : inv.status === 'cancelado' ? 'vencido' : 'atencao'}`}>
                      {inv.status === 'finalizado' ? 'Finalizado' : inv.status === 'cancelado' ? 'Cancelado' : 'Aberto'}
                    </span>
                  </td>
                  <td className="td-centro">
                    <button className="btn-mini" onClick={() => abrirDetalhe(inv)}>Ver</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {criando && (
        <div className="modal-overlay" onClick={() => !abrindo && setCriando(false)}>
          <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Novo inventário</h3>
              <button className="modal-fechar" onClick={() => setCriando(false)} aria-label="Fechar">✕</button>
            </div>
            <div className="est-mov-corpo">
              <label className="config-campo">Escopo dos produtos
                <select value={escopo} onChange={(e) => setEscopo(e.target.value as EscopoInv)}>
                  <option value="todos">Todos os produtos ativos</option>
                  <option value="com_estoque">Somente com estoque</option>
                  <option value="baixo">Somente estoque baixo (≤ mínimo)</option>
                </select>
              </label>
              <div className="est-mov-cabecalho">
                <label className="config-campo">Categoria (opcional)
                  <select value={categoriaSel} onChange={(e) => setCategoriaSel(e.target.value)}>
                    <option value="">Todas</option>
                    {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </label>
                <label className="config-campo">Buscar produto
                  <input className="busca" placeholder="Nome ou código..." value={buscaNovo} onChange={(e) => setBuscaNovo(e.target.value)} />
                </label>
              </div>
              <label className="config-campo">Observação (opcional)
                <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo / descrição do inventário" />
              </label>
              <p className="nota-config">
                {qtdSelecao == null ? 'Calculando produtos...' : `${qtdSelecao} produto(s) serão incluídos na contagem.`}
              </p>
              <div className="modal-acoes">
                <button className="btn-secundario" onClick={() => setCriando(false)} disabled={abrindo}>Cancelar</button>
                <button className="btn-primario" onClick={criar} disabled={abrindo || !qtdSelecao}>
                  {abrindo ? 'Criando...' : 'Criar inventário'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detalhe && (
        <div className="modal-overlay" onClick={() => setDetalhe(null)}>
          <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Inventário {detalhe.numero}</h3>
              <button className="modal-fechar" onClick={() => setDetalhe(null)} aria-label="Fechar">✕</button>
            </div>
            <div className="est-detalhe-meta">
              <div className="linha"><span>Data</span><strong>{fmtDataHora(detalhe.criado_em)}</strong></div>
              <div className="linha"><span>Finalizado</span><strong>{fmtDataHora(detalhe.finalizado_em)}</strong></div>
              <div className="linha"><span>Status</span><strong>{detalhe.status}</strong></div>
              <div className="linha"><span>Itens</span><strong>{detalhe.total_itens} (conferidos: {detalhe.total_conferidos})</strong></div>
              <div className="linha"><span>Divergências</span><strong>{detalhe.total_divergencias}</strong></div>
              {detalhe.observacao && <div className="linha"><span>Observação</span><strong>{detalhe.observacao}</strong></div>}
            </div>
            {carregandoDetalhe ? (
              <p className="sem-resultado">Carregando...</p>
            ) : (
              <div className="tabela-wrap" style={{ maxHeight: 300 }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="th-centro">Sistema</th>
                      <th className="th-centro">Físico</th>
                      <th className="th-centro">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalheItens.map((i) => (
                      <tr key={i.id} className={i.diferenca !== 0 ? 'est-divergencia' : ''}>
                        <td>{i.nome}</td>
                        <td className="td-centro">{i.estoque_sistema} {i.unidade}</td>
                        <td className="td-centro">{i.quantidade_fisica != null ? `${i.quantidade_fisica} ${i.unidade}` : '—'}</td>
                        <td className="td-centro">{i.conferido ? (i.diferenca > 0 ? `+${i.diferenca}` : i.diferenca) : '—'}</td>
                      </tr>
                    ))}
                    {detalheItens.length === 0 && <tr><td colSpan={4} className="sem-resultado">Sem itens.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setDetalhe(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}