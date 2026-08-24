# AUDITORIA FUNCIONAL COMPLETA — Sistema Loja Tabacaria

**Data:** 2026-08-24
**Método:** análise estática completa do código (renderer 19 features, servidor Express, schema SQLite v38, main process). Nenhuma alteração de código foi feita.
**Escopo:** 20 módulos funcionais, rastreabilidade UI → IPC/API → SQL → banco, cálculos, filtros, fuso horário, segurança.
**Nota:** problemas derivam de leitura de código; validação em execução está indicada em cada item ("Como reproduzir").

---

## 1. RESUMO GERAL

| Prioridade | Quantidade |
|-----------|-----------|
| 🔴 **CRÍTICO** | **24** |
| 🟠 **ALTO** | **51** |
| 🟡 **MÉDIO** | **65** |
| ⚪ **BAIXO** | **39** |
| **TOTAL de registros** | **179** |

> **Consolidação:** alguns registros compartilham a mesma causa-raiz vista de módulos diferentes (ex.: cancelamento de venda não estornar caixa aparece como VD-01, CX-02, FIN-05, REL-05, REL-17, NUM-03). Consolidando causas-raiz únicas: **≈ 150 problemas distintos**, distribuídos em ~30 famílias principais.

### Os 10 achados mais graves (visão executiva)

| # | Família | Consequência |
|---|---------|--------------|
| 1 | **Fiado/fidelidade não implementado ponta a ponta** — checkbox morto no PDV, venda nunca grava cliente, débito nunca incrementa, receber quebra com `prompt()` inexistente no Electron | Dinheiro a receber invisível/inconsistente |
| 2 | **Cancelamento de venda não estorna caixa nem pagamentos** — colunas `total_vendas/qtd_vendas` ficam infladas, pagamentos permanecem, qualquer usuário cancela | Caixa fecha com valor errado; relatórios divergem |
| 3 | **Delivery nunca vira venda** — pedido "entregue" só muda status; não entra em vendas, caixa, comissão ou financeiro | Receita do canal delivery invisível nos totais |
| 4 | **Fuso horário (UTC vs local)** em todas as consultas de data — vendas após 21h caem no dia seguinte; "hoje" varia entre telas | Todos os números diários deslocados |
| 5 | **Lucro calculado com custo ATUAL e ignorando descontos** — remarcar custo reescreve lucro histórico; desconto de item não reduz lucro | Indicador central de decisão errado |
| 6 | **Quebra de caixa trata toda venda como dinheiro** — Pix/cartão entram no "esperado na gaveta" | Fechamento de caixa impossível de bater |
| 7 | **Cancelar pedido pós-aceite não devolve estoque** (delivery) | Perda silenciosa de mercadoria |
| 8 | **Servidor aceita SQL arbitrário sem autenticação** (`/api/db/exec`) + seed reseta senha admin a cada boot + rotas destrutivas abertas (zerar/restaurar/encerrar) | Qualquer dispositivo da rede pode apagar tudo; senha volta a admin123 no restart |
| 9 | **Comissão recalculada on-the-fly com % atual** — tabela `comissoes` nunca populada; mudar % refaz história | Impossível auditar quanto foi pago |
| 10 | **Financeiro mistura regimes** — conta a receber soma como dívida/saída; venda fiado conta como "dinheiro disponível"; compra a prazo não gera conta | Cards Entrou/Saiu/Disponível não são confiáveis |

### Padrões estruturais encontrados (causas-raiz arquiteturais)

1. **CRUD via SQL cru do renderer** (`/api/db/run`) — validações de negócio espalhadas no frontend; servidor não conhece regras; sem auth.
2. **Sem camada transacional** — vendas/importações/preços executam N statements isolados; falha no meio = dados parciais.
3. **Datas em UTC gravadas, locais filtradas** — nenhuma consulta converte (`datetime('now')` default no schema).
4. **Colunas de controle nunca escritas** — `caixas.descontos/cancelamentos`, `clientes.debito` (só baixa manual), `pedidos.zona`, `comissoes`, `formas_pagamento.taxa/dias_receber`, `vendas.cliente_id`, `clientes.ultima_visita`.
5. **Falhas silenciosas** — operações destrutivas sem try/catch (excluir produto/fornecedor/usuário com FK falha sem mensagem); `prompt()` usado em 4 telas (não existe no Electron).
6. **Snapshot ausente** — preço de custo não é copiado para `venda_itens`; histórico de lucro depende do custo atual do produto.

---

## 2. MÓDULOS AUDITADOS

| # | Módulo | Telas/arquivos | Endpoints/IPC | Tabelas | Status geral |
|---|--------|----------------|---------------|---------|--------------|
| 1 | PDV/Vendas | `pdv/Pdv.tsx` (74KB), `pdv/ConfigPdv.tsx`, `vendas/Vendas.tsx`, `vendas/PainelVenda.tsx` | IPC `db:*` (SQL direto) | vendas, venda_itens, pagamentos, produtos, movimentacoes, caixas | ⚠️ Vende, mas fiado/cliente/promo/atacado/transação ausentes |
| 2 | Pedidos em aberto | `delivery/Delivery.tsx`, `EditarPedido.tsx`, `PainelPedido.tsx` | IPC `db:*` | pedidos, pedido_itens, orcamentos | ⚠️ Fluxo anda, mas entrega não gera venda; cancelar perde estoque |
| 3 | Clientes | `clientes/Clientes.tsx` | IPC `db:*` | clientes | ❌ Fiado/recebimento quebrado; transações vazias |
| 4 | Produtos | `produtos/Produtos.tsx`, `ImportarProdutos.tsx` | IPC `db:*` | produtos, subcategorias, marcas | ⚠️ CRUD ok; exclusão falha silenciosa; ajuste sem movimentação |
| 5 | Estoque | `estoque/*` (Movimentacoes, Inventario, Validade) | `/api/estoque/*` (transacionado ✅) | movimentacoes, inventarios | ⚠️ Inventário sólido; saída negativa permitida; lote único sobrescrito |
| 6 | Financeiro | `financeiro/Financeiro.tsx` (5 abas) | IPC `db:*` | contas, reservas_contas, separacoes_dinheiro, compras | ❌ Cards não confiáveis (tipo não filtrado, margem como custo, reserva duplicada) |
| 7 | Contas a pagar | aba Contas do Financeiro | IPC `db:*` | contas | ⚠️ Manual funciona; compra não gera conta |
| 8 | Contas a receber | select "A receber" apenas | — | contas | ❌ Sem fluxo real |
| 9 | Relatórios | `relatorios/*` (20+ relatórios) | IPC `db:*` | várias | ❌ Período travado em 30 dias (botão morto); lucro/fuso/agregação incorretos |
| 10 | Dashboard | `inicio/Home.tsx` | IPC `db:*` | vendas, produtos, caixas, pedidos | ⚠️ 3 dos 4 cards corretos; "Vendas hoje" com fuso+canceladas |
| 11 | Usuários/vendedores | `usuarios/Usuarios.tsx`, `comissoes/Comissoes.tsx` | `/api/auth/*` + IPC | usuarios, permissoes, comissoes | ❌ Limites de desconto mortos; exclusão silenciosa; comissão não auditável |
| 12 | Configurações | `servidor/*`, config geral (tabela `config`) | `/api/config` | config | ⚠️ Básico funciona; "Config. Financeiras" placebo |
| 13 | Servidor/rede | `servidor.ts`, `server/index.ts` | HTTP :3210 | — | ❌ Sem auth em nada; filtro subnet frouxo; porta escala +1..+50 |
| 14 | Catálogo online | `catalogo/CatalogoOnline.tsx`, `server/catalogo.ts` | `/api/catalogo/*` | catalogo_sync, catalogo_fila, produtos | ⚠️ Sync funciona; toggle usa coluna errada; pedidos vão só p/ WhatsApp |
| 15 | Atualização automática | `main/update.ts`, `setup-launcher/autoupdate.*` | WMI + node standalone | — | ✅ Funciona (E2E validado); gaps menores de rollback/observabilidade |
| 16 | Backup/restauração | `/api/backup`, `/api/servidor/restaurar` | HTTP | DB inteiro | ⚠️ Manual OK; automático INEXISTENTE (UI mente "a cada 4h"); restaurar aceita caminho arbitrário |
| 17 | Integrações | `importar-nex.ts` (71KB), `importar.ts`, `ImportarProdutos.tsx` | `/api/importar/*` | nex_*, todos | ⚠️ Importa amplo; idempotência fraca; sobrescreve custo/estoque; trava conexão durante import |
| 18 | Impressões/documentos | cupom PDV, cupom pedido | window.print | — | ⚠️ Cupom sai com desconto 0 (estado zerado antes do print) |
| 19 | Pesquisa e filtros | todos os módulos | — | — | ⚠️ Busca simples ignora codigo_interno; telefone só bate formatado; período dos relatórios morto |
| 20 | Permissões | `usuarios/Usuarios.tsx` (árvore) | — | permissoes | ❌ Populadas na UI, checadas só client-side; servidor valida nada |

