# ============================================================
# scripts/preparar-release.ps1
# Prepara a release mantendo custo R$0.
#
# Fluxo (sem certificado):
#   build -> EXEs -> SHA256 -> verificação informativa -> Cosign -> release
#
# Fluxo (quando WIN_CSC_LINK estiver definido no futuro):
#   build -> Authenticode (electron-builder assina automaticamente)
#         -> SHA256 -> verificação ESTRITA -> Cosign -> release
#
# O electron-builder NÃO exige certificado: se WIN_CSC_LINK não
# estiver definido, ele apenas não assina. Este script só orquestra
# os passos e deixa a assinatura ser condicional ao certificado.
# ============================================================
param(
    [string]$Versao = '',
    [switch]$SemCosign,      # para testes locais rápidos
    [switch]$SomenteVerificar
)

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot | Split-Path -Parent
Set-Location $raiz

function Passo($nome) { Write-Host "`n=== $nome ===" -ForegroundColor Cyan }
function Sha256File($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }

# 1. Informa o estado do certificado
if ($env:WIN_CSC_LINK) {
    Passo "CERTIFICADO DETECTADO (WIN_CSC_LINK definido) - electron-builder assinará"
} else {
    Passo "SEM CERTIFICADO (custo R$0) - build segue sem Authenticode"
}

# 2. Build
if (-not $SomenteVerificar) {
    if ($Versao) {
        Passo "Definindo versão $Versao"
        node -e "const fs=require('fs');const f='package.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.version='$Versao';fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
    }

    Passo "Build: app + instalador NSIS"
    npm.cmd run package
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Passo "Build: portable (canal de atualização)"
    npm.cmd run package:portable
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Passo "Build: instalador customizado (NossoSistema-Setup)"
    npm.cmd run package:setup
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# 3. SHA256SUMS (cobre os EXEs finais, assinados ou não)
Passo "Gerando SHA256SUMS"
$exes = @()
$exes += Get-ChildItem -LiteralPath "$raiz\dist-final" -Filter '*.exe' -File -ErrorAction SilentlyContinue
$exes += Get-ChildItem -LiteralPath "$raiz\dist-setup" -Filter '*.exe' -File -ErrorAction SilentlyContinue
$lines = foreach ($e in $exes) {
    "{0}  {1}" -f (Sha256File $e.FullName), (Split-Path $e -Leaf)
}
$lines | Set-Content -LiteralPath "$raiz\SHA256SUMS" -Encoding ASCII
Get-Content -LiteralPath "$raiz\SHA256SUMS"

# 4. Verificação de assinatura (condicional: só falha se certificado presente)
Passo "Verificação Authenticode (condicional)"
powershell -NoProfile -ExecutionPolicy Bypass -File "$raiz\scripts\verificar-assinatura.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 5. Cosign/Sigstore (integridade, NÃO Authenticode)
if (-not $SemCosign -and (Get-Command cosign -ErrorAction SilentlyContinue)) {
    Passo "Cosign sign-blob (integridade)"
    New-Item -ItemType Directory -Path "$raiz\artifacts" -Force | Out-Null
    foreach ($e in $exes) {
        $name = (Split-Path $e -Leaf) -replace '[^A-Za-z0-9._-]', '_'
        cosign sign-blob --yes --bundle "$raiz\artifacts\$name.sigstore.json" $e.FullName
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} elseif (-not $SemCosign) {
    Write-Host "cosign não encontrado no PATH - pulando (opcional)." -ForegroundColor Yellow
}

Passo "Concluído"
Write-Host "Artefatos: dist-final/ e dist-setup/ + SHA256SUMS"
if (Test-Path "$raiz\artifacts") { Write-Host "Assinatura Sigstore: artifacts/*.sigstore.json" }