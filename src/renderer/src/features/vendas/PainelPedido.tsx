import { useEffect, useState } from 'react'
import { getDbApi } from '../../shared/db'
import Cupom from '../../shared/Cupom'

interface Item {
  id: number
  produto_id: number | null
  nome: string
  quantidade: number
  preco: number
}

interface PedidoDetalhe {
  id: number
  numero: string
  cliente_nome: string
  cliente_telefone: string | null
  cliente_endereco: string | null
  observacoes: string | null
  subtotal: number
  taxa_entrega: number
  total: number
  status: string
  criado_em: string
  vendedor_nome?: string | null
}

export default function PainelPedido({
  pedidoId,
  onFechar,
  onEditar,
  onPagar
}: {
  pedidoId: number
  onFechar: () => void
  onEditar: (pedidoId: number) => void
  onPagar?: (pedidoId: number) => void
}) {
  const [pedido, setPedido] = useState<PedidoDetalhe | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [resumido, setResumido] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [imprimir, setImprimir] = useState(false)

  useEffect(() => {
    const carregar = async () => {
      const db = getDbApi()
      const p = (await db.get(
        `SELECT p.*, u.nome AS vendedor_nome FROM pedidos p LEFT JOIN usuarios u ON u.id = p.vendedor_id WHERE p.id = ?`,
        [pedidoId]
      )) as unknown as PedidoDetalhe | undefined
      setPedido(p ?? null)
      const rows = (await db.all(
        `SELECT id, produto_id, nome_produto, quantidade, preco_unitario FROM pedido_itens WHERE pedido_id = ? ORDER BY id`,
        [pedidoId]
      )) as unknown as { id: number; produto_id: number | null; nome_produto: string; quantidade: number; preco_unitario: number }[]
      setItens(rows.map((r) => ({ id: r.id, produto_id: r.produto_id, nome: r.nome_produto, quantidade: r.quantidade, preco: r.preco_unitario })))
    }
    carregar()
  }, [pedidoId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onFechar()
      }
      if (e.key === 'F2') {
        e.preventDefault()
        ;(onPagar ?? onEditar)(pedidoId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFechar, onEditar, onPagar, pedidoId])

  if (!pedido) return null

  const totalUnidades = itens.reduce((s, i) => s + i.quantidade, 0)
  const qtdTipos = itens.length
  const fmt = (dt: string) => {
    const d = new Date(dt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const cancelar = async () => {
    if (!confirm(`Cancelar o pedido ${pedido.numero}?`)) return
    await getDbApi().run(`UPDATE pedidos SET status = 'cancelado' WHERE id = ?`, [pedido.id])
    setMensagem(`Pedido ${pedido.numero} cancelado.`)
    setTimeout(onFechar, 400)
  }

  const editarObservacao = async () => {
    const atual = pedido.observacoes || ''
    const nova = prompt('Observação do pedido:', atual)
    if (nova === null) return
    await getDbApi().run(`UPDATE pedidos SET observacoes = ? WHERE id = ?`, [nova.trim() || null, pedido.id])
    setPedido({ ...pedido, observacoes: nova.trim() || null })
    setMensagem('Observação salva.')
  }

  const copiarTelefone = async (tel: string) => {
    let d = (tel ?? '').replace(/\D/g, '')
    if (d.startsWith('55') && d.length > 11) d = d.slice(2)
    if (!d) return
    try {
      await navigator.clipboard.writeText(d)
      setMensagem(`Telefone copiado: ${d}`)
    } catch {
      setMensagem('Não foi possível copiar.')
    }
  }

  return (
    <div className="pedido-painel-overlay">
      <div className="pedido-painel">
        <div className="pedido-painel-cab">
          <button className="pedido-painel-fechar" onClick={onFechar} title="Fechar (Esc)">✕</button>
          <div className="pedido-painel-acoes">
            <button className="pedido-painel-menu" title="Opções">•••</button>
            <button className="btn-primario" onClick={() => onEditar(pedido.id)}>Editar</button>
            <button className="btn-secundario" onClick={() => setImprimir(true)}>Imprimir</button>
          </div>
        </div>

        <div className="pedido-painel-corpo">
          <div className="pedido-painel-total-grande">R$ {pedido.total.toFixed(2)}</div>
          <div className="pedido-painel-numero">Pedido #{pedido.numero.replace(/^C-/, '')}</div>

          <div className="pedido-painel-infos">
            <div className="linha"><span>Data:</span><span>{fmt(pedido.criado_em)}</span></div>
            <div className="linha"><span>Cliente:</span><span>{pedido.cliente_nome || 'Consumidor não identificado'}</span></div>
            <div className="linha"><span>Contato:</span>
              <button className="pedido-painel-tel" onClick={() => copiarTelefone(pedido.cliente_telefone || '')} title="Clique para copiar (DDD + número)">
                {pedido.cliente_telefone || '-'} {pedido.cliente_telefone ? '⧉' : ''}
              </button>
            </div>
            <div className="linha"><span>Vendedor:</span><span>{pedido.vendedor_nome || '-'}</span></div>
            {pedido.cliente_endereco && <div className="linha"><span>Endereço:</span><span>{pedido.cliente_endereco}</span></div>}
            <div className="linha">
              <span>Observação:</span>
              <button
                className={`pedido-painel-obs-btn ${pedido.observacoes ? '' : 'pedido-painel-obs-vazio'}`}
                onClick={editarObservacao}
              >
                {pedido.observacoes || 'Adicionar observação - F6'}
              </button>
            </div>
          </div>

          <div className="pedido-painel-resumo">
            <button className="pedido-painel-resumo-titulo" onClick={() => setResumido((v) => !v)}>
              {qtdTipos} {qtdTipos === 1 ? 'item' : 'itens'} {resumido ? '▼' : '▲'}
            </button>
            <div className="linha"><span>Quantidade:</span><span>{totalUnidades}</span></div>
          </div>

          {!resumido && (
            <div className="pedido-painel-itens">
              {itens.map((i) => (
                <div key={i.id} className="pedido-painel-item">
                  <div className="pedido-painel-item-linha">
                    <span className="pedido-painel-item-nome">{i.quantidade}x {i.nome}</span>
                    <span className="pedido-painel-item-total">R$ {(i.quantidade * i.preco).toFixed(2)}</span>
                  </div>
                  <div className="pedido-painel-item-preco">Preço: R$ {i.preco.toFixed(2)}</div>
                </div>
              ))}
              {pedido.taxa_entrega > 0 && (
                <div className="pedido-painel-item">
                  <div className="pedido-painel-item-linha">
                    <span className="pedido-painel-item-nome">Entrega</span>
                    <span className="pedido-painel-item-total">R$ {pedido.taxa_entrega.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pedido-painel-total-linha">
            <span>Total:</span>
            <strong>R$ {pedido.total.toFixed(2)}</strong>
          </div>

          {mensagem && <div className="mensagem">{mensagem}</div>}
        </div>

        <div className="pedido-painel-rodape">
          <button className="pedido-painel-cancelar" onClick={cancelar}>Cancelar o pedido</button>
          <button className="pedido-painel-pagar" onClick={() => (onPagar ?? onEditar)(pedido.id)}>
            PAGAR/CONCLUIR - F2
          </button>
        </div>
      </div>

      {imprimir && (
        <Cupom
          titulo="PEDIDO"
          numero={pedido.numero}
          cliente={pedido.cliente_nome}
          data={pedido.criado_em}
          itens={itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, preco: i.preco }))}
          subtotal={pedido.subtotal}
          desconto={0}
          taxa={pedido.taxa_entrega}
          total={pedido.total}
          onFechar={() => setImprimir(false)}
        />
      )}
    </div>
  )
}
