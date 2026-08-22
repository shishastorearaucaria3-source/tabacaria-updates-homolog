import { useEffect, useState, useCallback } from 'react'
import { getDbApi } from '../../shared/db'

interface Fornecedor {
  id: number
  nome: string
  cnpj: string | null
  cpf: string | null
  telefone: string | null
  celular: string | null
  email: string | null
  endereco: string | null
  pessoa_fisica: number
  nao_contribuinte_icms: number
  ie: string | null
  isento_ie: number
  regime_especial_icms: number
  observacoes: string | null
  ativo: number
}

type AbaFornecedor = 'cadastro' | 'transacoes' | 'produtos'

const vazio = {
  id: 0,
  nome: '',
  cnpj: '',
  cpf: '',
  telefone: '',
  celular: '',
  email: '',
  endereco: '',
  pessoa_fisica: false,
  nao_contribuinte_icms: false,
  ie: '',
  isento_ie: false,
  regime_especial_icms: false,
  observacoes: '',
  ativo: true
}

function mascaraTelefone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (_, a, b, c) => `(${a}) ${b}${c ? '-' + c : ''}`)
  }
  return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
}

function mascaraCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

export default function Fornecedores({ onConcluido }: { onConcluido?: () => void }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [busca, setBusca] = useState('')
  const [filtroAtivo, setFiltroAtivo] = useState<'todos' | 'ativos' | 'inativos'>('ativos')
  const [form, setForm] = useState({ ...vazio })
  const [formAberto, setFormAberto] = useState(false)
  const [aba, setAba] = useState<AbaFornecedor>('cadastro')
  const [mensagem, setMensagem] = useState('')
  const [transacoes, setTransacoes] = useState<{ criado_em: string; numero: string; total: number }[]>([])
  const [produtosRel, setProdutosRel] = useState<{ nome: string; preco_venda: number; estoque: number }[]>([])

  const carregar = useCallback(async () => {
    const rows = (await getDbApi().all(
      `SELECT * FROM fornecedores
       WHERE (nome LIKE ? OR cnpj LIKE ? OR cpf LIKE ? OR telefone LIKE ? OR ? = '')
         AND (? = 'todos' OR (CASE WHEN ? = 'ativos' THEN ativo = 1 ELSE ativo = 0 END))
       ORDER BY nome`,
      [`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`, busca, filtroAtivo, filtroAtivo]
    )) as unknown as Fornecedor[]
    setFornecedores(rows)
  }, [busca, filtroAtivo])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    if (formAberto) {
      setAba('cadastro')
      setTimeout(() => {
        const el = document.getElementById('forn-nome')
        el?.focus()
      }, 50)
    }
  }, [formAberto])

  useEffect(() => {
    if (!formAberto || aba !== 'transacoes' || !form.id) return
    getDbApi().all(
      `SELECT c.criado_em, c.numero, c.total FROM compras c WHERE c.fornecedor_id = ? ORDER BY c.id DESC LIMIT 50`,
      [form.id]
    ).then((rows) => setTransacoes(rows as unknown as { criado_em: string; numero: string; total: number }[])).catch(() => setTransacoes([]))
  }, [aba, formAberto, form.id])

  useEffect(() => {
    if (!formAberto || aba !== 'produtos' || !form.id) return
    getDbApi().all(
      `SELECT nome, preco_venda, estoque FROM produtos WHERE fornecedor_id = ? ORDER BY nome`,
      [form.id]
    ).then((rows) => setProdutosRel(rows as unknown as { nome: string; preco_venda: number; estoque: number }[])).catch(() => setProdutosRel([]))
  }, [aba, formAberto, form.id])

  const abrirNovo = () => {
    setForm({ ...vazio })
    setFormAberto(true)
    setMensagem('')
  }

  const abrirEdicao = (f: Fornecedor) => {
    setForm({
      id: f.id,
      nome: f.nome,
      cnpj: f.cnpj ?? '',
      cpf: f.cpf ?? '',
      telefone: f.telefone ?? '',
      celular: f.celular ?? '',
      email: f.email ?? '',
      endereco: f.endereco ?? '',
      pessoa_fisica: !!f.pessoa_fisica,
      nao_contribuinte_icms: !!f.nao_contribuinte_icms,
      ie: f.ie ?? '',
      isento_ie: !!f.isento_ie,
      regime_especial_icms: !!f.regime_especial_icms,
      observacoes: f.observacoes ?? '',
      ativo: !!f.ativo
    })
    setFormAberto(true)
    setMensagem('')
  }

  const salvar = async () => {
    if (!form.nome.trim()) {
      setMensagem('Informe o nome / razão social.')
      document.getElementById('forn-nome')?.focus()
      return
    }
    const db = getDbApi()
    const doc = form.pessoa_fisica ? form.cpf : form.cnpj
    if (form.id) {
      await db.run(
        `UPDATE fornecedores SET nome=?, cnpj=?, cpf=?, telefone=?, celular=?, email=?, endereco=?,
         pessoa_fisica=?, nao_contribuinte_icms=?, ie=?, isento_ie=?, regime_especial_icms=?, observacoes=?, ativo=?
         WHERE id=?`,
        [form.nome.trim(), form.pessoa_fisica ? null : (doc || null), form.pessoa_fisica ? (doc || null) : null,
         form.telefone || null, form.celular || null, form.email || null, form.endereco || null,
         form.pessoa_fisica ? 1 : 0, form.nao_contribuinte_icms ? 1 : 0, form.ie || null,
         form.isento_ie ? 1 : 0, form.regime_especial_icms ? 1 : 0, form.observacoes || null, form.ativo ? 1 : 0,
         form.id]
      )
    } else {
      await db.run(
        `INSERT INTO fornecedores (nome, cnpj, cpf, telefone, celular, email, endereco, pessoa_fisica,
         nao_contribuinte_icms, ie, isento_ie, regime_especial_icms, observacoes, ativo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [form.nome.trim(), form.pessoa_fisica ? null : (doc || null), form.pessoa_fisica ? (doc || null) : null,
         form.telefone || null, form.celular || null, form.email || null, form.endereco || null,
         form.pessoa_fisica ? 1 : 0, form.nao_contribuinte_icms ? 1 : 0, form.ie || null,
         form.isento_ie ? 1 : 0, form.regime_especial_icms ? 1 : 0, form.observacoes || null, 1]
      )
    }
    setFormAberto(false)
    setMensagem(form.id ? 'Fornecedor atualizado!' : 'Fornecedor cadastrado!')
    carregar()
    onConcluido?.()
  }

  const inativarFornecedor = async () => {
    if (!form.id) return
    await getDbApi().run(`UPDATE fornecedores SET ativo = ? WHERE id = ?`, [form.ativo ? 0 : 1, form.id])
    setMensagem(form.ativo ? 'Fornecedor inativado.' : 'Fornecedor reativado.')
    setFormAberto(false)
    carregar()
  }

  const excluirFornecedor = async () => {
    if (!form.id) return
    if (!confirm(`Excluir o fornecedor "${form.nome}"? Esta ação não pode ser desfeita.`)) return
    await getDbApi().run(`DELETE FROM fornecedores WHERE id = ?`, [form.id])
    setMensagem('Fornecedor excluído.')
    setFormAberto(false)
    carregar()
  }

  const salvarF2 = () => {
    if (formAberto) salvar()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!formAberto) return
      if (e.key === 'F2') {
        e.preventDefault()
        salvarF2()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setFormAberto(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [formAberto, form])

  const docLabel = form.pessoa_fisica ? 'CPF' : 'CNPJ'
  const docValue = form.pessoa_fisica ? form.cpf : form.cnpj

  const renderCadastro = () => (
    <div className="form-grid form-grid-fornecedor">
      <label style={{ gridColumn: '1 / -1' }}>Nome / Razão Social
        <div className="forn-nome-linha">
          <input id="forn-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
          <label className="check-inline">
            <input type="checkbox" checked={form.pessoa_fisica} onChange={(e) => setForm({ ...form, pessoa_fisica: e.target.checked, isento_ie: form.isento_ie, regime_especial_icms: form.regime_especial_icms })} />
            Pessoa Física
          </label>
        </div>
      </label>

      <label>Telefone
        <input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: mascaraTelefone(e.target.value) })} placeholder="(00) 0000-0000" />
      </label>
      <label>Celular
        <input value={form.celular} onChange={(e) => setForm({ ...form, celular: mascaraTelefone(e.target.value) })} placeholder="(00) 00000-0000" />
      </label>

      <label>{docLabel}
        <div className="forn-nome-linha">
          <input
            value={docValue}
            onChange={(e) => {
              const raw = e.target.value
              const valor = form.pessoa_fisica ? mascaraCpf(raw) : mascaraCnpj(raw)
              setForm({ ...form, [form.pessoa_fisica ? 'cpf' : 'cnpj']: valor })
            }}
            placeholder={form.pessoa_fisica ? '000.000.000-00' : '00.000.000/0000-00'}
          />
          <label className="check-inline">
            <input type="checkbox" checked={form.nao_contribuinte_icms} onChange={(e) => setForm({ ...form, nao_contribuinte_icms: e.target.checked })} />
            Não é contribuinte de ICMS
          </label>
        </div>
      </label>

      <label style={{ gridColumn: '1 / -1' }}>I.E. (Inscrição Estadual)
        <div className="forn-ie-linha">
          <input value={form.ie} disabled={form.pessoa_fisica} onChange={(e) => setForm({ ...form, ie: e.target.value })} placeholder="Inscrição estadual" />
          <label className="check-inline">
            <input type="checkbox" checked={form.isento_ie} disabled={form.pessoa_fisica} onChange={(e) => setForm({ ...form, isento_ie: e.target.checked })} />
            Isento de IE
          </label>
          <label className="check-inline">
            <input type="checkbox" checked={form.regime_especial_icms} disabled={form.pessoa_fisica} onChange={(e) => setForm({ ...form, regime_especial_icms: e.target.checked })} />
            Regime especial de ICMS
          </label>
        </div>
      </label>

      <label style={{ gridColumn: '1 / -1' }}>Endereço
        <textarea rows={2} value={form.endereco} onChange={(e) => setForm({ ...form, endereco: e.target.value })} />
      </label>

      <label style={{ gridColumn: '1 / -1' }}>E-mail
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>

      <label style={{ gridColumn: '1 / -1' }}>Observações
        <textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
      </label>
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2>Fornecedores</h2>
        <div className="page-acoes">
          <div className="busca-pdv-caixa fornecedores-busca">
            <input
              className="busca-pdv"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, CNPJ, CPF, telefone..."
            />
          </div>
          <select value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value as 'todos' | 'ativos' | 'inativos')}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
          <button className="btn-primario" onClick={abrirNovo}>+ Novo Fornecedor</button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      <table className="tabela">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Documento</th>
            <th>Telefone</th>
            <th>Celular</th>
            <th>Email</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {fornecedores.map((f) => (
            <tr key={f.id} className={!f.ativo ? 'linha-cancelada' : ''}>
              <td>{f.nome}</td>
              <td>{f.pessoa_fisica ? (f.cpf ?? '-') : (f.cnpj ?? '-')}</td>
              <td>{f.telefone ?? '-'}</td>
              <td>{f.celular ?? '-'}</td>
              <td>{f.email ?? '-'}</td>
              <td>{f.ativo ? 'Ativo' : 'Inativo'}</td>
              <td className="td-acoes">
                <button className="btn-mini" onClick={() => abrirEdicao(f)}>Editar</button>
              </td>
            </tr>
          ))}
          {fornecedores.length === 0 && (
            <tr><td colSpan={7} className="sem-resultado">Nenhum fornecedor.</td></tr>
          )}
        </tbody>
      </table>

      {formAberto && (
        <div className="modal-overlay" onClick={() => setFormAberto(false)}>
          <div className="modal modal-grande" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>{form.id ? `Editar fornecedor: ${form.nome}` : 'Novo fornecedor'}</h3>
              <button className="btn-icone" onClick={() => setFormAberto(false)}>✕</button>
            </div>
            <div className="abas-vendas">
              <button className={`aba ${aba === 'cadastro' ? 'ativa' : ''}`} onClick={() => setAba('cadastro')}>Cadastro</button>
              <button className={`aba ${aba === 'transacoes' ? 'ativa' : ''}`} onClick={() => setAba('transacoes')}>Transações</button>
              <button className={`aba ${aba === 'produtos' ? 'ativa' : ''}`} onClick={() => setAba('produtos')}>Produtos</button>
            </div>
            <div className="modal-conteudo">
              {aba === 'cadastro' && renderCadastro()}
              {aba === 'transacoes' && (
                <div>
                  <h4>Compras do fornecedor</h4>
                  {transacoes.length === 0 ? (
                    <p className="sem-resultado">Nenhuma compra registrada.</p>
                  ) : (
                    <table className="tabela">
                      <thead><tr><th>Data</th><th>Número</th><th>Total</th></tr></thead>
                      <tbody>
                        {transacoes.map((t, i) => (
                          <tr key={i}><td>{t.criado_em}</td><td>{t.numero}</td><td>R$ {t.total.toFixed(2)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {aba === 'produtos' && (
                <div>
                  <h4>Produtos deste fornecedor</h4>
                  {produtosRel.length === 0 ? (
                    <p className="sem-resultado">Nenhum produto vinculado.</p>
                  ) : (
                    <table className="tabela">
                      <thead><tr><th>Produto</th><th>Preço venda</th><th>Estoque</th></tr></thead>
                      <tbody>
                        {produtosRel.map((p, i) => (
                          <tr key={i}><td>{p.nome}</td><td>R$ {p.preco_venda.toFixed(2)}</td><td>{p.estoque}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
            <div className="modal-rodape-acoes">
              <div className="modal-acoes">
                <button className="btn-primario" onClick={salvar}>SALVAR <kbd>F2</kbd></button>
                <button className="btn-secundario" onClick={() => setFormAberto(false)}>CANCELAR</button>
              </div>
              <div className="modal-acoes-direita">
                {form.id && (
                  <>
                    <button className="forn-link-inativar" onClick={inativarFornecedor}>
                      {form.ativo ? 'Inativar Fornecedor' : 'Reativar Fornecedor'}
                    </button>
                    <button className="forn-link-excluir" onClick={excluirFornecedor}>Excluir Fornecedor</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
