import { useCallback, useEffect, useRef, useState } from 'react'
import { getWhatsAppApi } from '../../shared/db'

type PainelWhatsApp = 'dashboard' | 'bot' | 'conversas' | 'intencoes' | 'mensagens' | 'menu' | 'produtos' | 'entrega' | 'configuracoes' | 'backup'

interface Dashboard {
  conversas: number
  humano: number
  bot: number
  pedidos_iniciados: number
  pedidos_finalizados: number
  pedidos_cancelados: number
  valor_total: number
  produtos_disponiveis: number
  sem_estoque: number
  bot_enabled: boolean
  delivery_mode: string
}

interface Conversa {
  phone: string
  name: string
  state: string
  attendance_status: string
  last_message: string
  last_at: string
}

interface Intent {
  name: string
  description: string
  enabled: boolean
  priority: number
  phrases: { id: number; phrase: string }[]
}

interface Mensagem {
  key: string
  name: string
  category: string
  text: string
  active: boolean
  isDefault: boolean
  variables: string[]
}

interface MenuItem {
  id: number
  position: number
  label: string
  action: string
  enabled: boolean
}

interface Produto {
  id: number
  name: string
  category: string
  price: number
  stock: number
  available: number
  whatsapp_visible: boolean
}

const fmtBRL = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`

export default function AtendimentoWhatsApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem('wa_token') || '')
  const [loginUser, setLoginUser] = useState('admin')
  const [loginPass, setLoginPass] = useState('')
  const [loginErro, setLoginErro] = useState('')
  const [tela, setTela] = useState<PainelWhatsApp>('dashboard')
  const [msg, setMsg] = useState('')

  const wp = useCallback(async <T = Record<string, unknown>>(method: 'get' | 'post', path: string, body?: unknown): Promise<T> => {
    if (method === 'get') {
      return getWhatsAppApi().get(path, token) as Promise<T>
    }
    return getWhatsAppApi().post(path, body ?? {}, token) as Promise<T>
  }, [token])

  const handleLogin = async () => {
    setLoginErro('')
    try {
      const r = await getWhatsAppApi().login(loginUser, loginPass)
      if (r.ok && r.token) {
        sessionStorage.setItem('wa_token', r.token)
        setToken(r.token)
      } else {
        setLoginErro(r.error || 'Credenciais inválidas')
      }
    } catch (e) {
      setLoginErro(`Erro: ${(e as Error).message}`)
    }
  }

  const handleLogout = () => {
    sessionStorage.removeItem('wa_token')
    setToken('')
    setTela('dashboard')
  }

  if (!token) {
    return (
      <div className="page">
        <div className="page-header"><h2>Atendimento WhatsApp</h2></div>
        <div className="wa-login">
          <div className="rp-tabela-card" style={{ maxWidth: 360 }}>
            <h4>Login do painel</h4>
            <label className="config-campo">Usuário
              <input className="input" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
            </label>
            <label className="config-campo">Senha
              <input className="input" type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            </label>
            {loginErro && <p className="nota-config" style={{ color: '#dc2626' }}>{loginErro}</p>}
            <button className="btn-primario" onClick={handleLogin}>Entrar</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Atendimento WhatsApp</h2>
        <div className="page-acoes">
          {msg && <span className="nota-config" style={{ marginRight: 8 }}>{msg}</span>}
          <button className="btn-mini" onClick={handleLogout}>Sair do painel</button>
        </div>
      </div>
      <div className="wa-layout">
        <nav className="wa-sidebar">
          {([
            ['dashboard', 'Visão geral'],
            ['bot', 'Controle do bot'],
            ['conversas', 'Conversas'],
            ['intencoes', 'Intenções'],
            ['mensagens', 'Mensagens'],
            ['menu', 'Menu'],
            ['produtos', 'Produtos'],
            ['entrega', 'Entrega'],
            ['configuracoes', 'Configurações'],
            ['backup', 'Backup']
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={`wa-nav-item ${tela === id ? 'ativa' : ''}`}
              onClick={() => { setTela(id as PainelWhatsApp); setMsg('') }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="wa-conteudo">
          {tela === 'dashboard' && <WaDashboard wp={wp} />}
          {tela === 'bot' && <WaBot wp={wp} />}
          {tela === 'conversas' && <WaConversas wp={wp} />}
          {tela === 'intencoes' && <WaIntencoes wp={wp} />}
          {tela === 'mensagens' && <WaMensagens wp={wp} />}
          {tela === 'menu' && <WaMenu wp={wp} />}
          {tela === 'produtos' && <WaProdutos wp={wp} />}
          {tela === 'entrega' && <WaEntrega wp={wp} />}
          {tela === 'configuracoes' && <WaConfig wp={wp} />}
          {tela === 'backup' && <WaBackup wp={wp} />}
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ──
function WaDashboard({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [d, setD] = useState<Dashboard | null>(null)
  useEffect(() => { wp('get', '/dashboard').then((r) => setD(r as unknown as Dashboard)).catch(() => {}) }, [wp])
  if (!d) return <p className="nota-config">Carregando...</p>
  return (
    <>
      <h3>Visão geral</h3>
      <div className="wa-grid">
        <div className="wa-card"><span className="muted">Bot</span><strong>{d.bot_enabled ? '🟢 Ativo' : '🔴 Pausado'}</strong></div>
        <div className="wa-card"><span className="muted">Conversas</span><strong>{d.conversas}</strong></div>
        <div className="wa-card"><span className="muted">Sob bot</span><strong>{d.bot}</strong></div>
        <div className="wa-card"><span className="muted">Humanos ativos</span><strong>{d.humano}</strong></div>
        <div className="wa-card"><span className="muted">Pedidos iniciados</span><strong>{d.pedidos_iniciados}</strong></div>
        <div className="wa-card"><span className="muted">Finalizados</span><strong>{d.pedidos_finalizados}</strong></div>
        <div className="wa-card"><span className="muted">Cancelados</span><strong>{d.pedidos_cancelados}</strong></div>
        <div className="wa-card"><span className="muted">Valor total</span><strong>{fmtBRL(d.valor_total)}</strong></div>
        <div className="wa-card"><span className="muted">Produtos disponíveis</span><strong>{d.produtos_disponiveis}</strong></div>
        <div className="wa-card"><span className="muted">Sem estoque</span><strong>{d.sem_estoque}</strong></div>
      </div>
    </>
  )
}

// ── Bot Control ──
function WaBot({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [msg, setMsg] = useState('')
  const load = useCallback(() => { wp('get', '/bot/status').then((r) => setEnabled(!!(r as Record<string, unknown>).enabled)).catch(() => {}) }, [wp])
  useEffect(() => { load() }, [load])
  const toggle = async (action: 'pause' | 'resume') => {
    if (action === 'pause' && !confirm('Pausar o bot? Clientes não receberão respostas automáticas.')) return
    await wp('post', `/bot/${action}`, {})
    load()
    setMsg(action === 'pause' ? 'Bot pausado.' : 'Bot ativado.')
  }
  return (
    <>
      <h3>Controle do Atendimento</h3>
      {msg && <p className="nota-config">{msg}</p>}
      <div className="wa-grid" style={{ maxWidth: 420 }}>
        <button className="btn-primario" style={{ background: enabled ? '#16a34a' : '#dc2626' }} onClick={() => toggle(enabled ? 'pause' : 'resume')}>
          {enabled ? '🟢 Bot ativo — pausar' : '🔴 Bot pausado — ativar'}
        </button>
        {!enabled && <div className="wa-card" style={{ borderColor: '#eab308' }}><span style={{ color: '#eab308' }}>⚠ O bot está pausado e não enviará respostas automáticas.</span></div>}
      </div>
    </>
  )
}

// ── Conversations ──
function WaConversas({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [convs, setConvs] = useState<Conversa[]>([])
  const [filtro, setFiltro] = useState('Todas')
  const [hist, setHist] = useState<{ phone: string; data: unknown[] } | null>(null)
  const load = useCallback(() => { wp('get', '/conversations').then((r) => setConvs((r as Record<string, unknown>).conversations as Conversa[])).catch(() => {}) }, [wp])
  useEffect(() => { load() }, [load])
  const setStatus = async (phone: string, status: string) => { await wp('post', '/conversations/status', { phone, status }); load() }
  const openConv = async (phone: string) => {
    const r = await wp('post', '/conversations/history', { phone })
    setHist({ phone, data: (r as Record<string, unknown>).history as unknown[] })
  }
  const list = filtro === 'Todas' ? convs : convs.filter((c) => c.attendance_status === filtro)

  if (hist) {
    return (
      <>
        <button className="btn-mini" onClick={() => setHist(null)}>← Voltar</button>
        <h3>Conversa — {hist.phone}</h3>
        <div className="wa-chat">
          {(hist.data as { direction: string; text: string; created_at: string }[]).map((h, i) => (
            <div key={i} className={`wa-msg ${h.direction === 'in' ? 'cliente' : 'bot'}`}>
              <strong>{h.direction === 'in' ? 'CLIENTE' : 'BOT'}</strong>
              <span className="muted"> {h.created_at}</span>
              <br />{h.text}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <button className="btn-mini" onClick={() => setStatus(hist.phone, 'EM_ATENDIMENTO')}>👤 Assumir</button>
          <button className="btn-mini" onClick={() => setStatus(hist.phone, 'BOT')}>🤖 Devolver ao bot</button>
          <button className="btn-mini" onClick={() => setStatus(hist.phone, 'ENCERRADO')}>Encerrar</button>
        </div>
      </>
    )
  }

  return (
    <>
      <h3>Conversas</h3>
      <div style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: 'auto' }} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          {['Todas', 'BOT', 'AGUARDANDO_ATENDENTE', 'EM_ATENDIMENTO', 'ENCERRADO'].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <div className="rp-tabela-wrap">
        <table className="rp-tabela">
          <thead><tr><th>Cliente</th><th>Telefone</th><th>Status</th><th>Última msg</th><th>Ações</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.phone}>
                <td>{c.name || '—'}</td>
                <td>{c.phone}</td>
                <td><span className={`wa-tag ${c.attendance_status}`}>{c.attendance_status}</span></td>
                <td>{(c.last_message || '').slice(0, 50)}</td>
                <td>
                  <button className="btn-mini" onClick={() => openConv(c.phone)}>Abrir</button>
                  <button className="btn-mini" onClick={() => setStatus(c.phone, 'EM_ATENDIMENTO')}>👤 Assumir</button>
                  <button className="btn-mini" onClick={() => setStatus(c.phone, 'BOT')}>🤖</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Intents ──
function WaIntencoes({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [intents, setIntents] = useState<Intent[]>([])
  const [novoFrase, setNovoFrase] = useState<Record<string, string>>({})
  const load = useCallback(() => { wp('get', '/intents').then((r) => setIntents((r as Record<string, unknown>).intents as Intent[])).catch(() => {}) }, [wp])
  useEffect(() => { load() }, [load])
  const addPhrase = async (name: string) => {
    const phrase = novoFrase[name]
    if (!phrase?.trim()) return
    await wp('post', '/intents/phrase/add', { intent: name, phrase: phrase.trim() })
    setNovoFrase((p) => ({ ...p, [name]: '' }))
    load()
  }
  const delPhrase = async (id: number) => { await wp('post', '/intents/phrase/remove', { id }); load() }
  return (
    <>
      <h3>Intenções</h3>
      {intents.map((it) => (
        <details key={it.name} open={it.name === 'HUMAN_HANDOFF'} className="wa-details">
          <summary><strong>{it.name}</strong> · {it.enabled ? '✅' : '⛔'} · prioridade {it.priority}</summary>
          <p className="nota-config">{it.description || 'Sem descrição'}</p>
          <ul>
            {it.phrases.map((p) => (
              <li key={p.id}>{p.phrase} <button className="btn-mini" onClick={() => delPhrase(p.id)}>✕</button></li>
            ))}
            {it.phrases.length === 0 && <li className="nota-config">Sem frases</li>}
          </ul>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input className="input" placeholder="Nova frase" value={novoFrase[it.name] || ''} onChange={(e) => setNovoFrase((p) => ({ ...p, [it.name]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && addPhrase(it.name)} style={{ flex: 1 }} />
            <button className="btn-mini" onClick={() => addPhrase(it.name)}>+ Adicionar</button>
          </div>
        </details>
      ))}
    </>
  )
}

// ── Messages ──
function WaMensagens({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [msgs, setMsgs] = useState<Mensagem[]>([])
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [texto, setTexto] = useState('')
  const [previa, setPrevia] = useState('')
  const load = useCallback(() => { wp('get', '/messages').then((r) => setMsgs((r as Record<string, unknown>).messages as Mensagem[])).catch(() => {}) }, [wp])
  useEffect(() => { load() }, [load])
  const cats = [...new Set(msgs.map((m) => m.category))]
  const list = msgs.filter((m) => (!cat || m.category === cat) && (!busca || m.key.includes(busca) || m.name.toLowerCase().includes(busca.toLowerCase())))
  const save = async (key: string) => { await wp('post', '/messages/save', { key, text: texto, active: true }); setEditando(null); load() }
  const restore = async (key: string) => { if (!confirm('Restaurar o texto padrão?')) return; await wp('post', '/messages/restore', { key }); load() }
  const preview = async (key: string) => { const r = await wp('post', '/messages/preview', { key }); setPrevia((r as Record<string, unknown>).preview as string) }

  return (
    <>
      <h3>Mensagens do Atendimento</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <input className="input" placeholder="Buscar mensagem..." value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1 }} />
        <select className="input" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Todas</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {list.map((m) => (
        <details key={m.key} className="wa-details">
          <summary><strong>{m.name}</strong> · <code style={{ fontSize: 11 }}>{m.key}</code> {m.isDefault ? <span className="nota-config">(padrão)</span> : m.active ? '✅' : '⛔'}</summary>
          {editando === m.key ? (
            <div>
              <p className="nota-config">Categoria: <strong>{m.category}</strong></p>
              <textarea className="input" value={texto} onChange={(e) => setTexto(e.target.value)} style={{ minHeight: 80 }} />
              <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {m.variables.map((v) => <button key={v} className="btn-mini" onClick={() => setTexto((t) => t + ' {' + v + '}')}>{'{' + v + '}'}</button>)}
              </div>
              {previa && <pre className="wa-pre">{previa}</pre>}
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <button className="btn-mini" onClick={() => preview(m.key)}>👁 Testar</button>
                <button className="btn-mini" style={{ background: '#16a34a', color: '#fff' }} onClick={() => save(m.key)}>💾 Salvar</button>
                <button className="btn-mini" onClick={() => restore(m.key)}>↩ Restaurar</button>
                <button className="btn-mini" onClick={() => { setEditando(null); setPrevia('') }}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button className="btn-mini" onClick={() => { setEditando(m.key); setTexto(m.text); setPrevia('') }}>Editar</button>
          )}
        </details>
      ))}
    </>
  )
}

// ── Menu ──
function WaMenu({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [items, setItems] = useState<MenuItem[]>([])
  const [novo, setNovo] = useState({ position: 0, label: '', action: 'products' })
  const load = useCallback(() => { wp('get', '/menu').then((r) => setItems((r as Record<string, unknown>).items as MenuItem[])).catch(() => {}) }, [wp])
  useEffect(() => { load() }, [load])
  const saveItem = async (it: MenuItem) => { await wp('post', '/menu/save', it); load() }
  const delItem = async (id: number) => { if (!confirm('Excluir?')) return; await wp('post', '/menu/delete', { id }); load() }
  const addItem = async () => { if (!novo.label.trim()) return; await wp('post', '/menu/save', { ...novo, enabled: true }); setNovo({ position: 0, label: '', action: 'products' }); load() }
  const acoes = ['products', 'search', 'order', 'my_orders', 'handoff', 'hours']
  return (
    <>
      <h3>Menu do WhatsApp</h3>
      <p className="nota-config">Sem opções cadastradas o bot usa o menu padrão interno.</p>
      <div className="rp-tabela-wrap">
        <table className="rp-tabela">
          <thead><tr><th>#</th><th>Texto</th><th>Ação</th><th>Ativo</th><th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.position}</td>
                <td>{it.label}</td>
                <td><code>{it.action}</code></td>
                <td>{it.enabled ? '✅' : '⛔'}</td>
                <td>
                  <button className="btn-mini" onClick={() => saveItem({ ...it, enabled: !it.enabled })}>{it.enabled ? 'Desativar' : 'Ativar'}</button>
                  <button className="btn-mini" onClick={() => delItem(it.id)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ marginTop: 16 }}>Nova opção</h4>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input className="input" type="number" style={{ width: 60 }} placeholder="#" value={novo.position || ''} onChange={(e) => setNovo({ ...novo, position: Number(e.target.value) })} />
        <input className="input" placeholder="Texto" value={novo.label} onChange={(e) => setNovo({ ...novo, label: e.target.value })} style={{ flex: 1 }} />
        <select className="input" style={{ width: 'auto' }} value={novo.action} onChange={(e) => setNovo({ ...novo, action: e.target.value })}>
          {acoes.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button className="btn-primario" onClick={addItem}>Adicionar</button>
      </div>
    </>
  )
}

// ── Products ──
function WaProdutos({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [prods, setProds] = useState<Produto[]>([])
  const load = useCallback(() => { wp('get', '/products').then((r) => setProds((r as Record<string, unknown>).products as Produto[])).catch(() => {}) }, [wp])
  useEffect(() => { load() }, [load])
  const toggleVis = async (id: number, visible: boolean) => { await wp('post', '/products/visible', { id, visible }); load() }
  return (
    <>
      <h3>Produtos</h3>
      <p className="nota-config">Controla a visibilidade no WhatsApp — nunca altera estoque real.</p>
      <div className="rp-tabela-wrap">
        <table className="rp-tabela">
          <thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Visível</th></tr></thead>
          <tbody>
            {prods.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.category || '—'}</td>
                <td>{fmtBRL(p.price)}</td>
                <td>{p.stock}</td>
                <td>{p.available === 1 && Number(p.stock) > 0 ? (
                  <input type="checkbox" checked={!!p.whatsapp_visible} onChange={(e) => toggleVis(p.id, e.target.checked)} />
                ) : <span className="nota-config">Fora</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Delivery ──
function WaEntrega({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [s, setS] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => { wp('get', '/delivery/settings').then((r) => setS((r as Record<string, unknown>).settings as Record<string, string>)).catch(() => {}) }, [wp])
  const save = async () => {
    await wp('post', '/delivery/settings', s)
    setMsg('Salvo.')
  }
  const k = (key: string) => s[key] ?? ''
  return (
    <>
      <h3>Entrega — Configuração</h3>
      {msg && <p className="nota-config">{msg}</p>}
      <div className="wa-grid" style={{ maxWidth: 600 }}>
        <label className="config-campo">Modo
          <select className="input" value={k('delivery_mode')} onChange={(e) => setS({ ...s, delivery_mode: e.target.value })}>
            <option value="fixed">Taxa fixa</option>
            <option value="distance">Por distância</option>
            <option value="zone">Por área</option>
          </select>
        </label>
        <label className="config-campo">Taxa fixa (R$)
          <input className="input" value={k('fixed_fee')} onChange={(e) => setS({ ...s, fixed_fee: e.target.value })} />
        </label>
        <label className="config-campo">Frete grátis acima (R$)
          <input className="input" value={k('free_above')} onChange={(e) => setS({ ...s, free_above: e.target.value })} />
        </label>
        <label className="config-campo">Pedido mínimo (R$)
          <input className="input" value={k('min_order')} onChange={(e) => setS({ ...s, min_order: e.target.value })} />
        </label>
      </div>
      <button className="btn-primario" onClick={save} style={{ marginTop: 12 }}>Salvar</button>
    </>
  )
}

// ── Settings ──
function WaConfig({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [s, setS] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => { wp('get', '/delivery/settings').then((r) => setS((r as Record<string, unknown>).settings as Record<string, string>)).catch(() => {}) }, [wp])
  const save = async () => { await wp('post', '/delivery/settings', s); setMsg('Salvo.') }
  return (
    <>
      <h3>Configurações gerais</h3>
      {msg && <p className="nota-config">{msg}</p>}
      <div className="wa-grid" style={{ maxWidth: 600 }}>
        <label className="config-campo">Timeout da conversa (min)
          <input className="input" value={s.conversation_timeout_minutes ?? '60'} onChange={(e) => setS({ ...s, conversation_timeout_minutes: e.target.value })} />
        </label>
        <label className="config-campo">Mensagem fora de expediente
          <textarea className="input" value={s.closed_message ?? ''} onChange={(e) => setS({ ...s, closed_message: e.target.value })} style={{ minHeight: 60 }} />
        </label>
      </div>
      <button className="btn-primario" onClick={save} style={{ marginTop: 12 }}>Salvar</button>
    </>
  )
}

// ── Backup ──
function WaBackup({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [msg, setMsg] = useState('')
  const exportar = async () => {
    try {
      const r = await wp('get', '/backup/export')
      const blob = new Blob([JSON.stringify((r as Record<string, unknown>).backup, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'whatsapp-config.json'
      a.click()
      setMsg('Exportado.')
    } catch (e) {
      setMsg(`Erro: ${(e as Error).message}`)
    }
  }
  const importar = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      try {
        const parsed = JSON.parse(text)
        await wp('post', '/backup/import', { backup: parsed })
        setMsg('Configurações importadas.')
      } catch (e) {
        setMsg(`Erro: ${(e as Error).message}`)
      }
    }
    input.click()
  }
  return (
    <>
      <h3>Backup das configurações</h3>
      {msg && <p className="nota-config">{msg}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primario" onClick={exportar}>Exportar configurações</button>
        <button className="btn-secundario" onClick={importar}>Importar (arquivo .json)</button>
      </div>
      <p className="nota-config" style={{ marginTop: 8 }}>Contém mensagens, intenções, frases, menu, categorias, entrega e configurações comerciais.</p>
    </>
  )
}
