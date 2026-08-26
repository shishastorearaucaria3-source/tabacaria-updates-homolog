# Instalação do NossoSistema — verificação e segurança (custo R$0)

## O que é assinatura e por que o Windows avisa

- O **Cosign/Sigstore** usado nas releases garante **integridade** (o arquivo baixado é exatamente o que foi publicado) e **procedência** (quem/onde foi gerado). Isso é verificado com `cosign verify-blob`.
- O **Cosign NÃO é uma assinatura Authenticode**. O Windows **não** reconhece o `.sigstore.json` como assinatura digital.
- Sem certificado Authenticode, o Windows pode mostrar: **"Windows protegeu seu computador — Microsoft Defender SmartScreen impediu o início de um aplicativo não reconhecido."**
- Isso **não** significa vírus: é o comportamento padrão para qualquer software **não assinado** baixado da internet.
- **Não existe solução gratuita confiável** que elimine esse aviso para software comercial/privado. A eliminação definitiva exige um certificado Authenticode pago (OV/EV de CA confiável).

## Antes de instalar — verificar a integridade (gratuito)

1. Baixe o instalador `NossoSistema-Setup.exe` da release oficial.
2. Abra o arquivo `SHA256SUMS` da mesma release.
3. No PowerShell, calcule o hash do instalador:
   ```powershell
   Get-FileHash -LiteralPath "C:\caminho\NossoSistema-Setup.exe" -Algorithm SHA256
   ```
4. Compare o valor com o publicado em `SHA256SUMS`. **Se bater, o arquivo é exatamente o publicado** (não foi alterado no meio do caminho).

## Se o Windows mostrar "Windows protegeu seu computador"

Este é o passo **manual e consciente** do usuário (nunca automatizado pelo sistema):

1. Na janela do aviso, clique em **"Mais informações"**.
2. Clique em **"Executar assim mesmo"**.
3. Confirme que o Publisher/nome do arquivo corresponde ao esperado e que o `SHA256` bate com a release oficial.

> Aviso importante: essa opção existe para o usuário **decidir conscientemente**. Se você não confia na origem do arquivo, **não** execute — verifique o hash primeiro e baixe apenas da release oficial.

## Verificar a assinatura (se um dia houver certificado)

Quando o projeto passar a ter certificado Authenticode, será possível verificar:

```powershell
Get-AuthenticodeSignature -LiteralPath "C:\caminho\NossoSistema-Setup.exe"
```

- `Status = Valid` e um Publisher preenchido = assinatura válida.
- `Status = NotSigned` = não assinado (como hoje, antes do certificado).

## O que o sistema NÃO faz

- Não desativa o SmartScreen.
- Não desativa o Windows Defender.
- Não adiciona exceções no antivírus.
- Não tenta burlar a segurança do Windows.
- Não pede execução como administrador para "liberar" o arquivo.

## Integridade da release

- Os executáveis publicados **não são alterados depois da publicação** (hash estável em `SHA256SUMS` + assinatura Sigstore).
- Em cada versão, `SHA256SUMS` é recalculado sobre os artefatos **finais**.
- O canal de atualização valida **tamanho + SHA-256** antes de instalar (já existente).