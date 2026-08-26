import { useEffect, useState, useCallback, useRef } from 'react'
import Pdv from './features/pdv/Pdv'
import Produtos from './features/produtos/Produtos'
import Clientes from './features/clientes/Clientes'
import Vendas from './features/vendas/Vendas'
import Estoque from './features/estoque/Estoque'
import Relatorios from './features/relatorios/Relatorios'
import Financeiro from './features/financeiro/Financeiro'
import Comissoes from './features/comissoes/Comissoes'
import Usuarios from './features/usuarios/Usuarios'
import Delivery from './features/delivery/Delivery'
import Zonas from './features/zonas/Zonas'
import CatalogoOnline from './features/catalogo/CatalogoOnline'
import Caixa from './features/caixa/Caixa'
import CaixaTransacoes from './features/caixa/CaixaTransacoes'
import FormasPagamento from './features/formaspagamento/FormasPagamento'
import AlterarPrecos from './features/precos/AlterarPrecos'
import Servidor from './features/servidor/Servidor'
import Home from './features/inicio/Home'
import Login from './features/login/Login'
import { getDbApi, hasDbApi, getAuthApi, Usuario, fazerBackupManual, setFullscreen, getCatalogoApi, getServidorApi } from './shared/db'

type Tela = 'inicio' | 'pdv' | 'produtos' | 'clientes' | 'vendas' | 'estoque' | 'financeiro' | 'comissoes' | 'relatorios' | 'usuarios' | 'delivery' | 'zonas' | 'catalogo' | 'caixa' | 'formaspagamento' | 'precos' | 'nfe' | 'sobre' | 'servidor'

const ICONES: Record<string, string> = {
  inicio: 'M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z',
  vendas: 'M6 3h12l2 5v13H4V8z M4 8h16 M9 3l1 5 M15 3l-1 5 M8 13h8 M8 17h5',
  clientes: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  produtos: 'M3 7 12 3l9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  estoque: 'M4 7h16v13H4z M8 7V4h8v3 M9 12h6 M9 15h6',
  catalogo: 'M3 4h18v16H3z M3 10h18 M8 4v16 M16 4v16',
  financeiro: 'M3 6h18v13H3z M16 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M3 9h4 M17 15h4',
  caixa: 'M5 4h14a2 2 0 0 1 2 2v13H3V6a2 2 0 0 1 2-2z M3 9h18 M7 13h6 M7 16h4 M19 19v2',
  relatorios: 'M4 4h16v16H4z M8 16v-5 M12 16V8 M16 16v-3',
  nfe: 'M6 2h9l5 5v15H6z M14 2v5h5 M9 12h6 M9 16h6',
  apps: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  sobre: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01',
  pdv: 'M4 4h16v11H4z M8 20h8 M12 15v5 M2 20h20',
  delivery: 'M3 7h13v9H3z M16 10h4l2 3v3h-6z M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M18 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  zonas: 'M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  comissoes: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
  formas: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z M2 10h20',
  precos: 'M3 6h18v13H3z M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M5 9h3 M5 13h3',
  usuarios: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2',
  servidor: 'M2 12a10 10 0 1 1 20 0 10 10 0 0 1-20 0z M12 7v5l3 2 M12 2v2 M12 20v2 M2 12h2 M20 12h2'
}

interface MenuItem {
  id: Tela
  label: string
  icon: string
  atalho?: string
  admin?: boolean
  abrePdv?: boolean
  emBreve?: boolean
}

const MENU_PRINCIPAL: MenuItem[] = [
  { id: 'vendas', label: 'Vendas', icon: 'vendas' },
  { id: 'clientes', label: 'Clientes', icon: 'clientes' },
  { id: 'produtos', label: 'Produtos', icon: 'produtos' },
  { id: 'estoque', label: 'Estoque', icon: 'estoque' },
  { id: 'catalogo', label: 'Catálogo Online', icon: 'catalogo' },
  { id: 'financeiro', label: 'Contas a Pagar', icon: 'financeiro' },
  { id: 'caixa', label: 'Caixa', icon: 'caixa' },
  { id: 'relatorios', label: 'Relatórios', icon: 'relatorios' },
  { id: 'nfe', label: 'Nota Fiscal', icon: 'nfe', emBreve: true }
]