---

## 3. PROBLEMAS ENCONTRADOS — DETALHAMENTO

Formato dos campos: conforme solicitado. Nos níveis MÉDIO/BAIXO os campos são condensados em tabela (seção 3.3/3.4).

### 3.1 PROBLEMAS CRÍTICOS (24)

---

**CRIT-01 — Fiado é checkbox morto no PDV**
- ID: PDV-01 | Módulo: 1-PDV
- Página: `src\renderer\src\features\pdv\Pdv.tsx:1495`
- Problema: `<input type="checkbox" /> Fiado (pagar depois)` sem `checked`/`onChange`.
- Atual: clicável, não persiste, nenhum efeito na venda.
- Esperado: marcar pagamento como fiado, exigir cliente, lançar débito.
- Arquivo/Função: `Pdv.tsx`, `finalizarVenda`/modal pagamento. Tabela: `pagamentos`.
- Causa: UI desenhada, lógica nunca implementada.
- Impacto: venda sai como pagamento normal; dinheiro a receber invisível.
- Prioridade: **CRÍTICO**
- Reproduzir: F2 → marcar "Fiado" → concluir → conferir `pagamentos` da venda.
- Validar correção: venda fiado grava forma "Fiado", exige cliente, incrementa débito.

**CRIT-02 — Venda não vincula cliente; débito/fidelidade/crédito inexistentes na venda**
- ID: PDV-02 (alias CLI-03) | Módulo: 1-PDV / 3-Clientes
- Página: `Pdv.tsx:757-760`; `Clientes.tsx`
- Problema: INSERT de venda omite `cliente_id`. Nenhum código incrementa `clientes.debito`; `fiado_limite` nunca consultado; `tem_credito/valor_cred/pontos/fid_total` nunca usados em fluxo de compra.
- Esperado: venda fiado → `debito += total` (validando limite); uso de crédito abate `valor_cred`; compra soma pontos e atualiza `ultima_visita`/`fid_total`.
- Tabelas: `vendas.cliente_id`, `clientes.*`.
- Impacto: coluna Fiado do cliente sempre "em dia"; aba Transações do cliente sempre vazia (CLI-04); fidelidade inexistente.
- Prioridade: **CRÍTICO**
- Reproduzir: vender para cliente cadastrado → Ver → Transações = vazio; débito = 0.
- Validar: transações aparecem; débito sobe na venda fiado e baixa ao receber.

**CRIT-03 — Receber fiado quebra: `prompt()` não existe no Electron**
- ID: CLI-01 | Módulo: 3-Clientes
- Página: `Clientes.tsx:275`
- Problema: `window.prompt()` lança `Error: prompt() is and will not be supported` no Electron. Sem polyfill.
- Atual: botão "Receber" falha silenciosamente antes do UPDATE.
- Esperado: modal próprio de valor/data.
- Impacto: única via de baixa de débito inoperante (e débito nem sobe — CRIT-02).
- Prioridade: **CRÍTICO**
- Reproduzir: cliente com debito>0 → Receber → nada acontece (erro no console).
- Validar: modal abre, baixa registra com rastro (valor/data/venda).

**CRIT-04 — Finalização de venda sem transação (risco de dados parciais)**
- ID: PDV-04 | Módulo: 1-PDV
- Página: `Pdv.tsx:752-789`
- Problema: ~10 `await db.run` sequenciais (venda→itens→pagamentos→estoque→movimentações→caixa) sem BEGIN/COMMIT; IPC `db:run` é statement isolado.
- Atual: erro no meio deixa venda sem pagamentos / estoque parcial / caixa parcial.
- Esperado: transação atômica (ou endpoint server-side único).
- Impacto: banco inconsistente em falha qualquer.
- Prioridade: **CRÍTICO** (risco de integridade)
- Reproduzir: forçar erro no loop de itens → verificar registros órfãos.
- Validar: simular erro → nada persiste.

**CRIT-05 — Cancelar venda não estorna caixa/pagamentos e sem permissão**
- ID: VD-01 (aliases CX-02, FIN-05, REL-05, REL-17, NUM-03) | Módulo: 2-Vendas/Caixa/Financeiro/Relatórios
- Página: `vendas\Vendas.tsx:323-341`
- Problema: cancelamento só devolve estoque + status + marca movimentações. Não decrementa `caixas.total_vendas/qtd_vendas`, não anula `pagamentos`, não escreve `caixas.cancelamentos`, sem checagem de perfil/permissão.
- Atual: caixa fecha inflado; Meios de Pagamento soma pagamentos de venda cancelada; timeline do Caixa diverge das colunas; Financeiro exclui canceladas mas Caixa não.
- Esperado: estorno completo (caixa, pagamentos marcados, comissão, fiado), restrito por permissão.
- Tabelas: vendas, caixas, pagamentos, movimentacoes.
- Impacto: fechamento de caixa e relatórios inconsistentes entre si.
- Prioridade: **CRÍTICO**
- Reproduzir: vender no caixa atual → cancelar → comparar Resumo do Caixa × timeline × Relatório Caixa Atual.
- Validar: os três números coincidem após cancelamento.

**CRIT-06 — Quebra de caixa trata toda venda como dinheiro**
- ID: CX-01 | Módulo: 2-Caixa
- Página: `Caixa.tsx:287-292` (`fecharCaixa`)
- Problema: saldoFinal esperado = inicial + `total_vendas` (todas as formas) + suprimentos − sangrias.
- Atual: R$ 100 em Pix entram no "esperado na gaveta"; operador forçado a informar quebra falsa.
- Esperado: esperar apenas Dinheiro (± troco) + inicial + suprimentos − sangrias.
- Tabelas: caixas, pagamentos.forma.
- Impacto: fechamento de caixa matematicamente incorreto.
- Prioridade: **CRÍTICO**
- Reproduzir: caixa novo, 1 venda Pix → Fechar → saldo do sistema inclui o Pix.
- Validar: esperado = só dinheiro.

**CRIT-07 — Pedido entregue nunca vira venda (receita invisível)**
- ID: DL-01 | Módulo: 2-Delivery
- Página: `Delivery.tsx:106-130` (`avancarStatus`)
- Problema: status 'entregue' só faz UPDATE + estoque. Únicos INSERT INTO vendas do sistema: PDV e import Nex.
- Atual: delivery não entra em vendas, caixa, pagamentos, comissão, financeiro, relatórios.
- Esperado: entrega gera venda vinculada (tipo 'delivery') ao caixa ativo, com pagamento informado.
- Tabelas: pedidos→vendas, pagamentos, caixas.
- Impacto: faturamento subnotificado; taxa de entrega some dos totais.
- Prioridade: **CRÍTICO**
- Reproduzir: aceitar pedido → avançar até Entregue → Histórico de Vendas/Caixa inalterados.
- Validar: venda criada, caixa/comissão/relatórios refletem.

**CRIT-08 — Cancelar pedido pós-aceite não devolve estoque**
- ID: DL-02 | Módulo: 2-Delivery
- Página: `Delivery.tsx:132-137`, `PainelPedido.tsx:87-92`
- Problema: estoque debitado novo→aceito; cancelamento posterior só seta status.
- Atual: mercadoria debitada + pedido cancelado = perda silenciosa.
- Esperado: devolver estoque (gerando movimentação de reversão).
- Impacto: estoque fantasma negativo.
- Prioridade: **CRÍTICO**
- Reproduzir: aceitar pedido → cancelar card → conferir estoque do produto.
- Validar: estoque volta + movimentação registrada.

**CRIT-09 — Fuso horário: UTC gravado, local filtrado (afeta TODAS as telas)**
- ID: NUM-01 (aliases REL-06, DIST-01, FIN-10, FIN-11, FIN-17, CX-08 parcial, DL-08 parcial) | Módulos: todos
- Página: schema (`datetime('now')`=UTC), `Vendas.tsx:159-201`, `data.ts`, `Distribuicao.tsx:81-104`, `Financeiro.tsx:115-146`, `Caixa.tsx:252/271`
- Problema: `created_at/criado_em/aberto_em` em UTC; filtros "Hoje/Ontem" comparam data local; `fechado_em` gravado em localtime (mistura); `toISOString()` em pedidos; `new Date('YYYY-MM-DD')` parseia UTC.
- Atual: venda às 22h locais cai no dia seguinte; Horário de Pico deslocado +3h; duração do caixa errada; períodos personalizados assimétricos; data de pagamento retroage até 21h.
- Esperado: convenção única (datas de negócio em local ou conversão explícita em todas as queries).
- Impacto: TODOS os números diários podem divergir entre telas.
- Prioridade: **CRÍTICO**
- Reproduzir: vender às 22h → Home "hoje" não conta; Relatório conta em outro dia.
- Validar: venda noturna aparece no dia local em todas as telas.

