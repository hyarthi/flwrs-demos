<#
Runs the cv-dog demo on Windows (after .\install.ps1): starts the flwrs
server, enables the scene, serves the page, and prints its address. Ctrl+C
disables the scene and stops everything.

  .\run.ps1                  the page at http://127.0.0.1:8078/
  .\run.ps1 -Open            and open it in the browser
  .\run.ps1 -Video <file>    an MJPEG recording instead of the camera (looped)

The Windows version of ./run: keep the two in step. Untested on Windows
(flwrs has no Windows CI yet either).
#>
[CmdletBinding()]
param(
    [switch]$Open,
    [string]$Video = '',
    [switch]$Help
)
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

if ($Help) { Get-Help $PSCommandPath -Full | Out-String | Write-Host; exit 0 }

$Demo = $PSScriptRoot
$PagePort = 8078

function Die([string]$Text) { Write-Host "run: $Text" -ForegroundColor Red; exit 1 }
function Has([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Python 3.8+, as install.ps1 finds it.
function Find-Python {
    foreach ($candidate in @(@('py', '-3'), @('python3'), @('python'))) {
        $exe = $candidate[0]
        if (-not (Has $exe)) { continue }
        $rest = @($candidate | Select-Object -Skip 1)
        try {
            $ver = & $exe @rest -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>$null
        } catch { continue }
        if ($LASTEXITCODE -eq 0 -and $ver -match '^(\d+)\.(\d+)$' -and
            ([int]$Matches[1] -gt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 8))) {
            return , $candidate
        }
    }
    return $null
}

$exe = Join-Path $Demo 'bin\flwrs-app.exe'
if (-not (Test-Path $exe)) { Die 'not installed: run .\install.ps1 first' }
$Python = Find-Python
if (-not $Python) { Die 'Python 3.8 or newer is needed' }
$Py = $Python[0]
$PyArgs = @($Python | Select-Object -Skip 1)
function Setup([string[]]$Arguments) {
    & $Py @($PyArgs + @('scene/setup.py') + $Arguments)
    if ($LASTEXITCODE -ne 0) { throw "scene/setup.py $($Arguments -join ' ') failed" }
}
if ($Video) { $Video = (Resolve-Path $Video).Path }

Set-Location $Demo
New-Item -ItemType Directory -Force (Join-Path $Demo '.data') | Out-Null
# The server and the page server in hidden windows of their own, so a Ctrl+C
# here reaches only this script, whose finally block disables the scene
# before it stops them.
$server = Start-Process -FilePath $exe -ArgumentList @('--config', 'scene/config.toml') `
    -WorkingDirectory $Demo -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $Demo '.data\server.log') `
    -RedirectStandardError (Join-Path $Demo '.data\server.err.log')
$page = $null
try {
    Setup @('wait', '60')
    if ($Video) { Setup @('input-video', $Video) } else { Setup @('input-camera') }
    Setup @('enable')
    $page = Start-Process -FilePath $Py `
        -ArgumentList ($PyArgs + @('-m', 'http.server', "$PagePort", '--bind', '127.0.0.1', '--directory', $Demo)) `
        -WindowStyle Hidden -PassThru
    $url = "http://127.0.0.1:$PagePort/"
    Write-Host "The dog: $url"
    Write-Host 'flwrs:   http://127.0.0.1:8077/ (the server, its scene and logs)'
    Write-Host 'Ctrl+C stops.'
    if ($Open) { Start-Process $url }
    # Wait in short steps, so Ctrl+C is handled promptly.
    while (-not $server.HasExited) { Start-Sleep -Milliseconds 500 }
} finally {
    Write-Host "`nStopping…"
    try { Setup @('disable') } catch { }
    if ($page -and -not $page.HasExited) { Stop-Process -Id $page.Id -Force }
    # No console signal reaches a process in another console: a plain stop,
    # after the scene's nodes were shut down by the disable above.
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
