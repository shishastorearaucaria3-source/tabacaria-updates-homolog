import { useEffect, useState, useCallback, useRef } from 'react'
import { getDbApi } from '../../shared/db'

interface ProdutoPreco {
  id: number
  nome: string
  preco_custo: number
  preco_venda: number
  preco_atacado1: number
  preco_atacado2: number
  estoque: number
}

type CampoPreco = 'preco_custo' | 'preco_venda' | 'preco_atacado1' | 'preco_atacado2'

interface Alteracao {
  id: number
  tipo: string
  valor: number
  campo: string
  observacao: string | null
  criado_em: string
  qtd: number
  usuario_nome: string | null
}

interface AlteracaoItem {
  nome: string
  preco_antigo: number
  preco_novo: number
}

const CAMPOS_PRECO: { chave: CampoPreco; label: string }[] = [
  { chave: 'preco_venda', label: 'Preço de venda (Varejo)' },
  { chave: 'preco_atacado1', label: 'Preço de venda (Atacado 1)' },
  { chave: 'preco_atacado2', label: 'Preço de venda (Atacado 2)' },
  { chave: 'preco_custo', label: 'Preço de custo' }
]

const LABEL_CAMPO: Record<string, string> = {
  preco_venda: 'Varejo',
  preco_atacado1: 'Atacado 1',
  preco_atacado2: 'Atacado 2',
  preco_custo: 'Custo'
}