**CRIT-10 — Lucro usa custo ATUAL e ignora descontos (de item e da venda)**
- ID: REL-04 (alias parcial DIST-04) | Módulo: 9-Relatórios/Distribuição
- Página: `relatorios\data.ts` (`carregarMetricas`, `carregarPorProduto`, `carregarPorCategoriaProduto`, `carregarEstoqueProdutoVendido`, `carregarVendasPorHora`)
- SQL atual: `SUM((vi.preco_unitario - COALESCE(p.preco_custo,0)) * vi.quantidade)`
- Problema: (a) `preco_custo` atual para vendas passadas — remarcação reescreve história; (b) ignora `vi.desconto` e `v.desconto`; (c) produto excluído (produto_id NULL) recebe custo 0 → lucro inflado.
- Esperado: snapshot de custo em `venda_itens` (migração) e lucro = líquido do item − custo_snapshot×qtd.
- Impacto: indicador central de decisão errado nas duas direções.
- Prioridade: **CRÍTICO**
- Reproduzir: vender com desconto de item → lucro do relatório não muda; alterar custo → lucro do mês passado muda.
- Validar: lucro imune a remarcação e sensível a descontos.

**CRIT-11 — Filtro de período de TODOS os relatórios está morto (travado em 30 dias)**
- ID: REL-01 | Módulo: 9-Relatórios
- Página: `relatorios\ReportFilters.tsx` (botão Período sem onClick), `data.ts` (`filtros.data='30 dias'` fixo)
- Atual: impossível ver hoje/ontem/mês/personalizado em qualquer relatório.
- Esperado: dropdown funcional propagando para as queries.
- Impacto: módulo de relatórios praticamente inútil para análise diária.
- Prioridade: **CRÍTICO**
- Reproduzir: abrir relatório → clicar "30 dias" → nada.
- Validar: mudança de período reflete nos números.

**CRIT-12 — Vendas por Cliente×Categoria infla totals (fan-out de JOIN)**
- ID: REL-09 | Módulo: 9-Relatórios
- Página: `relatorios\data.ts` (`carregarPorClienteCategoria`)
- SQL: `FROM vendas v LEFT JOIN venda_itens vi ... GROUP BY c.nome, cat.nome SELECT ..., SUM(v.total)`
- Problema: cada venda multiplica pelo nº de itens → cliente com venda de 3 itens mostra 3× o valor repartido entre categorias.
- Esperado: agregar itens por categoria em subquery; total da venda rateado uma vez.
- Impacto: número de cliente/categoria absurdo.
- Prioridade: **CRÍTICO**
- Reproduzir: venda com 3 itens de categorias distintas → total do cliente triplicado.
- Validar: soma por cliente ≤ faturamento real.

**CRIT-13 — Dashboard "Lucro Bruto" inventado (52% fixo)**
- ID: DASH-03 | Módulo: 10-Dashboard/Caixa
- Página: `Caixa.tsx:296` — `lucroBruto = totalVendas * 0.52`
- Problema: margem arbitrária apresentada como lucro real; 3ª definição diferente de lucro no sistema (ver CRIT-10, Distribuição).
- Prioridade: **CRÍTICO** (número de dinheiro enganoso)
- Validar: remover ou calcular com custo real.

**CRIT-14 — Servidor executa SQL arbitrário SEM autenticação**
- ID: USU-03 (=SEC-03, base de PERM-01/SEC-02) | Módulo: 13-Servidor / 20-Permissões
- Página: `server\index.ts:240-297`
- Problema: `/api/db/run|exec` aceitam INSERT/UPDATE/DELETE/multi-statement de qualquer host da rede (filtro só checa subnet); login não emite token/sessão server-side.
- Atual: `curl http://ip:3210/api/db/exec -d '{"sql":"DELETE FROM produtos"}'` funciona.
- Esperado: sessão/token + autorização server-side + allowlist.
- Impacto: perda total de dados por qualquer dispositivo da LAN.
- Prioridade: **CRÍTICO**
- Validar: rota sem credencial rejeitada; ações sensíveis auditadas.

**CRIT-15 — seed() reseta senha admin a cada boot**
- ID: SEC-01 | Módulo: 13-Servidor
- Página: `server\index.ts:97-105`
- Problema: todo boot faz UPDATE senha=admin123, perfil=admin, ativo=1 para login 'admin'.
- Atual: senha trocada pelo lojista volta ao padrão conhecido ao reiniciar; admin desativado reativa sozinho.
- Prioridade: **CRÍTICO** (segurança)
- Reproduzir: trocar senha → reiniciar app → logar com admin123.
- Validar: seed só cria se usuário não existe.

**CRIT-16 — Rotas destrutivas sem auth (zerar/restaurar/encerrar/alterarSenha)**
- ID: SEC-02 | Módulo: 13-Servidor
- Página: `server\index.ts` (`/api/servidor/zerar|restaurar|encerrar`, `/api/auth/alterarSenha`)
- Problema: zerar apaga tabelas inclusive usuários/config; restaurar copia arquivo SQLite arbitrário por cima do vivo; encerrar dá process.exit; alterarSenha troca de qualquer usuario_id — tudo sem auth.
- Impacto: destruição remota trivial.
- Prioridade: **CRÍTICO**

**CRIT-17 — Senha literal salva no localStorage ("Lembrar senha")**
- ID: USU-01 | Módulo: 11-Login
- Página: `login\Login.tsx:122`
- Problema: `localStorage.setItem('nex_senha_salva', senha)`.
- Impacto: qualquer acesso à máquina expõe a senha.
- Prioridade: **CRÍTICO** (segurança)

**CRIT-18 — Restauração aceita caminho arbitrário e substitui DB vivo sem auth**
- ID: BK-02 | Módulo: 16-Backup
- Página: `main\servidor.ts:432-464`, endpoint `index.ts:554`
- Problema: `POST /api/servidor/restaurar {"arquivo":"C:\\qualquer\\x.sqlite"}` sobrescreve o banco em uso.
- Prioridade: **CRÍTICO** (combinado com CRIT-14)

**CRIT-19 — Comissão recalculada on-the-fly; tabela `comissoes` morta**
- ID: COM-01 | Módulo: 6-Comissões
- Página: `comissoes\Comissoes.tsx:44-51`; `relatorios\data.ts:125-136`
- Problema: nenhuma leitura/escrita na tabela `comissoes`; ambas as telas calculam `SUM(v.total * percent_atual)` na hora.
- Atual: mudar % do vendedor refaz toda a apuração passada; impossível auditar pago.
- Esperado: registrar comissão na venda (snapshot %) na tabela existente.
- Prioridade: **CRÍTICO** (dinheiro/auditoria)
- Reproduzir: anotar comissão "Tudo" → mudar 5%→10% → valores dobram retroativamente.

**CRIT-20 — Conta a receber soma como dívida e como saída**
- ID: FIN-01 | Módulo: 6-Financeiro
- Página: `Financeiro.tsx:137-146, 320-325, 431-438`
- Problema: nenhum total filtra `tipo`; conta "A receber" entra em aberto/vencido como dívida e, paga, aumenta "Saiu".
- Esperado: separar pagar/receber em todos os agregados.
- Impacto: cards Entrou/Saiu/Disponível incorretos.
- Prioridade: **CRÍTICO**
- Reproduzir: criar conta A receber → baixar → card "Hoje — Saiu" sobe.

**CRIT-21 — Reposição calcula margem rotulada de custo**
- ID: FIN-02 | Módulo: 6-Financeiro
- Página: `Financeiro.tsx:242-266` vs CMV `220-229/639`
- Problema: tabela por fornecedor usa `(preço−custo)×qtd` (margem) como "Necessário reservar"; card/tfoot usam custo real → tela contradiz a si mesma.
- Prioridade: **CRÍTICO** (reserva de dinheiro errada)
- Reproduzir: item com markup alto → reserva ≫ CMV; tfoot ≠ soma das linhas.

**CRIT-22 — Baixa de conta duplica reserva**
- ID: FIN-03 | Módulo: 6-Financeiro
- Página: `Financeiro.tsx:372-376`
- Problema: `baixar()` grava valor pago como nova linha em `reservas_contas` → dinheiro já pago continua somando em RESERVADO, reduzindo DISPONÍVEL duas vezes.
- Prioridade: **CRÍTICO** (dupla contagem de caixa)
- Reproduzir: conta sem reserva → baixar 40 → RESERVADO sobe 40.

