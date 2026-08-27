import { useCallback, useEffect, useState } from 'react'
import { getWhatsAppApi } from '../../shared/db'

type PainelWhatsApp = 'visao' | 'delivery' | 'pedidos' | 'automacao' | 'catalogo' | 'regras' | 'configuracoes'

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

interface Pedido {
  id: number
  numero: string
  cliente_nome: string
  cliente_telefone: string
  cliente_endereco?: string
  observacoes?: string
  subtotal: number
  taxa_entrega: number
  total: number
  status: string
  criado_em: string
}

interface PedidoItem {
  name: string
  qty: number
  unit_price: number
  subtotal: number
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

const MENU_ITENS: [PainelWhatsApp, string][] = [
  ['visao', 'Visão geral'],
  ['delivery', 'Delivery'],
  ['pedidos', 'Pedidos'],
  ['automacao', 'Automação'],
  ['catalogo', 'Catálogo'],
  ['regras', 'Regras e preços'],
  ['configuracoes', 'Configurações']
]

export default function AtendimentoWhatsApp() {
  const [tela, setTela] = useState<PainelWhatsApp>('visao')
  const [msg, setMsg] = useState('')

  const wp = useCallback(async <T = Record<string, unknown>>(method: 'get' | 'post', path: string, body?: unknown): Promise<T> => {
    if (method === 'get') {
      return getWhatsAppApi().get(path) as Promise<T>
    }
    return getWhatsAppApi().post(path, body ?? {}) as Promise<T>
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h2>WhatsApp</h2>
        <div className="page-acoes">
          {msg && <span className="nota-config" style={{ marginRight: 8 }}>{msg}</span>}
        </div>
      </div>
      <div className="wa-layout">
        <nav className="wa-sidebar">
          {MENU_ITENS.map(([id, label]) => (
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
          {tela === 'visao' && <WaVisaoGeral wp={wp} />}
          {tela === 'delivery' && <WaDelivery wp={wp} />}
          {tela === 'pedidos' && <WaPedidos wp={wp} />}
          {tela === 'automacao' && <WaAutomacao wp={wp} />}
          {tela === 'catalogo' && <WaCatalogo wp={wp} />}
          {tela === 'regras' && <WaRegras wp={wp} />}
          {tela === 'configuracoes' && <WaConfig wp={wp} />}
        </div>
      </div>
    </div>
  )
}

// ── Visão geral ──
function WaVisaoGeral({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [d, setD] = useState<Dashboard | null>(null)
  const [wa, setWa] = useState<{ running: boolean; configured: boolean } | null>(null)
  useEffect(() => {
    wp('get', '/dashboard').then((r) => setD(r as unknown as Dashboard)).catch(() => {})
    getWhatsAppApi().status().then((r) => setWa(r)).catch(() => {})
  }, [wp])
  if (!d) return <p className="nota-config">Carregando...</p>

  const modoEntrega = d.delivery_mode === 'distance' ? 'Por distância' : d.delivery_mode === 'zone' ? 'Por área' : 'Taxa fixa'

  return (
    <>
      <h3>Visão geral</h3>
      <div className="wa-grid">
        <div className="wa-card">
          <span className="muted">Conexão WhatsApp</span>
          <strong style={{ color: wa?.running ? '#16a34a' : wa?.configured === false ? '#eab308' : '#dc2626' }}>
            {wa?.running ? '🟢 Conectado' : wa?.configured === false ? '🟡 Não configurado' : '🔴 Desconectado'}
          </strong>
        </div>
        <div className="wa-card"><span className="muted">Bot</span><strong>{d.bot_enabled ? '🟢 Ativo' : '🔴 Pausado'}</strong></div>
        <div className="wa-card"><span className="muted">Conversas</span><strong>{d.conversas}</strong></div>
        <div className="wa-card"><span className="muted">Sob bot</span><strong>{d.bot}</strong></div>
        <div className="wa-card"><span className="muted">Precisa de atendimento</span><strong>{d.humano}</strong></div>
        <div className="wa-card"><span className="muted">Pedidos iniciados</span><strong>{d.pedidos_iniciados}</strong></div>
        <div className="wa-card"><span className="muted">Finalizados</span><strong>{d.pedidos_finalizados}</strong></div>
        <div className="wa-card"><span className="muted">Cancelados</span><strong>{d.pedidos_cancelados}</strong></div>
        <div className="wa-card"><span className="muted">Faturamento WhatsApp</span><strong>{fmtBRL(d.valor_total)}</strong></div>
        <div className="wa-card"><span className="muted">Produtos no catálogo</span><strong>{d.produtos_disponiveis}</strong></div>
        <div className="wa-card"><span className="muted">Sem estoque</span><strong style={{ color: d.sem_estoque > 0 ? '#dc2626' : undefined }}>{d.sem_estoque}</strong></div>
        <div className="wa-card"><span className="muted">Entrega</span><strong>{modoEntrega}</strong></div>
      </div>

      {d.humano > 0 && (
        <div className="wa-card" style={{ borderColor: '#eab308', marginTop: 12 }}>
          <span style={{ color: '#eab308' }}>⚠ {d.humano} conversa(s) aguardando atendimento humano. Veja em Delivery/Conversas.</span>
        </div>
      )}
      {d.sem_estoque > 0 && (
        <div className="wa-card" style={{ borderColor: '#dc2626', marginTop: 8 }}>
          <span style={{ color: '#dc2626' }}>⚠ {d.sem_estoque} produto(s) sem estoque no catálogo.</span>
        </div>
      )}
    </>
  )
}

// ── Delivery (operacional) ──
function WaDelivery({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [aberto, setAberto] = useState<{ pedido: Pedido; itens: PedidoItem[] } | null>(null)
  const load = useCallback(() => {
    wp('get', '/delivery/pedidos').then((r) => setPedidos((r as Record<string, unknown>).pedidos as Pedido[])).catch(() => {})
  }, [wp])
  useEffect(() => { load() }, [load])
  const abrir = async (id: number) => {
    const r = await wp('get', `/pedidos/${id}`)
    const p = (r as Record<string, unknown>).pedido as Pedido
    const itens = (r as Record<string, unknown>).itens as PedidoItem[]
    setAberto({ pedido: p, itens })
  }

  if (aberto) {
    return (
      <>
        <button className="btn-mini" onClick={() => setAberto(null)}>← Voltar</button>
        <h3>Pedido {aberto.pedido.numero}</h3>
        <div className="wa-card">
          <p><strong>Cliente:</strong> {aberto.pedido.cliente_nome} ({aberto.pedido.cliente_telefone})</p>
          {aberto.pedido.cliente_endereco && <p><strong>Endereço:</strong> {aberto.pedido.cliente_endereco}</p>}
          {aberto.pedido.observacoes && <p><strong>Obs:</strong> {aberto.pedido.observacoes}</p>}
          <p><strong>Status:</strong> {aberto.pedido.status}</p>
        </div>
        <div className="rp-tabela-wrap" style={{ marginTop: 8 }}>
          <table className="rp-tabela">
            <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Subtotal</th></tr></thead>
            <tbody>
              {aberto.itens.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}</td>
                  <td>{it.qty}</td>
                  <td>{fmtBRL(it.unit_price)}</td>
                  <td>{fmtBRL(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8 }}>
          <p><strong>Subtotal:</strong> {fmtBRL(aberto.pedido.subtotal)} · <strong>Entrega:</strong> {fmtBRL(aberto.pedido.taxa_entrega)}</p>
          <p><strong>Total:</strong> {fmtBRL(aberto.pedido.total)}</p>
        </div>
      </>
    )
  }

  return (
    <>
      <h3>Delivery</h3>
      <p className="nota-config">Pedidos para entrega (novos / preparando / em rota) vindos do WhatsApp.</p>
      {pedidos.length === 0 && <p className="nota-config">Nenhum pedido de entrega no momento.</p>}
      <div className="rp-tabela-wrap">
        <table className="rp-tabela">
          <thead><tr><th>#</th><th>Cliente</th><th>Telefone</th><th>Endereço</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.id}>
                <td>{p.numero}</td>
                <td>{p.cliente_nome}</td>
                <td>{p.cliente_telefone}</td>
                <td>{(p.cliente_endereco || '—').slice(0, 40)}</td>
                <td>{fmtBRL(p.total)}</td>
                <td><span className="wa-tag">{p.status}</span></td>
                <td><button className="btn-mini" onClick={() => abrir(p.id)}>Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Pedidos (WhatsApp) ──
function WaPedidos({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [filtro, setFiltro] = useState('')
  const [aberto, setAberto] = useState<{ pedido: Pedido; itens: PedidoItem[] } | null>(null)
  const load = useCallback(() => {
    wp('get', '/pedidos').then((r) => setPedidos((r as Record<string, unknown>).pedidos as Pedido[])).catch(() => {})
  }, [wp])
  useEffect(() => { load() }, [load])
  const abrir = async (id: number) => {
    const r = await wp('get', `/pedidos/${id}`)
    setAberto({ pedido: (r as Record<string, unknown>).pedido as Pedido, itens: (r as Record<string, unknown>).itens as PedidoItem[] })
  }

  const statuses = ['novo', 'preparando', 'em_rota', 'finalizado', 'cancelado']
  const list = !filtro ? pedidos : pedidos.filter((p) => p.status === filtro)

  if (aberto) {
    return (
      <>
        <button className="btn-mini" onClick={() => setAberto(null)}>← Voltar</button>
        <h3>Pedido {aberto.pedido.numero}</h3>
        <div className="wa-card">
          <p><strong>Cliente:</strong> {aberto.pedido.cliente_nome} ({aberto.pedido.cliente_telefone})</p>
          {aberto.pedido.cliente_endereco && <p><strong>Endereço:</strong> {aberto.pedido.cliente_endereco}</p>}
          {aberto.pedido.observacoes && <p><strong>Obs:</strong> {aberto.pedido.observacoes}</p>}
          <p><strong>Status:</strong> {aberto.pedido.status} · <strong>Criado em:</strong> {aberto.pedido.criado_em}</p>
        </div>
        <div className="rp-tabela-wrap" style={{ marginTop: 8 }}>
          <table className="rp-tabela">
            <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Subtotal</th></tr></thead>
            <tbody>
              {aberto.itens.map((it, i) => (
                <tr key={i}><td>{it.name}</td><td>{it.qty}</td><td>{fmtBRL(it.unit_price)}</td><td>{fmtBRL(it.subtotal)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8 }}>
          <p><strong>Subtotal:</strong> {fmtBRL(aberto.pedido.subtotal)} · <strong>Entrega:</strong> {fmtBRL(aberto.pedido.taxa_entrega)}</p>
          <p><strong>Total:</strong> {fmtBRL(aberto.pedido.total)}</p>
        </div>
      </>
    )
  }

  return (
    <>
      <h3>Pedidos do WhatsApp</h3>
      <div style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: 'auto' }} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todos</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="rp-tabela-wrap">
        <table className="rp-tabela">
          <thead><tr><th>#</th><th>Cliente</th><th>Telefone</th><th>Total</th><th>Status</th><th>Criado</th><th></th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.numero}</td>
                <td>{p.cliente_nome}</td>
                <td>{p.cliente_telefone}</td>
                <td>{fmtBRL(p.total)}</td>
                <td><span className={`wa-tag ${p.status}`}>{p.status}</span></td>
                <td>{p.criado_em}</td>
                <td><button className="btn-mini" onClick={() => abrir(p.id)}>Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Automação ──
function WaAutomacao({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [secao, setSecao] = useState<'bot' | 'intencoes' | 'mensagens'>('bot')
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {([['bot', 'Atendimento'], ['intencoes', 'Intenções'], ['mensagens', 'Mensagens']] as const).map(([id, label]) => (
          <button key={id} className={`btn-mini ${secao === id ? '' : ''}`} style={secao === id ? { background: '#1f2937', color: '#fff' } : undefined} onClick={() => setSecao(id)}>{label}</button>
        ))}
      </div>
      {secao === 'bot' && <WaBot wp={wp} />}
      {secao === 'intencoes' && <WaIntencoes wp={wp} />}
      {secao === 'mensagens' && <WaMensagens wp={wp} />}
    </>
  )
}

// ── Catálogo ──
function WaCatalogo({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [prods, setProds] = useState<Produto[]>([])
  const load = useCallback(() => { wp('get', '/products').then((r) => setProds((r as Record<string, unknown>).products as Produto[])).catch(() => {}) }, [wp])
  useEffect(() => { load() }, [load])
  const toggleVis = async (id: number, visible: boolean) => { await wp('post', '/products/visible', { id, visible }); load() }
  return (
    <>
      <h3>Catálogo</h3>
      <p className="nota-config">Controla quais produtos aparecem para o cliente no WhatsApp — nunca altera o estoque real.</p>
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

// ── Regras e preços (entrega) ──
function WaRegras({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [s, setS] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => { wp('get', '/delivery/settings').then((r) => setS((r as Record<string, unknown>).settings as Record<string, string>)).catch(() => {}) }, [wp])
  const save = async () => { await wp('post', '/delivery/settings', s); setMsg('Salvo.') }
  const k = (key: string) => s[key] ?? ''
  return (
    <>
      <h3>Regras e preços da entrega</h3>
      {msg && <p className="nota-config">{msg}</p>}
      <div className="wa-grid" style={{ maxWidth: 600 }}>
        <label className="config-campo">Modo de cobrança
          <select className="input" value={k('delivery_mode')} onChange={(e) => setS({ ...s, delivery_mode: e.target.value })}>
            <option value="fixed">Taxa fixa</option>
            <option value="distance">Por distância</option>
            <option value="zone">Por área</option>
          </select>
        </label>
        <label className="config-campo">Taxa fixa (R$)
          <input className="input" value={k('fixed_fee')} onChange={(e) => setS({ ...s, fixed_fee: e.target.value })} />
        </label>
        <label className="config-campo">Frete grátis acima de (R$)
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

// ── Settings (gerais) ──
function WaConfig({ wp }: { wp: (m: 'get' | 'post', p: string, b?: unknown) => Promise<Record<string, unknown>> }) {
  const [s, setS] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => { wp('get', '/delivery/settings').then((r) => setS((r as Record<string, unknown>).settings as Record<string, string>)).catch(() => {}) }, [wp])
  const save = async () => { await wp('post', '/delivery/settings', s); setMsg('Salvo.') }
  return (
    <>
      <h3>Configurações</h3>
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
      <WaBackup wp={wp} />
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
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
      <h4>Backup das configurações</h4>
      {msg && <p className="nota-config">{msg}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primario" onClick={exportar}>Exportar configurações</button>
        <button className="btn-secundario" onClick={importar}>Importar (arquivo .json)</button>
      </div>
      <p className="nota-config" style={{ marginTop: 8 }}>Contém mensagens, intenções, frases, menu, categorias, entrega e configurações comerciais.</p>
    </div>
  )
}