export default function AlterarPrecos({ usuarioId }: { usuarioId?: number }) {
  const [aba, setAba] = useState<'alterar' | 'historico'>('alterar')
  const [busca, setBusca] = useState('')
  const [selecionados, setSelecionados] = useState<ProdutoPreco[]>([])
  const [sugestoes, setSugestoes] = useState<ProdutoPreco[]>([])
  const [buscaAvancada, setBuscaAvancada] = useState(false)
  const [modo, setModo] = useState<'percentual' | 'fixo'>('percentual')
  const [campo, setCampo] = useState<CampoPreco>('preco_venda')
  const [valor, setValor] = useState('')
  const [observacao, setObservacao] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [alteracoes, setAlteracoes] = useState<Alteracao[]>([])
  const [sugestaoIdx, setSugestaoIdx] = useState(-1)
  const [sinalFixo, setSinalFixo] = useState<'mais' | 'menos'>('mais')
  const [confirmando, setConfirmando] = useState(false)
  const [verItens, setVerItens] = useState<{ id: number; numero: string; itens: AlteracaoItem[] } | null>(null)
  const buscaRef = useRef<HTMLInputElement>(null)
  const sugestaoSelRef = useRef<HTMLButtonElement | null>(null)

  const carregarSugestoes = useCallback(async () => {
    const db = getDbApi()
    if (!busca.trim()) {
      setSugestoes([])
      return
    }
    if (!buscaAvancada) {
      const termo = `%${busca}%`
      const rows = (await db.all(
        `SELECT p.id, p.nome, p.preco_custo, p.preco_venda, p.preco_atacado1, p.preco_atacado2, p.estoque
         FROM produtos p
         LEFT JOIN marcas m ON m.id = p.marca_id
         WHERE p.ativo = 1 AND (p.nome LIKE ? OR p.codigo_barras LIKE ? OR m.nome LIKE ?)
         ORDER BY p.nome
         LIMIT 30`,
        [termo, termo, termo]
      )) as unknown as ProdutoPreco[]
      setSugestoes(rows)
      return
    }
    const palavras = busca.trim().split(/\s+/).filter(Boolean)
    const condCampos = `(p.nome LIKE ? OR m.nome LIKE ? OR p.codigo_barras LIKE ? OR p.codigo_interno LIKE ?
                         OR p.codigo_extra LIKE ? OR p.descricao LIKE ? OR s.nome LIKE ? OR c.nome LIKE ? OR p.localizacao LIKE ?)`
    const condicoes = palavras.map(() => condCampos).join(' AND ')
    const params: unknown[] = []
    for (const w of palavras) {
      const like = `%${w}%`
      params.push(like, like, like, like, like, like, like, like, like)
    }
    const rows = (await db.all(
      `SELECT p.id, p.nome, p.preco_custo, p.preco_venda, p.preco_atacado1, p.preco_atacado2, p.estoque
       FROM produtos p
       LEFT JOIN marcas m ON m.id = p.marca_id
       LEFT JOIN subcategorias s ON s.id = p.subcategoria_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.ativo = 1 AND (${condicoes})
       ORDER BY p.nome
       LIMIT 30`,
      params
    )) as unknown as ProdutoPreco[]
    setSugestoes(rows)
  }, [busca, buscaAvancada])

  const carregarAlteracoes = useCallback(async () => {
    const rows = (await getDbApi().all(
      `SELECT a.*, u.nome AS usuario_nome,
              (SELECT COUNT(*) FROM alteracoes_preco_itens i WHERE i.alteracao_id = a.id) AS qtd
       FROM alteracoes_preco a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY a.id DESC LIMIT 30`
    )) as unknown as Alteracao[]
    setAlteracoes(rows)
  }, [])

  useEffect(() => {
    const t = setTimeout(carregarSugestoes, 200)
    return () => clearTimeout(t)
  }, [carregarSugestoes])

  useEffect(() => {
    carregarAlteracoes()
  }, [carregarAlteracoes])

  useEffect(() => {
    if (sugestaoIdx >= 0 && sugestaoSelRef.current) {
      sugestaoSelRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [sugestaoIdx])

  const adicionar = (p: ProdutoPreco) => {
    setSelecionados((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]))
    setSugestaoIdx(-1)
    setTimeout(() => buscaRef.current?.focus(), 0)
  }

  const remover = (id: number) => {
    setSelecionados((prev) => prev.filter((p) => p.id !== id))
  }

  const onBuscaKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSugestaoIdx((prev) => (sugestoes.length ? Math.min(prev + 1, sugestoes.length - 1) : -1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSugestaoIdx((prev) => Math.max(prev - 1, -1))
      return
    }
    if (e.key === 'Enter') {
      if (sugestoes.length > 0) {
        const alvo = sugestaoIdx >= 0 && sugestoes[sugestaoIdx] ? sugestoes[sugestaoIdx] : sugestoes[0]
        adicionar(alvo)
      }
      return
    }
    if (e.key === 'Escape') {
      setSugestaoIdx(-1)
      setBusca('')
    }
  }

  const valorAtual = (p: ProdutoPreco): number => p[campo] ?? 0

  const precoNovo = (p: ProdutoPreco, sinal?: '+' | '-'): number | null => {
    const v = Number(valor)
    if (!valor || isNaN(v)) return null
    const atual = valorAtual(p)
    if (modo === 'percentual') return Math.round(atual * (1 + v / 100) * 100) / 100
    if (sinal === '-') return Math.round(Math.max(0, atual - v) * 100) / 100
    if (sinal === '+') return Math.round((atual + v) * 100) / 100
    return v
  }

  const validarAntesDeAplicar = (): boolean => {
    if (selecionados.length === 0) {
      setMensagem('Adicione ao menos um produto na busca.')
      return false
    }
    if (!valor || isNaN(Number(valor))) {
      setMensagem('Informe o percentual ou o valor do ajuste.')
      return false
    }
    if (modo === 'fixo' && Number(valor) <= 0) {
      setMensagem('O valor do ajuste deve ser maior que zero.')
      return false
    }
    return true
  }

  const solicitarConfirmacao = () => {
    if (!validarAntesDeAplicar()) return
    setConfirmando(true)
  }

  const aplicar = async () => {
    if (!validarAntesDeAplicar()) return
    const sinal = modo === 'fixo' ? (sinalFixo === 'menos' ? '-' : '+') : undefined
    const v = Number(valor)
    const db = getDbApi()
    const res = await db.run(
      `INSERT INTO alteracoes_preco (usuario_id, tipo, valor, observacao, campo) VALUES (?, ?, ?, ?, ?)`,
      [usuarioId ?? null, modo, sinal === '-' ? -v : v, observacao.trim() || null, campo]
    )
    const alteracaoId = Number(res.lastInsertRowid)
    for (const p of selecionados) {
      const novo = precoNovo(p, sinal)
      if (novo === null) continue
      await db.run(
        `INSERT INTO alteracoes_preco_itens (alteracao_id, produto_id, preco_antigo, preco_novo, campo) VALUES (?, ?, ?, ?, ?)`,
        [alteracaoId, p.id, valorAtual(p), novo, campo]
      )
      await db.run(`UPDATE produtos SET ${campo} = ? WHERE id = ?`, [novo, p.id])
    }
    setConfirmando(false)
    setObservacao('')
    setValor('')
    setSelecionados([])
    setMensagem(`Preço atualizado em ${selecionados.length} produto(s).`)
    carregarAlteracoes()
  }

  const abrirItens = async (a: Alteracao) => {
    const rows = (await getDbApi().all(
      `SELECT i.preco_antigo, i.preco_novo, p.nome
       FROM alteracoes_preco_itens i
       JOIN produtos p ON p.id = i.produto_id
       WHERE i.alteracao_id = ?
       ORDER BY p.nome`,
      [a.id]
    )) as unknown as { preco_antigo: number; preco_novo: number; nome: string }[]
    setVerItens({ id: a.id, numero: `#${a.id}`, itens: rows.map((r) => ({ nome: r.nome, preco_antigo: r.preco_antigo, preco_novo: r.preco_novo })) })
  }

  const fmtDataHora = (dt: string) => {
    const d = new Date(dt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const renderAlterar = () => (
    <>
      {mensagem && <div className="mensagem">{mensagem}</div>}

      <div className="painel-form">
        <div className="precos-campo-selector">
          <span className="precos-campo-label">Alterar:</span>
          <div className="segmented">
            {CAMPOS_PRECO.map((c) => (
              <button key={c.chave} className={campo === c.chave ? 'ativo' : ''} onClick={() => setCampo(c.chave)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="precos-ajuste-linha">
          <div className="segmented">
            <button className={modo === 'percentual' ? 'ativo' : ''} onClick={() => setModo('percentual')}>Percentual (%)</button>
            <button className={modo === 'fixo' ? 'ativo' : ''} onClick={() => setModo('fixo')}>Preço fixo (ajuste R$)</button>
          </div>
          <input
            type="number"
            step="0.01"
            placeholder={modo === 'percentual' ? 'Ex: 10 (aumento) ou -10 (desconto)' : 'Valor do ajuste (R$)'}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
          {modo === 'fixo' && (
            <div className="precos-ajuste-botoes">
              <button
                className={`btn-ajuste-mais ${sinalFixo === 'mais' ? 'ativo' : ''}`}
                onClick={() => setSinalFixo('mais')}
                title="Selecionar aumento de preço"
              >
                + Aumentar
              </button>
              <button
                className={`btn-ajuste-menos ${sinalFixo === 'menos' ? 'ativo' : ''}`}
                onClick={() => setSinalFixo('menos')}
                title="Selecionar diminuição de preço"
              >
                - Diminuir
              </button>
            </div>
          )}
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Observação (ex: reajuste fornecedor)" />
          <button className="btn-primario" onClick={solicitarConfirmacao} disabled={selecionados.length === 0}>
            Aplicar em {selecionados.length} produto(s)
          </button>
        </div>
      </div>

      <div className="precos-busca-wrap">
        <div className="busca-pdv-caixa">
          <input
            ref={buscaRef}
            autoFocus
            className="busca-pdv"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value)
              setSugestaoIdx(-1)
            }}
            onKeyDown={onBuscaKey}
            placeholder={buscaAvancada ? 'Busca avançada: nome, marca, código, categoria, obs... (Enter adiciona)' : 'Digite para buscar produtos... (Enter adiciona)'}
          />
          <button
            className={`pdv-busca-avancada ${buscaAvancada ? 'ativo' : ''}`}
            onClick={() => {
              const novo = !buscaAvancada
              setBuscaAvancada(novo)
              setBusca('')
              setSugestaoIdx(-1)
            }}
            title={buscaAvancada ? 'Busca avançada ativa — clique para desativar' : 'Ativar busca avançada (busca em mais campos)'}
          >
            Avançada {buscaAvancada ? 'ON' : 'OFF'}
          </button>
        </div>
        {sugestoes.length > 0 && (
          <div className="pdv-sugestoes">
            {sugestoes.map((p, idx) => {
              const jaSelecionado = selecionados.some((s) => s.id === p.id)
              return (
                <button
                  key={p.id}
                  ref={idx === sugestaoIdx ? sugestaoSelRef : undefined}
                  className={`pdv-sugestao ${idx === sugestaoIdx ? 'ativo' : ''} ${jaSelecionado ? 'ja-selecionado' : ''}`}
                  onMouseEnter={() => setSugestaoIdx(idx)}
                  onClick={() => adicionar(p)}
                >
                  <span className="ps-texto">
                    <span className="ps-nome">{p.nome}</span>
                    <span className="ps-info">
                      {LABEL_CAMPO[campo]}: R$ {valorAtual(p).toFixed(2)}
                      {jaSelecionado ? ' • já adicionado ✓' : ''}
                    </span>
                    <span className="ps-estoque">Estoque: {p.estoque}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="precos-selecionados">
        {selecionados.length > 0 && (
          <>
            <div className="precos-selecionados-titulo">Produtos selecionados ({selecionados.length})</div>
            {selecionados.map((p) => {
              const novo = precoNovo(p, '+')
              return (
                <div key={p.id} className="preco-selecionado-linha">
                  <div className="preco-selecionado-info">
                    <strong>{p.nome}</strong>
                    <span>{LABEL_CAMPO[campo]} atual: R$ {valorAtual(p).toFixed(2)}</span>
                    {novo !== null && <span className="texto-verde">Novo: R$ {novo.toFixed(2)}</span>}
                    <span>Estoque: {p.estoque}</span>
                  </div>
                  <button className="btn-mini" onClick={() => remover(p.id)} title="Remover da seleção">Remover ✕</button>
                </div>
              )
            })}
          </>
        )}
      </div>
    </>
  )

  const renderHistorico = () => (
    <div className="rel-painel">
      <table className="tabela">
        <thead>
          <tr><th>Data</th><th>Quem alterou</th><th>Campo</th><th>Tipo</th><th>Valor</th><th>Produtos</th><th>Observação</th><th></th></tr>
        </thead>
        <tbody>
          {alteracoes.map((a) => (
            <tr key={a.id}>
              <td>{fmtDataHora(a.criado_em)}</td>
              <td>{a.usuario_nome ?? '-'}</td>
              <td>{LABEL_CAMPO[a.campo] ?? a.campo}</td>
              <td>{a.tipo === 'percentual' ? 'Percentual' : 'Preço fixo'}</td>
              <td>{a.tipo === 'percentual' ? `${a.valor}%` : `R$ ${a.valor.toFixed(2)}`}</td>
              <td>{a.qtd}</td>
              <td>{a.observacao ?? '-'}</td>
              <td className="td-acoes">
                <button className="btn-mini" onClick={() => abrirItens(a)}>Ver produtos</button>
              </td>
            </tr>
          ))}
          {alteracoes.length === 0 && (
            <tr><td colSpan={8} className="sem-resultado">Nenhuma alteração ainda.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2>Alteração em massa de preços</h2>
        <div className="page-acoes">
          <div className="segmented">
            <button className={aba === 'alterar' ? 'ativo' : ''} onClick={() => setAba('alterar')}>Alterar preços</button>
            <button className={aba === 'historico' ? 'ativo' : ''} onClick={() => setAba('historico')}>Histórico</button>
          </div>
        </div>
      </div>

      {aba === 'alterar' && renderAlterar()}
      {aba === 'historico' && renderHistorico()}

      {confirmando && (
        <div className="modal-overlay" onClick={() => setConfirmando(false)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Confirmar alteração de preço</h3>
            <div className="modal-resumo">
              <div className="linha"><span>Campo</span><strong>{LABEL_CAMPO[campo]}</strong></div>
              <div className="linha"><span>Tipo</span><strong>{modo === 'percentual' ? `Percentual ${valor}%` : `${sinalFixo === 'menos' ? 'Diminuição' : 'Aumento'} de R$ ${Number(valor).toFixed(2)}`}</strong></div>
              <div className="linha"><span>Produtos</span><strong>{selecionados.length}</strong></div>
              <div className="linha total-periodo"><span>Total após alteração</span><strong>—</strong></div>
            </div>
            <div className="precos-selecionados-titulo" style={{ margin: '10px 0 6px' }}>Produtos afetados:</div>
            <div className="precos-confirmar-lista">
              {selecionados.slice(0, 6).map((p) => {
                const novo = precoNovo(p, modo === 'fixo' ? (sinalFixo === 'menos' ? '-' : '+') : undefined)
                return (
                  <div key={p.id} className="preco-confirmar-item">
                    <span className="preco-confirmar-nome">{p.nome}</span>
                    <span className="preco-confirmar-precos">
                      R$ {valorAtual(p).toFixed(2)} → <strong>{novo !== null ? `R$ ${novo.toFixed(2)}` : '-'}</strong>
                    </span>
                  </div>
                )
              })}
              {selecionados.length > 6 && <div className="sem-resultado">+{selecionados.length - 6} produtos</div>}
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setConfirmando(false)}>Cancelar</button>
              <button className="btn-primario" onClick={aplicar}>✓ Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {verItens && (
        <div className="modal-overlay" onClick={() => setVerItens(null)}>
          <div className="modal modal-pagamento" onClick={(e) => e.stopPropagation()}>
            <h3>Produtos alterados — alteração {verItens.numero}</h3>
            <div className="precos-confirmar-lista">
              {verItens.itens.map((i, idx) => (
                <div key={idx} className="preco-confirmar-item">
                  <span className="preco-confirmar-nome">{i.nome}</span>
                  <span className="preco-confirmar-precos">
                    R$ {i.preco_antigo.toFixed(2)} → <strong>R$ {i.preco_novo.toFixed(2)}</strong>
                  </span>
                </div>
              ))}
              {verItens.itens.length === 0 && <p className="sem-resultado">Sem itens.</p>}
            </div>
            <div className="modal-acoes">
              <button className="btn-primario" onClick={() => setVerItens(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