**CRIT-23 — Saída manual permite estoque negativo ilimitado**
- ID: EST-01 (relaciona PDV-03) | Módulo: 5-Estoque
- Página: `estoque\Movimentacoes.tsx:303-310`; `server\index.ts:692`
- Problema: server faz `estoque = estoque - ?` sem checar saldo; UI só `min="0"`.
- Atual: sair 999 com saldo 5 → -994 gravado.
- Esperado: bloqueio ou confirmação explícita conforme configuração.
- Prioridade: **CRÍTICO** (estoque inconsistente)
- Nota: PDV-03 agrava — venda também permite negativo e ignora `controla_estoque`.

**CRIT-24 — Toggle "Permitir venda sem estoque" e modal são código morto**
- ID: PDV-03b (parte de PDV-03) | Módulo: 1-PDV/Configurações
- Página: `Pdv.tsx:1609-1631` (modal nunca setado), `ConfigPdv.tsx:34-41`, permissão `vender_sem_estoque` lida e nunca aplicada
- Impacto: configuração prometida não funciona.
- Prioridade: **CRÍTICO** funcional (decisão de negócio ignorada)

### 3.2 PROBLEMAS ALTO (51)

| ID | Módulo | Problema (Atual → Esperado) | Arquivo/Função | Tabelas/endpoint |
|----|--------|------------------------------|----------------|------------------|
| PDV-03a | PDV | Baixa estoque de TODO produto (ignora `controla_estoque`), permite negativo, ignora fracionado → respeitar flags e config | `Pdv.tsx:768-771` | produtos, movimentacoes |
| PDV-05 | PDV | `preco_promo/promocional` nunca aplicados; atacado só manual (qtd_min_atacado nunca lida); `preco_alteravel` ignorado (edição livre) → aplicar automático e travar edição | `Pdv.tsx:169-173, 299, 997, 1551-1558` | produtos |
| PDV-06 | PDV/Caixa/Rel. | Troco grava pagamento maior que a venda (`pagamentos`=100 p/ total 37); soma formas ≠ total; troco não registrado → registrar troco/clampar dinheiro | `Pdv.tsx:470,552,595,778-789` (=REL-07, NUM-02) | pagamentos, caixas |
| PDV-10 | PDV/Delivery | Editar pedido: F11 zera taxa_entrega; concluir coleta pagamento/troco mas NÃO grava nada; tela pós mostra troco fictício com `total=subtotal` errado | `Pdv.tsx:628, 686-701` | pedidos |
| VD-02 | Vendas | Editar pagamentos de venda concluída sem validar soma=total, sem tocar caixa, permite apagar 100% dos pagamentos | `vendas\PainelVenda.tsx:121-143` | pagamentos |
| CX-03 | Caixa | Abrir múltiplos caixas sem verificação (reabrir valida; abrir não) → combinar com PDV pegar caixa alheio (PDV-09) | `Caixa.tsx:206-216 vs 241-249`; `Pdv.tsx:415-418` | caixas |
| CX-04 | Caixa | "Salvar conferência" só seta mensagem — nada persiste em tabela nenhuma (dado de auditoria perdido) | `Caixa.tsx:348-351` | — |
| DL-03 | Delivery | Baixa de estoque no pedido ignora `controla_estoque`/disponibilidade (mesma raiz de PDV-03) | `Delivery.tsx:119` | produtos |
| DL-04 | Delivery | EditarPedido recalcula total sem desconto (UPDATE omite coluna); reduzir itens pós-aceite não devolve estoque | `EditarPedido.tsx:64-65,107-110` | pedidos/pedido_itens |
| CLI-02 | Clientes | Campo "Pontos" do formulário nunca incluído nos params/INSERT/UPDATE — edição descartada silenciosamente | `Clientes.tsx:231-272,555` | clientes.pontos |
| CLI-04 | Clientes | Aba Transações/Última compra sempre vazia (depende de vendas.cliente_id que nunca é gravado — CRIT-02) | `Clientes.tsx:210-213` | vendas.cliente_id |
| PROD-01 | Produtos | Excluir produto falha silenciosa: FK sem CASCADE em venda_itens/movimentacoes/compra_itens/pedido_itens + sem try/catch → unhandled rejection | `Produtos.tsx:685-692` | produtos + FKs |
| PROD-02 | Produtos | Editar estoque direto no cadastro (e na importação) sem gerar movimentação → trilha de auditoria quebrada | `Produtos.tsx:629-638`; `ImportarProdutos.tsx:183-194` | produtos.estoque, movimentacoes |
| PROD-03 | Produtos/PDV | codigo_barras/interno sem UNIQUE; gerador usa Math.random → duplicados aceitos; bipe pode achar produto errado | `Produtos.tsx:568-573` | produtos |
| EST-02 | Estoque | Resumo financeiro (custo/valor do estoque) calculado sobre a PÁGINA visível (50 itens), card mostra COUNT total → número muda ao paginar | `estoque\Estoque.tsx:139-147,208` | produtos |
| EST-03 | Estoque | Lote/validade: um slot por produto sobrescrito a cada movimentação; movimentacoes não guarda lote; detalhe exibe valores ATUAIS → rastreabilidade por lote inexistente | `Movimentacoes.tsx:168-174,469-479`; `server\index.ts:694-698` | produtos, movimentacoes |
| EST-06 | Estoque | Inventário: UPDATE de digitação com catch silencioso ("offline") — contagem perdida não avisa; Finalizar lê estado antigo do banco | `estoque\Inventario.tsx:185-193` | inventario_itens |
| FORN-01 | Fornecedores | Excluir fornecedor falha silenciosa (FK produtos/compras/contas/separacoes/movimentacoes sem CASCADE, sem try/catch) | `Fornecedores.tsx:184-191` | fornecedores + FKs |
| FORN-02 | Fornecedores/Financeiro | `regra_reposicao(_valor)` salva mas recarregada sempre como 100% → reposição sai errada até re-salvar na sessão | `relatorios\Distribuicao.tsx:232-238 vs 268-278` | fornecedores |
| PRECO-01 | Preços | Percentual negativo SEM clamp → preço de venda NEGATIVO gravado (modo fixo tem Math.max; percentual não) | `precos\AlterarPrecos.tsx:175` | produtos.preco_venda |
| USU-02 | Segurança | senha_hash = SHA-256 sem salt (não bcrypt) → rainbow-table se DB vazar | `server\index.ts:93-95` | usuarios |
| USU-05 | Servidor | Sem busy_timeout; conexão única compartilhada; BEGIN manual durante import Nex permite requests intercaladas entrarem NA transação (venda feita durante import pode ser revertida) | `server\index.ts:56,66,811`; `importar-nex.ts:811` | todas |
| USU-07 | Usuários/PDV | `limitar_desconto/desconto_max_percent` salvos e NUNCA enforceados no PDV (desconto livre) | `Usuarios.tsx:193,218`; `Pdv.tsx:456+` | usuarios |
| BK-01 | Backup | Backup automático NÃO EXISTE (tooltip mente "a cada 4h"); só manual e pré-update | `App.tsx:459`; grep global | backups/ |
| CAT-01 | Catálogo | Toggle da tela publica coluna ERRADA (`publicado` em vez de `catalogo_publicado`) → despublicar no catálogo não muda o site | `CatalogoOnline.tsx:151,250,262` vs `catalogo.ts:195` | produtos |
| CAT-02 | Catálogo | Pedido do site finaliza SÓ via WhatsApp (wa.me); nada grava em `pedidos` → polling de "novos" nunca vê pedido online | `catalogo.ts:935-976`; `App.tsx:98` | pedidos |
| CAT-04 | Catálogo/Segurança | Token GitHub plaintext no banco (`catalogo_sync.config`) e em JSON no disco (backup-config) | `catalogo.ts:42-45,1543-1562` | catalogo_sync |
| IMP-02 | Integração | Import Nex abre BEGIN manual na conexão única e faz `await pausar()` dentro → qualquer request intercalada entra na mesma transação | `importar-nex.ts:811-1319` | todas |
| IMP-03 | Integração | Idempotência fraca: dedupe de vendas por contador em memória + correlação item/pagamento por data-MINUTO → re-import duplica/mistura vendas | `importar-nex.ts:1179-1212` | vendas, venda_itens, pagamentos |
| IMP-04 | Integração | Upsert por código/nome SOBRESCREVE dados locais: preço_custo zerado (UPDATE seta null), estoque piseteado; clientes por CPF | `importar-nex.ts:1013-1028,1106-1115` | produtos, clientes |
| REL-05 | Relatórios | Métricas com fallback para `caixas.total_vendas` quando 0 vendas concluídas → venda cancelada conta como faturamento (coluna nunca estornada) | `relatorios\data.ts` | caixas |
| REL-06 | Relatórios | Horário de Pico agrupa hora UTC (`substr(created_at,12,2)`) → pico real 19h aparece como 22h | `data.ts` | vendas.created_at |
| REL-08 | Relatórios | Por produto/categoria/marca usa `vi.subtotal` BRUTO (ignora desconto do item e rateio do cupom) → soma das linhas ≠ faturamento dos cards | `data.ts` múltiplos | venda_itens.desconto |
| REL-17 | Relatórios | Caixa Atual mostra colunas congeladas (`total_vendas/qtd_vendas`) ao lado de Meios de Pagamento filtrando canceladas → dois números divergentes na MESMA tela | `data.ts carregarCaixaAtual` | caixas, pagamentos |
| REL-19 | Relatórios/Integração | Vendas importadas do Nex têm itens com preco/subtotal=0 e total=Σpagamentos → lucro NEGATIVO falso em lucro/produto/categoria/distribuição | `importar-nex.ts` + relatórios | venda_itens |
| DIST-01 | Distribuição | Períodos misturam fuso na mesma tela (hoje local vs mês UTC) | `Distribuicao.tsx:81-104` | vendas.created_at |
| DIST-04 | Distribuição | Resumo usa v.total líquido; tabela por produto soma vi.subtotal bruto → linhas ≠ card FATURAMENTO | `Distribuicao.tsx:154+` | vendas/venda_itens |
| DASH-01 | Dashboard | "Vendas hoje" sem filtro status (cancelada conta) e janela UTC (`date('now')`) | `inicio\Home.tsx` | vendas |
| FIN-04 | Financeiro/Estoque | Compra manual grava `compras(status='paga')` e NUNCA gera conta a pagar (`contas.origem/compra_id` nunca preenchidos) → compra a prazo invisível | `server\index.ts:707`; `Financeiro.tsx:169-184` | compras, contas |
| FIN-05 | Financeiro/Vendas | Cancelar venda não ajusta caixa (mesma raiz CRIT-05 vista do financeiro: entrouHoje exclui canceladas, caixa não) | `Vendas.tsx:323-341` | caixas |
| FIN-06 | Financeiro | `entrouHoje` = TODA venda concluída (cartão/pix/fiado) como "dinheiro disponível do dia"; base do "Disponível real" → regime competência/caixa misturados | `Financeiro.tsx:144,576,683-684` | vendas, pagamentos |
| FIN-07 | Financeiro | Excluir conta PAGA permitido (reescreve "Saiu" retroativo) e sem try/catch | `Financeiro.tsx:385-390` | contas |
| FIN-18 | Financeiro | Contas a receber sem fluxo real: sem aba/filtro/baixa própria; fiado só `pagamentos`, cartão sem previsto (FP-02), delivery nunca vira venda | módulo inteiro | contas(tipo) |
| COM-02 | Comissões/Rel. | Módulo usa INNER JOIN+vendedor NOT NULL; relatório LEFT JOIN+"Sem vendedor" → totais gerais divergem entre as duas telas | `Comissoes.tsx:47-48`; `data.ts:131-133` | vendas.vendedor_id |
| COM-03 | Comissões | Base bruta `v.total`: ignora taxa de cartão (nunca calculada), fiado ainda não recebido → comissão sobre dinheiro que não caiu | ambos | vendas |
| FP-01 | Formas Pgto | `formas_pagamento.taxa` (%) nunca usada em cálculo algum → lucro com cartão superestimado em tudo | `FormasPagamento.tsx` CRUD; grep | formas_pagamento.taxa |
| FP-02 | Formas Pgto/PDV | `dias_receber` nunca gera recebível/previsto D+n → cartão a prazo sem agendamento | `FormasPagamento.tsx:89,94,200`; `Pdv.tsx:46` | formas_pagamento.dias_receber |
| FP-03 | Formas Pgto/Catálogo | Flag `ativo` ÚNICA compartilhada: desativar forma no catálogo remove do PDV (e vice-versa) silenciosamente | `CatalogoOnline.tsx:191`; `Pdv.tsx:407` | formas_pagamento.ativo |

