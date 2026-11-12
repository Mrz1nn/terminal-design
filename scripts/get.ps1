# Terminal-Design: instalação completa em uma linha (Windows 10/11, Windows PowerShell 5.1+).
#
#   irm https://raw.githubusercontent.com/Mrz1nn/terminal-design/main/scripts/get.ps1 | iex
#
# Opções (com pipe, use variáveis de ambiente antes do comando):
#   $env:TD_NO_CLAUDE = '1'   não configura a status line do Claude Code
#   $env:TD_THEME = 'nord'    tema inicial
#   $env:TD_NO_PATH = '1'     não mexe no PATH do usuário
# Como arquivo: powershell -ExecutionPolicy Bypass -File get.ps1 -NoClaude -Theme nord -NoPath
#
# O que acontece:
#   1. Node.js 18.17+: usa o seu; se faltar, instala o Node.js LTS com o winget
#      (OpenJS.NodeJS.LTS). Sem winget, baixa o zip oficial de nodejs.org, confere o
#      SHA-256 e coloca em %LOCALAPPDATA%\TerminalDesign\node (só para o Terminal-Design).
#   2. Baixa a última release do GitHub, confere o SHA-256 e só então extrai.
#   3. Roda scripts\install.ps1 da release com -ClaudeCode.
# Nada baixado é executado antes da verificação do checksum.
#
# Variáveis para testes/CI:
#   TD_RELEASE_BASE_URL, ou TD_RELEASE_ZIP + TD_RELEASE_SUMS (arquivos locais de scripts/pack-release.js)
#   TD_NODE_DIST_URL (pasta de distribuição do Node.js; https:// ou pasta local; força o zip, sem winget)
#   TD_NO_WINGET=1 (usa o zip mesmo havendo winget)

