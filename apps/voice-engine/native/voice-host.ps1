<#
  Terminal-Design voice host launcher (Windows PowerShell 5.1, no modules required).

  Compiles voice-host.cs with Add-Type (C# compiler that ships with .NET Framework) and runs it.
  The compiled DLL is cached in -CacheDir, keyed by the SHA-256 of the C# source, so only the
  first start pays the ~1-2 s compile cost.

  Normally started by apps/voice-engine/src/host.js, which speaks JSON lines on stdin/stdout.
  Modes: listen (global hotkey), record (fixed N seconds, for `td voice test`), devices (list mics).
#>
param(
  [ValidateSet('listen', 'record', 'devices')][string]$Mode = 'listen',
  [int]$Modifiers = 6,
  [int]$Vk = 0x78,
  [string]$HotkeyLabel = 'Ctrl+Shift+F9',
  [ValidateSet('push-to-talk', 'toggle')][string]$Trigger = 'push-to-talk',
  [int]$MaxSeconds = 60,
  [int]$Seconds = 5,
  [string]$Device = 'default',
  [ValidateSet('type', 'paste')][string]$InsertMode = 'type',
  [string]$OutDir = $env:TEMP,
  [string]$CacheDir = '',
  [switch]$NoOverlay,
  [switch]$NoTray
)

$ErrorActionPreference = 'Stop'

function Write-HostEvent([hashtable]$obj) {
  # Escape non-ASCII as \uXXXX so the line survives any console code page (cp850, cp1252...).
  $json = [regex]::Replace(($obj | ConvertTo-Json -Compress), '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
  [Console]::Out.Write($json + "`n")
  [Console]::Out.Flush()
}

try {
  $source = Join-Path $PSScriptRoot 'voice-host.cs'
  $code = [IO.File]::ReadAllText($source)
  $refs = @('System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions')

  if (-not ('TerminalDesign.Voice.Host' -as [type])) {
    if ($CacheDir) {
      $sha = [Security.Cryptography.SHA256]::Create()
      $hash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($code)) | ForEach-Object { $_.ToString('x2') })
      $dll = Join-Path $CacheDir ("voice-host-" + $hash.Substring(0, 16) + ".dll")
      if (-not (Test-Path -LiteralPath $dll)) {
        New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
        # Compile to a temp name first so a concurrent start never loads a half-written DLL.
        $tmp = "$dll.$PID.tmp"
        Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -OutputAssembly $tmp -OutputType Library
        Move-Item -LiteralPath $tmp -Destination $dll -Force
      }
      Add-Type -LiteralPath $dll
    } else {
      Add-Type -TypeDefinition $code -ReferencedAssemblies $refs
    }
  }
} catch {
  Write-HostEvent @{ event = 'error'; code = 'compile'; message = "falha ao compilar o host de voz: $($_.Exception.Message)" }
  exit 10
}

try {
  $code = [TerminalDesign.Voice.Host]::Run($Mode, [uint32]$Modifiers, [uint32]$Vk, $HotkeyLabel, $Trigger,
    $MaxSeconds, $Seconds, $Device, $InsertMode, $OutDir, (-not $NoOverlay), (-not $NoTray))
  exit $code
} catch {
  Write-HostEvent @{ event = 'error'; code = 'host'; message = $_.Exception.Message }
  exit 11
}