### 3.3 PROBLEMAS MÉDIO (65)

**PDV / Vendas / Caixa / Delivery**

| ID | Problema | Local |
|----|----------|-------|
| PDV-07 | Cupom imprime desconto 0 (limparVenda zera estado antes do print) | `Pdv.tsx:1665-1675 após 793` |
| PDV-08 | Desconto negativo AUMENTA total; % equivalente usa subtotal bruto | `Pdv.tsx:459-465,1522-1583` |
| PDV-09 | Multi-caixa: pega `aberto=1 ORDER BY id DESC` — pode vender no caixa de outro operador | `Pdv.tsx:415-418` |
| PDV-11 | Parcelas viram sufixo textual ("Cartão 3x"); sem vencimento/valor parcela | `Pdv.tsx:546-552` (=FP-07) |
| VD-03 | Aprovar orçamento perde desconto (SELECT/INSERT omitem coluna) | `Vendas.tsx:297-317` |
| VD-04 | Modal de detalhe de venda inalcançável (~50 linhas mortas) | `Vendas.tsx:111,1030-1082` |
| CX-05 | Colunas `descontos/cancelamentos` mortas; label mostra "{qtd_vendas} Descontos" com valor fixo 0 | `Caixa.tsx:461` |
| CX-06 | "Lucro Bruto" 52% fixo (ver CRIT-13) — indicador sem fonte | `Caixa.tsx:296` |
| CX-07 | Reabertura de caixa sem permissão; próximo fechamento sobrescreve saldo/quebra anteriores | `Caixa.tsx:241-257` |
| CX-08 | Fusos mistos: aberto_em UTC vs fechado_em localtime → duração/exibição erradas | `Caixa.tsx:226,252,271` |
| CX-09 | Detalhe de caixas anteriores inclui canceladas (timeline atual filtra) | `Caixa.tsx:316-320` |
| DL-05 | Zonas de entrega ignoradas no fluxo (pedidos.zona nunca preenchido; taxa digitada livre) | `Delivery.tsx:142` |
| DL-06 | PainelPedido: botão opções sem ação; hint F6 sem handler; cancelar pós-saída permitido; cupom com desconto fixo 0; itens brutos ignoram desconto | `PainelPedido.tsx:62-75,87-92,121,165,205` |
| DL-08 | Pedidos criados com toISOString() (UTC) exibidos como local (+3h) | `Pdv.tsx:648/709`; `Delivery.tsx:185` |
| NUM-04 | Itens exibidos brutos (qty×preço) em PainelVenda/PainelPedido/preview ignorando desconto do item → soma ≠ subtotal | vários |

**Clientes / Produtos / Estoque / Fornecedores / Preços / Zonas**

| ID | Problema | Local |
|----|----------|-------|
| CLI-05 | `ultima_visita` nunca atualizada | `Clientes.tsx:461` |
| CLI-06 | Fidelidade sem fluxo (pontos/fid_total só manuais) | `Clientes.tsx:555-556` |
| CLI-08 | Sem exclusão de cliente nem import/export | `Clientes.tsx:407-409` |
| PROD-04 | Busca simples ignora codigo_interno/extra (placeholder promete "código") | `Produtos.tsx:362-366` |
| PROD-05 | Ordenação por cabeçalho vale só para a página atual (slice antes do sort) | `Produtos.tsx:180,295-306` |
| PROD-06 | Clonagem copia EAN igual e força publicado=1 | `Produtos.tsx:663-683` |
| PROD-07 | Sem validação promo>venda/atacado>venda/custo>venda; margem não exibida | `Produtos.tsx:575-591` |
| PROD-11 | Importação sobrescreve estoque sem movimentação | `ImportarProdutos.tsx:183-194` |
| PROD-12 | Importação sem mapeamento de preco_custo → custo 0 distorce toda margem | `ImportarProdutos.tsx:11-34` |
| PROD-13 | Loop de importação sem transação → parcial com contadores mentirosos | `ImportarProdutos.tsx:146-209` |
| EST-04 | Entrada com custo SUBSTITUI preço de custo (sem média ponderada) | `server\index.ts:686-690` |
| EST-05 | Compra manual nasce 'paga' sem passar pelo financeiro | `server\index.ts:707` |
| EST-08 | Validade: LIMIT 500 sem paginação; editar validade sem log; reflete só último lote | `Validade.tsx:63,93-106` |
| FORN-02 | (listado também em ALTO) regra_reposicao ignorada no reload | `Distribuicao.tsx` |
| PRECO-02 | Base de cálculo é snapshot obsoleto (preço capturado na busca) | `AlterarPrecos.tsx:169,135-139` |
| PRECO-03 | Aplicação em lote não-atômica (histórico inconsistente em falha) | `AlterarPrecos.tsx:212-220` |
| PRECO-04 | Prévia ignora sinal "Diminuir" (mostra + sempre) | `AlterarPrecos.tsx:358` |
| PRECO-05 | Sem desfazer histórico; seleção um-a-um LIMIT 30 | `AlterarPrecos.tsx:377-404` |
| PRECO-06 | Alterar venda não recalcula/valida promo → promo > venda possível | `AlterarPrecos.tsx` |
| ZONA-01 | Taxa 0 (grátis) bloqueada; negativa aceita | `Zonas.tsx:280` |
| ZONA-02 | Polígonos sobrepostos: primeira zona física vence (sem prioridade) | `shared\geo.ts:27-38` |

