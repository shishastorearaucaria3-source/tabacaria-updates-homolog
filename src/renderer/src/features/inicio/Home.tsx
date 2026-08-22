import { useEffect, useState } from 'react'
import { getDbApi } from '../../shared/db'

interface TelaHome {
  id: string
  label: string
  desc: string
}

export default function Home({ usuarioNome, onAbrirPdv, onNavegar }: {
  usuarioNome: string
  onAbrirPdv: () => void
  onNavegar: (tela: string) => void
}) {
  const [loja, setLoja] = useState('Minha Tabacaria')
  const [stats, setStats] = useState({ produtos: 0, vendasHoje: 0, caixaAberto: false, pedidosNovos: 0 })

  useEffect(() => {
    const db = getDbApi()
    db.get(`SELECT valor FROM config WHERE chave = 'nome_loja'`).then((row) => {
      if (row) setLoja((row as { valor: string | null }).valor ?? 'Minha Tabacaria')
    }).catch(() => {})
    db.get(`SELECT COUNT(*) AS c FROM produtos WHERE ativo = 1`).then((r) =>
      setStats((s) => ({ ...s, produtos: (r as { c: number }).c }))
    ).catch(() => {})
    db.get(`SELECT COUNT(*) AS c FROM vendas WHERE date(created_at) = date('now')`).then((r) =>
      setStats((s) => ({ ...s, vendasHoje: (r as { c: number }).c }))
    ).catch(() => {})
    db.get(`SELECT id FROM caixas WHERE aberto = 1 LIMIT 1`).then((r) =>
      setStats((s) => ({ ...s, caixaAberto: !!r }))
    ).catch(() => {})
    db.get(`SELECT COUNT(*) AS c FROM pedidos WHERE status = 'novo'`).then((r) =>
      setStats((s) => ({ ...s, pedidosNovos: (r as { c: number }).c }))
    ).catch(() => {})
  }, [])

  const modulos: TelaHome[] = [
    { id: 'caixa', label: 'Caixa', desc: 'Abertura, sangria e fechamento' },
    { id: 'produtos', label: 'Produtos', desc: 'Cadastro, fotos e preços' },
    { id: 'clientes', label: 'Clientes', desc: 'Cadastro e histórico' },
    { id: 'vendas', label: 'Vendas', desc: 'Histórico de vendas' },
    { id: 'estoque', label: 'Estoque', desc: 'Ajustes e compras' },
    { id: 'financeiro', label: 'Financeiro', desc: 'Contas a pagar/receber' },
    { id: 'relatorios', label: 'Relatórios', desc: 'Dashboard e vendas' },
    { id: 'delivery', label: 'Delivery', desc: 'Pedidos online' },
    { id: 'catalogo', label: 'Catálogo Online', desc: 'Configuração do site' },
    { id: 'comissoes', label: 'Comissões', desc: 'Vendedores e metas' },
    { id: 'precos', label: 'Alterar preços', desc: 'Remarcação em massa' },
    { id: 'formaspagamento', label: 'Formas de pagamento', desc: 'Pix, crédito, dinheiro' }
  ]

  return (
    <div className="page home">
      <div className="home-banner">
        <h2>{loja}</h2>
        <p>Bem-vindo, {usuarioNome}. Clique no PDV para atender no balcão.</p>
        <button className="btn-pdv-grande" onClick={onAbrirPdv}>
          Abrir PDV <kbd>F3</kbd>
        </button>
      </div>

      <div className="cards-grid">
        <div className="card-stat">
          <span>Produtos ativos</span>
          <strong>{stats.produtos}</strong>
        </div>
        <div className="card-stat">
          <span>Vendas hoje</span>
          <strong>{stats.vendasHoje}</strong>
        </div>
        <div className="card-stat">
          <span>Caixa</span>
          <strong className={stats.caixaAberto ? 'texto-verde' : 'texto-vermelho'}>
            {stats.caixaAberto ? 'Aberto' : 'Fechado'}
          </strong>
        </div>
        <div className="card-stat">
          <span>Pedidos novos (delivery)</span>
          <strong>{stats.pedidosNovos}</strong>
        </div>
      </div>

      <div className="home-modulos">
        {modulos.map((m) => (
          <button key={m.id} className="home-modulo" onClick={() => onNavegar(m.id)}>
            <strong>{m.label}</strong>
            <span>{m.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
