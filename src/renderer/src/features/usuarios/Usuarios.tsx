import { useEffect, useState, useCallback } from 'react'
import { getDbApi, getAuthApi } from '../../shared/db'

interface LinhaUsuario {
  id: number
  nome: string
  login: string
  perfil: string
  comissao_percent: number
  ativo: number
  usar_web: number
  usar_app: number
  limitar_desconto: number
  desconto_max_percent: number
}

interface ModuloPermissao {
  chave: string
  label: string
  permissoes: { chave: string; label: string }[]
}

const MODULOS_PERMISSOES: ModuloPermissao[] = [
  {
    chave: 'caixa',
    label: 'Caixa',
    permissoes: [
      { chave: 'caixa_ver_anteriores', label: 'Ver dados de Caixas Anteriores' },
      { chave: 'caixa_ver_anteriores_outros', label: 'Ver dados de Caixas Anteriores de outros usuários' },
      { chave: 'caixa_suprimento', label: 'Lançar Suprimento (entrada de dinheiro) no Caixa' },
      { chave: 'caixa_sangria', label: 'Lançar Sangria (saída de dinheiro) no Caixa' },
      { chave: 'caixa_abrir_fechar', label: 'Abrir / Fechar Caixa' },
      { chave: 'caixa_ver_totalizacao', label: 'Ver totalização do Caixa Atual' },
      { chave: 'caixa_ver_colunas_valores', label: 'Ver colunas de valores do caixa' },
      { chave: 'caixa_ver_transacoes', label: 'Ver transações do caixa atual' },
      { chave: 'caixa_reabrir', label: 'Reabrir Caixa' },
      { chave: 'caixa_ver_canais_venda', label: 'Visualizar Canais de Venda' },
      { chave: 'caixa_ver_lucro', label: 'Ver lucro/prejuízo bruto no caixa' }
    ]
  },
  {
    chave: 'clientes',
    label: 'Clientes',
    permissoes: [
      { chave: 'clientes_cadastrar', label: 'Cadastrar/Alterar dados de Clientes' },
      { chave: 'clientes_apagar', label: 'Apagar Clientes' },
      { chave: 'clientes_corrigir_credito', label: 'Corrigir Crédito dos Clientes' },
      { chave: 'clientes_alterar_limite', label: 'Alterar limite de débito dos clientes' },
      { chave: 'clientes_inativar', label: 'Inativar / Re-ativar contas de clientes' },
      { chave: 'clientes_corrigir_pontos', label: 'Corrigir quantidade de pontos de fidelidade' },
      { chave: 'clientes_receber_debitos', label: 'Receber pagamento de débitos' },
      { chave: 'clientes_acessar', label: 'Acessar Clientes' },
      { chave: 'clientes_ver_totais', label: 'Ver total geral de débitos e créditos' }
    ]
  },
  {
    chave: 'gerais',
    label: 'Gerais',
    permissoes: [
      { chave: 'gerais_imprimir_exportar', label: 'Usar opção de imprimir e exportar do menu principal' },
      { chave: 'gerais_abrir_gaveta', label: 'Abrir gaveta de dinheiro sem realizar venda' }
    ]
  },
  {
    chave: 'produtos',
    label: 'Produtos',
    permissoes: [
      { chave: 'produtos_cadastrar', label: 'Cadastrar/Alterar dados de Produtos' },
      { chave: 'produtos_apagar', label: 'Apagar Produtos' },
      { chave: 'produtos_alterar_preco', label: 'Alterar Preço de Produtos' },
      { chave: 'produtos_ver_custo_lucro', label: 'Ver custo/lucro dos produtos e vendas' },
      { chave: 'produtos_ver_custo_margem', label: 'Ver Custo e Margem de lucro de produtos' },
      { chave: 'produtos_alterar_custo_margem', label: 'Alterar Custo e Margem de lucro de produtos' },
      { chave: 'produtos_acessar', label: 'Acessar Produtos' },
      { chave: 'produtos_cadastro_rapido', label: 'Permite Cadastro Rápido de Produtos' },
      { chave: 'produtos_inativar', label: 'Inativar / Re-ativar produtos' }
    ]
  },
  {
    chave: 'estoque',
    label: 'Estoque',
    permissoes: [
      { chave: 'estoque_acessar', label: 'Acessar Estoque' },
      { chave: 'estoque_ajustar', label: 'Ajustar/Corrigir estoque' },
      { chave: 'estoque_movimentar', label: 'Lançar movimentações (entrada/saída)' },
      { chave: 'estoque_ver_custo', label: 'Ver custo do estoque' },
      { chave: 'estoque_importar', label: 'Importar dados de estoque' }
    ]
  },
  {
    chave: 'vendas',
    label: 'Vendas',
    permissoes: [
      { chave: 'vendas_acessar', label: 'Acessar Vendas' },
      { chave: 'vendas_cancelar', label: 'Cancelar vendas' },
      { chave: 'vendas_editar_pagamento', label: 'Editar pagamento de vendas' },
      { chave: 'vendas_ver_todas', label: 'Ver vendas de outros usuários' },
      { chave: 'vendas_editar', label: 'Editar pedidos' }
    ]
  },
  {
    chave: 'orcamento',
    label: 'Orçamento',
    permissoes: [
      { chave: 'orcamento_acessar', label: 'Acessar Orçamentos' },
      { chave: 'orcamento_criar', label: 'Criar Orçamentos' },
      { chave: 'orcamento_aprovar', label: 'Aprovar Orçamentos' },
      { chave: 'orcamento_editar', label: 'Editar Orçamentos' }
    ]
  },
  {
    chave: 'relatorios',
    label: 'Relatórios',
    permissoes: [
      { chave: 'relatorios_acessar', label: 'Acessar Relatórios' },
      { chave: 'relatorios_exportar', label: 'Exportar relatórios' },
      { chave: 'relatorios_ver_custo', label: 'Ver custos/lucros nos relatórios' }
    ]
  }
]