# Everything lives in one function called on the last line, so a truncated download
# never runs half of the script.
function Install-TerminalDesign {
  param(
    [switch]$NoClaude,
    [switch]$NoPath,
    [string]$Theme
  )

  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

  if ($env:TD_NO_CLAUDE -eq '1') { $NoClaude = $true }
  if ($env:TD_NO_PATH -eq '1') { $NoPath = $true }
  if (-not $Theme -and $env:TD_THEME) { $Theme = $env:TD_THEME }

  $repo = 'Mrz1nn/terminal-design'
  if ($env:TD_RELEASE_BASE_URL) { $releaseBase = $env:TD_RELEASE_BASE_URL.TrimEnd('/') } else { $releaseBase = "https://github.com/$repo/releases/latest/download" }
  if ($env:TD_NODE_DIST_URL) { $nodeDist = $env:TD_NODE_DIST_URL.TrimEnd('/', '\') } else { $nodeDist = 'https://nodejs.org/dist/latest-v22.x' }
  if ($env:TD_DATA_HOME) { $dataHome = $env:TD_DATA_HOME } else { $dataHome = Join-Path $env:LOCALAPPDATA 'TerminalDesign' }

  function Fail([string]$msg) { throw "x $msg" }
  function Step([string]$msg) { Write-Host "  > $msg" }

  function Get-Resource([string]$src, [string]$dest) {
    if ($src -match '^https://') {
      # .NET WebClient instead of Invoke-WebRequest: no module autoload (works when Windows PowerShell
      # is started from PowerShell 7) and TLS 1.2 forced, which GitHub requires on older Windows 10.
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $wc = New-Object System.Net.WebClient
      $wc.Headers['User-Agent'] = 'terminal-design-installer'
      try { $wc.DownloadFile($src, $dest) } finally { $wc.Dispose() }
    } elseif ($src -match '^http://') {
      Fail "recusado: só HTTPS é permitido ($src)"
    } else {
      $local = $src -replace '^file:///?', ''
      if (-not (Test-Path -LiteralPath $local -PathType Leaf)) { Fail "arquivo não encontrado: $src" }
      Copy-Item -LiteralPath $local -Destination $dest -Force
    }
  }

  # .NET ZipFile instead of Expand-Archive (no module autoload). It refuses entries that would
  # land outside the destination folder (zip-slip).
  function Expand-Zip([string]$zip, [string]$dest) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
  }

  function Join-Src([string]$base, [string]$name) {
    if ($base -match '^(https?|file)://') { return "$base/$name" }
    return (Join-Path $base $name)
  }

  function Assert-Hash([string]$file, [string]$expected) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fs = [System.IO.File]::OpenRead($file)
    try { $actual = -join ($sha.ComputeHash($fs) | ForEach-Object { $_.ToString('x2') }) } finally { $fs.Dispose(); $sha.Dispose() }
    if ($actual -ne $expected.ToLowerInvariant()) {
      Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
      Fail "SHA-256 não confere para $(Split-Path -Leaf $file); download recusado"
    }
  }

  function Test-NodeOk([string]$exe) {
    if (-not $exe -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $false }
    try {
      $v = (& $exe -p 'process.versions.node' 2>$null)
      if (-not $v) { return $false }
      return ([version](($v | Select-Object -First 1).Trim() -replace '-.*$', '')) -ge [version]'18.17.0'
    } catch { return $false }
  }

  function Find-Node {
    $cands = @()
    if ($env:TD_NODE) { $cands += $env:TD_NODE }
    $cands += (Join-Path $dataHome 'node\node.exe')
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $cands += $cmd.Source }
    foreach ($c in $cands) { if (Test-NodeOk $c) { return $c } }
    return $null
  }

  function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
  }

  function Install-NodeZip([string]$tmp) {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) { 'ARM64' { $a = 'arm64' } 'AMD64' { $a = 'x64' } default { Fail "arquitetura não suportada para baixar o Node.js: $arch" } }
    Step "baixando o Node.js LTS oficial (win-$a) de $nodeDist"
    $sums = Join-Path $tmp 'node-SHASUMS256.txt'
    Get-Resource (Join-Src $nodeDist 'SHASUMS256.txt') $sums
    $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match "^([0-9a-f]{64})\s+(node-v[0-9.]+-win-$a\.zip)$" } | Select-Object -First 1
    if (-not $line) { Fail "não achei o Node.js para win-$a em $nodeDist" }
    $null = $line -match "^([0-9a-f]{64})\s+(node-v[0-9.]+-win-$a\.zip)$"
    $hash = $Matches[1]; $file = $Matches[2]
    $zip = Join-Path $tmp $file
    Get-Resource (Join-Src $nodeDist $file) $zip
    Assert-Hash $zip $hash
    Step "$file conferido (SHA-256)"
    $x = Join-Path $tmp 'node-x'
    Expand-Zip $zip $x
    $src = Join-Path $x ($file -replace '\.zip$', '')
    if (-not (Test-Path -LiteralPath (Join-Path $src 'node.exe'))) { Fail 'o pacote do Node.js não tem node.exe' }
    $dest = Join-Path $dataHome 'node'
    New-Item -ItemType Directory -Force -Path $dataHome | Out-Null
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Move-Item -LiteralPath $src -Destination $dest
    $exe = Join-Path $dest 'node.exe'
    if (-not (Test-NodeOk $exe)) { Fail 'o Node.js baixado não funciona neste computador' }
    return $exe
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("terminal-design-" + [Guid]::NewGuid().ToString('N').Substring(0, 12))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $prevNode = $env:TD_NODE
  try {
    Write-Host ''
    Write-Host 'Terminal-Design: instalação completa' -ForegroundColor Cyan
    Write-Host ''

    # ---- 1. Node.js -----------------------------------------------------------
    $node = $null
    if (-not $env:TD_NODE_DIST_URL) { $node = Find-Node }
    $nodeNote = $null
    if ($node) {
      $nodeNote = "Node.js $((& $node -p 'process.versions.node')) ($node)"
      Step "Node.js encontrado: $nodeNote"
    } else {
      $winget = Get-Command winget -ErrorAction SilentlyContinue
      if ($winget -and -not $env:TD_NODE_DIST_URL -and $env:TD_NO_WINGET -ne '1') {
        Step 'Node.js 18.17+ não encontrado; instalando o Node.js LTS com o winget (pode pedir confirmação do Windows)…'
        & winget install -e --id OpenJS.NodeJS.LTS --scope user --silent --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
          Step 'tentando de novo sem --scope user…'
          & winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
        }
        Update-SessionPath
        $node = Find-Node
        if ($node) { $nodeNote = "Node.js $((& $node -p 'process.versions.node')) instalado pelo winget" }
      }
      if (-not $node) {
        $node = Install-NodeZip $tmp
        $nodeNote = "Node.js $((& $node -p 'process.versions.node')) baixado de nodejs.org para $(Join-Path $dataHome 'node')"
      }
      Step $nodeNote
    }

    # ---- 2. release -----------------------------------------------------------
    $sums = Join-Path $tmp 'SHA256SUMS.txt'
    if ($env:TD_RELEASE_SUMS) { Get-Resource $env:TD_RELEASE_SUMS $sums } else { Get-Resource "$releaseBase/SHA256SUMS.txt" $sums }
    $pattern = '^([0-9a-fA-F]{64})\s+\*?(terminal-design-[0-9][0-9A-Za-z.+-]*\.zip)\s*$'
    $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if (-not $line) { Fail 'o SHA256SUMS.txt da release não lista o pacote terminal-design-<versão>.zip' }
    $null = $line -match $pattern
    $zipHash = $Matches[1]; $zipName = $Matches[2]
    $zip = Join-Path $tmp $zipName
    if ($env:TD_RELEASE_ZIP) { Get-Resource $env:TD_RELEASE_ZIP $zip } else { Get-Resource "$releaseBase/$zipName" $zip }
    Assert-Hash $zip $zipHash
    Step "$zipName baixado e conferido (SHA-256)"

    $x = Join-Path $tmp 'release'
    Expand-Zip $zip $x
    $root = Get-ChildItem -LiteralPath $x -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'scripts\install.ps1') } | Select-Object -First 1
    if ($root) { $root = $root.FullName } elseif (Test-Path -LiteralPath (Join-Path $x 'scripts\install.ps1')) { $root = $x } else { Fail 'o pacote baixado não tem scripts\install.ps1' }

    # ---- 3. install -----------------------------------------------------------
    $env:TD_NODE = $node
    $installArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'scripts\install.ps1'))
    if (-not $NoClaude) { $installArgs += '-ClaudeCode' }
    if ($NoPath) { $installArgs += '-NoPath' }
    if ($Theme) { $installArgs += @('-Theme', $Theme) }
    # A Windows PowerShell child started from PowerShell 7 inherits PowerShell 7 module paths and then
    # cannot load its own cmdlets. Give the child the default Windows PowerShell module path.
    $savedModulePath = $env:PSModulePath
    $env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
    try { & powershell.exe @installArgs } finally { $env:PSModulePath = $savedModulePath }
    if ($LASTEXITCODE -ne 0) { Fail 'o instalador terminou com erro (veja acima)' }


    # ---- summary --------------------------------------------------------------
    Write-Host ''
    Write-Host '────────────────────────────────────────'
    Write-Host 'Terminal-Design instalado.' -ForegroundColor Green
    Write-Host "  • programa: $dataHome"
    Write-Host "  • $nodeNote"
    if ($NoClaude) { Write-Host '  • Claude Code: não configurado (rode depois: td claude install)' } else { Write-Host '  • Claude Code: status line configurada' }
    Write-Host ''
    if ($NoPath) { Write-Host "Pronto. Rode: `"$(Join-Path $dataHome 'bin\td.cmd')`"" -ForegroundColor Green }
    else { Write-Host 'Pronto. Abra um terminal novo e digite td' -ForegroundColor Green }
  } catch {
    Write-Host ''
    Write-Host "$($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'A instalação não foi concluída.' -ForegroundColor Red
    $global:LASTEXITCODE = 1
    if ($MyInvocation.ScriptName) { exit 1 }
  } finally {
    $env:TD_NODE = $prevNode
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Script arguments when run as a file; empty when piped into iex.
$tdGetArgs = @{}
for ($i = 0; $i -lt $args.Count; $i++) {
  switch -Regex ($args[$i]) {
    '^-NoClaude$' { $tdGetArgs.NoClaude = $true }
    '^-NoPath$' { $tdGetArgs.NoPath = $true }
    '^-Theme$' { $i++; $tdGetArgs.Theme = $args[$i] }
  }
}
Install-TerminalDesign @tdGetArgs
