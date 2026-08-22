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

interface PagamentoVenda {
  id: number
  forma: string
  valor: number
}

interface VendaDetalhe {
  id: number
  numero: string
  tipo: string
  subtotal: number
  desconto: number
  total: number
  status: string
  created_at: string
  cliente_nome: string | null
  cliente_telefone?: string | null
  observacoes: string | null
  vendedor_nome?: string | null
}

const limparNumero = (tel: string) => {
  let d = tel.replace(/\D/g, '')
  if (d.startsWith('55') && d.length > 11) d = d.slice(2)
  return d
}

export default function PainelVenda({
  vendaId,
  onFechar,
  onCancelar
}: {
  vendaId: number
  onFechar: () => void
  onCancelar?: (venda: VendaDetalhe) => void
}) {
  const [venda, setVenda] = useState<VendaDetalhe | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [pagamentos, setPagamentos] = useState<PagamentoVenda[]>([])
  const [resumido, setResumido] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [imprimir, setImprimir] = useState(false)
  const [editandoPgto, setEditandoPgto] = useState(false)
  const [novaForma, setNovaForma] = useState('')
  const [novoValor, setNovoValor] = useState('')
  const [formas, setFormas] = useState<{ id: number; nome: string }[]>([])

  useEffect(() => {
    const carregar = async () => {
      const db = getDbApi()
      const v = (await db.get(
        `SELECT v.*, c.nome AS cliente_nome, COALESCE(c.celular, c.telefone) AS cliente_telefone, u.nome AS vendedor_nome
         FROM vendas v
         LEFT JOIN clientes c ON c.id = v.cliente_id
         LEFT JOIN usuarios u ON u.id = v.vendedor_id
         WHERE v.id = ?`,
        [vendaId]
      )) as unknown as VendaDetalhe | undefined
      setVenda(v ?? null)
      const rows = (await db.all(
        `SELECT id, produto_id, nome_produto, quantidade, preco_unitario FROM venda_itens WHERE venda_id = ? ORDER BY id`,
        [vendaId]
      )) as unknown as { id: number; produto_id: number | null; nome_produto: string; quantidade: number; preco_unitario: number }[]
      setItens(rows.map((r) => ({ id: r.id, produto_id: r.produto_id, nome: r.nome_produto, quantidade: r.quantidade, preco: r.preco_unitario })))
      const pgs = (await db.all(
        `SELECT id, forma, valor FROM pagamentos WHERE venda_id = ? ORDER BY id`,
        [vendaId]
      )) as unknown as PagamentoVenda[]
      setPagamentos(pgs)
      const fs = (await db.all(
        `SELECT id, nome FROM formas_pagamento WHERE ativo = 1 ORDER BY id`
      )) as unknown as { id: number; nome: string }[]
      setFormas(fs)
    }
    carregar()
  }, [vendaId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onFechar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onFechar])

  if (!venda) return null

  const totalUnidades = itens.reduce((s, i) => s + i.quantidade, 0)
  const qtdTipos = itens.length
  const fmt = (dt: string) => {
    const d = new Date(dt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const copiarTelefone = async (tel: string) => {
    const num = limparNumero(tel)
    try {
      await navigator.clipboard.writeText(num)
      setMensagem(`Telefone copiado: ${num}`)
    } catch {
      setMensagem('Não foi possível copiar.')
    }
  }

  const adicionarPagamento = async () => {
    if (!novaForma || !novoValor) return
    const valor = Number(novoValor.replace(/\./g, '').replace(',', '.'))
    if (valor <= 0) return
    await getDbApi().run(
      `INSERT INTO pagamentos (venda_id, forma, valor) VALUES (?, ?, ?)`,
      [venda.id, novaForma, valor]
    )
    setNovaForma('')
    setNovoValor('')
    const pgs = (await getDbApi().all(
      `SELECT id, forma, valor FROM pagamentos WHERE venda_id = ? ORDER BY id`,
      [venda.id]
    )) as unknown as PagamentoVenda[]
    setPagamentos(pgs)
    setMensagem('Pagamento adicionado.')
  }

  const removerPagamento = async (id: number) => {
    await getDbApi().run(`DELETE FROM pagamentos WHERE id = ?`, [id])
    setPagamentos((prev) => prev.filter((p) => p.id !== id))
    setMensagem('Pagamento removido.')
  }

  return (
    <div className="pedido-painel-overlay">
      <div className="pedido-painel">
        <div className="pedido-painel-cab">
          <button className="pedido-painel-fechar" onClick={onFechar} title="Fechar (Esc)">✕</button>
          <div className="pedido-painel-acoes">
            <button className="pedido-painel-menu" title="Opções">•••</button>
            <button className="btn-primario" onClick={() => setEditandoPgto(true)}>Editar pagamento</button>
            <button className="btn-secundario" onClick={() => setImprimir(true)}>Imprimir</button>
          </div>
        </div>

        <div className="pedido-painel-corpo">
          <div className="pedido-painel-total-grande">R$ {venda.total.toFixed(2)}</div>
          <div className="pedido-painel-numero">Venda #{venda.numero}</div>

          <div className="pedido-painel-infos">
            <div className="linha"><span>Data:</span><span>{fmt(venda.created_at)}</span></div>
            <div className="linha"><span>Cliente:</span><span>{venda.cliente_nome || 'Consumidor não identificado'}</span></div>
            {venda.cliente_telefone && (
              <div className="linha">
                <span>Telefone:</span>
                <button className="pedido-painel-tel" onClick={() => copiarTelefone(venda.cliente_telefone || '')} title="Clique para copiar (DDD + número)">
                  {venda.cliente_telefone} ⧉
                </button>
              </div>
            )}
            <div className="linha">
              <span>Pagamentos:</span>
              <span>
                {pagamentos.map((p) => `${p.forma} R$ ${p.valor.toFixed(2)}`).join(' • ') || '-'}
              </span>
            </div>
            <div className="linha"><span>Vendedor:</span><span>{venda.vendedor_nome || '-'}</span></div>
            {venda.observacoes && (
              <div className="linha"><span>Observação:</span><span>{venda.observacoes}</span></div>
            )}
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
            </div>
          )}

          <div className="pedido-painel-total-linha">
            <span>Total:</span>
            <strong>R$ {venda.total.toFixed(2)}</strong>
          </div>

          {mensagem && <div className="mensagem">{mensagem}</div>}
        </div>

        <div className="pedido-painel-rodape">
          {venda.status !== 'cancelada' && onCancelar && (
            <button className="pedido-painel-cancelar" onClick={() => onCancelar(venda)}>Cancelar venda</button>
          )}
          <button className="pedido-painel-pagar" onClick={() => setEditandoPgto(true)}>
            EDITAR PAGAMENTO
          </button>
        </div>
      </div>

      {editandoPgto && (
        <div className="modal-overlay">
          <div className="modal modal-pgto-f2">
            <h3>Editar pagamento — Venda #{venda.numero}</h3>
            <div className="pgto-f2-pagos">
              {pagamentos.map((p) => (
                <div key={p.id} className="pgto-f2-pago">
                  <span>{p.forma}</span>
                  <span>R$ {p.valor.toFixed(2)}</span>
                  <button className="btn-mini" onClick={() => removerPagamento(p.id)}>x</button>
                </div>
              ))}
              {pagamentos.length === 0 && <p className="pgto-f2-sem-pgto">Nenhum pagamento.</p>}
            </div>
            <div className="pgto-f2-forma-inputs" style={{ justifyContent: 'flex-start' }}>
              <select value={novaForma} onChange={(e) => setNovaForma(e.target.value)}>
                <option value="">Forma...</option>
                {formas.map((f) => <option key={f.id} value={f.nome}>{f.nome}</option>)}
              </select>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={novoValor}
                onChange={(e) => setNovoValor(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') adicionarPagamento() }}
              />
              <button className="btn-primario" onClick={adicionarPagamento}>Adicionar</button>
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setEditandoPgto(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {imprimir && (
        <Cupom
          titulo="VENDA"
          numero={venda.numero}
          cliente={venda.cliente_nome}
          data={venda.created_at}
          itens={itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, preco: i.preco }))}
          subtotal={venda.subtotal}
          desconto={venda.desconto}
          taxa={0}
          total={venda.total}
          onFechar={() => setImprimir(false)}
        />
      )}
    </div>
  )
}
