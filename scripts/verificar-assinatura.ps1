# ============================================================
# scripts/verificar-assinatura.ps1
# Verifica Authenticode dos EXEs finais.
#
# MODO CONDICIONAL (default):
#   - Se WIN_CSC_LINK estiver definido  -> MODO ESTRITO: falha se
#     qualquer EXE estiver NotSigned (pipeline com certificado).
#   - Se WIN_CSC_LINK NÃO estiver definido -> MODO INFORMATIVO:
#     apenas informa o estado; NÃO falha (build sem certificado,
#     custo R$0, mantém Cosign como integridade).
#
# Uso:
#   powershell -NoProfile -File scripts/verificar-assinatura.ps1
#   powershell -NoProfile -File scripts/verificar-assinatura.ps1 -Estrito
# ============================================================
param(
    [string]$Raiz = (Get-Location).Path,
    [switch]$Estrito
)

$ErrorActionPreference = 'Stop'
$falhou = 0
$verificados = 0

# Decide o modo: estrito se flag OU se WIN_CSC_LINK está definido
$temCertificado = [bool]$env:WIN_CSC_LINK -or $Estrito
$modo = if ($temCertificado) { 'ESTRITO' } else { 'INFORMATIVO' }

# Lista de EXEs que DEVEM estar assinados (quando há certificado)
$exes = @(
    "dist-setup\NossoSistema-Setup.exe",
    "dist-setup\win-unpacked\NossoSistema Setup.exe",
    "dist-setup\win-unpacked\resources\embedded\app\Sistema Loja Tabacaria.exe",
    "dist-final\win-unpacked\Sistema Loja Tabacaria.exe",
    "dist-final\NossoSistema.exe"
)

Write-Host ""
Write-Host "=== VERIFICAÇÃO DE ASSINATURA AUTHENTICODE ===" -ForegroundColor Cyan
Write-Host "Modo: $modo  | WIN_CSC_LINK: $(if ($env:WIN_CSC_LINK) { 'definido' } else { 'ausente' })" -ForegroundColor DarkYellow
Write-Host ""

# Lembrete sobre Sigstore/Cosign vs Authenticode
if (-not $temCertificado) {
    Write-Host "ATENÇÃO: sem certificado Authenticode. O Cosign/Sigstore garante" -ForegroundColor DarkYellow
    Write-Host "integridade, mas NÃO é reconhecido pelo Windows como assinatura." -ForegroundColor DarkYellow
    Write-Host "O EXE pode exibir 'Windows protegeu seu computador' no download." -ForegroundColor DarkYellow
    Write-Host ""
}

foreach ($rel in $exes) {
    $exe = Join-Path $Raiz $rel
    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Host "AUSENTE $rel" -ForegroundColor Yellow
        continue
    }
    $verificados++
    $sig = Get-AuthenticodeSignature -LiteralPath $exe
    $publisher = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '(nenhum)' }
    if ($sig.Status -eq 'Valid' -and $sig.SignerCertificate) {
        Write-Host "OK     $rel" -ForegroundColor Green
        Write-Host "       Publisher: $publisher" -ForegroundColor DarkGray
    } else {
        $msg = "SEM-SIG $rel | Status: $($sig.Status) | Publisher: $publisher"
        if ($temCertificado) {
            Write-Host "FALHA  $msg" -ForegroundColor Red
            $falhou++
        } else {
            Write-Host "INFO   $msg" -ForegroundColor DarkGray
        }
    }
}

Get-ChildItem -LiteralPath (Join-Path $Raiz 'dist-final') -Filter 'Sistema Loja Tabacaria Setup*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
    $verificados++
    $sig = Get-AuthenticodeSignature -LiteralPath $_.FullName
    if ($sig.Status -eq 'Valid' -and $sig.SignerCertificate) {
        Write-Host "OK     $($_.Name)" -ForegroundColor Green
    } else {
        $msg = "SEM-SIG $($_.Name) | Status: $($sig.Status)"
        if ($temCertificado) {
            Write-Host "FALHA  $msg" -ForegroundColor Red
            $falhou++
        } else {
            Write-Host "INFO   $msg" -ForegroundColor DarkGray
        }
    }
}

Write-Host ""
Write-Host "Verificados: $verificados | Falhas: $falhou (modo $modo)" -ForegroundColor Cyan

if ($temCertificado -and $falhou -gt 0) {
    Write-Host "ERRO: certificado presente mas um ou mais EXEs NÃO estão assinados." -ForegroundColor Red
    exit 1
}

if ($temCertificado) {
    Write-Host "OK: todos os executáveis estão assinados (Authenticode válido)." -ForegroundColor Green
} else {
    Write-Host "OK: modo informativo (sem certificado). Build continua sem Authenticode." -ForegroundColor Green
    Write-Host "    Cosign/Sigstore permanece como verificação de integridade." -ForegroundColor Green
}
exit 0