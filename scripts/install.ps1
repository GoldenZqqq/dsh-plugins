#Requires -Version 5.1
<#
.SYNOPSIS
  Install plugins from the dsh-plugins collection into a DSH profile.

.DESCRIPTION
  Default mode creates an NTFS junction from
  ~\.dsh\profiles\node_modules\<name> to plugins\<name> in this repo, so edits
  in the repo take effect after a DSH restart without re-copying.
  Use -Copy for a plain recursive copy instead.

.PARAMETER Name
  Plugin folder name(s) under plugins/ to install.

.PARAMETER All
  Install every plugin found under plugins/.

.PARAMETER Copy
  Copy files instead of creating a junction.

.PARAMETER Force
  Replace an existing install (a plain directory, or a junction pointing
  somewhere else).

.PARAMETER ProfileName
  DSH profile to install into. DSH resolves plugin packages from the profile's
  own node_modules, so this is the directory that actually takes effect.
  Default: web

.PARAMETER NodeModules
  Target node_modules directory.
  Default: $env:USERPROFILE\.dsh\profiles\<ProfileName>\node_modules

.EXAMPLE
  .\install.ps1 -All
  .\install.ps1 -Name dsh-win-toast
  .\install.ps1 -All -Copy -Force
  .\install.ps1 -All -ProfileName tui
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string[]]$Name,
    [switch]$All,
    [switch]$Copy,
    [switch]$Force,
    [string]$ProfileName = 'web',
    [string]$NodeModules = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginsRoot = Join-Path $repoRoot 'plugins'

# 默认装到 profile 自己的 node_modules —— 早先版本默认写的是
# ~\.dsh\profiles\node_modules，那个目录不在 DSH 的解析路径上，装进去不会加载。
if ([string]::IsNullOrWhiteSpace($NodeModules)) {
    $NodeModules = Join-Path $env:USERPROFILE ".dsh\profiles\$ProfileName\node_modules"
}

$available = @(Get-ChildItem $pluginsRoot -Directory | Select-Object -ExpandProperty Name)
if ($available.Count -eq 0) { throw "No plugins found under $pluginsRoot" }

$targets = @()
if ($All) {
    $targets = $available
} elseif ($Name) {
    foreach ($n in $Name) {
        if ($available -notcontains $n) {
            throw "Unknown plugin '$n'. Available: $($available -join ', ')"
        }
    }
    $targets = $Name
} else {
    throw "Specify -Name <plugin> or -All. Available: $($available -join ', ')"
}

foreach ($plugin in $targets) {
    $source = Join-Path $pluginsRoot $plugin
    $target = Join-Path $NodeModules $plugin

    if (Test-Path $target) {
        $item = Get-Item $target -Force
        $isLink = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
        if ($isLink) {
            $linkTarget = @($item.Target) | Select-Object -First 1
            if ($linkTarget -and ([IO.Path]::GetFullPath($linkTarget) -eq [IO.Path]::GetFullPath($source))) {
                Write-Host "[=] $plugin already installed (junction -> $source)" -ForegroundColor DarkGray
                continue
            }
            if (-not $Force) {
                throw "$plugin is installed as a junction to '$linkTarget'. Use -Force to repoint it."
            }
            # Delete() on a junction removes only the link, never the contents.
            $item.Delete()
        } else {
            if (-not $Force) {
                throw "$plugin already exists at $target (plain directory). Use -Force to replace it."
            }
            Remove-Item $target -Recurse -Force
        }
    }

    if (-not (Test-Path $NodeModules)) {
        New-Item -ItemType Directory -Path $NodeModules -Force | Out-Null
    }

    if ($Copy) {
        Copy-Item $source $target -Recurse -Force
        Write-Host "[+] $plugin installed (copy) -> $target" -ForegroundColor Green
    } else {
        New-Item -ItemType Junction -Path $target -Value $source | Out-Null
        Write-Host "[+] $plugin installed (junction) -> $target" -ForegroundColor Green
    }
}
