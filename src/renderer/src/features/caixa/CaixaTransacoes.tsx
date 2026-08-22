import { useEffect, useState } from 'react'
import { getDbApi } from '../../shared/db'

interface CaixaInfo {
  id: number
  saldo_inicial: number
  total_vendas: number
  total_sangrias: number
  total_suprimentos: number
  qtd_vendas: number
  aberto_em: string
  fechado_em: string | null
  saldo_informado: number | null
  quebra: number | null
  usuario_nome: string | null
  usuario_fechamento_nome: string | null
}

interface Venda {
  id: number
  numero: string
  tipo: string
  total: number
  subtotal: number
  status: string
  created_at: string
  forma: string | null
  itens: { nome: string; qtd: number }[]
}

export default function CaixaTransacoes({ caixaId, onVoltar }: { caixaId: number; onVoltar: () => void }) {
  const [caixa, setCaixa] = useState<CaixaInfo | null>(null)
  const [vendas, setVendas] = useState<Venda[]>([])

  const carregar = async () => {
    const db = getDbApi()
    const c = (await db.get(
      `SELECT c.*, u.nome AS usuario_nome, uf.nome AS usuario_fechamento_nome
       FROM caixas c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       LEFT JOIN usuarios uf ON uf.id = c.usuario_fechamento
       WHERE c.id = ?`,
      [caixaId]
    )) as unknown as CaixaInfo | undefined
    setCaixa(c ?? null)

    const rows = (await db.all(
      `SELECT v.id, v.numero, v.tipo, v.total, v.subtotal, v.status, v.created_at,
              (SELECT p.forma FROM pagamentos p WHERE p.venda_id = v.id LIMIT 1) AS forma,
              (SELECT GROUP_CONCAT(vi.nome_produto || '|' || vi.quantidade, '~') FROM venda_itens vi WHERE vi.venda_id = v.id) AS itens_str
       FROM vendas v
       WHERE v.caixa_id = ?
       ORDER BY CAST(v.numero AS INTEGER) ASC`,
      [caixaId]
    )) as unknown as { id: number; numero: string; tipo: string; total: number; subtotal: number; status: string; created_at: string; forma: string | null; itens_str: string | null }[]
    setVendas(
      rows.map((r) => ({
        id: r.id,
        numero: r.numero,
        tipo: r.tipo,
        total: r.total,
        subtotal: r.subtotal,
        status: r.status,
        created_at: r.created_at,
        forma: r.forma,
        itens: (r.itens_str || '').split('~').filter(Boolean).map((parte) => {
          const [nome, qtd] = parte.split('|')
          return { nome: nome ?? '', qtd: Number(qtd) || 1 }
        })
      }))
    )
  }

  useEffect(() => {
    carregar()
  }, [caixaId])

  const saldoFinal = caixa ? caixa.saldo_inicial + caixa.total_vendas + caixa.total_suprimentos - caixa.total_sangrias : 0
  const fmt = (dt: string | null) => (dt ? dt.slice(0, 10).split('-').reverse().join('/') + ' ' + dt.slice(11, 16) : '-')

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Caixa #{caixaId} <span className="seta-titulo">▾</span></h2>
          {caixa && <p className="nota-config">Aberto em {fmt(caixa.aberto_em)} • Fechado em {fmt(caixa.fechado_em)}</p>}
        </div>
        <div className="page-acoes">
          <button className="btn-secundario" onClick={onVoltar}>Voltar</button>
        </div>
      </div>

      {caixa && (
        <div className="rel-painel">
          <div className="resumo-linhas">
            <div className="linha"><span>Saldo inicial</span><span>R$ {caixa.saldo_inicial.toFixed(2)}</span></div>
            <div className="linha"><span>Total de vendas</span><span>R$ {caixa.total_vendas.toFixed(2)}</span></div>
            <div className="linha"><span>Entradas (suprimentos)</span><span>R$ {caixa.total_suprimentos.toFixed(2)}</span></div>
            <div className="linha"><span>Retiradas (sangrias)</span><span>R$ {caixa.total_sangrias.toFixed(2)}</span></div>
            <div className="linha saldo-final"><span>Saldo final</span><strong>R$ {saldoFinal.toFixed(2)}</strong></div>
            {caixa.saldo_informado != null && (
              <div className="linha"><span>Saldo informado</span><span>R$ {caixa.saldo_informado.toFixed(2)}</span></div>
            )}
            {caixa.quebra != null && (
              <div className="linha"><span>Quebra de caixa</span><strong className={caixa.quebra !== 0 ? 'texto-vermelho' : ''}>R$ {caixa.quebra.toFixed(2)}</strong></div>
            )}
            <div className="linha"><span>Abriu</span><span>{caixa.usuario_nome ?? '-'}</span></div>
            <div className="linha"><span>Fechou</span><span>{caixa.usuario_fechamento_nome ?? '-'}</span></div>
          </div>
        </div>
      )}

      <div className="rel-painel">
        <h3>Transações ({vendas.length})</h3>
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr><th>Número</th><th>Tipo</th><th>Data</th><th>Pagamento</th><th>Produtos</th><th>Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {vendas.map((v) => (
                <tr key={v.id} className={v.status === 'cancelada' ? 'linha-cancelada' : ''}>
                  <td>{v.numero}</td>
                  <td>{v.tipo === 'debito' ? 'Pagamento de Débito' : 'Venda'}</td>
                  <td>{fmt(v.created_at)}</td>
                  <td>{v.forma ?? '-'}</td>
                  <td className="coluna-itens">
                    {v.itens.slice(0, 3).map((it, i) => (
                      <div key={i} className="item-linha">{it.qtd > 1 ? `${it.qtd}x ` : ''}{it.nome}</div>
                    ))}
                    {v.itens.length > 3 && <div className="item-linha">+{v.itens.length - 3} mais</div>}
                  </td>
                  <td>R$ {v.total.toFixed(2)}</td>
                  <td>{v.status === 'cancelada' ? 'Cancelada' : 'Concluída'}</td>
                </tr>
              ))}
              {vendas.length === 0 && (
                <tr><td colSpan={7} className="sem-resultado">Nenhuma transação neste caixa.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