const MENU_GESTAO: MenuItem[] = [
  { id: 'comissoes', label: 'Comissões', icon: 'comissoes' },
  { id: 'precos', label: 'Alterar preços', icon: 'precos' },
  { id: 'servidor', label: 'Servidor', icon: 'servidor', admin: true },
  { id: 'usuarios', label: 'Gerenciar usuários', icon: 'usuarios', admin: true }
]

export default function App() {
  const [loja, setLoja] = useState('Carregando...')
  const [tela, setTela] = useState<Tela>('vendas')
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregado, setCarregado] = useState(false)
  const [msgBackup, setMsgBackup] = useState('')
  const [catalogoUrl, setCatalogoUrl] = useState('')
  const [pdvFocado, setPdvFocado] = useState(false)
  const [sidebarRecolhida, setSidebarRecolhida] = useState(false)
  const [caixaTransacoesId, setCaixaTransacoesId] = useState<number | null>(null)
  const [permissoes, setPermissoes] = useState<Set<string> | null>(null)
  const [pedidoEdicaoId, setPedidoEdicaoId] = useState<number | null>(null)
  const [modoPdv, setModoPdv] = useState<'venda' | 'pedido' | 'orcamento'>('venda')
  const [produtoEdicaoId, setProdutoEdicaoId] = useState<number | null>(null)
  const [novosPedidos, setNovosPedidos] = useState(0)
  const novosPedidosRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!hasDbApi() || !usuario) return
    const verificar = async () => {
      try {
        const rows = (await getDbApi().all(
          `SELECT id FROM pedidos WHERE status = 'novo'`
        )) as unknown as { id: number }[]
        const ids = new Set(rows.map((r) => r.id))
        const novos = rows.filter((r) => !novosPedidosRef.current.has(r.id))
        for (const r of rows) novosPedidosRef.current.add(r.id)
        if (novos.length > 0) {
          try {
            const ctx = new AudioContext()
            const notas = [880, 1108.73, 1318.51]
            notas.forEach((freq, idx) => {
              const osc = ctx.createOscillator()
              const ganho = ctx.createGain()
              osc.type = 'sine'
              osc.frequency.value = freq
              osc.connect(ganho)
              ganho.connect(ctx.destination)
              const t = ctx.currentTime + idx * 0.18
              ganho.gain.setValueAtTime(0.001, t)
              ganho.gain.exponentialRampToValueAtTime(0.35, t + 0.02)
              ganho.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
              osc.start(t)
              osc.stop(t + 0.18)
            })
          } catch {
            // sem som
          }
        }
        setNovosPedidos(ids.size)
      } catch {
        // sem acesso
      }
    }
    verificar()
    const t = setInterval(verificar, 6000)
    return () => clearInterval(t)
  }, [usuario])

  useEffect(() => {
    if (!hasDbApi() || !usuario) return
    getCatalogoApi().getConfig().then((c) => setCatalogoUrl(c.site_url || '')).catch(() => {})
  }, [usuario])

  useEffect(() => {
    if (!hasDbApi() || !usuario) return
    getDbApi()
      .get(`SELECT valor FROM config WHERE chave = 'nome_loja'`)
      .then((row) => {
        if (row) setLoja((row as { valor: string | null }).valor ?? 'Minha Tabacaria')
      })
      .catch(() => setLoja('Minha Tabacaria'))
  }, [usuario])

  useEffect(() => {
    if (!hasDbApi()) return
    getAuthApi()
      .session()
      .then((u) => setUsuario(u))
      .finally(() => setCarregado(true))
  }, [])

  useEffect(() => {
    if (!usuario) return
    const carregarPermissoes = async () => {
      try {
        if (usuario.perfil === 'admin') {
          setPermissoes(null)
          return
        }
        const rows = (await getDbApi().all(
          `SELECT modulo FROM permissoes WHERE usuario_id = ?`,
          [usuario.id]
        )) as unknown as { modulo: string }[]
        setPermissoes(new Set(rows.map((r) => r.modulo)))
      } catch {
        setPermissoes(new Set())
      }
    }
    carregarPermissoes()
  }, [usuario])

  // Monitor de conexão com o servidor: se perder a conexão, desconecta o usuário
  useEffect(() => {
    if (!usuario) return
    let falhas = 0
    let desconectou = false
    const checar = async () => {
      if (desconectou) return
      const desconectar = () => {
        desconectou = true
        setMsgBackup('Conexão com o servidor perdida. Você foi desconectado.')
        setUsuario(null)
        setTela('inicio')
        setPdvFocado(false)
        setFullscreen(false).catch(() => {})
      }
      try {
        const s = await getServidorApi().status()
        const online = !!(s && s.online && s.api === 'conectada')
        if (online) {
          falhas = 0
          return
        }
        falhas++
        if (falhas >= 2) {
          getAuthApi().logout().catch(() => {})
          desconectar()
        }
      } catch {
        falhas++
        if (falhas >= 2) {
          getAuthApi().logout().catch(() => {})
          desconectar()
        }
      }
    }
    checar()
    const t = setInterval(checar, 2000)
    return () => clearInterval(t)
  }, [usuario])

  const irPdv = useCallback(async () => {
    if (!hasDbApi()) {
      setTela('pdv')
      setPdvFocado(true)
      setFullscreen(true).catch(() => {})
      return
    }
    const caixa = (await getDbApi().get(`SELECT id FROM caixas WHERE aberto = 1 ORDER BY id DESC LIMIT 1`).catch(() => null)) as
      | { id: number }
      | null
      | undefined
    if (!caixa) {
      setMsgBackup('Caixa fechado. Abra o caixa na aba Caixa para vender no balcão (F3).')
      setTela('caixa')
      return
    }
    setModoPdv('venda')
    setPedidoEdicaoId(null)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [])

  const editarPedido = useCallback((pedidoId: number) => {
    setPedidoEdicaoId(pedidoId)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [])

  const novoPedido = useCallback(() => {
    setModoPdv('pedido')
    setPedidoEdicaoId(null)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [])

  const novoOrcamento = useCallback(() => {
    setModoPdv('orcamento')
    setPedidoEdicaoId(null)
    setTela('pdv')
    setPdvFocado(true)
    setFullscreen(true).catch(() => {})
  }, [])

  const sairPdv = useCallback(() => {
    setPedidoEdicaoId(null)
    setModoPdv('venda')
    setPdvFocado(false)
    setTela('vendas')
    setFullscreen(false).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault()
        if (pdvFocado) {
          return
        }
        irPdv()
      }
      if (e.key === 'F4' && !pdvFocado) {
        e.preventDefault()
        novoPedido()
      }
      if (e.key === 'F5' && !pdvFocado) {
        e.preventDefault()
        novoOrcamento()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [irPdv, sairPdv, pdvFocado, novoPedido, novoOrcamento])

  const sair = async () => {
    await getAuthApi().logout()
    setUsuario(null)
    setTela('inicio')
    setPdvFocado(false)
    setFullscreen(false).catch(() => {})
  }

  if (!carregado) return <div className="login-loading">Carregando...</div>

  if (!usuario) {
    return <Login onLogin={(u) => setUsuario(u)} />
  }

  const navegar = (item: MenuItem) => {
    if (item.emBreve) {
      setMsgBackup(`${item.label} estará disponível em breve.`)
      return
    }
    if (item.abrePdv) {
      irPdv()
      return
    }
    if (permissoes && !permissoes.has(item.id)) {
      setMsgBackup('Você não tem permissão para acessar este módulo.')
      return
    }
    setProdutoEdicaoId(null)
    setTela(item.id)
    setMsgBackup('')
  }

  const menuVisivel = MENU_GESTAO.filter((m) => !m.admin || usuario.perfil === 'admin')

  if (pdvFocado) {
    return (
      <div className="app pdv-focado">
        <Pdv
          usuarioId={usuario.id}
          aoConcluirVenda={sairPdv}
          aoVoltar={sairPdv}
          pedidoEdicaoId={pedidoEdicaoId}
          modo={modoPdv}
          onEditarProduto={(id) => setProdutoEdicaoId(id)}
        />
        {produtoEdicaoId != null && (
          <div className="pdv-overlay-edicao">
            <div className="pdv-overlay-edicao-topo">
              <span>Editando produto</span>
              <button className="btn-primario" onClick={() => setProdutoEdicaoId(null)}>Voltar para a venda</button>
            </div>
            <div className="pdv-overlay-edicao-conteudo">
              <Produtos produtoEdicaoId={produtoEdicaoId} />
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderTela = () => {
    switch (tela) {
      case 'inicio':
        return <Home usuarioNome={usuario.nome} onAbrirPdv={irPdv} onNavegar={(t) => setTela(t as Tela)} />
      case 'produtos':
        return <Produtos />
      case 'clientes':
        return <Clientes />
      case 'vendas':
        return <Vendas onNovaVenda={irPdv} onEditarPedido={editarPedido} onNovoPedido={novoPedido} onNovoOrcamento={novoOrcamento} />
      case 'estoque':
        return <Estoque usuarioId={usuario.id} onAbrirProduto={(id) => { setProdutoEdicaoId(id); setTela('produtos') }} />
      case 'financeiro':
        return <Financeiro usuarioId={usuario.id} />
      case 'comissoes':
        return <Comissoes />
      case 'relatorios':
        return <Relatorios onNavegar={(t) => setTela(t as Tela)} usuarioNome={usuario.nome} />
      case 'usuarios':
        return usuario.perfil === 'admin' || (permissoes?.has('usuarios')) ? <Usuarios /> : <Pdv />
      case 'delivery':
        return <Delivery />
      case 'zonas':
        return <Zonas />
      case 'catalogo':
        return <CatalogoOnline onNavegar={(t) => setTela(t as Tela)} usuarioNome={usuario.nome} />
      case 'caixa':
        return caixaTransacoesId != null ? (
          <CaixaTransacoes caixaId={caixaTransacoesId} onVoltar={() => setCaixaTransacoesId(null)} />
        ) : (
          <Caixa usuarioId={usuario.id} usuarioNome={usuario.nome} onAbrirCaixa={(id) => setCaixaTransacoesId(id)} />
        )
      case 'formaspagamento':
        return <FormasPagamento />
      case 'precos':
        return <AlterarPrecos usuarioId={usuario.id} />
      case 'servidor':
        return <Servidor />
      case 'nfe':
      case 'sobre':
        return <EmBreve titulo={MENU_PRINCIPAL.find((m) => m.id === tela)?.label ?? ''} />
      default:
        return <Home usuarioNome={usuario.nome} onAbrirPdv={irPdv} onNavegar={(t) => setTela(t as Tela)} />
    }
  }

  const renderItem = (item: MenuItem) => (
    <button
      key={item.id}
      className={`nav-item ${tela === item.id ? 'ativo' : ''} ${sidebarRecolhida ? 'recolhido' : ''}`}
      onClick={() => navegar(item)}
      title={sidebarRecolhida ? item.label : undefined}
    >
      <span className="nav-item-corpo">
        <svg className="nav-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={ICONES[item.icon]} />
        </svg>
        <span className="nav-label">{item.label}</span>
        {item.id === 'vendas' && novosPedidos > 0 && (
          <span className="nav-badge">{novosPedidos}</span>
        )}
      </span>
      {!sidebarRecolhida && item.atalho && <kbd>{item.atalho}</kbd>}
    </button>
  )

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-esquerda">
          <button
            className="btn-hamburguer"
            onClick={() => setSidebarRecolhida((v) => !v)}
            title={sidebarRecolhida ? 'Expandir menu' : 'Recolher menu'}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1>Sistema Loja Tabacaria</h1>
        </div>
        <div className="header-direita">
          <span className="loja-nome">{loja}</span>
          {catalogoUrl && (
            <a className="delivery-url" href={catalogoUrl} target="_blank" rel="noreferrer" title="Abrir catálogo público">
              Catálogo público: {catalogoUrl}
            </a>
          )}
          <span className="usuario-logado">
            {usuario.nome}
            {usuario.perfil === 'admin' ? (
              <button
                className="perfil-badge perfil-badge-btn"
                onClick={() => { setTela('usuarios'); setMsgBackup('') }}
                title="Gerenciar usuários"
              >
                admin ▾
              </button>
            ) : (
              <span className="perfil-badge">{usuario.perfil}</span>
            )}
          </span>
          <button
            className="btn-mini"
            onClick={async () => setMsgBackup(await fazerBackupManual())}
            title="Backup automático a cada 4h"
          >
            Backup
          </button>
          <button className="btn-mini" onClick={sair}>Sair</button>
        </div>
      </header>
      <div className="app-corpo">
        <nav className={`sidebar ${sidebarRecolhida ? 'recolhida' : ''}`}>
          {msgBackup && <div className="msg-backup">{msgBackup}</div>}
          <div className="sidebar-grupo">{MENU_PRINCIPAL.map(renderItem)}</div>
          <div className="sidebar-separador" />
          <div className="sidebar-grupo">{menuVisivel.map(renderItem)}</div>
        </nav>
        <main className="main">{renderTela()}</main>
      </div>
    </div>
  )
}

function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h2>{titulo}</h2>
      </div>
      <p className="sem-resultado">Este módulo estará disponível em breve.</p>
    </div>
  )
}
