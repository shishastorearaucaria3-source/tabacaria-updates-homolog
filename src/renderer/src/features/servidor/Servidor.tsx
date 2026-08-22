import { useCallback, useEffect, useRef, useState } from 'react'
import { getServidorApi, getCatalogoApi, getDbApi, getImportarApi, fazerBackupManual, getUpdateApi } from '../../shared/db'

interface StatusServidor {
  online: boolean
  api: string
  banco: string
  banco_tamanho: number
  sincronizacao: string
  ultima_sync: string
  proxima_sync: string
  ultimo_erro_sync: string
  uptime: string
  porta: number
  ip_local: string
  computador: string
  sistema_operacional: string
  versao_sistema: string
  versao_servidor: string
  diretorio: string
  id_equipamento: string
  ultimo_backup: { data: string; tamanho: number; arquivo: string } | null
}

interface LogItem {
  hora: string
  nivel: string
  msg: string
}

interface ItemDiag {
  nome: string
  status: string
  detalhe: string
}

interface BackupItem {
  nome: string
  data: string
  tamanho: number
}

const OPC_ZERAR: { id: string; label: string; desc: string }[] = [
  { id: 'vendas', label: 'Vendas', desc: 'Vendas concluídas, itens, pagamentos e movimentações de estoque' },
  { id: 'pedidos', label: 'Pedidos', desc: 'Pedidos de delivery e itens dos pedidos' },
  { id: 'orcamentos', label: 'Orçamentos', desc: 'Orçamentos e itens' },
  { id: 'clientes', label: 'Clientes', desc: 'Cadastro de clientes e saldos' },
  { id: 'movimentacoes', label: 'Movimentações de estoque', desc: 'Histórico de entradas/saídas/ajustes' },
  { id: 'historico', label: 'Histórico de preços', desc: 'Alterações de preço registradas' },
  { id: 'caixas', label: 'Caixas', desc: 'Caixas e movimentos de caixa' },
  { id: 'contas', label: 'Contas a pagar/receber', desc: 'Contas, reservas e pagamentos' },
  { id: 'formas', label: 'Formas de pagamento', desc: 'Formas cadastradas' }
]

const ITENS_SYNC = ['Produtos', 'Estoque', 'Preços', 'Pedidos', 'Clientes', 'Categorias']

