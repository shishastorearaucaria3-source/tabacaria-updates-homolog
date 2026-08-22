const $ = (id) => document.getElementById(id)
let estado = null
let resultado = null

function mostrar(id) {
  document.querySelectorAll('main > section').forEach((s) => s.classList.add('oculto'))
  $(id).classList.remove('oculto')
}

window.setup.onProgresso((info) => {
  $('etapa-progresso').textContent = info.etapa === 'servidor' ? 'Instalando servidor…' : 'Instalando aplicativo…'
  $('texto-progresso').textContent = `${info.arquivos} de ${info.total} arquivos`
  const pct = info.total ? Math.round((info.arquivos / info.total) * 100) : 0
  $('barra-preenchida').style.width = pct + '%'
  if (info.atual) $('etapa-progresso').textContent = 'Copiando: ' + info.atual
})

async function iniciar() {
  estado = await window.setup.estado()
  $('rodape-versao').textContent = 'Versão ' + estado.versaoNova
  if (estado.existe) {
    $('versao-atual').textContent = estado.versaoAtual || '—'
    $('versao-nova').textContent = estado.versaoNova
    $('tipo-atual').textContent = estado.tipoAtual === 'servidor' ? 'Servidor + Sistema' : 'Somente Sistema'
    mostrar('passo-existente')
  } else {
    mostrar('passo-escolha')
  }
}

async function executar(tipo) {
  mostrar('passo-progresso')
  const barra = $('barra-preenchida')
  const contBarra = document.querySelector('.barra')
  barra.style.width = '0%'
  contBarra.classList.add('ociosa')
  resultado = await window.setup.instalar(tipo)
  contBarra.classList.remove('ociosa')
  if (resultado.ok) {
    barra.style.width = '100%'
    $('btn-abrir').textContent = 'Abrir sistema'
    $('texto-concluido').textContent =
      tipo === 'servidor'
        ? 'O sistema completo foi instalado. O servidor inicia automaticamente com o Windows.'
        : 'O aplicativo foi instalado. Para conectar ao servidor, use a tela de login (opção "Outro (rede)").'
    $('btn-abrir').dataset.exe = resultado.exe || ''
    mostrar('passo-concluido')
  } else {
    $('texto-erro').textContent = resultado.erro || 'Erro desconhecido.'
    mostrar('passo-erro')
  }
}

$('btn-continuar').onclick = () => {
  const tipo = document.querySelector('input[name="tipo"]:checked').value
  executar(tipo)
}

$('btn-atualizar').onclick = async () => {
  mostrar('passo-progresso')
  $('titulo-progresso').textContent = 'Atualizando…'
  $('texto-progresso').textContent = 'Preparando…'
  $('etapa-progresso').textContent = ''
  $('barra-preenchida').style.width = '0%'
  document.querySelector('.barra').classList.add('ociosa')
  resultado = await window.setup.atualizar()
  document.querySelector('.barra').classList.remove('ociosa')
  if (resultado.ok) {
    $('barra-preenchida').style.width = '100%'
    $('btn-abrir').textContent = 'Abrir sistema'
    $('texto-concluido').textContent = 'Sistema atualizado. Banco e configurações preservados.'
    $('btn-abrir').dataset.exe = resultado.exe || ''
    mostrar('passo-concluido')
  } else {
    $('texto-erro').textContent = resultado.erro || 'Erro desconhecido.'
    mostrar('passo-erro')
  }
}

$('btn-reinstalar').onclick = async () => {
  mostrar('passo-progresso')
  $('titulo-progresso').textContent = 'Reinstalando…'
  $('texto-progresso').textContent = 'Preparando…'
  $('etapa-progresso').textContent = ''
  $('barra-preenchida').style.width = '0%'
  document.querySelector('.barra').classList.add('ociosa')
  resultado = await window.setup.reinstalar()
  document.querySelector('.barra').classList.remove('ociosa')
  if (resultado.ok) {
    $('barra-preenchida').style.width = '100%'
    $('btn-abrir').textContent = 'Abrir sistema'
    $('texto-concluido').textContent = 'Sistema reinstalado. Dados preservados.'
    $('btn-abrir').dataset.exe = resultado.exe || ''
    mostrar('passo-concluido')
  } else {
    $('texto-erro').textContent = resultado.erro || 'Erro desconhecido.'
    mostrar('passo-erro')
  }
}

$('btn-desinstalar').onclick = async () => {
  if (!confirm('Desinstalar o NossoSistema? Os dados do sistema (banco) serão preservados.')) return
  mostrar('passo-progresso')
  $('titulo-progresso').textContent = 'Desinstalando…'
  $('texto-progresso').textContent = 'Removendo arquivos e configurações…'
  $('etapa-progresso').textContent = ''
  $('barra-preenchida').style.width = '0%'
  document.querySelector('.barra').classList.add('ociosa')
  resultado = await window.setup.desinstalar()
  document.querySelector('.barra').classList.remove('ociosa')
  if (resultado.ok) {
    $('barra-preenchida').style.width = '100%'
    $('texto-concluido').textContent = 'Sistema desinstalado. Banco de dados preservado.'
    $('btn-abrir').dataset.exe = ''
    $('btn-abrir').textContent = 'Fechar'
    mostrar('passo-concluido')
  } else {
    $('texto-erro').textContent = resultado.erro || 'Erro desconhecido.'
    mostrar('passo-erro')
  }
}

$('btn-cancelar').onclick = () => window.setup.sair()
$('btn-erro-fechar').onclick = () => window.setup.sair()
$('btn-fechar').onclick = () => window.setup.sair()

$('btn-abrir').onclick = async () => {
  if ($('btn-abrir').dataset.exe) await window.setup.relancar($('btn-abrir').dataset.exe)
  window.setup.sair()
}

iniciar()
