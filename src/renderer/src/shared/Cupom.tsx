import { useEffect, useState } from 'react'
import { getDbApi } from './db'

interface Item {
  nome: string
  quantidade: number
  preco: number
}

export default function Cupom({
  titulo,
  numero,
  cliente,
  data,
  itens,
  subtotal,
  desconto,
  taxa,
  total,
  pagamentos,
  onFechar
}: {
  titulo?: string
  numero: string
  cliente?: string | null
  data?: string | null
  itens: Item[]
  subtotal: number
  desconto?: number
  taxa?: number
  total: number
  pagamentos?: { forma: string; valor: number }[]
  onFechar: () => void
}) {
  const [loja, setLoja] = useState('')
  const [rodape, setRodape] = useState('')

  useEffect(() => {
    const carregar = async () => {
      try {
        const rows = (await getDbApi().all(
          `SELECT chave, valor FROM config`
        )) as unknown as { chave: string; valor: string }[]
        const mapa: Record<string, string> = {}
        for (const r of rows) mapa[r.chave] = r.valor
        setLoja(mapa['recnomeloja'] || mapa['nome_loja'] || 'MINHA TABACARIA')
        setRodape(mapa['recrodape'] || 'Confira seu pedido no ato da entrega. Não realizamos trocas. Obrigado!')
      } catch {
        // ignore
      }
    }
    carregar()
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      window.print()
      setTimeout(onFechar, 300)
    }, 200)
    return () => clearTimeout(t)
  }, [onFechar])

  const agora = data ?? new Date().toLocaleString('pt-BR')
  const pag = pagamentos ?? []

  return (
    <div className="cupom-print">
      <div className="cupom">
        <div className="cupom-titulo">{loja || 'MINHA TABACARIA'}</div>
        <div className="cupom-linha">{titulo ?? 'CUPOM NÃO FISCAL'}</div>
        <div className="cupom-linha">Nº {numero}</div>
        <div className="cupom-linha">Data: {agora}</div>
        {cliente && <div className="cupom-linha">Cliente: {cliente}</div>}
        <div className="cupom-sep">------------------------------</div>
        {itens.map((i, idx) => (
          <div key={idx} className="cupom-item">
            <div className="cupom-item-nome">{i.quantidade} {i.nome}</div>
            <div className="cupom-item-valor">R$ {(i.quantidade * i.preco).toFixed(2)}</div>
          </div>
        ))}
        <div className="cupom-sep">------------------------------</div>
        <div className="cupom-item"><span>Subtotal</span><span>R$ {subtotal.toFixed(2)}</span></div>
        {!!desconto && <div className="cupom-item"><span>Desconto</span><span>-R$ {desconto.toFixed(2)}</span></div>}
        {!!taxa && <div className="cupom-item"><span>Entrega</span><span>R$ {taxa.toFixed(2)}</span></div>}
        {pag.length > 0 && (
          <>
            <div className="cupom-sep">------------------------------</div>
            {pag.map((p, i) => (
              <div key={i} className="cupom-item"><span>{p.forma}</span><span>R$ {p.valor.toFixed(2)}</span></div>
            ))}
          </>
        )}
        <div className="cupom-sep">------------------------------</div>
        <div className="cupom-total">TOTAL: R$ {total.toFixed(2)}</div>
        <div className="cupom-rodape">{rodape || 'Confira seu pedido no ato da entrega. Não realizamos trocas. Obrigado!'}</div>
      </div>
    </div>
  )
}
