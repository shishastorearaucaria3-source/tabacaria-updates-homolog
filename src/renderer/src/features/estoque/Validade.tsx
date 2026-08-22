import { useCallback, useEffect, useState } from 'react'
import { getDbApi } from '../../shared/db'

interface ProdutoValidade {
  id: number
  nome: string
  codigo_barras: string | null
  lote: string | null
  data_validade: string | null
  data_fabricacao: string | null
  estoque: number
  estoque_minimo: number
  unidade: string
  ativo: number
}

type FiltroVal = 'vencidos' | '7d' | '30d' | '60d' | 'sem_validade' | 'todos'

const FILTROS: { id: FiltroVal; label: string }[] = [
  { id: 'vencidos', label: 'Vencidos' },
  { id: '7d', label: 'Vencendo em 7 dias' },
  { id: '30d', label: 'Vencendo em 30 dias' },
  { id: '60d', label: 'Vencendo em 60 dias' },
  { id: 'todos', label: 'Todos com validade' },
  { id: 'sem_validade', label: 'Sem data de validade' }
]

export default function Validade({ onAbrirProduto }: { onAbrirProduto?: (id: number) => void }) {
  const [filtro, setFiltro] = useState<FiltroVal>('vencidos')
  const [busca, setBusca] = useState('')
  const [produtos, setProdutos] = useState<ProdutoValidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [editar, setEditar] = useState<ProdutoValidade | null>(null)
  const [form, setForm] = useState({ data_validade: '', data_fabricacao: '', lote: '' })
  const [mensagem, setMensagem] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const conds: string[] = [`p.controla_estoque = 1`]
    const params: unknown[] = []
    if (filtro === 'vencidos') {
      conds.push(`p.data_validade IS NOT NULL AND p.data_validade <> '' AND date(p.data_validade) < date('now')`)
    } else if (filtro === '7d') {
      conds.push(`p.data_validade IS NOT NULL AND p.data_validade <> '' AND date(p.data_validade) BETWEEN date('now') AND date('now','+7 days')`)
    } else if (filtro === '30d') {
      conds.push(`p.data_validade IS NOT NULL AND p.data_validade <> '' AND date(p.data_validade) BETWEEN date('now') AND date('now','+30 days')`)
    } else if (filtro === '60d') {
      conds.push(`p.data_validade IS NOT NULL AND p.data_validade <> '' AND date(p.data_validade) BETWEEN date('now') AND date('now','+60 days')`)
    } else if (filtro === 'sem_validade') {
      conds.push(`(p.data_validade IS NULL OR p.data_validade = '')`)
    } else {
      conds.push(`p.data_validade IS NOT NULL AND p.data_validade <> ''`)
    }
    const termo = busca.trim()
    if (termo) {
      conds.push(`(p.nome LIKE ? OR p.codigo_barras LIKE ? OR p.lote LIKE ?)`)
      const like = `%${termo}%`
      params.push(like, like, like)
    }
    try {
      const rows = (await getDbApi().all(
        `SELECT p.id, p.nome, p.codigo_barras, p.lote, p.data_validade, p.data_fabricacao, p.estoque, p.estoque_minimo, p.unidade, p.ativo
         FROM produtos p WHERE ${conds.join(' AND ')} ORDER BY p.data_validade ASC, p.nome LIMIT 500`,
        params
      )) as unknown as ProdutoValidade[]
      setProdutos(rows)
    } catch {
      setProdutos([])
    } finally {
      setCarregando(false)
    }
  }, [filtro, busca])

  useEffect(() => { carregar() }, [carregar])

  const statusVal = (d: string | null) => {
    if (!d) return { cls: 'sem-validade', label: 'Sem validade' }
    const hoje = Date.now()
    const venc = new Date(d + 'T00:00:00').getTime()
    if (isNaN(venc)) return { cls: 'sem-validade', label: 'Inválida' }
    const dias = Math.ceil((venc - hoje) / 86400000)
    if (dias < 0) return { cls: 'vencido', label: `Vencido há ${Math.abs(dias)} dia(s)` }
    if (dias <= 7) return { cls: 'proximo', label: `${dias} dia(s)` }
    if (dias <= 30) return { cls: 'atencao', label: `${dias} dia(s)` }
    return { cls: 'ok', label: `${dias} dia(s)` }
  }

  const abrirEdicao = (p: ProdutoValidade) => {
    setEditar(p)
    setForm({ data_validade: p.data_validade || '', data_fabricacao: p.data_fabricacao || '', lote: p.lote || '' })
  }

  const salvar = async () => {
    if (!editar) return
    try {
      await getDbApi().run(
        `UPDATE produtos SET data_validade = ?, data_fabricacao = ?, lote = ? WHERE id = ?`,
        [form.data_validade || null, form.data_fabricacao || null, form.lote.trim() || null, editar.id]
      )
      setMensagem('Validade atualizada.')
      setEditar(null)
      carregar()
    } catch (e) {
      setMensagem(`Erro: ${(e as Error).message}`)
    }
  }

  return (
    <div className="est-abas-conteudo">
      <div className="est-toolbar">
        <div className="segmented">
          {FILTROS.map((f) => (
            <button key={f.id} className={filtro === f.id ? 'ativo' : ''} onClick={() => setFiltro(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="busca" placeholder="Buscar por nome, código ou lote..." value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {carregando ? (
        <p className="sem-resultado">Carregando...</p>
      ) : produtos.length === 0 ? (
        <p className="sem-resultado">Nenhum produto neste filtro.</p>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="th-centro">Lote</th>
                <th className="th-centro">Validade</th>
                <th className="th-centro">Fabricação</th>
                <th className="th-centro">Dias restantes</th>
                <th className="th-centro">Estoque</th>
                <th className="th-centro">Situação</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => {
                const st = statusVal(p.data_validade)
                return (
                  <tr key={p.id} className={p.ativo ? '' : 'linha-cancelada'}>
                    <td>
                      {p.nome}
                      {p.codigo_barras && <div className="est-sub">{p.codigo_barras}</div>}
                    </td>
                    <td className="td-centro">{p.lote || '—'}</td>
                    <td className="td-centro">{p.data_validade || '—'}</td>
                    <td className="td-centro">{p.data_fabricacao || '—'}</td>
                    <td className="td-centro">{p.data_validade ? (st.label === 'Sem validade' || st.label === 'Inválida' ? '—' : st.label) : '—'}</td>
                    <td className="td-centro">{p.estoque} {p.unidade}</td>
                    <td className="td-centro">
                      <span className={`est-val-status ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="td-centro">
                      <button className="btn-mini" onClick={() => abrirEdicao(p)}>Editar</button>
                      {onAbrirProduto && <button className="btn-mini" onClick={() => onAbrirProduto(p.id)}>Ver</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editar && (
        <div className="modal-overlay" onClick={() => setEditar(null)}>
          <div className="modal modal-estoque" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Controle de validade — {editar.nome}</h3>
              <button className="modal-fechar" onClick={() => setEditar(null)} aria-label="Fechar">✕</button>
            </div>
            <div className="est-mov-corpo">
              <label className="config-campo">Data de validade
                <input type="date" value={form.data_validade} onChange={(e) => setForm({ ...form, data_validade: e.target.value })} />
              </label>
              <label className="config-campo">Data de fabricação
                <input type="date" value={form.data_fabricacao} onChange={(e) => setForm({ ...form, data_fabricacao: e.target.value })} />
              </label>
              <label className="config-campo">Lote
                <input value={form.lote} onChange={(e) => setForm({ ...form, lote: e.target.value })} placeholder="Número do lote" />
              </label>
              <div className="modal-acoes">
                <button className="btn-secundario" onClick={() => setEditar(null)}>Cancelar</button>
                <button className="btn-primario" onClick={salvar}>Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}