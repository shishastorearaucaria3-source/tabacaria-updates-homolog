# Especificação do Importador NEX — Parser por GUID + Offsets Comprovados

Data: 2026-08-28
Autor: engenharia reversa validada 7/7 vendas, itens e produtos.
Objetivo: documentar a estrutura binária dos `.nx1` do Nex para implementar um
parser confiável que lê **Venda → Item → Produto → Caixa → Cliente**.

> Status dos campos nesta especificação:
>   - **[CONFIRMADO]** — validado byte-a-byte em pelo menos 7 registros reais.
>   - **[PROVÁVEL]**  — estrutura esperada, com menos evidências.
>   - **[NÃO IDENTIFICADO]** — não localizado no binário até o momento.

---

## 1. Visão geral e regra central

- Os arquivos `.nx1` são banco de dados do tipo NexusDB (magic `NX!2` no header;
  blocos de dados marcados por `NXHD`).
- **GUID (identificador) nos binários usa layout .NET** (little-endian nas 3
  primeiras partes: 4+2+2 bytes, os 6 últimos bytes em big-endian).
  **NUNCA** RFC-4122 big-endian. (Causa das buscas antigas falharem.)
- **Fonte de itens = `MovEst.nx1`** (itens modernos completos com produto,
  quantidade e preço). O `ITran.nx1` SÓ contém itens antigos (2020–21) sem
  produto/quantidade/preço. — **[CONFIRMADO]**
- Cada registro aparece **2 vezes** no arquivo (referência binária duplicada).

---

## 2. MovEst.nx1 — ITEM / Movimento

Campos relativos ao **item_uid (GUID .NET, 16 bytes, rel 0)**. — **[CONFIRMADO 7/7]**

| rel | tipo             | campo        | validação (ex. id=69798) |
|-----|------------------|--------------|--------------------------|
| -4  | int32            | ITEM id      | id do item (ex. 69798)   |
| +0  | GUID .NET (16B)  | item_uid     | identificador do item    |
| +20 | int32            | TRAN id      | id da venda (ex. 30593)  |
| +55 | GUID .NET (16B)  | produto_uid  | GUID do produto          |
| +71 | int32            | produto_id   | id do produto (ex. 146)  |
| +75 | double IEEE754   | quant        | quantidade (ex. 3)       |
| +83 | Currency int64×10000 | unit (pmc) | preço unitário (ex. 0.50) |
| +91 | Currency int64×10000 | total      | total do item (ex. 1.50) |
| +99 | Currency int64×10000 | total (dup) | total duplicado          |

- **Não há caixa nem data no MovEst** — estão no `Tran.nx1`. — **[CONFIRMADO]**
- Cada item aparece 2× no arquivo; deduplicar por `item_uid`. — **[CONFIRMADO]**

## 3. Tran.nx1 — VENDA

Campos relativos ao **tran_uid (GUID .NET, 16 bytes, rel 0)**. — **[CONFIRMADO 7/7]**

| rel    | tipo              | campo         | validação (ex. venda 30593) |
|--------|-------------------|---------------|-----------------------------|
| -4     | int32             | TRAN id       | id da venda (ex. 30593)     |
| +0     | GUID .NET (16B)   | tran_uid      | GUID da venda               |
| +32    | ASCII `"30593\0"` | TRAN id (str) | id da venda como string     |
| +134   | WideString        | tipo/descrição | `"Venda"`                  |
| +451/+455 | int32          | CAIXA id      | id da caixa (ex. 665)       |

- `caixa_uid` (GUID .NET) presente no registro. — **[CONFIRMADO]**
- vendedor `"Maciel"` (WideString) presente. — **[PROVÁVEL/observado]**
- **DATAHORA (TDateTime) e TOTAL (Currency)** da venda: **NÃO IDENTIFICADOS**
  como double/currency simples na janela varrida (-64..+1400).
  Fonte alternativa confiável: `cloud_json.nx1`. — **[NÃO IDENTIFICADO]**

