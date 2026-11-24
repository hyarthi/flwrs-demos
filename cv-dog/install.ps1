<#
Installs the cv-dog demo on Windows: builds flwrs (the server and its plugins)
from source, downloads the models, and sets up the demo's scene on a local
server. Safe to re-run. Everything it makes stays in this folder, in
gitignored places: .flwrs\ (the flwrs checkout), .build\ (build output),
bin\ (the server), packages\ (plugin packages), models\, .data\.

  .\install.ps1                      the newest flwrs release (a v<version> tag)
  .\install.ps1 -Ref main            a branch, tag or commit of flwrs instead
  .\install.ps1 -Flwrs <path>        a local flwrs checkout as it is (development)
  .\install.ps1 -Plugins a,b         build these plugins (default: the ones the
                                     scene uses, listed in scene\plugins.txt)
  .\install.ps1 -Plugins all         build every flwrs plugin
  .\install.ps1 -DebugBuild          debug builds (faster to build, slower to run)

Needs: git, Python 3.8+, the Rust toolchain flwrs asks for (its rust-version)
with the MSVC build tools (Visual Studio Build Tools, "Desktop development
with C++"), Node.js 20.19+ and npm (the server's web UI).
$env:FLWRS_REPO overrides where flwrs is cloned from (a URL or a local path).

The Windows version of ./install: keep the two in step. Untested on Windows
(flwrs has no Windows CI yet either).
#>
[CmdletBinding()]
param(
    [string]$Ref = '',
    [string]$Flwrs = '',
    [string[]]$Plugins = @(),
    [switch]$DebugBuild,
    [switch]$Help
)
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

if ($Help) { Get-Help $PSCommandPath -Full | Out-String | Write-Host; exit 0 }

$Demo = $PSScriptRoot
$Repo = if ($env:FLWRS_REPO) { $env:FLWRS_REPO } else { 'https://github.com/hyarthi/flwrs' }
$ProfileName = if ($DebugBuild) { 'debug' } else { 'release' }

function Say([string]$Text) { Write-Host $Text }
function Die([string]$Text) { Write-Host "install: $Text" -ForegroundColor Red; exit 1 }
function Has([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
# Runs a native command and stops on failure (PowerShell doesn't for exit codes).
function Run([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { Die "$Exe $($Arguments -join ' ') failed ($LASTEXITCODE)" }
}

# Python 3.8+: `py -3`, `python3` or `python` (the Microsoft Store's `python`
# stub only opens the Store, so the version is checked, not just the name).
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

# --- Tools -------------------------------------------------------------------
$missing = @()
if (-not (Has 'git')) { $missing += 'git (https://git-scm.com)' }
if (-not (Has 'cargo')) { $missing += 'Rust (https://rustup.rs)' }
if (-not (Has 'node')) { $missing += 'Node.js 20.19 or newer (https://nodejs.org)' }
if (-not (Has 'npm')) { $missing += 'npm (comes with Node.js)' }
$Python = Find-Python
if (-not $Python) { $missing += 'Python 3.8 or newer (https://www.python.org; the Store stub isn''t enough)' }
if (Has 'rustc') {
    $hostTriple = (& rustc -vV | Select-String '^host: ').Line.Substring(6)
    if ($hostTriple -like '*msvc*') {
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        $vc = $null
        if (Test-Path $vswhere) {
            $vc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        }
        if (-not $vc -and -not (Has 'cl')) {
            $missing += 'the MSVC C/C++ build tools (Visual Studio Build Tools, "Desktop development with C++")'
        }
    } elseif (-not (Has 'gcc')) {
        $missing += "a C compiler for $hostTriple (gcc)"
    }
}
if ($missing.Count -gt 0) {
    Die ("missing tools:`n  - " + ($missing -join "`n  - "))
}
$nodeOk = & node -e 'const [a,b]=process.versions.node.split(".").map(Number); console.log(a>20||(a===20&&b>=19)?1:0)'
if ($nodeOk -ne '1') { Die "Node.js $(& node --version) is too old: the web UI needs 20.19 or newer" }
$Py = $Python[0]
$PyArgs = @($Python | Select-Object -Skip 1)

# --- flwrs source -------------------------------------------------------------
if ($Flwrs) {
    $Src = (Resolve-Path $Flwrs).Path
    Say "Using the flwrs checkout at $Src (as it is)."
} else {
    $Src = Join-Path $Demo '.flwrs'
    if (Test-Path (Join-Path $Src '.git')) {
        Say 'Updating flwrs in .flwrs\'
        Run git @('-C', $Src, 'fetch', '--quiet', '--tags', 'origin')
    } else {
        Say "Cloning $Repo into .flwrs\"
        Run git @('clone', '--quiet', $Repo, $Src)
    }
    if (-not $Ref) {
        # The newest server release: v<version> tags, by version order.
        $Ref = & git -C $Src tag --list 'v*' --sort=-v:refname | Select-Object -First 1
        if (-not $Ref) {
            Die 'flwrs has no release (v<version> tag) yet: pick one with -Ref <branch|tag|commit>, e.g. -Ref main'
        }
    }
    & git -C $Src checkout --quiet --detach $Ref 2>$null
    if ($LASTEXITCODE -ne 0) {
        & git -C $Src checkout --quiet --detach "origin/$Ref"
        if ($LASTEXITCODE -ne 0) { Die "no such flwrs ref: $Ref" }
    }
    Say "flwrs at $Ref ($(& git -C $Src rev-parse --short HEAD))"
}
if (-not (Test-Path (Join-Path $Src 'Cargo.toml'))) { Die "$Src isn't a flwrs checkout (no Cargo.toml)" }

$want = (Select-String -Path (Join-Path $Src 'Cargo.toml') -Pattern '^rust-version\s*=\s*"([0-9.]+)"' |
    Select-Object -First 1).Matches[0].Groups[1].Value
$have = ((& rustc --version) -split ' ')[1] -replace '-.*$', ''
if ([version]$have -lt [version]$want) { Die "Rust $have is older than flwrs needs ($want): rustup update" }

# --- Build ----------------------------------------------------------------------
$Build = Join-Path $Demo '.build\target'
foreach ($d in @('bin', 'packages', '.build\target')) { New-Item -ItemType Directory -Force (Join-Path $Demo $d) | Out-Null }
Say "Building the flwrs server ($ProfileName; the first build takes a while)"
$cargoArgs = @('build', '--quiet', '-p', 'flwrs-app')
if (-not $DebugBuild) { $cargoArgs += '--release' }
Push-Location $Src
try {
    $env:CARGO_TARGET_DIR = Join-Path $Build 'server'
    Run cargo $cargoArgs
} finally {
    Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    Pop-Location
}
Copy-Item -Force (Join-Path $Build "server\$ProfileName\flwrs-app.exe") (Join-Path $Demo 'bin\flwrs-app.exe')

$list = @($Plugins | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if ($list.Count -eq 0) {
    # The plugins the scene uses.
    $list = @(Get-Content (Join-Path $Demo 'scene\plugins.txt') |
        ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
} elseif ($list.Count -eq 1 -and $list[0] -eq 'all') {
    $list = @(Get-ChildItem (Join-Path $Src 'plugins') -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') } | ForEach-Object { $_.Name })
}
Remove-Item (Join-Path $Demo 'packages\*.zip') -ErrorAction SilentlyContinue
foreach ($p in $list) {
    if (-not (Test-Path (Join-Path $Src "plugins\$p\manifest.json"))) { Die "no plugin $p in flwrs (plugins\$p\manifest.json)" }
    Say "Packaging plugin $p"
    $trellisArgs = @('trellis', 'package', "plugins/$p", '--out', (Join-Path $Demo 'packages'))
    if ($DebugBuild) { $trellisArgs += '--debug' }
    Push-Location $Src
    try {
        # Each plugin in its own target folder (their builds enable other features).
        $env:CARGO_TARGET_DIR = Join-Path $Build $p
        Run cargo $trellisArgs | Out-Null
    } finally {
        Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
        Pop-Location
    }
}

# --- Models -------------------------------------------------------------------------
$Models = Join-Path $Demo 'models'
New-Item -ItemType Directory -Force $Models | Out-Null
foreach ($line in Get-Content (Join-Path $Demo 'scene\models.txt')) {
    if (-not $line -or $line.StartsWith('#')) { continue }
    $file, $sum, $url, $license, $source = $line -split "`t"
    $target = Join-Path $Models $file
    if ((Test-Path $target) -and (Get-FileHash -Algorithm SHA256 $target).Hash.ToLower() -eq $sum) {
        Say "Model ${file}: already here"
        continue
    }
    Say "Downloading $file ($license)"
    $part = "$target.part"
    Invoke-WebRequest -Uri $url -OutFile $part -UseBasicParsing
    $got = (Get-FileHash -Algorithm SHA256 $part).Hash.ToLower()
    if ($got -ne $sum) {
        Remove-Item $part
        Die "${file}: SHA-256 $got, expected $sum (from $url): not using it"
    }
    Move-Item -Force $part $target
}

# --- The scene ------------------------------------------------------------------------
Say 'Setting up the scene'
Set-Location $Demo
New-Item -ItemType Directory -Force (Join-Path $Demo '.data') | Out-Null
# In a hidden window of its own: a Ctrl+C here doesn't reach it, and the
# finally block below stops it.
$server = Start-Process -FilePath (Join-Path $Demo 'bin\flwrs-app.exe') `
    -ArgumentList @('--config', 'scene/config.toml') -WorkingDirectory $Demo `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $Demo '.data\install-server.log') `
    -RedirectStandardError (Join-Path $Demo '.data\install-server.err.log')
try {
    Run $Py ($PyArgs + @('scene/setup.py', 'wait', '60'))
    Run $Py ($PyArgs + @('scene/setup.py', 'plugins', 'packages'))
    Run $Py ($PyArgs + @('scene/setup.py', 'scene', 'models'))
} finally {
    # No console signal reaches a process in another console: a plain stop.
    # The scene isn't enabled here, so nothing is running in it.
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
Say 'Installed. Start the demo with .\run.ps1'
