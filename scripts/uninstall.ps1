<#
.SYNOPSIS
  Desinstala o Terminal-Design (atalho para `td uninstall`).

.DESCRIPTION
  Remove a integração com o Claude Code (só a nossa), a entrada no PATH e os arquivos
  do programa em %LOCALAPPDATA%\TerminalDesign. A configuração é mantida, a menos que
  você use -Purge ou responda que quer apagá-la.

    powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 [-Yes] [-KeepConfig] [-Purge]
#>
[CmdletBinding()]
param(
  [switch]$Yes,
  [switch]$KeepConfig,
  [switch]$Purge
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'x Node.js não encontrado; ele é necessário para desinstalar com segurança.' -ForegroundColor Red
  exit 1
}

if ($env:TD_DATA_HOME) { $dataHome = $env:TD_DATA_HOME } else { $dataHome = Join-Path $env:LOCALAPPDATA 'TerminalDesign' }
$launcher = Join-Path $dataHome 'launcher.js'
$repoTd = Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\td.js'

$tdArgs = @('uninstall')
if ($Yes) { $tdArgs += '--yes' }
if ($KeepConfig) { $tdArgs += '--keep-config' }
if ($Purge) { $tdArgs += '--purge' }

if (Test-Path $launcher) { & node $launcher @tdArgs } else { & node $repoTd @tdArgs }
exit $LASTEXITCODE