const MODULOS_ACESSO = [
  { chave: 'vendas', label: 'Vendas' },
  { chave: 'pdv', label: 'PDV (Balcão)' },
  { chave: 'clientes', label: 'Clientes' },
  { chave: 'produtos', label: 'Produtos' },
  { chave: 'estoque', label: 'Estoque' },
  { chave: 'catalogo', label: 'Catálogo Online' },
  { chave: 'financeiro', label: 'Contas a Pagar' },
  { chave: 'caixa', label: 'Caixa' },
  { chave: 'relatorios', label: 'Relatórios' },
  { chave: 'delivery', label: 'Delivery' },
  { chave: 'comissoes', label: 'Comissões' },
  { chave: 'precos', label: 'Alterar Preços' },
  { chave: 'formaspagamento', label: 'Formas de Pagamento' },
  { chave: 'zonas', label: 'Zonas de Entrega' },
  { chave: 'usuarios', label: 'Usuários e Permissões' },
  { chave: 'vender_sem_estoque', label: 'Permitir venda sem estoque' }
]

const usuarioVazio = {
  id: 0,
  nome: '',
  login: '',
  senha: '',
  perfil: 'vendedor',
  comissao: '',
  usar_web: true,
  usar_app: true,
  limitar_desconto: false,
  desconto_max: ''
}

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState<LinhaUsuario[]>([])
  const [form, setForm] = useState({ ...usuarioVazio })
  const [formAberto, setFormAberto] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [permUsuarioId, setPermUsuarioId] = useState<number | null>(null)
  const [permUsuarioNome, setPermUsuarioNome] = useState('')
  const [permissao, setPermissao] = useState<Record<string, boolean>>({})
  const [acesso, setAcesso] = useState<Record<string, boolean>>({})
  const [abas, setAbas] = useState<Record<number, 'dados' | 'supervisor' | 'permissoes'>>({})
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({ caixa: true, clientes: true })

  const carregar = useCallback(async () => {
    const rows = (await getDbApi().all(
      `SELECT id, nome, login, perfil, comissao_percent, ativo, usar_web, usar_app, limitar_desconto, desconto_max_percent FROM usuarios ORDER BY perfil, nome`
    )) as unknown as LinhaUsuario[]
    setUsuarios(rows)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const salvar = async () => {
    if (!form.nome.trim() || !form.login.trim()) {
      setMensagem('Informe nome e login.')
      return
    }
    if (form.id) {
      const res = await getAuthApi().atualizarUsuario({
        usuarioId: form.id,
        nome: form.nome.trim(),
        login: form.login.trim(),
        perfil: form.perfil,
        comissao: Number(form.comissao) || 0,
        senha: form.senha || undefined
      })
      if (res.ok) {
        await getDbApi().run(
          `UPDATE usuarios SET usar_web = ?, usar_app = ?, limitar_desconto = ?, desconto_max_percent = ? WHERE id = ?`,
          [form.usar_web ? 1 : 0, form.usar_app ? 1 : 0, form.limitar_desconto ? 1 : 0, Number(form.desconto_max) || 0, form.id]
        )
        setFormAberto(false)
        setForm({ ...usuarioVazio })
        setMensagem('Usuário atualizado.')
        carregar()
      } else {
        setMensagem('Erro ao atualizar usuário.')
      }
      return
    }
    if (!form.senha) {
      setMensagem('Informe uma senha inicial.')
      return
    }
    const res = await getAuthApi().criarUsuario({
      nome: form.nome.trim(),
      login: form.login.trim(),
      senha: form.senha,
      perfil: form.perfil,
      comissao: Number(form.comissao) || 0
    })
    if (res.ok && res.id != null) {
      await getDbApi().run(
        `UPDATE usuarios SET usar_web = ?, usar_app = ?, limitar_desconto = ?, desconto_max_percent = ? WHERE id = ?`,
        [form.usar_web ? 1 : 0, form.usar_app ? 1 : 0, form.limitar_desconto ? 1 : 0, Number(form.desconto_max) || 0, res.id]
      )
      setFormAberto(false)
      setForm({ ...usuarioVazio })
      setMensagem('Usuário criado.')
      carregar()
    } else {
      setMensagem('Erro ao criar usuário (login duplicado?).')
    }
  }

  const editarUsuario = (u: LinhaUsuario) => {
    setForm({
      id: u.id,
      nome: u.nome,
      login: u.login,
      senha: '',
      perfil: u.perfil,
      comissao: String(u.comissao_percent),
      usar_web: !!u.usar_web,
      usar_app: !!u.usar_app,
      limitar_desconto: !!u.limitar_desconto,
      desconto_max: String(u.desconto_max_percent ?? '')
    })
    setFormAberto(true)
    setMensagem('')
    setAbas((prev) => ({ ...prev, [u.id]: 'dados' }))
  }

  const deletarUsuario = async (u: LinhaUsuario) => {
    if (u.perfil === 'admin') {
      setMensagem('Não é possível deletar o administrador.')
      return
    }
    if (!confirm(`Deletar o usuário ${u.nome}? Esta ação não pode ser desfeita.`)) return
    await getDbApi().run(`DELETE FROM permissoes WHERE usuario_id = ?`, [u.id])
    await getDbApi().run(`DELETE FROM usuarios WHERE id = ?`, [u.id])
    setMensagem('Usuário deletado.')
    carregar()
  }

  const alterarSenha = async (u: LinhaUsuario) => {
    const nova = prompt(`Nova senha para ${u.nome}:`)
    if (!nova || nova.length < 4) {
      setMensagem('Senha deve ter ao menos 4 caracteres.')
      return
    }
    await getAuthApi().alterarSenha(u.id, nova)
    setMensagem('Senha alterada.')
  }

  const ativarDesativar = async (u: LinhaUsuario) => {
    await getDbApi().run(`UPDATE usuarios SET ativo = ? WHERE id = ?`, [u.ativo ? 0 : 1, u.id])
    setMensagem(u.ativo ? 'Usuário desativado.' : 'Usuário ativado.')
    carregar()
  }

  const abrirPermissoes = async (u: LinhaUsuario) => {
    setPermUsuarioId(u.id)
    setPermUsuarioNome(u.nome)
    const rows = (await getDbApi().all(
      `SELECT modulo FROM permissoes WHERE usuario_id = ?`,
      [u.id]
    )) as unknown as { modulo: string }[]
    const mapaPerm: Record<string, boolean> = {}
    const mapaAcesso: Record<string, boolean> = {}
    const todas = [...MODULOS_PERMISSOES.flatMap((m) => m.permissoes.map((p) => p.chave)), ...MODULOS_ACESSO.map((m) => m.chave)]
    for (const ch of todas) mapaPerm[ch] = false
    for (const r of rows) {
      mapaPerm[r.modulo] = true
      mapaAcesso[r.modulo] = true
    }
    if (u.perfil === 'admin') {
      for (const ch of todas) mapaPerm[ch] = true
      for (const m of MODULOS_ACESSO) mapaAcesso[m.chave] = true
    }
    setPermissao(mapaPerm)
    setAcesso(mapaAcesso)
  }

  const salvarPermissoes = async () => {
    if (!permUsuarioId) return
    const db = getDbApi()
    const moduloAtual = usuarios.find((u) => u.id === permUsuarioId)
    if (moduloAtual?.perfil === 'admin') {
      setMensagem('Administrador já tem acesso a todas as permissões.')
      setPermUsuarioId(null)
      return
    }
    await db.run(`DELETE FROM permissoes WHERE usuario_id = ?`, [permUsuarioId])
    const todas = [...MODULOS_PERMISSOES.flatMap((m) => m.permissoes.map((p) => p.chave))]
    for (const ch of todas) {
      if (permissao[ch]) {
        await db.run(`INSERT INTO permissoes (usuario_id, modulo) VALUES (?, ?)`, [permUsuarioId, ch])
      }
    }
    for (const m of MODULOS_ACESSO) {
      if (acesso[m.chave]) {
        await db.run(`INSERT INTO permissoes (usuario_id, modulo) VALUES (?, ?)`, [permUsuarioId, m.chave])
      }
    }
    setPermUsuarioId(null)
    setMensagem(`Permissões de ${permUsuarioNome} salvas.`)
  }

  const alternarModulo = (m: ModuloPermissao, ativo: boolean) => {
    setPermissao((prev) => {
      const novo = { ...prev }
      for (const p of m.permissoes) novo[p.chave] = ativo
      return novo
    })
  }

  const alternarAcesso = (chave: string) => {
    setAcesso((prev) => ({ ...prev, [chave]: !prev[chave] }))
  }

  const renderDados = () => (
    <div className="form-grid">
      <label>Nome
        <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus />
      </label>
      <label>Login
        <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
      </label>
      <label>Senha {form.id && <small className="nota-config">(deixe vazio para manter)</small>}
        <input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
      </label>
      <label>Perfil
        <select value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value })}>
          <option value="vendedor">Vendedor</option>
          <option value="gerente">Gerente</option>
          <option value="admin">Administrador</option>
        </select>
      </label>
      <label style={{ gridColumn: '1 / -1' }}>Comissão (%) — aplicada nas vendas deste vendedor
        <input type="number" step="0.1" value={form.comissao} onChange={(e) => setForm({ ...form, comissao: e.target.value })} />
      </label>
    </div>
  )

  const renderSupervisor = () => (
    <div className="permissoes-grid permissoes-opcoes">
      <label className="permissao-item">
        <input type="checkbox" checked={form.usar_web} onChange={(e) => setForm({ ...form, usar_web: e.target.checked })} />
        Permitir usar o Nex na Web
      </label>
      <label className="permissao-item">
        <input type="checkbox" checked={form.usar_app} onChange={(e) => setForm({ ...form, usar_app: e.target.checked })} />
        Permitir usar o aplicativo do Nex
      </label>
      <label className="permissao-item">
        <input type="checkbox" checked={form.limitar_desconto} onChange={(e) => setForm({ ...form, limitar_desconto: e.target.checked })} />
        Limitar descontos
      </label>
      {form.limitar_desconto && (
        <label className="permissao-item permissao-item-input">
          Percentual máximo permitido por venda (%)
          <input type="number" step="0.01" min="0" max="100" value={form.desconto_max} onChange={(e) => setForm({ ...form, desconto_max: e.target.value })} />
        </label>
      )}
      <label className="permissao-item">
        <input type="checkbox" checked={form.perfil === 'admin'} onChange={(e) => setForm({ ...form, perfil: e.target.checked ? 'admin' : 'vendedor' })} />
        Este usuário é um Administrador e tem acesso a todas as funções do Nex
      </label>
    </div>
  )

  const renderPermissoes = () => (
    <div>
      <p className="nota-config">Marque os recursos que o usuário pode acessar:</p>
      <div className="permissoes-modulos-acesso">
        <div className="precos-campo-label" style={{ marginBottom: 6 }}>Acesso aos módulos do sistema</div>
        <div className="permissoes-grid">
          {MODULOS_ACESSO.map((m) => (
            <label key={m.chave} className="permissao-item">
              <input type="checkbox" checked={acesso[m.chave] ?? false} onChange={() => alternarAcesso(m.chave)} />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      <div className="permissoes-arvore">
        {MODULOS_PERMISSOES.map((m) => {
          const expandido = expandidos[m.chave]
          const marcados = m.permissoes.filter((p) => permissao[p.chave]).length
          const total = m.permissoes.length
          return (
            <div key={m.chave} className={`perm-modulo ${expandido ? 'aberto' : ''}`}>
              <div className="perm-modulo-cab" onClick={() => setExpandidos((prev) => ({ ...prev, [m.chave]: !prev[m.chave] }))}>
                <span className="perm-modulo-seta">{expandido ? '−' : '+'}</span>
                <strong>{m.label}</strong>
                <span className="perm-modulo-count">{marcados}/{total}</span>
                <label className="permissao-item" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={marcados === total && total > 0}
                    onChange={(e) => alternarModulo(m, e.target.checked)}
                  />
                  Todos
                </label>
              </div>
              {expandido && (
                <div className="perm-modulo-corpo">
                  {m.permissoes.map((p) => (
                    <label key={p.chave} className="permissao-item">
                      <input
                        type="checkbox"
                        checked={permissao[p.chave] ?? false}
                        onChange={(e) => setPermissao((prev) => ({ ...prev, [p.chave]: e.target.checked }))}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <h2>Gerenciar usuários</h2>
        <div className="page-acoes">
          <button className="btn-primario" onClick={() => { setForm({ ...usuarioVazio }); setFormAberto(true); setMensagem('') }}>
            + Novo usuário
          </button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}

      {formAberto && (
        <div className="modal-overlay">
          <div className="modal modal-grande">
            <div className="modal-topo">
              <h3>{form.id ? `Editar usuário: ${form.nome}` : 'Novo usuário'}</h3>
              <button className="btn-icone" onClick={() => setFormAberto(false)}>✕</button>
            </div>
            <div className="abas-vendas">
              <button className={`aba ${abas[form.id] ?? 'dados' === 'dados' ? 'ativa' : ''}`} onClick={() => setAbas((prev) => ({ ...prev, [form.id]: 'dados' }))}>
                Dados pessoais
              </button>
              <button className={`aba ${abas[form.id] === 'supervisor' ? 'ativa' : ''}`} onClick={() => setAbas((prev) => ({ ...prev, [form.id]: 'supervisor' }))}>
                Supervisor
              </button>
              <button className={`aba ${abas[form.id] === 'permissoes' ? 'ativa' : ''}`} onClick={() => setAbas((prev) => ({ ...prev, [form.id]: 'permissoes' }))}>
                Permissões
              </button>
            </div>
            <div className="modal-conteudo">
              {(abas[form.id] ?? 'dados') === 'dados' && renderDados()}
              {(abas[form.id] ?? 'dados') === 'supervisor' && renderSupervisor()}
              {(abas[form.id] ?? 'dados') === 'permissoes' && renderPermissoes()}
            </div>
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setFormAberto(false)}>Cancelar</button>
              <button className="btn-primario" onClick={salvar}>Salvar <kbd>F2</kbd></button>
            </div>
          </div>
        </div>
      )}

      {permUsuarioId != null && (
        <div className="modal-overlay">
          <div className="modal modal-grande">
            <div className="modal-topo">
              <h3>Permissões de {permUsuarioNome}</h3>
              <button className="btn-icone" onClick={() => setPermUsuarioId(null)}>✕</button>
            </div>
            {renderPermissoes()}
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => setPermUsuarioId(null)}>Cancelar</button>
              <button className="btn-primario" onClick={salvarPermissoes}>Salvar <kbd>F2</kbd></button>
            </div>
          </div>
        </div>
      )}

      <table className="tabela">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Login</th>
            <th>Perfil</th>
            <th>Comissão</th>
            <th>Acesso</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id}>
              <td>{u.nome}</td>
              <td>{u.login}</td>
              <td>{u.perfil}</td>
              <td>{u.comissao_percent}%</td>
              <td>{u.perfil === 'admin' ? 'Todas' : 'Conforme permissões'}</td>
              <td>{u.ativo ? 'Ativo' : 'Inativo'}</td>
              <td className="td-acoes">
                <button className="btn-mini" onClick={() => editarUsuario(u)}>Editar</button>
                <button className="btn-mini" onClick={() => abrirPermissoes(u)}>Permissões</button>
                <button className="btn-mini" onClick={() => alterarSenha(u)}>Senha</button>
                <button className="btn-mini" onClick={() => ativarDesativar(u)}>
                  {u.ativo ? 'Desativar' : 'Ativar'}
                </button>
                {u.perfil !== 'admin' && (
                  <button className="btn-mini btn-danger" onClick={() => deletarUsuario(u)}>Deletar</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
