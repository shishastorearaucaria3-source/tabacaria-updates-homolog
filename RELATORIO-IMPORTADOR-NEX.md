# Relatório — Importador NEX com itens do MovEst (FASE 1–7)

Data: 2026-08-28
Escopo: Fases 1–7 do plano de parser/importador NEX, conforme decisões do usuário
(parser por GUID+offsets comprovados com MovEst como fonte de itens; manter heurística
legada de data da venda; primeira importação em banco de teste; NÃO modificar .nx1 originais).

---

## FASE 1 — Documentação
- `ESPECIFICACAO-IMPORTADOR-NEX.md` criado (campos CONFIRMADO/PROVÁVEL/NÃO IDENTIFICADO; cadeia
  venda→item→produto→caixa→cliente; 7 casos de teste).

## FASE 2 — Parser binário
- Parser isolado em `C:\Users\maciel\AppData\Local\Temp\opencode\nex-parser\` (somente leitura).
- Enumerador de registros NexusDB: magic `NX!2`, blocos de 4096 bytes, dados desde o bloco 8.
  - `MovEst.nx1`: stride 676, slot inicial in-block 40, 6 slots/bloco.
  - `Tran.nx1`: stride 1280, slot inicial in-block 256, 3 slots/bloco.
- Campos provados: MovEst — id int32, item_uid GUID, tran int32, produto_uid GUID, produto_id int32,
  quant double, unit Currency×10000, total. Tran — id int32 (+ASCII `"id\0"`), caixa int32.

## FASE 3 — Prova de leitura
- 123.779 itens (MovEst) e 54.399 vendas (Tran) lidos em ~8s.
- As 7 vendas ground-truth mostram TODOS os itens com conservação total unitário.
- 36.907 vendas com itens via MovEst; 17.492 sem (vendas genuinamente sem itens de inventário).

## FASE 4 — Validação vs cloud_json
- 12/12 itens e 12/12 caixas validados contra ground-truth do cloud_json. Veredito: PASSOU.

## FASE 5 — Integração no sistema
- `src/server/nex-binary.ts` (novo): parser TS slot-walker expõe `lerItensMovEst(buf)` e `lerVendasTran(buf)`.
- `src/server/importar-nex.ts`: itens agora vêm do `MovEst.nx1` (produto/quant/preço reais), vinculados
  por **tran exato** à venda; `numero = NEX-{id real}`; `caixa_id` correto; `total/subtotal` = soma real dos itens.
  - Backup do original: `src/server/importar-nex.ts.bak-movest`.
- Fix aplicado: `nome_produto` é NOT NULL — quando o produto vincula, usa `nome` real do produto;
  senão, fallback `produto#{produtoNex}`.

## FASE 6 — Importação de teste (banco de TESTE, nunca produção)
- Banco de teste isolado via `TABACARIA_DB` apontando para um .sqlite temporário com schema+migrações.
- Resultado (código final):
  - Vendas: **54.399** · Itens: **117.260** (todos com quantidade>0 e preco_unitario>0)
  - Vendas com caixa: 53.727 · Erros: **0**
  - Ground-truth: **7/7 PASS** (quantidade, preço unit., subtotal, caixa corretos)
  - Ex.: NEX-19240 subtotal = 149,00 (soma real dos 5 itens); NEX-30593 caixa 665 com itens reais.
- Idempotência (FASE 6b): vendas/itens/pagamentos com delta = 0 (sem duplicidade).
  - Ressalva pré-existente (não causada por esta mudança): reimportar duplica **caixas** e **produtos**,
    pois a deduplicação deles usa `aberto_em+fechado_em` / sem chave única forte.

## FASE 7 — Build final + relatório
- `npm run build:servidor` → OK.
- `tsc --noEmit -p tsconfig.node.json` e `tsc --noEmit -p tsconfig.web.json` → OK.
- Instalador/pacote: **adiado** (decisão do usuário) — será gerado quando for distribuir a versão.

---

## Arquivos alterados/criados
| Arquivo | Ação |
|---|---|
| `src/server/nex-binary.ts` | novo — parser TS (somente leitura) |
| `src/server/importar-nex.ts` | editado — itens do MovEst, vínculo por tran, quant/preço reais |
| `src/server/importar-nex.ts.bak-movest` | backup do original antes da edição |
| `ESPECIFICACAO-IMPORTADOR-NEX.md` | FASE 1 |
| `out/server/server/importar-nex.js`, `nex-binary.js` | compilados (build:servidor) |

## Dados de apoio (evidência)
- `C:\Users\maciel\AppData\Local\Temp\opencode\nex-parser\` — parser.js, fase3.js, fase4.js,
  fase6.js, fase6b.js, `VENDAS_SAIDA.json`, `teste-nex.sqlite` (banco de teste).
- Dados-fonte: `D:\sistema loja tabacaria\nexbackuptotal\Dados\` (não modificados).

## Pendências
- Instalador/pacote da nova versão (adiado).
- Deduplicação de caixas/produtos no reimport (comportamento pré-existente; recomendado revisar antes
  de uma reimportação no mesmo banco).