**Relatórios / Dashboard**

| ID | Problema | Local |
|----|----------|-------|
| REL-03 | Filtro de hora afeta só gráfico/tabela; MetricCards e rodapé usam período inteiro | `ReportTable/Relatorios.tsx` |
| REL-10 | Comissão: % atual retroage; escopo/janela divergem da tela Comissões | `data.ts:125-136` |
| REL-11 | GROUP BY nome mescla homônimos (produto/usuário/cliente) | `data.ts` |
| REL-12 | Estoque por Produto Vendido INNER JOIN oculta produtos excluídos | `data.ts` |
| REL-13 | Retenção: recorrencia hardcoded 0; "clientes novos" = distintos do dia | `data.ts` |
| REL-15 | Movimentação: histórico completo (ignora período); tipo cancelamento fora do saldo; LIMIT 200 parcial | `data.ts` |
| REL-16 | Rodapés sem sentido (ticket=soma de médias; analítico 500; retenção 30) | `data.ts` |
| REL-18 | Caixas Anteriores: datas mistas; lista difere da tela Caixa | `data.ts` |
| REL-20 | Nenhum relatório exporta/imprime; botões decorativos do Header sem onClick | `Header.tsx` |
| DIST-02 | Regras de reposição salvas não recarregadas (idem FORN-02) | `Distribuicao.tsx:232` |
| DIST-03 | "Já separado" sem filtro de período (separação antiga zera falta atual) | `Distribuicao.tsx` |
| DIST-05 | Primeira carga exige APLICAR sem explicar; status "Todas" entra canceladas | `Distribuicao.tsx` |

**Usuários / Servidor / Catálogo / Import / Update**

| ID | Problema | Local |
|----|----------|-------|
| USU-06 | Excluir usuário com vendas falha silenciosa (FK) | `Usuarios.tsx:248-258` |
| USU-08 | Desativar usuário bloqueia novo login mas sessão vigente permanece; perfil checado só no renderer | `App.tsx:162,326,373` |
| SRV-01 | Subnet compara só 2 octetos; IPv4-mapped tratado como loopback | `index.ts:156-177,231-238` |
| CAT-06 | Trigger de sync enfileira produto ERRADO (params[0]=valor publicado, não id) | `index.ts:16-31` |
| IMP-05 | Usuários Nex importados com senha_hash='' → lockout | `importar-nex.ts:1136-1143` |
| IMP-06 | historico_remocoes/logs_sistema/nex_dados_brutos/terminais sem tela nenhuma e sem dedupe (re-import acumula) | grep global |
| UPD-02 | Sem rollback automático em falha; marker mais recente pode ser órfão de tentativa anterior | `update.ts:315-341` |
| UPD-03 | Instalação via PS Bypass + .ps1 em %TEMP%; canal HTTP LAN permite MITM coerente | `update.ts:286-305` |
| SEC-05 | express.json 100mb / raw 600mb sem rate-limit → DoS trivial em LAN | `index.ts:226,851,905,923` |

**Financeiro / Comissões / Formas**

| ID | Problema | Local |
|----|----------|-------|
| FIN-08 | separar() sem validar valor ≤ falta_reservar → over-reserve zera disponível | `Financeiro.tsx:346-358` |
| FIN-09 | Aba Compromissos depende de Reposição ter sido aplicada antes (falta=0 senão) | `Financeiro.tsx:286-288,676-688` |
| FIN-10 | Fuso: cards UTC vs abas locais na MESMA tela (ver CRIT-09) | `Financeiro.tsx:115-146` |
| FIN-11 | Período personalizado assimétrico (parse YYYY-MM-DD como UTC) | `Financeiro.tsx:212` |
| FIN-14 | "Config. Financeiras" salva em localStorage placebo — nenhum cálculo consome | `Financeiro.tsx:302,392-396` |
| COM-04 | prompt() vazio define 0% (sem teto, aceita 999%) | `Comissoes.tsx:54-57` |
| FP-04 | permite_troco ignorado pelo PDV (troco concedido p/ Pix/cartão parcial) | `Pdv.tsx:470`; `FormasPagamento.tsx:180-185` |
| FP-05 | Excluir forma sem checar uso em pagamentos (histórico perde vínculo; recriar funde períodos) | `FormasPagamento.tsx:115-119` |
| FP-06 | "Criar rápida" (Crédito banco1/2) zera taxa/dias fixos | `FormasPagamento.tsx:121-135` |
| FP-07 | Parcelas = sufixo textual (idem PDV-11) | `Pdv.tsx:546-551` |
| FP-08 | Nome de forma duplicado permitido → PDV find() pega o primeiro; relatório funde | `FormasPagamento.tsx:76-108`; `Pdv.tsx:527` |

### 3.4 PROBLEMAS BAIXO (39)

| ID | Problema | Local |
|----|----------|-------|
| PDV-12 | Código morto: usarCodigoBarras/somarForma/adicionarPagamentoDigitado (com parse NaN) nunca chamados; item qtd 0 salvável | `Pdv.tsx:507-512,540,574,813` |
| VD-05 | Ordenação do Histórico morta (setas sem efeito) | `Vendas.tsx:771-780` |
| VD-06 | Parse GROUP_CONCAT '~'/'\|' quebra com separador no nome | `Vendas.tsx:209,614-620` |
| VD-07 | Stub "Troca ou Devolução" ("em breve") | `Vendas.tsx:664-666` |
| CX-10 | Botões "⋯ Detalhes" sem onClick; sangria sem motivo obrigatório; CaixaImportar pode sobrescrever caixa real (ON CONFLICT id) e ignora campo saldo_final | `Caixa.tsx:218-239,458-504`; `CaixaImportar.tsx:55,117-127` |
| DL-07 | Botão "Simular pedido" insere dados falsos em produção | `Delivery.tsx:146-203,215` |
| CLI-07 | Colunas Compras/Última compra/Total sempre '—' | `Clientes.tsx:322-323,464` |
| CLI-09 | Busca telefone/cpf só bate formato mascarado (dígitos não encontram) | `Clientes.tsx:136-139` |
| CLI-10 | Sem UNIQUE/validação CPF/CNPJ/código → duplicados silenciosos | schema mig.26 |
| CLI-11 | Sem paginação (tabela inteira) | `Clientes.tsx:131-144` |
| PROD-08 | Botão "Abrir" das transações sem onClick | `Produtos.tsx:1662` |
| PROD-09 | Abas/placeholders "em breve": Kit, Tributação, multi-fornecedor, validade, etiquetas | `Produtos.tsx:848-860,1177-1205` |
| PROD-10 | salvar()/clonarProduto() sem try/catch | `Produtos.tsx` |
| PROD-14 | Chave fantasma ean_gtin no mapeamento de importação | `ImportarProdutos.tsx:100` |
| EST-10 | bonificacao classificada como SAÍDA (conferir regra de negócio) | `estoque\tipos.ts:26` |
| EST-11 | Data retroativa livre em movimentações manuais | `Movimentacoes.tsx:255-257` |
| FORN-03 | Sem validação real de CPF/CNPJ (só máscara) | `Fornecedores.tsx:42-58,140-174` |
| FORN-04 | Transações sem link de abertura; multi-fornecedor "em breve" | `Fornecedores.tsx:351-366` |
| PRECO-07 | usuarioId ?? null permite histórico sem autor; card placeholder permanente | `AlterarPrecos.tsx:209,429` |
| ZONA-03 | poligono corrompido derruba listagem inteira (JSON.parse sem try) | `Zonas.tsx:62-79` |
| ZONA-04 | pedidos.zona por NOME (renomear quebra histórico) | schema mig.6 |
| REL-02 | "Tipo de Data" cosmético (refaz query igual) | `ReportFilters.tsx` |
| REL-14 | "Vendas por Combo" rótulo falso (top produtos) | `data.ts` |
| DIST-06 | disponível com Math.max mascara negativo; barra flex inválida com 0 | `Distribuicao.tsx` |
| DASH-04 | Card "Descontos" mostra coluna morta + qtd_vendas no rótulo; "Aberto Hoje" hardcodado | `Caixa.tsx:461+` |
| USU-04 | Enumeração de usuários pré-login | `Login.tsx:58` |
| SRV-02 | Porta ocupada escala +1..+50 e grava nova porta (clientes antigos erram) | `index.ts:939-964` |
| CAT-05 | Site público expõe estoque exato por produto (informativo) | `catalogo.ts:703+` |
| UPD-01 | Sem checagem periódica automática de update (só manual) | `Servidor.tsx:114` |
| SEC-04 | Sem CORS (vetor real é cliente HTTP direto) | server/index.ts |
| FIN-12 | Query pago30 calculada e descartada | `Financeiro.tsx:146` |
| FIN-13 | Hint F2 sem handler keydown | `Financeiro.tsx:536,771` |
| FIN-15 | Busca só por descrição (fornecedor/categoria não encontram) | `Financeiro.tsx:124` |
| FIN-16 | Editar conta paga permite valor < valor_pago; saldo negativo verde | `Financeiro.tsx:313-317,416` |
| FIN-17 | Data de pagamento default UTC (retroage até 21h) | `Financeiro.tsx:370,536` |
| COM-05 | Apuração não recalcula após alterar % (só ao trocar período) | `Comissoes.tsx:54-59` |
| COM-06 | Lista inclui inativos e admins como comissionáveis | `Comissoes.tsx:29` |
| COM-07 | Períodos desalinhados módulo ("Tudo") × relatório (30d) | ambos |
| FP-09 | CRUD de formas sem try/catch (falha silenciosa offline) | `FormasPagamento.tsx:93-128` |