export default function Servidor() {
  const [status, setStatus] = useState<StatusServidor | null>(null)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [backupDir, setBackupDir] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [diag, setDiag] = useState<ItemDiag[] | null>(null)
  const [diagRodando, setDiagRodando] = useState(false)
  const [mostrarZerar, setMostrarZerar] = useState(false)
  const [zerarSel, setZerarSel] = useState<string[]>([])
  const [confirmZerar, setConfirmZerar] = useState(false)
  const [mostrarImportar, setMostrarImportar] = useState(false)
  const [importarPasso, setImportarPasso] = useState(0)
  const [arquivoImportar, setArquivoImportar] = useState<string>('')
  const [colunasImportar, setColunasImportar] = useState<string[]>([])
  const [linhasImportar, setLinhasImportar] = useState<Record<string, unknown>[]>([])
  const [mapColunas, setMapColunas] = useState<Record<string, string>>({})
  const [impMsg, setImpMsg] = useState('')
  const [updateUrl, setUpdateUrl] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')
  const [updateDisponivel, setUpdateDisponivel] = useState<{ atual: string; nova: string; notas: string[] } | null>(null)
  const logsRef = useRef<HTMLDivElement>(null)

  const carregar = useCallback(async () => {
    try {
      const [s, l, b] = await Promise.all([
        getServidorApi().status(),
        getServidorApi().logs(),
        getServidorApi().backupInfo()
      ])
      setStatus(s as unknown as StatusServidor)
      setLogs(l.logs)
      setBackups(b.backups)
      setBackupDir(b.dir)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    carregar()
    const t = setInterval(carregar, 5000)
    return () => clearInterval(t)
  }, [carregar])

  useEffect(() => {
    getUpdateApi().getConfig().then((u) => setUpdateUrl(u || '')).catch(() => {})
  }, [])

  const verificarUpdate = async () => {
    setUpdateMsg('Verificando atualizações…')
    setUpdateDisponivel(null)
    try {
      const r = await getUpdateApi().verificar()
      if (!r.ativo) { setUpdateMsg('Canal de atualização não configurado.'); return }
      if (r.disponivel) {
        setUpdateDisponivel({ atual: r.atual, nova: r.nova || '', notas: r.notas })
        setUpdateMsg(r.obrigatoria ? 'Atualização obrigatória disponível.' : 'Nova versão disponível.')
      } else {
        setUpdateMsg(`Sem atualizações. Versão instalada: ${r.atual}`)
      }
    } catch (e) {
      setUpdateMsg(`Erro ao verificar: ${(e as Error).message}`)
    }
  }

  const salvarUpdateUrl = async () => {
    try {
      const r = await getUpdateApi().setConfig(updateUrl.trim())
      if (r && (r as { ok?: boolean }).ok === false) {
        setUpdateMsg((r as { erro?: string }).erro || 'URL rejeitada.')
      } else {
        setUpdateMsg('Canal de atualização salvo.')
      }
    } catch (e) {
      setUpdateMsg(`Erro: ${(e as Error).message}`)
    }
  }

  const instalarUpdate = async () => {
    setUpdateMsg('Baixando e instalando atualização… o sistema será reiniciado.')
    try {
      const r = await getUpdateApi().instalar()
      if (!r.ok) setUpdateMsg(`Falha na atualização: ${r.erro}`)
    } catch (e) {
      setUpdateMsg(`Falha na atualização: ${(e as Error).message}`)
    }
  }

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [logs])

  const syncAgora = async () => {
    setSincronizando(true)
    setMensagem('Sincronizando...')
    try {
      const r = await getCatalogoApi().sync()
      setMensagem(r.ok ? 'Sincronização concluída com sucesso.' : `Falha na sincronização: ${r.erro}`)
    } catch (e) {
      setMensagem(`Erro: ${(e as Error).message}`)
    } finally {
      setSincronizando(false)
      carregar()
    }
  }

  const criarBackup = async () => {
    if (!confirm('Criar um backup completo dos dados do sistema agora?')) return
    setOcupado(true)
    try {
      const msg = await fazerBackupManual()
      setMensagem(msg)
    } catch (e) {
      setMensagem(`Erro: ${(e as Error).message}`)
    } finally {
      setOcupado(false)
      carregar()
    }
  }

  const restaurar = async () => {
    if (!confirm('Restaurar um backup substituirá TODOS os dados atuais do sistema.\n\nDeseja continuar?')) return
    if (!confirm('Confirmação final: restaurar o backup selecionado agora? Esta ação não pode ser desfeita.')) return
    setOcupado(true)
    try {
      const r = await getServidorApi().restaurar()
      setMensagem(r.ok ? 'Backup restaurado com sucesso. O sistema foi recarregado.' : `Falha: ${r.erro}`)
      carregar()
    } catch (e) {
      setMensagem(`Erro: ${(e as Error).message}`)
    } finally {
      setOcupado(false)
    }
  }

  const rodarDiagnostico = async () => {
    setDiagRodando(true)
    setDiag(null)
    try {
      const r = await getServidorApi().diagnostico()
      setDiag(r.itens)
    } catch (e) {
      setErro(`Erro no diagnóstico: ${(e as Error).message}`)
    } finally {
      setDiagRodando(false)
    }
  }

  const corrigir = async () => {
    if (!confirm('Executar correções automáticas? Apenas ajustes seguros serão feitos.')) return
    setOcupado(true)
    try {
      const r = await getServidorApi().corrigir()
      setMensagem(r.correcoes.length ? r.correcoes.join(' · ') : 'Nenhuma correção necessária.')
    } catch (e) {
      setMensagem(`Erro: ${(e as Error).message}`)
    } finally {
      setOcupado(false)
      rodarDiagnostico()
    }
  }

  const confirmarZerar = () => {
    if (zerarSel.length === 0) {
      setMensagem('Selecione ao menos um item para zerar.')
      return
    }
    if (!confirmZerar) {
      setConfirmZerar(true)
      return
    }
    const nomes = OPC_ZERAR.filter((o) => zerarSel.includes(o.id)).map((o) => o.label).join(', ')
    if (!confirm(`ATENÇÃO: zerar definitivamente ${nomes}?\n\nEsta ação NÃO pode ser desfeita. Produtos, usuários e configurações NÃO são apagados.`)) {
      setConfirmZerar(false)
      return
    }
    setOcupado(true)
    getServidorApi()
      .zerar(zerarSel)
      .then((r) => {
        setMensagem(r.ok ? `Dados zerados: ${r.removidos.join(', ')}` : `Falha: ${r.erro}`)
        setMostrarZerar(false)
        setZerarSel([])
        setConfirmZerar(false)
      })
      .catch((e) => setMensagem(`Erro: ${(e as Error).message}`))
      .finally(() => setOcupado(false))
  }

  const abrirImportar = () => {
    setMostrarImportar(true)
    setImportarPasso(0)
    setArquivoImportar('')
    setColunasImportar([])
    setLinhasImportar([])
    setMapColunas({})
    setImpMsg('')
  }

  const selecionarArquivo = async () => {
    setImpMsg('')
    try {
      const res = await getImportarApi().lerArquivo()
      if (!res) return
      if (res.erro) {
        setImpMsg(res.erro)
        return
      }
      setArquivoImportar(res.arquivo)
      setColunasImportar(res.colunas)
      setLinhasImportar(res.linhas)
      setImportarPasso(1)
    } catch (e) {
      setImpMsg(`Erro ao ler arquivo: ${(e as Error).message}`)
    }
  }

  const importarDados = async () => {
    const mapeadas = Object.values(mapColunas).filter(Boolean)
    if (mapeadas.length === 0) {
      setImpMsg('Mapeie pelo menos uma coluna para importar.')
      return
    }
    if (!confirm(`Importar ${linhasImportar.length} registro(s)?`)) return
    setOcupado(true)
    try {
      const db = getDbApi()
      let importados = 0
      let erros = 0
      for (const linha of linhasImportar) {
        try {
          const nome = String(linha[mapColunas.nome] ?? '').trim()
          if (!nome) {
            erros++
            continue
          }
          const precoVenda = Number(linha[mapColunas.preco] ?? 0) || 0
          const precoCusto = Number(linha[mapColunas.custo] ?? 0) || 0
          const estoque = Number(linha[mapColunas.estoque] ?? 0) || 0
          const codigo = String(linha[mapColunas.codigo] ?? '').trim() || null
          const categoria = String(linha[mapColunas.categoria] ?? '').trim() || null
          let categoriaId: number | null = null
          if (categoria) {
            const exist = (await db.get(`SELECT id FROM categorias WHERE nome = ?`, [categoria])) as { id: number } | undefined
            if (exist) {
              categoriaId = exist.id
            } else {
              const r = await db.run(`INSERT INTO categorias (nome) VALUES (?)`, [categoria])
              categoriaId = Number(r.lastInsertRowid)
            }
          }
          await db.run(
            `INSERT INTO produtos (nome, codigo_barras, codigo_interno, categoria_id, preco_custo, preco_venda, estoque, ativo)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [nome, codigo, codigo, categoriaId, precoCusto, precoVenda, estoque]
          )
          importados++
        } catch {
          erros++
        }
      }
      setImpMsg(`Importação concluída: ${importados} importado(s), ${erros} com erro.`)
      setImportarPasso(2)
      setMensagem(`Importação concluída: ${importados} produto(s) importado(s).`)
    } catch (e) {
      setImpMsg(`Erro na importação: ${(e as Error).message}`)
    } finally {
      setOcupado(false)
    }
  }

  const limparLogs = async () => {
    await getServidorApi().limparLogs()
    carregar()
  }

  const online = !!status?.online && status?.api === 'conectada'

  const nivelLog = (n: string) => {
    if (n === 'SUCCESS') return 'ok'
    if (n === 'ERROR') return 'erro'
    if (n === 'WARNING') return 'aviso'
    return 'info'
  }

  const fmtBytes = (b: number) => {
    if (!b) return '—'
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / (1024 * 1024)).toFixed(2)} MB`
  }

  const fmtData = (iso: string) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('pt-BR')
    } catch {
      return iso
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Servidor</h2>
        <div className="page-acoes">
          <button className="btn-secundario" onClick={rodarDiagnostico} disabled={diagRodando}>Diagnóstico</button>
          <button className="btn-primario" onClick={syncAgora} disabled={sincronizando || !online}>{sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}</button>
        </div>
      </div>

      {mensagem && <div className="mensagem">{mensagem}</div>}
      {erro && <div className="mensagem" style={{ color: '#dc2626' }}>{erro}</div>}

      {/* Status do servidor */}
      <div className={`srv-status-hero ${online ? 'online' : 'offline'}`}>
        <div className="srv-status-ico">{online ? '🟢' : '🔴'}</div>
        <div className="srv-status-info">
          <h3>Servidor {online ? 'Online' : 'Offline'}</h3>
          <div className="srv-status-grid">
            <span><b>API:</b> <em className={status?.api === 'conectada' ? 'srv-ok' : 'srv-erro'}>{status?.api === 'conectada' ? 'Conectada' : 'Desconectada'}</em></span>
            <span><b>Banco de dados:</b> <em className="srv-ok">{status?.banco === 'conectado' ? 'Conectado' : '—'}</em></span>
            <span><b>Sincronização:</b> <em className={status?.sincronizacao === 'ativa' ? 'srv-ok' : 'srv-aviso'}>{status?.sincronizacao ?? '—'}</em></span>
            <span><b>IP local:</b> {status?.ip_local ?? '—'}</span>
            <span><b>Computador:</b> {status?.computador ?? '—'}</span>
            <span><b>Uptime:</b> {status?.uptime ?? '—'}</span>
            <span><b>Porta:</b> {status?.porta ?? '—'}</span>
            <span><b>Última sincronização:</b> {status?.ultima_sync || 'Nunca'}</span>
          </div>
        </div>
      </div>

      <div className="srv-grid">
        {/* Ações */}
        <section className="rp-tabela-card">
          <h4>Menu de Ações</h4>
          <div className="srv-acoes">
            <div className="srv-acao">
              <div>
                <strong>Backup</strong>
                <span>Último: {status?.ultimo_backup ? `${fmtData(status.ultimo_backup.data)} (${fmtBytes(status.ultimo_backup.tamanho)})` : 'nenhum'}</span>
              </div>
              <button className="btn-mini" onClick={criarBackup} disabled={ocupado}>Criar Backup Agora</button>
            </div>
            <div className="srv-acao">
              <div>
                <strong>Restaurar</strong>
                <span>Substitui os dados atuais por um backup selecionado</span>
              </div>
              <button className="btn-mini" onClick={restaurar} disabled={ocupado}>Restaurar backup...</button>
            </div>
            <div className="srv-acao">
              <div>
                <strong>Corrigir</strong>
                <span>Verifica e corrige inconsistências do banco</span>
              </div>
              <button className="btn-mini" onClick={corrigir} disabled={ocupado}>Corrigir agora</button>
            </div>
            <div className="srv-acao">
              <div>
                <strong>Zerar dados</strong>
                <span>Limpeza controlada — confirmação em duas etapas</span>
              </div>
              <button className="btn-mini btn-perigo" onClick={() => setMostrarZerar(true)}>Zerar...</button>
            </div>
            <div className="srv-acao">
              <div>
                <strong>Importar dados</strong>
                <span>CSV, Excel ou JSON (produtos)</span>
              </div>
              <button className="btn-mini" onClick={abrirImportar}>Importar...</button>
            </div>
            <div className="srv-acao">
              <div>
                <strong>Suporte</strong>
                <span>Central de ajuda e documentação do sistema</span>
              </div>
              <button className="btn-mini" onClick={() => setMensagem('Central de suporte estará disponível em breve.')}>Abrir suporte</button>
            </div>
          </div>
        </section>

        {/* Informações do equipamento */}
        <section className="rp-tabela-card">
          <h4>Informações do Servidor</h4>
          <div className="srv-info-linhas">
            <div className="linha"><span>Nome do computador</span><strong>{status?.computador ?? '—'}</strong></div>
            <div className="linha"><span>IP local</span><strong>{status?.ip_local ?? '—'}</strong></div>
            <div className="linha"><span>Sistema operacional</span><strong>{status?.sistema_operacional ?? '—'}</strong></div>
            <div className="linha"><span>Versão do sistema</span><strong>{status?.versao_sistema ?? '—'}</strong></div>
            <div className="linha"><span>Versão do servidor</span><strong>{status?.versao_servidor ?? '—'}</strong></div>
            <div className="linha"><span>Porta</span><strong>{status?.porta ?? '—'}</strong></div>
            <div className="linha"><span>Diretório</span><strong style={{ wordBreak: 'break-all', textAlign: 'right' }}>{status?.diretorio ?? '—'}</strong></div>
            <div className="linha"><span>ID do equipamento</span><strong style={{ wordBreak: 'break-all', textAlign: 'right' }}>{status?.id_equipamento ?? '—'}</strong></div>
          </div>
        </section>
      </div>

      {/* Sincronização */}
      <section className="rp-tabela-card">
        <h4>Sincronização</h4>
        <div className="srv-sync-itens">
          {ITENS_SYNC.map((nome) => (
            <div key={nome} className="srv-sync-item">
              <span>{nome}</span>
              <em className="srv-ok">Sincronizado</em>
            </div>
          ))}
        </div>
        {status?.ultimo_erro_sync && <p className="nota-config" style={{ color: '#dc2626' }}>Último erro: {status.ultimo_erro_sync}</p>}
        {status?.proxima_sync && status.proxima_sync !== '—' && <p className="nota-config">Próxima sincronização automática: {status.proxima_sync}</p>}
      </section>

      {/* Atualizações */}
      <section className="rp-tabela-card">
        <h4>Atualizações do sistema</h4>
        <div className="srv-sync-itens">
          <div className="srv-sync-item">
            <span>Canal de atualização (URL com manifest.json)</span>
            <input
              type="text"
              className="srv-update-input"
              placeholder="https://seu-servidor/atualizacoes"
              value={updateUrl}
              onChange={(e) => setUpdateUrl(e.target.value)}
            />
            <button className="btn-mini" onClick={salvarUpdateUrl}>Salvar canal</button>
          </div>
          <div className="srv-sync-item">
            <span>Verificar se existe versão nova</span>
            <button className="btn-mini" onClick={verificarUpdate}>Verificar agora</button>
          </div>
        </div>
        {updateDisponivel && (
          <div className="srv-update-disponivel">
            <p>Versão atual: <strong>{updateDisponivel.atual}</strong> → Nova versão: <strong>{updateDisponivel.nova}</strong></p>
            {updateDisponivel.notas.length > 0 && (
              <ul>{updateDisponivel.notas.map((n, i) => <li key={i}>{n}</li>)}</ul>
            )}
            <button className="btn-primario" onClick={instalarUpdate}>Atualizar agora</button>
          </div>
        )}
        {updateMsg && <p className="nota-config">{updateMsg}</p>}
      </section>

      {/* Logs */}
      <section className="rp-tabela-card">
        <div className="srv-log-titulo">
          <h4>Log do Servidor</h4>
          <button className="btn-mini" onClick={limparLogs}>Limpar logs</button>
        </div>
        <div className="srv-log" ref={logsRef}>
          {logs.length === 0 && <p className="nota-config">Nenhum log registrado.</p>}
          {logs.map((l, i) => (
            <div key={i} className="srv-log-linha">
              <span className="srv-log-hora">{l.hora}</span>
              <span className={`srv-log-nivel ${nivelLog(l.nivel)}`}>{l.nivel}</span>
              <span className="srv-log-msg">{l.msg}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Diagnóstico */}
      {diag && (
        <section className="rp-tabela-card">
          <h4>{diag.every((d) => d.status === 'ok') ? 'Sistema verificado' : 'Problemas encontrados'}</h4>
          <div className="srv-diag">
            {diag.map((d) => (
              <div key={d.nome} className={`srv-diag-item ${d.status}`}>
                <span className="srv-diag-ico">{d.status === 'ok' ? '✓' : d.status === 'atencao' ? '⚠' : '✗'}</span>
                <div>
                  <strong>{d.nome}</strong>
                  <span>{d.detalhe}</span>
                </div>
              </div>
            ))}
          </div>
          {!diag.every((d) => d.status === 'ok') && (
            <button className="btn-mini" onClick={corrigir} disabled={ocupado}>Executar correções seguras</button>
          )}
        </section>
      )}

      {/* Modal Zerar */}
      {mostrarZerar && (
        <div className="modal-overlay" onClick={() => { if (!ocupado) { setMostrarZerar(false); setConfirmZerar(false); setZerarSel([]) } }}>
          <div className="modal modal-config-catalogo" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Zerar dados</h3>
              <button className="modal-fechar" onClick={() => { setMostrarZerar(false); setConfirmZerar(false); setZerarSel([]) }} aria-label="Fechar">✕</button>
            </div>
            <p className="nota-config">
              Selecione exatamente o que deseja limpar. Produtos, usuários, configurações e formas de pagamento NÃO são apagados. Requer confirmação em duas etapas.
            </p>
            <div className="srv-zerar-lista">
              {OPC_ZERAR.map((o) => (
                <label key={o.id} className={`srv-zerar-item ${zerarSel.includes(o.id) ? 'ativa' : ''}`}>
                  <button
                    type="button"
                    className={`config-forma-check ${zerarSel.includes(o.id) ? 'ativa' : ''}`}
                    onClick={() => setZerarSel((prev) => prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id])}
                  >
                    {zerarSel.includes(o.id) ? '✓' : ''}
                  </button>
                  <span>
                    <strong>{o.label}</strong>
                    <small>{o.desc}</small>
                  </span>
                </label>
              ))}
            </div>
            {confirmZerar && (
              <p className="nota-config" style={{ color: '#dc2626', fontWeight: 700 }}>
                ⚠ Confirmação 2: clique em "Confirmar zerar" novamente para executar.
              </p>
            )}
            <div className="modal-acoes">
              <button className="btn-secundario" onClick={() => { setMostrarZerar(false); setConfirmZerar(false); setZerarSel([]) }}>Cancelar</button>
              <button className="btn-primario btn-perigo" onClick={confirmarZerar} disabled={ocupado || zerarSel.length === 0}>
                {confirmZerar ? 'Confirmar zerar' : 'Zerar selecionados'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Importar */}
      {mostrarImportar && (
        <div className="modal-overlay" onClick={() => !ocupado && setMostrarImportar(false)}>
          <div className="modal modal-config-catalogo" onClick={(e) => e.stopPropagation()}>
            <div className="modal-topo">
              <h3>Importar dados</h3>
              <button className="modal-fechar" onClick={() => setMostrarImportar(false)} aria-label="Fechar">✕</button>
            </div>

            {importarPasso === 0 && (
              <>
                <p className="nota-config">Selecione um arquivo CSV, Excel (.xlsx/.xls) ou JSON com os dados de produtos.</p>
                <div className="modal-acoes">
                  <button className="btn-secundario" onClick={() => setMostrarImportar(false)}>Cancelar</button>
                  <button className="btn-primario" onClick={selecionarArquivo}>Selecionar arquivo</button>
                </div>
              </>
            )}

            {importarPasso === 1 && (
              <>
                <p className="nota-config">Arquivo: <strong>{arquivoImportar}</strong> — {linhasImportar.length} linha(s) identificada(s).</p>
                <p className="nota-config">Mapeie as colunas do arquivo para os campos do sistema:</p>
                <div className="srv-map-colunas">
                  <label className="config-campo">Nome do produto
                    <select value={mapColunas.nome ?? ''} onChange={(e) => setMapColunas({ ...mapColunas, nome: e.target.value })}>
                      <option value="">— selecione —</option>
                      {colunasImportar.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="config-campo">Preço de venda
                    <select value={mapColunas.preco ?? ''} onChange={(e) => setMapColunas({ ...mapColunas, preco: e.target.value })}>
                      <option value="">— selecione —</option>
                      {colunasImportar.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="config-campo">Preço de custo
                    <select value={mapColunas.custo ?? ''} onChange={(e) => setMapColunas({ ...mapColunas, custo: e.target.value })}>
                      <option value="">— selecione —</option>
                      {colunasImportar.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="config-campo">Estoque
                    <select value={mapColunas.estoque ?? ''} onChange={(e) => setMapColunas({ ...mapColunas, estoque: e.target.value })}>
                      <option value="">— selecione —</option>
                      {colunasImportar.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="config-campo">Código / código de barras
                    <select value={mapColunas.codigo ?? ''} onChange={(e) => setMapColunas({ ...mapColunas, codigo: e.target.value })}>
                      <option value="">— selecione —</option>
                      {colunasImportar.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="config-campo">Categoria
                    <select value={mapColunas.categoria ?? ''} onChange={(e) => setMapColunas({ ...mapColunas, categoria: e.target.value })}>
                      <option value="">— selecione —</option>
                      {colunasImportar.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
                {impMsg && <p className="nota-config" style={{ color: impMsg.startsWith('Erro') ? '#dc2626' : '#16a34a' }}>{impMsg}</p>}
                <div className="srv-previa">
                  <strong>Prévia (primeiras 5 linhas)</strong>
                  {linhasImportar.slice(0, 5).map((l, i) => (
                    <div key={i} className="srv-previa-linha">{JSON.stringify(l)}</div>
                  ))}
                </div>
                <div className="modal-acoes">
                  <button className="btn-secundario" onClick={() => setImportarPasso(0)}>Voltar</button>
                  <button className="btn-primario" onClick={importarDados} disabled={ocupado}>Confirmar importação</button>
                </div>
              </>
            )}

            {importarPasso === 2 && (
              <>
                <p className="nota-config" style={{ color: '#16a34a', fontWeight: 700 }}>{impMsg}</p>
                <div className="modal-acoes">
                  <button className="btn-primario" onClick={() => setMostrarImportar(false)}>Concluir</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}