import { join, dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirPadrao,
  pastaDadosApp,
  exeApp,
  gravarLogServidor,
  esperarAppFechado,
  copiarArvore,
  rodarComCaptura,
  gravarRegistro,
  gravarConfigServidor,
  removerServidorAutostart,
  criarAtalhos,
  criarAtalhoServidor,
  relançarApp,
  lerVersaoInstalada,
  lerTipoInstalado,
  AutoupdateResultado,
  obterMarkerPath,
  adquirirLock,
  validarEstruturaPayload,
  escreverMarkerAtomico,
} from './autoupdate-shared.js';

async function runAutoupdate(): Promise<void> {
  const installDir = process.env.SETUP_INSTALL_DIR;
  const payloadPath = process.env.SETUP_PAYLOAD_PATH;
  const tipo = process.env.SETUP_TIPO || 'servidor';
  const versaoEsperada = process.env.SETUP_VERSAO_ESPERADA || '0.0.0';

  if (!installDir || !payloadPath) {
    const err = 'SETUP_INSTALL_DIR e SETUP_PAYLOAD_PATH são obrigatórios';
    console.error('[autoupdate] ERRO:', err);
    const markerPath = obterMarkerPath();
    escreverMarkerAtomico(markerPath, {
      ok: false,
      versao: versaoEsperada,
      timestamp: new Date().toISOString(),
      estagio: 'inicio',
      erro: err,
    });
    process.exit(1);
  }

  gravarLogServidor(`[autoupdate] INICIO dir=${installDir} payload=${payloadPath} tipo=${tipo} versao=${versaoEsperada}`);

  const markerPath = obterMarkerPath();
  let lockCleanup = () => {};
  let extrator: string | null = null;
  // Preserva o update.url ORIGINAL (canal configurado pelo usuário) para
  // validar depois que a atualização NÃO o alterou. Não confundir com o canal
  // de download (SETUP_UPDATE_URL), que é onde o payload foi buscado.
  const urlPathOriginal = join(pastaDadosApp(), 'update.url');
  const updateUrlAntes = existsSync(urlPathOriginal) ? readFileSync(urlPathOriginal, 'utf8').trim() : '';

  // Remove markers de resultado de execuções ANTERIORES (já processados pelo
  // update.ts), preservando SEMPRE o marker atual — que é o único que o
  // processo pai ainda pode estar lendo.
  function limparMarkersAntigos(atual: string): void {
    try {
      for (const f of readdirSync(tmpdir())) {
        if (f.startsWith('nos-autoupdate-resultado-') && f.endsWith('.json')) {
          const p = join(tmpdir(), f);
          if (p !== atual) { try { rmSync(p, { force: true }) } catch { /* ignore */ } }
        }
      }
    } catch { /* ignore */ }
  }

  try {
    const lock = adquirirLock(installDir);
    if (!lock.ok) {
      const err = 'Outra atualização já está em andamento para esta instalação';
      gravarLogServidor(`[autoupdate] ${err}`);
      escreverMarkerAtomico(markerPath, {
        ok: false,
        versao: versaoEsperada,
        timestamp: new Date().toISOString(),
        estagio: 'lock',
        erro: err,
      });
      process.exit(1);
    }
    lockCleanup = lock.cleanup;
    gravarLogServidor('[autoupdate] Lock adquirido');

    gravarLogServidor('[autoupdate] Validando payload...');
    if (!existsSync(payloadPath)) {
      throw new Error(`Payload não encontrado: ${payloadPath}`);
    }

    gravarLogServidor('[autoupdate] Parando aplicação alvo...');
    await esperarAppFechado(installDir);
    gravarLogServidor('[autoupdate] Aplicação parada');

    gravarLogServidor('[autoupdate] Extraindo payload...');
    extrator = join(tmpdir(), `nos-autoupdate-extract-${Date.now()}`);
    mkdirSync(extrator, { recursive: true });
    const rExt = await rodarComCaptura(payloadPath, ['/S', `/D=${extrator}`], 420000);
    if (rExt.code !== 0) {
      throw new Error(`Extração do payload falhou (exit=${rExt.code ?? rExt.sinal}${rExt.erro ? `: ${rExt.erro}` : ''})`);
    }

    gravarLogServidor('[autoupdate] Validando estrutura do payload extraído...');
    const validacao = validarEstruturaPayload(extrator);
    if (!validacao.ok) {
      throw new Error(validacao.erro || 'Estrutura de payload inválida');
    }
    if (validacao.versao !== versaoEsperada) {
      throw new Error(`Versão do payload (${validacao.versao}) não confere com esperada (${versaoEsperada})`);
    }
    gravarLogServidor(`[autoupdate] Payload válido: versão=${validacao.versao}`);

    gravarLogServidor('[autoupdate] Copiando arquivos...');
    const appSrc = join(extrator, 'resources', 'embedded', 'app');
    const copia = await copiarArvore(appSrc, installDir);
    gravarLogServidor(`[autoupdate] Copiados ${copia.arquivos} arquivos (${(copia.bytes/1024/1024).toFixed(1)} MB)`);

    gravarLogServidor('[autoupdate] Atualizando configurações...');
    const tipoFinal = tipo === 'cliente' ? 'cliente' : 'servidor';
    if (tipoFinal === 'servidor') {
      gravarConfigServidor();
    } else {
      removerServidorAutostart();
    }
    const cfgPath = join(installDir, 'instalacao.json');
    writeFileSync(cfgPath, JSON.stringify({
      tipo: tipoFinal,
      versao: versaoEsperada,
      instalado_em: new Date().toISOString(),
    }, null, 2), 'utf8');
    gravarRegistro(installDir, tipoFinal, versaoEsperada);

    const exe = exeApp(installDir);
    if (exe) {
      criarAtalhos(installDir, exe);
      if (tipoFinal === 'servidor') criarAtalhoServidor(installDir, exe);
    }

    gravarLogServidor('[autoupdate] Relançando aplicação...');
    if (exe) relançarApp(exe);

    gravarLogServidor('[autoupdate] Aguardando inicialização...');
    await new Promise(r => setTimeout(r, 3000));

    if (exe && existsSync(exe)) {
      const versaoInstalada = lerVersaoInstalada(installDir);
      const tipoInstalado = lerTipoInstalado(installDir);
      if (versaoInstalada !== versaoEsperada) {
        throw new Error(`Versão instalada (${versaoInstalada}) difere da esperada (${versaoEsperada})`);
      }
      if (tipoInstalado !== tipoFinal) {
        throw new Error(`Tipo instalado (${tipoInstalado}) difere do esperado (${tipoFinal})`);
      }
      const urlPath = join(pastaDadosApp(), 'update.url');
      const urlAtual = existsSync(urlPath) ? readFileSync(urlPath, 'utf8').trim() : '';
      if (updateUrlAntes && urlAtual !== updateUrlAntes) {
        throw new Error(`update.url alterada inesperadamente: ${urlAtual} != ${updateUrlAntes}`);
      }
      gravarLogServidor('[autoupdate] Validação pós-instalação OK');
    } else {
      throw new Error('Executável não encontrado após instalação');
    }

    gravarLogServidor('[autoupdate] SUCESSO');
    escreverMarkerAtomico(markerPath, {
      ok: true,
      versao: versaoEsperada,
      timestamp: new Date().toISOString(),
      estagio: 'concluida',
    });
    lockCleanup();
    process.exit(0);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    gravarLogServidor(`[autoupdate] FALHA: ${err}`);
    try {
      escreverMarkerAtomico(markerPath, {
        ok: false,
        versao: versaoEsperada,
        timestamp: new Date().toISOString(),
        estagio: 'erro',
        erro: err,
      });
    } catch { /* ignore */ }
    lockCleanup();
    process.exit(1);
  } finally {
    // Limpa a pasta de extração em TODOS os caminhos (sucesso, erro, exceção
    // inesperada) — evita acumular centenas de MB em %TEMP%.
    if (extrator) {
      try { rmSync(extrator, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    limparMarkersAntigos(markerPath);
  }
}
runAutoupdate().catch((e) => {
  console.error('[autoupdate] ERRO NÃO TRATADO:', e);
  process.exit(1);
});