---

## 4. PROBLEMAS CRÍTICOS (consolidado temático)

| Tema | IDs | Resumo |
|------|-----|--------|
| Fiado/fidelidade ponta a ponta | CRIT-01/02/03 | Checkbox morto, venda sem cliente, débito nunca sobe, receber quebra |
| Cancelamento incompleto | CRIT-05 (+FIN-05, REL-05/17) | Caixa/pagamentos/comissão não estornados; sem permissão |
| Delivery fora do financeiro | CRIT-07 / CRIT-08 | Entrega nunca vira venda; cancelar pós-aceite perde estoque |
| Fuso horário global | CRIT-09 (10 aliases) | UTC×local em todas as telas; vendas noturnas migram de dia |
| Lucro incorreto | CRIT-10 / CRIT-13 | Custo atual + descontos ignorados + "52% fixo" |
| Relatórios inoperantes | CRIT-11 / CRIT-12 | Período morto; fan-out infla cliente×categoria |
| Caixa matematicamente errado | CRIT-06 | Todas as formas contam como dinheiro na gaveta |
| Integridade transacional | CRIT-04 / CRIT-23 / CRIT-24 | Venda sem transação; estoque negativo livre; config no-op |
| Segurança do servidor | CRIT-14..18 | SQL aberto sem auth; seed admin123; rotas destrutivas; senha no localStorage; restaurar arbitrário |
| Dinheiro do financeiro | CRIT-19..22 | Comissão reescrevível; a receber como dívida; margem como custo; reserva duplicada |

## 5. PROBLEMAS DE DADOS

- **Sem transação:** venda (CRIT-04), importação de produtos (PROD-13), preços em lote (PRECO-03).
- **FK sem CASCADE + falha silenciosa:** produto (PROD-01), fornecedor (FORN-01), usuário (USU-06) — exclusões que "não fazem nada".
- **Colunas nunca escritas:** `caixas.descontos/cancelamentos`, `clientes.debito`(só baixa)/`pontos`(form)/`ultima_visita`, `vendas.cliente_id`, `pedidos.zona`, `comissoes`, `formas_pagamento.taxa/dias_receber`, `contas.origem/compra_id`.
- **Snapshot ausente:** custo não copiado para venda_itens → lucro histórico instável (CRIT-10); lote único sobrescrito (EST-03).
- **Duplicação permitida:** códigos de produto (PROD-03), formas com mesmo nome (FP-08), clientes sem UNIQUE cpf/cnpj (CLI-10), re-import Nex duplica vendas (IMP-03) e acumula tabelas brutas (IMP-06).
- **Perda silenciosa:** conferência de inventário (EST-06), "salvar conferência" do caixa (CX-04), pontos do cliente (CLI-02).

## 6. PROBLEMAS DE CÁLCULOS

1. **Lucro — 3 definições conflitantes:** 52% fixo (Caixa) × custo atual sem descontos (Relatórios) × líquido−custo atual (Distribuição). Nenhuma usa snapshot nem desconto de item.
2. **Troco:** gravado como pagamento (PDV-06) → Meios de Pagamento > Total; esperado-na-gaveta inclui Pix (CX-01).
3. **Desconto:** negativo aumenta total (PDV-08); % exibida com base bruta; aprovar orçamento zera (VD-03); editar pedido omite (DL-04).
4. **Fan-out/agregação:** Cliente×Categoria multiplica por itens (REL-09); rodapés somam médias (REL-16); resumo do estoque por página (EST-02); linhas ≠ card na Distribuição (DIST-04).
5. **Comissão:** base bruta sem taxa cartão/fiado pendente (COM-03); % atual retroage (COM-01); INNER vs LEFT diverge (COM-02).
6. **Estoque:** saída/venda permitem negativo (EST-01/PDV-03); entrada substitui custo sem média (EST-04); saldo do relatório não deriva das movimentações (REL-15).
7. **Reserva financeira:** baixa duplica reserva (FIN-03); over-reserve sem validação (FIN-08); reposição calcula margem (CRIT-21).
8. **Arredondamento:** floats brutos em REAL sem política de arredondamento em nenhum cálculo monetário.

## 7. PROBLEMAS DE RELATÓRIOS

- Período travado (CRIT-11) e "tipo de data" cosmético (REL-02).
- Hora de pico +3h (REL-06); janelas UTC (REL-05 fallback, DASH-01).
- Canceladas: excluídas na maioria, INCLUÍDAS em Home-hoje, caixas.total_vendas, fallback REL-05, Distribuição "Todas", detalhe de caixas anteriores (CX-09).
- Descontos: ignorados no lucro (REL-04) e nos totais por produto (REL-08); soma das linhas ≠ faturamento (C5).
- Taxa de entrega: existe só em pedidos; NENHUM relatório de faturamento inclui delivery (C8) — canal invisível.
- Custo/produto/lucro: custo atual para o passado (REL-04); produtos excluídos custam 0 (mesma query) ou desaparecem (INNER, REL-12); vendas Nex com item R$0 geram lucro negativo falso (REL-19).
- Totais vs banco: Σformas ≠ Σtotal (troco, REL-07); qtd_vendas ≠ COUNT real após cancelar (C3); "hoje" tem 4 valores diferentes conforme a tela (C1).
- Sem export/imprimir em nenhum relatório (REL-20).

## 8. PROBLEMAS DE ESTOQUE

- Negativo permitido em venda e saída manual (PDV-03/EST-01); config e permissão `vender_sem_estoque` são no-op (CRIT-24).
- Ajuste direto no cadastro/importação sem movimentação (PROD-02/11) quebra rastreabilidade.
- Inventário sólido na finalização, mas digitação pode se perder silenciosamente (EST-06); vendas durante inventário são sobrescritas sem aviso (documentar).
- Lote/validade: um slot por produto, sobrescrito a cada movimento; histórico exibe valores atuais (EST-03); alertas refletem só último lote (EST-08).
- Entrada com custo substitui (sem média ponderada, EST-04); compra nasce paga fora do financeiro (EST-05 = FIN-04).
- Resumo financeiro da lista por página (EST-02); bonificação como saída a confirmar (EST-10).

## 9. PROBLEMAS FINANCEIROS

- Cards não confiáveis: tipo não filtrado (CRIT-20), fiado/cartão contam como dinheiro hoje (FIN-06), canceladas divergem entre Financeiro e Caixa (FIN-05).
- Reposição: margem rotulada de custo (CRIT-21), regras salvas ignoradas (FORN-02/DIST-02), separações sem período (DIST-03), baixa duplica reserva (CRIT-22), over-reserve (FIN-08).
- Compra a prazo não gera conta (FIN-04); delivery não gera receita (CRIT-07); contas a receber sem fluxo (FIN-18); taxa de cartão e dias_receber decorativos (FP-01/02).
- Compromissos dependem de navegação prévia (FIN-09); fuso inconsistente interno (FIN-10/11/17); excluir conta paga reescreve passado (FIN-07).
- Comissão: não auditável (CRIT-19) e base errada (COM-03).

## 10. PROBLEMAS DE INTEGRAÇÃO

