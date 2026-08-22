import { useEffect, useState, useCallback } from 'react'
import { getDbApi } from '../../shared/db'

interface Vendedor {
  id: number
  nome: string
  login: string
  comissao_percent: number
  ativo: number
}

interface ComissaoPeriodo {
  vendedor_id: number
  nome: string
  vendas: number
  total: number
  comissao: number
}

export default function Comissoes() {
  const [vendedores, setVendedores] = useState<Vendedor[]>([])
  const [periodo, setPeriodo] = useState<'mes' | '30d' | 'todos'>('mes')
  const [apuracao, setApuracao] = useState<ComissaoPeriodo[]>([])
  const [mensagem, setMensagem] = useState('')

  const carregar = useCallback(async () => {
    const db = getDbApi()
    const rows = (await db.all(
      `SELECT id, nome, login, comissao_percent, ativo FROM usuarios WHERE perfil = 'vendedor' OR perfil = 'admin' ORDER BY nome`
    )) as unknown as Vendedor[]
    setVendedores(rows)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    const db = getDbApi()
    let where = "v.status = 'concluida'"
    if (periodo === 'mes') where += ` AND v.created_at >= datetime('now','start of month')`
    else if (periodo === '30d') where += ` AND v.created_at >= datetime('now','-30 days')`

    db.all(
      `SELECT v.vendedor_id, u.nome, COUNT(*) vendas, COALESCE(SUM(v.total),0) total,
              COALESCE(SUM(v.total * u.comissao_percent / 100.0),0) comissao
       FROM vendas v JOIN usuarios u ON u.id = v.vendedor_id
       WHERE ${where} AND v.vendedor_id IS NOT NULL
       GROUP BY v.vendedor_id, u.nome
       ORDER BY total DESC`
    ).then((rows) => setApuracao(rows as unknown as ComissaoPeriodo[]))
  }, [periodo])

  const alterarPercentual = async (v: Vendedor) => {
    const novo = Number(prompt(`Percentual de comissão de ${v.nome} (%):`, String(v.comissao_percent)) ?? v.comissao_percent)
    if (isNaN(novo) || novo < 0) return
    await getDbApi().run(`UPDATE usuarios SET comissao_percent = ? WHERE id = ?`, [novo, v.id])
    setMensagem('Percentual atualizado.')
    carregar()
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Comissões</h2>
        <div className="page-acoes">
          <div className="segmented">
            <button className={periodo === 'mes' ? 'ativo' : ''} onClick={() => setPeriodo('mes')}>Mês atual</button>
            <button className={periodo === '30d' ? 'ativo' : ''} onClick={() => setPeriodo('30d')}>30 dias</button>
            <button className={periodo === 'todos' ? 'ativo' : ''} onClick={() => setPeriodo('todos')}>Tudo</button>
          </div>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <div className="rel-dois">
        <section className="rel-painel">
          <h3>Vendedores e comissão</h3>
          <table className="tabela">
            <thead>
              <tr><th>Nome</th><th>Login</th><th>Comissão</th><th></th></tr>
            </thead>
            <tbody>
              {vendedores.map((v) => (
                <tr key={v.id}>
                  <td>{v.nome}</td>
                  <td>{v.login}</td>
                  <td>{v.comissao_percent}%</td>
                  <td className="td-acoes">
                    <button className="btn-mini" onClick={() => alterarPercentual(v)}>Alterar %</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rel-painel">
          <h3>Apuração do período</h3>
          <table className="tabela">
            <thead>
              <tr><th>Vendedor</th><th>Vendas</th><th>Volume</th><th>Comissão</th></tr>
            </thead>
            <tbody>
              {apuracao.map((a) => (
                <tr key={a.vendedor_id}>
                  <td>{a.nome}</td>
                  <td>{a.vendas}</td>
                  <td>R$ {a.total.toFixed(2)}</td>
                  <td className="texto-verde">R$ {a.comissao.toFixed(2)}</td>
                </tr>
              ))}
              {apuracao.length === 0 && (
                <tr><td colSpan={4} className="sem-resultado">Sem vendas atribuídas no período.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}