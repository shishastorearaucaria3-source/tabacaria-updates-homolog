import { useState, useEffect, useRef } from 'react'
import { getAuthApi, getDbApi, hasDbApi, Usuario, getServidorApi } from '../../shared/db'

interface UsuarioLogin {
  id: number
  nome: string
  login: string
  perfil: string
}

export default function Login({ onLogin }: { onLogin: (u: Usuario) => void }) {
  const [usuarios, setUsuarios] = useState<UsuarioLogin[]>([])
  const [idx, setIdx] = useState(-1)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [lembrar, setLembrar] = useState(() => localStorage.getItem('nex_lembrar_login') === '1')
  const senhaRef = useRef<HTMLInputElement>(null)

  const [ips, setIps] = useState<string[]>([])
  const [urlAtual, setUrlAtual] = useState('')
  const [modoLocal, setModoLocal] = useState(true)
  const [ipManual, setIpManual] = useState('')
  const [conexaoMsg, setConexaoMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [testando, setTestando] = useState(false)
  const [descobrindo, setDescobrindo] = useState(false)

  const carregarConexao = async () => {
    try {
      const c = await getServidorApi().conexao()
      setIps(c.ips)
      setUrlAtual(c.url)
      setModoLocal(c.local)
      if (!c.local && c.ips.length > 0) setIpManual(c.ips[0])
    } catch { /* servidor indisponível */ }
  }

  useEffect(() => {
    carregarConexao()
    // Descoberta automática: o terminal localiza o servidor na LAN sozinho,
    // sem digitar IP nem chave. Se encontrar, configura e carrega os usuários.
    const descobrirEConectar = async () => {
      if (!hasDbApi()) return
      setDescobrindo(true)
      try {
        const d = await getServidorApi().descobrir()
        if (d.servidores.length > 0) {
          // Usa o primeiro servidor encontrado (ou o que já estava configurado).
          const url = d.servidores[0]
          const c = await getServidorApi().configurarConexao({ url })
          setUrlAtual(c.url)
          setModoLocal(c.url.startsWith('http://localhost'))
          carregarUsuarios()
          setConexaoMsg({ ok: true, texto: `Servidor encontrado: ${url}` })
        } else {
          // Nenhum servidor na LAN; se já havia URL configurada, tenta ela.
          const c = await getServidorApi().conexao()
          if (c.url && !c.url.startsWith('http://localhost')) {
            const t = await getServidorApi().testar()
            if (t.ok) carregarUsuarios()
          }
        }
      } catch { /* servidor indisponível */ }
      setDescobrindo(false)
    }
    descobrirEConectar()
  }, [])

  useEffect(() => {
    if (!hasDbApi()) {
      setCarregando(false)
      return
    }
    getAuthApi()
      .session()
      .then((u) => {
        if (u) onLogin(u)
        else setCarregando(false)
      })
      .catch(() => setCarregando(false))
  }, [onLogin])

  // Carrega a lista de usuários via a rota pública de usuários (sem precisar de
// sessão). O terminal NUNCA digita nem armazena API Key — o servidor autoriza
// pela LAN e a autenticação real é o login de usuário/senha.
  const carregarUsuarios = () => {
    if (!hasDbApi()) return
    getAuthApi()
      .usuarios()
      .then((lista) => {
        setUsuarios(lista)
        const salvo = localStorage.getItem('nex_ultimo_login')
        if (salvo) {
          const i = lista.findIndex((u) => u.login === salvo)
          if (i !== -1) setIdx(i)
        }
      })
      .catch(() => {})
  }

  // Segurança: senhas nunca são persistidas neste computador. Remove qualquer
  // senha gravada por versões anteriores (ficavam em texto plano no localStorage).
  useEffect(() => {
    try { localStorage.removeItem('nex_senha_salva') } catch { /* ignore */ }
  }, [])

  const usuarioAtual = idx >= 0 && usuarios[idx] ? usuarios[idx] : null

  useEffect(() => {
    if (usuarioAtual) senhaRef.current?.focus()
  }, [usuarioAtual])

  const aplicarConexao = async (opcoes: { local?: boolean; ip?: string }) => {
    setConexaoMsg(null)
    setTestando(true)
    try {
      // Sem API Key: o servidor autoriza pela LAN; a autenticação real é o login.
      const r = await getServidorApi().configurarConexao(opcoes.local ? { local: true } : { local: false, ip: opcoes.ip })
      setUrlAtual(r.url)
      setIps(r.ips)
      setModoLocal(!!opcoes.local)
      const t = await getServidorApi().testar()
      setConexaoMsg(t.ok ? { ok: true, texto: `Conectado ao servidor em ${t.url}` } : { ok: false, texto: `Sem conexão: ${t.erro}` })
      carregarUsuarios()
    } catch (e) {
      setConexaoMsg({ ok: false, texto: `Erro: ${(e as Error).message}` })
    } finally {
      setTestando(false)
    }
  }

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')
    if (!usuarioAtual) {
      setErro('Selecione um usuário com as setas ↑ ↓.')
      return
    }
    if (!senha) {
      setErro('Digite a senha.')
      return
    }
    const res = await getAuthApi().login(usuarioAtual.login, senha)
    if (res.ok && res.usuario) {
      try {
        localStorage.setItem('nex_ultimo_login', usuarioAtual.login)
        // "Lembrar" guarda apenas o login — a senha NUNCA é persistida.
        localStorage.setItem('nex_lembrar_login', lembrar ? '1' : '0')
        localStorage.removeItem('nex_senha_salva')
      } catch { /* ignore */ }
      onLogin(res.usuario)
    } else {
      setErro(res.erro ?? 'Senha incorreta.')
      setSenha('')
      senhaRef.current?.focus()
    }
  }

  if (carregando) return <div className="login-loading">Carregando...</div>

  return (
    <div className="login">
      <form className="login-box" onSubmit={entrar}>
        <h1>Sistema Loja Tabacaria</h1>
        <p className="login-sub">Acesso ao PDV e gestão</p>

        <div className="login-conexao">
          <div className="login-conexao-titulo">
            <strong>Conexão com o servidor</strong>
            <span>{modoLocal ? 'Neste computador' : `Rede: ${urlAtual.replace('http://', '')}`}</span>
          </div>

          <div className="login-conexao-modos">
            <button
              type="button"
              className={`login-modo ${modoLocal ? 'ativa' : ''}`}
              onClick={() => aplicarConexao({ local: true })}
            >
              Mesmo computador
            </button>
            <button
              type="button"
              className={`login-modo ${!modoLocal ? 'ativa' : ''}`}
              onClick={() => aplicarConexao({ local: false, ip: ipManual || ips[0] })}
            >
              Outro (rede)
            </button>
          </div>

          {!modoLocal && (
            <div className="login-rede">
              {ips.length > 0 && (
                <div className="login-ips">
                  <span>IPs detectados na rede:</span>
                  {ips.map((ip) => (
                    <button
                      key={ip}
                      type="button"
                      className={`login-ip ${ipManual === ip ? 'ativa' : ''}`}
                      onClick={() => {
                        setIpManual(ip)
                        aplicarConexao({ local: false, ip })
                      }}
                    >
                      {ip}
                    </button>
                  ))}
                </div>
              )}
              <div className="login-ip-manual">
                <input
                  type="text"
                  value={ipManual}
                  onChange={(e) => setIpManual(e.target.value)}
                  placeholder="Digite o IP do servidor, ex: 192.168.0.112"
                />
                <button type="button" className="btn-mini" onClick={() => aplicarConexao({ local: false, ip: ipManual })} disabled={testando || !ipManual.trim()}>
                  {testando ? 'Conectando...' : 'Conectar'}
                </button>
              </div>
              <p className="nota-config" style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                {descobrindo ? 'Procurando servidor na rede...' : 'O sistema procura o servidor automaticamente. Nenhuma chave é necessária.'}
              </p>
            </div>
          )}

          {conexaoMsg && (
            <div className={`login-conexao-msg ${conexaoMsg.ok ? 'ok' : 'erro'}`}>
              {conexaoMsg.ok ? '🟢 ' : '🔴 '} {conexaoMsg.texto}
            </div>
          )}
        </div>

        <label>
          Usuário
          <select
            className="login-select"
            value={usuarioAtual?.login ?? ''}
            onChange={(e) => {
              const i = usuarios.findIndex((u) => u.login === e.target.value)
              setIdx(i)
              setErro('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((prev) => {
                  const delta = e.key === 'ArrowDown' ? 1 : -1
                  const novo = prev < 0 ? (delta > 0 ? 0 : usuarios.length - 1) : (prev + delta + usuarios.length) % usuarios.length
                  return novo
                })
              }
            }}
          >
            <option value="">Selecione o usuário...</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.login}>
                {u.nome} {u.perfil === 'admin' ? '(admin)' : ''}
              </option>
            ))}
          </select>
        </label>

        {usuarioAtual && (
          <label>
            Senha
            <input
              ref={senhaRef}
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoFocus
            />
          </label>
        )}

        {erro && <div className="login-erro">{erro}</div>}
            <label className="login-lembrar">
              <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
              Lembrar meu login neste computador
            </label>
        <button type="submit" className="btn-primario btn-login" disabled={!usuarioAtual}>
          Entrar
        </button>
        <p className="login-hint">Use as setas ↑ ↓ para escolher o usuário e digite a senha.</p>
      </form>
    </div>
  )
}
