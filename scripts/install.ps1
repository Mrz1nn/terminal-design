<#
.SYNOPSIS
  Instala o Terminal-Design a partir deste repositório (clonado ou baixado).

.DESCRIPTION
  Copia os arquivos do programa para %LOCALAPPDATA%\TerminalDesign\versions\<versão>,
  cria o launcher, o atalho bin\td.cmd e o current.json, adiciona bin\ ao PATH do usuário
  (sem admin) e roda `td doctor`. A configuração em %APPDATA%\TerminalDesign só é criada
  se não existir; nunca é sobrescrita. Pode rodar de novo quantas vezes quiser.

  Se o Windows bloquear o script:
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1

.PARAMETER Theme
  Define o tema (ex.: midnight, dracula, nord).
.PARAMETER ClaudeCode
  Também instala a status line no Claude Code (td claude install).
.PARAMETER NoPath
  Não altera o PATH do usuário.
#>
[CmdletBinding()]
param(
  [string]$Theme,
  [switch]$ClaudeCode,
  [switch]$NoPath
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Fail([string]$msg) {
  Write-Host "x $msg" -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Terminal-Design - instalação' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $repo 'package.json')) -or -not (Test-Path (Join-Path $repo 'packages\updater\src\installer.js'))) {
  Fail "não encontrei os arquivos do Terminal-Design em $repo. Rode este script de dentro da pasta do projeto."
}

# Node.js >= 18.17
# TD_NODE (used by get.ps1 with a private Node.js) wins over the node in PATH.
if ($env:TD_NODE) {
  if (-not (Test-Path -LiteralPath $env:TD_NODE -PathType Leaf)) { Fail "TD_NODE aponta para um arquivo que não existe: $($env:TD_NODE)" }
  $nodeExe = $env:TD_NODE
} else {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) { $nodeExe = $nodeCmd.Source } else { $nodeExe = $null }
}
if (-not $nodeExe) {
  Fail 'Node.js não encontrado. Instale o Node.js 18.17 ou mais novo (LTS recomendado): https://nodejs.org/pt-br/download  e abra um terminal novo.'
}
$nodeVersion = (& $nodeExe -p 'process.versions.node' 2>$null)
if (-not $nodeVersion) { Fail 'não foi possível executar o Node.js.' }
try { $parsed = [version]($nodeVersion.Trim() -replace '-.*$', '') } catch { Fail "versão do Node.js não reconhecida: $nodeVersion" }
if ($parsed -lt [version]'18.17.0') {
  Fail "o Terminal-Design precisa do Node.js 18.17 ou mais novo (encontrado $nodeVersion). Atualize em https://nodejs.org/pt-br/download"
}
Write-Host "  > Node.js $nodeVersion ($nodeExe)"

$nodeArgs = @((Join-Path $repo 'packages\updater\src\installer.js'))
if ($NoPath) { $nodeArgs += '--no-path' }
if ($Theme) { $nodeArgs += "--theme=$Theme" }

& $nodeExe @nodeArgs
if ($LASTEXITCODE -ne 0) { Fail 'a instalação não foi concluída. A nova versão não foi ativada; a instalação anterior, se havia, continua como estava.' }

if ($env:TD_DATA_HOME) { $dataHome = $env:TD_DATA_HOME } else { $dataHome = Join-Path $env:LOCALAPPDATA 'TerminalDesign' }
$binDir = Join-Path $dataHome 'bin'
$launcher = Join-Path $dataHome 'launcher.js'

# Make `td` usable in this window too.
if (-not $NoPath -and (($env:Path -split ';') -notcontains $binDir)) { $env:Path = "$env:Path;$binDir" }

Write-Host ''
& $nodeExe $launcher doctor
if ($LASTEXITCODE -ne 0) { Write-Host '! td doctor encontrou pontos de atenção (veja acima). A instalação foi feita.' -ForegroundColor Yellow }

if ($ClaudeCode) {
  Write-Host ''
  & $nodeExe $launcher claude install
  if ($LASTEXITCODE -ne 0) { Write-Host '! não foi possível configurar o Claude Code agora. Rode depois: td claude install' -ForegroundColor Yellow }
}

Write-Host ''
if ($NoPath) {
  Write-Host "Pronto. Rode: `"$binDir\td.cmd`"" -ForegroundColor Green
} else {
  Write-Host 'Pronto. Abra um terminal novo e digite: td' -ForegroundColor Green
}
exit 0