## 4. Produto.nx1 — PRODUTO — **[CONFIRMADO 7/7]**

- `produto_uid` (GUID .NET) encontrado para todos os 7 produtos; vincula ao
  `produto_id` do item via GUID.
- Ex.: produto `146` com GUID `FCA40F56-...` (Alumínio Solto), produto `1003`
  (Essência Onix Yellow Drops), `682` (Essência Onix Mango), `905`, `126`, `506`,
  `627` (Carvão Solto).
- descrição do produto obtida de `catalogo_json.nx1` (blobs JSON) na prática.

## 5. Caixa.nx1 — CAIXA — **[PENDENTE de mapeamento nesta especificação]**

- Estrutura de campos ainda não mapeada nesta sessão.
- `Tran.caixa` (int32) vincula ao id da caixa; `Tran.caixa_uid` (GUID .NET)
  vincula ao caixa_uid.

## 6. Cliente.nx1 — CLIENTE — **[PENDENTE de mapeamento]**

- Estrutura ainda não mapeada nesta sessão. Na verdade todas as 7 vendas de
  teste têm `cliente = 0` (balcão).

## 7. cloud_json.nx1 — fonte de validação / campos ausentes

- Contém blobs JSON UTF-16LE com itens/vendas completos (datahora, totais,
  cliente, caixa, produto).
- Fonte **autoritativa de cruzamento** para `datahora`, `total` da venda e da
  linha, item/quant/unit/total, que não foram localizados de forma simples no
  Tran binário. — **[CONFIRMADO]**

---

## 8. Cadeia de vínculo (validada 7/7) — **[CONFIRMADO]**

```
Tran.id  ==  MovEst.tran   (venda → item)
MovEst.produto_id → Produto.id   (item → produto)
MovEst.produto_uid == Produto.produto_uid (validação por GUID)
Tran.caixa → Caixa.id / Caixa.caixa_uid
```

## 9. Casos de teste usados (7 vendas, 7 itens, 7 produtos) — **[CONFIRMADO]**

| venda | caixa | data | item  | produto | descrição | quant | unit | total |
|-------|-------|------|-------|---------|-----------|-------|------|-------|
| 30593 | 665 | 2022-11-05 | 69798 | 146 | Alumínio Solto | 3 | 0.50 | 1.50 |
| 30736 | 669 | 2022-11-11 | 70048 | 1003 | Essência Onix Yellow Drops | 1 | 12 | 12 |
| 31401 | 695 | 2022-12-13 | 71964 | 682 | Essência Onix Mango | 1 | 12 | 12 |
| 43146 | 1084 | 2024-06-01 | 103411 | 627 | Carvão Solto | 6 | 0.50 | 3 |
| 19240 | 371 | 2021-10-17 | 43539 | 126 | Essência Nay Dulce de Leche | 9 | 7.90 | 71.10 |
| 24411 | 479 | 2022-02-20 | 55947 | 506 | Essência Onix Grape | 1 | 12 | 12 |
| 38883 | 944 | 2023-11-16 | 92161 | 905 | Essência Magic Space Lemon Mint | 1 | 10 | 10 |

## 10. Decisões de implementação (parser FASE 2/5)

- **Fonte de itens**: `MovEst.nx1` (item_uid, tran, produto, quant, unit, total).
- **Fonte de vendas**: `Tran.nx1` (id, caixa, tipo).
- **Produtos**: `Produto.nx1` (+ descrição de `catalogo_json.nx1`).
- **datahora/total da venda**: de `cloud_json.nx1` (cruzamento por GUID).
- **Caixa/Cliente**: `Caixa.nx1` / `Cliente.nx1` quando disponíveis.
- **Enumeração**: localizar registros por varredura do GUID .NET e validar a
  estrutura nos offsets comprovados; deduplicar registros que aparecem 2×.
- **NÃO** usar offsets/stride antigos do importador legado (que causavam
  produtos ausentes e quant sempre 1 / preço 0).