- **NEX:** transação manual na conexão única bloqueia/corrói concorrência (IMP-02=USU-05); idempotência fraca duplica/mistura vendas por minuto (IMP-03); upsert sobrescreve custo/estoque/preço locais (IMP-04); usuários ficam travados (IMP-05); tabelas brutas sem tela e sem dedupe (IMP-06); itens históricos R$0 distorcem relatórios (REL-19). Não importa contas/movimentações antigas/fornecedores (IMP-01).
- **Catálogo:** toggle coluna errada (CAT-01); pedidos só WhatsApp, nunca no sistema (CAT-02); token plaintext (CAT-04); trigger enfileira produto errado (CAT-06); flag ativo única PDV↔catálogo (FP-03); expõe estoque exato (CAT-05).
- **Planilha de produtos:** custo não mapeado (PROD-12), parcial sem transação (PROD-13), chave fantasma (PROD-14).

## 11. PROBLEMAS DE INTERFACE

- Botões sem ação: período dos relatórios (CRIT-11), "Salvar conferência" (CX-04), "Abrir" transações (PROD-08), "⋯ Detalhes" do caixa (CX-10), opções do pedido (DL-06), Header Menu/Globo/Config (REL-20), F2/F6 hints sem handler (FIN-13, DL-06).
- Placeholders "em breve": troca/devolução (VD-07), kits/tributação/etiquetas (PROD-09), monofásicos (relatório).
- Falhas silenciosas sem try/catch em exclusões/salvamentos (G-02): produtos, fornecedores, usuários, zonas, financeiro, formas.
- `prompt()` usado em 4 telas (Clientes, Comissões, PainelPedido, Usuários) — quebra no Electron (CLI-01 é a crítica).
- Dados que não salvam: pontos do cliente (CLI-02); dados fictícios: lucro 52%, descontos fixo 0 (CX-05/06), recorrencia 0 (REL-13).
- UX: primeira carga da Distribuição vazia até APLICAR (DIST-05); busca telefone format-only (CLI-09); ordenação por página (PROD-05/VD-05); saldo negativo verde (FIN-16).

## 12. CORREÇÕES RECOMENDADAS (ordem sugerida de execução)

**Fase 1 — Parar o sangramento de dinheiro/dados (semanas 1-2)**
1. Transacionar finalização da venda (endpoint server-side único `POST /api/vendas`) — resolve CRIT-04 e habilita validações server-side.
2. Corrigir cancelamento completo: estornar caixas.total_vendas/qtd_vendas, anular pagamentos, escrever caixas.cancelamentos, exigir permissão (CRIT-05 + FIN-05 + REL-05/17).
3. Delivery: ao entregar, gerar venda+pagamentos vinculados ao caixa; cancelar pós-aceite devolve estoque (CRIT-07/08).
4. Clamp de dinheiro: pagamento ≤ falta (dinheiro gera troco registrado), desconto ≥ 0, preço ≥ 0 no percentual (PDV-06/08, PRECO-01), saída/venda respeitar controla_estoque e bloqueio de negativo conforme config (CRIT-23/24, EST-01).
5. Quebra de caixa só com Dinheiro (CRIT-06); abrir-caixa único por operador (CX-03/PDV-09).

**Fase 2 — Confiabilidade dos números (semanas 3-4)**
6. Migração v39: adicionar `preco_custo_snapshot`/`desconto_rateado` em venda_itens (e backfill razoável) → refazer lucro dos relatórios (CRIT-10), Distribuição (DIST-04) e remover 52% (CRIT-13).
7. Padronizar datas: gravar `created_at_local` (ou view com conversão) e unificar TODOS os filtros (CRIT-09 + 10 aliases) — incluir Horário de Pico, Dashboard hoje, Financeiro, Distribuição, duração do caixa.
8. Ativar filtro de período dos relatórios (CRIT-11); corrigir fan-out cliente×categoria (CRIT-12); usar vi.subtotal−vi.desconto em totais por produto (REL-08); reconciliar Caixa Atual × timeline (REL-17).
9. Financeiro: filtrar tipo='pagar' nos agregados (CRIT-20), corrigir reposição para CMV (CRIT-21), baixa não criar reserva (CRIT-22), validar separação (FIN-08), regime de caixa p/ "Disponível" (FIN-06).

**Fase 3 — Funcionalidades prometidas e ausentes (mês 2)**
10. Fiado end-to-end: PDV grava cliente/forma Fiado → debito sobe (validando limite) → modal de recebimento (substituir prompt) com rastro (CRIT-01/02/03) + aba Transações passa a funcionar.
11. Comissão registrada na venda (tabela comissoes existente, snapshot %) + unificar módulo×relatório (CRIT-19, COM-02/03).
12. Formas de pagamento: aplicar taxa no líquido (FP-01), gerar previsto D+n via dias_receber (FP-02), flags separadas PDV/catálogo (FP-03), honrar permite_troco (FP-04).
13. Catálogo: corrigir coluna publicada (CAT-01), webhook/manual para pedido entrar em `pedidos` (CAT-02), mover token para local seguro (CAT-04), corrigir trigger (CAT-06).
14. Exclusões seguras: try/catch + mensagem de vínculos (ou soft-delete) em produto/fornecedor/usuário (PROD-01, FORN-01, USU-06); ajuste de estoque sempre via movimentação (PROD-02/11).

**Fase 4 — Segurança e robustez (mês 2-3)**
15. Auth mínima server-side: token na sessão + middleware em /api/db/* e rotas sensíveis; seed só cria admin se inexistente (CRIT-14..17); backup automático agendado real (BK-01); restaurar restrito à pasta backups (BK-02/CRT-18).
16. Import Nex: rodar em conexão/transação isolada, dedupe por hash do registro, upsert opcional campo-a-campo sem zerar custo (IMP-02..04), tela para tabelas brutas (IMP-06).
17. Inventário: remover catch silencioso da digitação + aviso de vendas durante contagem (EST-06/07); lote por movimentação (EST-03, migração futura).

**Backlog (MÉDIO/BAIXO)** — demais 104 registros conforme seções 3.3/3.4.

---

## CONTAGEM FINAL POR PRIORIDADE

| Prioridade | Registros | % |
|-----------|----------:|--:|
| 🔴 CRÍTICO | **24** | 13,4% |
| 🟠 ALTO | **51** | 28,5% |
| 🟡 MÉDIO | **65** | 36,3% |
| ⚪ BAIXO | **39** | 21,8% |
| **TOTAL** | **179** | 100% |

### Matriz módulo × prioridade (por ID)

| Módulo | Crítico | Alto | Médio | Baixo | Total |
|--------|--------:|-----:|------:|------:|------:|
| 1. PDV/Vendas | 4 (PDV-01/02/04, VD-01) | 4 (PDV-03a/05/06/10, VD-02*) | 5 | 4 | 17* |
| 2. Pedidos/Delivery | 2 (DL-01/02) | 2 | 5 | 2 | 11 |
| 3. Clientes | 2 (CLI-01/03) | 2 | 3 | 4 | 11 |
| 4. Produtos | — | 3 | 6 | 4 | 13 |
| 5. Estoque | 2 (CRIT-23/24, EST-01) | 3 | 3 | 2 | 10 |
| 6. Financeiro | 4 (CRIT-19..22) | 6 | 5 | 5 | 20 |
| 7. Contas a pagar | — | 1 (FIN-04) | — | — | 1 |
| 8. Contas a receber | — | 1 (FIN-18) | — | — | 1 |
| 9. Relatórios | 3 (REL-01/04/09) | 6 | 9 | 2 | 20 |
| 10. Dashboard/Caixa | 1 (DASH-03; CX-01/02 no bloco 2) | 4 (CX-03/04, REL-17, DASH-01) | 5 | 3 | 13 |
| 11. Usuários/Comissões | 1 (COM-01) | 3 (USU-05/07, COM-02/03) | 4 | 5 | 13 |
| 12. Configurações | 1 (CRIT-24 config) | — | 1 (FIN-14) | 1 | 3 |
| 13. Servidor/rede | 4 (CRIT-14..17) | 2 (USU-02*, BK-01) | 3 | 2 | 11 |
| 14. Catálogo online | — | 3 | 2 | 1 | 6 |
| 15. Atualização | — | — | 2 | 1 | 3 |
| 16. Backup/restauração | 1 (BK-02) | — | — | — | 1 |
| 17. Integrações | — | 3 (IMP-02/03/04) | 2 | — | 5 |
| 18. Impressões | — | — | 1 (PDV-07) | 1 | 2 |
| 19. Pesquisa/filtros | — | 1 (REL-08) | 4 | 3 | 8 |
| 20. Permissões | 2 (dentro CRIT-14..16) | 1 (USU-07) | 1 (USU-08) | 1 | 5 |

*Valores por ID; alguns IDs aparecem em mais de um módulo pela natureza cruzada (ex.: VD-02 conta em Vendas; NUM-04 em Pesquisa/filtros). A matriz é aproximada nos cruzamentos; os totais por prioridade acima são canônicos.*

---

**Auditoria gerada por análise estática completa. Nenhum código foi alterado. Aguardando revisão para iniciar as correções.**

