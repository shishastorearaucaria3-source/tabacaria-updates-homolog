import { useEffect, useState } from 'react'
import { getDbApi } from '../../shared/db'

interface Edicao {
  id: number
  numero: string
  cliente_nome: string
  cliente_telefone: string | null
  cliente_endereco: string | null
  observacoes: string | null
  taxa_entrega: number
  itens: { id: number; produto_id: number | null; nome: string; quantidade: number; preco: number }[]
}

interface ProdutoBusca {
  id: number
  nome: string
  preco_venda: number
}

export default function EditarPedido({ pedidoId, onFechar, onSalvo }: { pedidoId: number; onFechar: () => void; onSalvo: () => void }) {
  const [ed, setEd] = useState<Edicao | null>(null)
  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<ProdutoBusca[]>([])
  const [mensagem, setMensagem] = useState('')

  useEffect(() => {
    const carregar = async () => {
      const db = getDbApi()
      const p = (await db.get(`SELECT * FROM pedidos WHERE id = ?`, [pedidoId])) as unknown as Edicao & { subtotal: number; total: number }
      const itens = (await db.all(
        `SELECT id, produto_id, nome_produto, quantidade, preco_unitario FROM pedido_itens WHERE pedido_id = ?`,
        [pedidoId]
      )) as unknown as { id: number; produto_id: number | null; nome_produto: string; quantidade: number; preco_unitario: number }[]
      setEd({
        id: p.id,
        numero: p.numero,
        cliente_nome: p.cliente_nome,
        cliente_telefone: p.cliente_telefone,
        cliente_endereco: p.cliente_endereco,
        observacoes: p.observacoes,
        taxa_entrega: p.taxa_entrega,
        itens: itens.map((i) => ({ id: i.id, produto_id: i.produto_id, nome: i.nome_produto, quantidade: i.quantidade, preco: i.preco_unitario }))
      })
    }
    carregar()
  }, [pedidoId])

  useEffect(() => {
    if (!busca.trim()) {
      setResultados([])
      return
    }
    let cancelado = false
    getDbApi()
      .all(`SELECT id, nome, preco_venda FROM produtos WHERE ativo = 1 AND nome LIKE ? ORDER BY nome LIMIT 8`, [`%${busca}%`])
      .then((rows) => { if (!cancelado) setResultados(rows as unknown as ProdutoBusca[]) })
      .catch(() => {})
    return () => { cancelado = true }
  }, [busca])

  if (!ed) return null

  const subtotal = ed.itens.reduce((s, i) => s + i.quantidade * i.preco, 0)
  const total = subtotal + (ed.taxa_entrega || 0)

  const atualizar = (patch: Partial<Edicao>) => setEd({ ...ed, ...patch })

  const mudarQtd = (id: number, delta: number) => {
    atualizar({
      itens: ed.itens
        .map((i) => (i.id === id ? { ...i, quantidade: Math.max(0, i.quantidade + delta) } : i))
        .filter((i) => i.quantidade > 0)
    })
  }

  const removerItem = (id: number) => {
    atualizar({ itens: ed.itens.filter((i) => i.id !== id) })
  }

  const adicionarProduto = (p: ProdutoBusca) => {
    const existente = ed.itens.find((i) => i.produto_id === p.id)
    if (existente) {
      atualizar({ itens: ed.itens.map((i) => (i.id === existente.id ? { ...i, quantidade: i.quantidade + 1 } : i)) })
    } else {
      atualizar({
        itens: [
          ...ed.itens,
          { id: -Date.now() - Math.floor(Math.random() * 1000), produto_id: p.id, nome: p.nome, quantidade: 1, preco: p.preco_venda }
        ]
      })
    }
    setBusca('')
    setResultados([])
  }

  const salvar = async () => {
    if (!ed.cliente_nome.trim()) {
      setMensagem('Informe o nome do cliente.')
      return
    }
    if (ed.itens.length === 0) {
      setMensagem('Adicione ao menos um item.')
      return
    }
    const db = getDbApi()
    await db.run(
      `UPDATE pedidos SET cliente_nome = ?, cliente_telefone = ?, cliente_endereco = ?, observacoes = ?, subtotal = ?, taxa_entrega = ?, total = ? WHERE id = ?`,
      [ed.cliente_nome.trim(), ed.cliente_telefone || null, ed.cliente_endereco || null, ed.observacoes || null, subtotal, ed.taxa_entrega || 0, total, ed.id]
    )
    await db.run(`DELETE FROM pedido_itens WHERE pedido_id = ?`, [ed.id])
    for (const i of ed.itens) {
      await db.run(
        `INSERT INTO pedido_itens (pedido_id, produto_id, nome_produto, quantidade, preco_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)`,
        [ed.id, i.produto_id, i.nome, i.quantidade, i.preco, i.quantidade * i.preco]
      )
    }
    setMensagem(`Pedido ${ed.numero} atualizado.`)
    onSalvo()
    onFechar()
  }

  return (
    <div className="modal-overlay">
      <div className="modal modal-grande">
        <h3>Editar pedido {ed.numero}</h3>
        {mensagem && <div className="mensagem">{mensagem}</div>}
        <div className="form-grid">
          <label>Cliente
            <input value={ed.cliente_nome} onChange={(e) => atualizar({ cliente_nome: e.target.value })} />
          </label>
          <label>Telefone
            <input value={ed.cliente_telefone ?? ''} onChange={(e) => atualizar({ cliente_telefone: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>Endereço
            <input value={ed.cliente_endereco ?? ''} onChange={(e) => atualizar({ cliente_endereco: e.target.value })} />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>Observações
            <input value={ed.observacoes ?? ''} onChange={(e) => atualizar({ observacoes: e.target.value })} />
          </label>
          <label>Taxa de entrega (R$)
            <input type="number" step="0.1" min="0" value={ed.taxa_entrega} onChange={(e) => atualizar({ taxa_entrega: Number(e.target.value) || 0 })} />
          </label>
        </div>

        <div className="editar-pedido-busca">
          <input placeholder="Buscar produto para adicionar..." value={busca} onChange={(e) => setBusca(e.target.value)} />
          {resultados.length > 0 && (
            <div className="editar-pedido-resultados">
              {resultados.map((p) => (
                <button key={p.id} onClick={() => adicionarProduto(p)}>
                  {p.nome} — R$ {p.preco_venda.toFixed(2)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="editar-pedido-itens">
          {ed.itens.map((i) => (
            <div key={i.id} className="editar-pedido-item">
              <span className="editar-pedido-nome">{i.nome}</span>
              <div className="editar-pedido-qtd">
                <button onClick={() => mudarQtd(i.id, -1)}>−</button>
                <span>{i.quantidade}</span>
                <button onClick={() => mudarQtd(i.id, 1)}>+</button>
              </div>
              <span>R$ {(i.quantidade * i.preco).toFixed(2)}</span>
              <button className="btn-mini" onClick={() => removerItem(i.id)}>Remover</button>
            </div>
          ))}
        </div>

        <div className="modal-resumo">
          <div className="linha"><span>Subtotal</span><strong>R$ {subtotal.toFixed(2)}</strong></div>
          <div className="linha"><span>Entrega</span><strong>R$ {(ed.taxa_entrega || 0).toFixed(2)}</strong></div>
          <div className="linha total-periodo"><span>Total</span><strong>R$ {total.toFixed(2)}</strong></div>
        </div>

        <div className="modal-acoes">
          <button className="btn-secundario" onClick={onFechar}>Cancelar</button>
          <button className="btn-primario" onClick={salvar}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
