<#
.SYNOPSIS
    Create a git worktree and seed it with the local state git does not carry.

.DESCRIPTION
    A fresh worktree contains only tracked files. Everything this project needs
    to actually run - configuration, local credentials, expensive caches,
    compiler output - is deliberately gitignored, so a new worktree starts
    unusable. Seeding it by hand is slow and easy to half-finish, which is why
    people end up sharing a single checkout and overwriting each other's
    uncommitted work.

    This script does the seeding, and it is loud about what it could not do.

    Three rules it will not bend:

    1. What is copied is decided by what it costs to get back, not by whether
       it is needed. Almost all of it is needed. Items that a command rebuilds
       in seconds are NOT copied - copying them is how a worktree that should
       be cheap starts costing megabytes for bytes a build step reproduces.
       Items with no rebuild command at all are copied, and a failed copy of
       one of those is fatal.

    2. A required item missing from the source is an ERROR, not a skip.
       An absent contracts/.env does not raise anything at runtime: the loader
       swallows the error and the network falls back to a local default, so the
       code returns data that looks valid. A guard that cannot measure its
       subject must fail, because its silence is indistinguishable from its
       approval.

    3. node_modules is never copied, linked or shared. It is installed per
       worktree. Sharing the tree is how a second copy of a wasm package
       reappears, and two copies break the application at runtime while the
       typecheck and the test suite stay green.

.PARAMETER Branch
    Branch to create in the new worktree, e.g. feat/case-list.

.PARAMETER Path
    Where to put the worktree. Defaults to a sibling of the repository root,
    named <repo>-wt-<slug>. Never allowed inside the system temp directory.

.PARAMETER From
    Start point for the new branch. Defaults to origin/<default branch>.

.PARAMETER SourceRoot
    Checkout to copy the local state from. Defaults to the repository's main
    worktree, which is where that state lives by convention. Only pass this if
    a linked worktree is the one that is actually set up.

.PARAMETER SkipInstall
    Do not run npm ci. The worktree will need it before anything runs.

.EXAMPLE
    ./scripts/seed-worktree.ps1 -Branch feat/case-list

.EXAMPLE
    ./scripts/seed-worktree.ps1 -Branch fix/sync -Path D:\work\amparo-wt-sync -SkipInstall
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Branch,

    [string] $Path,

    [string] $From,

    [string] $SourceRoot,

    [switch] $SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail {
    param([string] $Message)
    Write-Host ''
    Write-Host "FAILED: $Message" -ForegroundColor Red
    exit 1
}

function Step { param([string] $Message) Write-Host "  $Message" -ForegroundColor Cyan }
function Ok   { param([string] $Message) Write-Host "  ok    $Message" -ForegroundColor Green }
function Note { param([string] $Message) Write-Host "  note  $Message" -ForegroundColor DarkGray }
function Warn { param([string] $Message) Write-Host "  WARN  $Message" -ForegroundColor Yellow }

# --- What a usable worktree needs -------------------------------------------
#
# The axis that decides what to do with an item is not "is it needed" - almost
# all of it is needed. It is WHAT IT COSTS TO GET IT BACK. Three tiers, and the
# tier picks the behaviour:
#
#   irrecoverable  There is no command that rebuilds this. Lose the last copy
#                  and the thing it unlocks is gone: the credentials a proof
#                  derives from, the secret that answers a deployment, the
#                  configuration someone wrote by hand. Copy it, and treat a
#                  failed copy as fatal.
#
#   expensive      A command rebuilds it, but the command costs hours or tens
#                  of megabytes. Copy it when it is there; when it is not, name
#                  the command and its price instead of pretending it is fine.
#
#   regenerable    Seconds to rebuild. DO NOT COPY IT. Copying it is how a
#                  worktree that should be cheap starts costing megabytes for
#                  bytes that a build step reproduces exactly.
#
# `Required` is a separate, narrower flag: it marks the items whose ABSENCE is
# silent. A missing contracts/.env raises nothing - the loader swallows the
# error and the network falls back to the local default - so the script has to
# be the thing that notices.

$Manifest = @(
    @{ Path = 'contracts/.env';              Tier = 'irrecoverable'; Required = $true
       Why  = 'network, contract and secrets, written by hand. Its absence is swallowed and the network silently falls back to local' }
    @{ Path = 'frontend/.env';               Tier = 'irrecoverable'; Required = $true
       Why  = 'interface mode. Absent means mock data with no warning' }
    @{ Path = 'CLAUDE.md';                   Tier = 'irrecoverable'; Required = $true
       Why  = 'the only working-notes file, deliberately untracked' }
    @{ Path = 'contracts/midnight-level-db'; Tier = 'irrecoverable'; Required = $false
       Why  = 'local private state. Holds the authority credential' }
    @{ Glob = 'contracts/deployment.*.json'; Tier = 'irrecoverable'; Required = $false
       Why  = 'deployment records. They carry the secret that answers that deployment' }
    @{ Glob = 'contracts/subjects.*.json';   Tier = 'irrecoverable'; Required = $false
       Why  = 'reporter credentials. The only thing that can rebuild the nullifiers a credential proof needs' }

    @{ Path = 'contracts/.wallet-state';     Tier = 'expensive';     Required = $false
       Why  = 'wallet sync state'
       Rebuild = 'resyncs from genesis on next use: hours' }
    @{ Path = 'contracts/.zk-params';        Tier = 'expensive';     Required = $false
       Why  = 'cached proving parameters'
       Rebuild = 'downloaded on the first proof: tens of megabytes' }

    @{ Path = 'contracts/src/managed';       Tier = 'regenerable';   Required = $false
       Why  = 'compiler output'
       Rebuild = 'compact compile --skip-zk src/amparo.compact src/managed/amparo' }
    @{ Path = 'frontend/public/zk';          Tier = 'regenerable';   Required = $false
       Why  = 'published proving assets'
       Rebuild = 'npm run copy-zk (in frontend/)' }
)

# Sentinels. A manifest that lost its irrecoverable entries, or its required
# ones, would seed almost nothing and still report success. Refuse to run rather
# than approve by omission.
$requiredCount      = @($Manifest | Where-Object { $_.Required }).Count
$irrecoverableCount = @($Manifest | Where-Object { $_.Tier -eq 'irrecoverable' }).Count
if ($requiredCount -lt 1 -or $irrecoverableCount -lt 1) {
    Fail 'the seed manifest lost its required or irrecoverable entries. It was gutted; nothing here can be trusted.'
}

$knownTiers = @('irrecoverable', 'expensive', 'regenerable')
foreach ($item in $Manifest) {
    if ($knownTiers -notcontains $item.Tier) {
        $label = if ($item.ContainsKey('Path')) { $item.Path } else { $item.Glob }
        Fail "manifest entry '$label' declares an unknown tier '$($item.Tier)'. A tier decides whether the item is copied at all."
    }
}

# --- Locate the source checkout ---------------------------------------------
#
# The state being copied lives in the main worktree by convention, not in
# whichever worktree this script was invoked from. Resolving it explicitly means
# the script behaves the same whether it runs from the main checkout or from a
# linked worktree that has nothing in it.

Push-Location $PSScriptRoot
try {
    $GitDir = (& git rev-parse --git-common-dir)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($GitDir)) {
        Fail 'this script is not inside a git repository.'
    }

    if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
        # First entry of the porcelain listing is always the main worktree.
        $listing = @(& git worktree list --porcelain)
        if ($LASTEXITCODE -ne 0) { Fail 'git worktree list failed.' }
        $first = $listing | Where-Object { $_ -like 'worktree *' } | Select-Object -First 1
        if ([string]::IsNullOrWhiteSpace($first)) {
            Fail 'could not determine the main worktree.'
        }
        $SourceRoot = $first -replace '^worktree ', ''
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    Fail "the source checkout does not exist: $SourceRoot"
}

$RepoRoot = (Resolve-Path -LiteralPath $SourceRoot).ProviderPath
$RepoName = Split-Path -Leaf $RepoRoot

if (-not $PSBoundParameters.ContainsKey('From') -or [string]::IsNullOrWhiteSpace($From)) {
    Push-Location $RepoRoot
    try {
        $head = (& git symbolic-ref --quiet refs/remotes/origin/HEAD)
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($head)) {
            $From = $head -replace '^refs/remotes/', ''
        }
        else {
            $From = 'origin/main'
            Note "origin/HEAD is not set locally; starting from $From."
            Note 'Run: git remote set-head origin --auto'
        }
    }
    finally {
        Pop-Location
    }
}

# --- Resolve and validate the destination -----------------------------------

if ([string]::IsNullOrWhiteSpace($Path)) {
    $slug = ($Branch -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLowerInvariant()
    $Path = Join-Path (Split-Path -Parent $RepoRoot) "$RepoName-wt-$slug"
}

# Resolve without requiring existence.
$Path = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::Combine((Get-Location).ProviderPath, $Path))

# A worktree under the system temp directory gets deleted without warning, and
# takes any unpushed commit with it.
$tempRoots = @($env:TEMP, $env:TMP) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    ForEach-Object { [System.IO.Path]::GetFullPath($_).TrimEnd('\') }

foreach ($root in $tempRoots) {
    if ($Path.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase) -or
        $Path.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        Fail @"
the destination is inside the system temp directory:
    $Path
That directory is cleaned automatically. A worktree there loses every commit
that was not pushed. Pass -Path with a location outside it.
"@
    }
}

if ($Path.StartsWith($RepoRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail @"
the destination is inside the repository:
    $Path
Nested worktrees break .git resolution. Put it beside the repository instead.
"@
}

if (Test-Path -LiteralPath $Path) {
    Fail "the destination already exists: $Path"
}

# --- Check the source before touching anything ------------------------------

Write-Host ''
Write-Host "Seeding a worktree for $RepoName" -ForegroundColor White
Write-Host "  branch      $Branch"
Write-Host "  from        $From"
Write-Host "  source      $RepoRoot"
Write-Host "  destination $Path"
Write-Host ''
Step 'Checking the source checkout'

$missingRequired = @()
foreach ($item in $Manifest) {
    if ($item.ContainsKey('Glob')) { continue }
    if ($item.Required) {
        $source = Join-Path $RepoRoot $item.Path
        if (-not (Test-Path -LiteralPath $source)) {
            $missingRequired += $item
        }
    }
}

if ($missingRequired.Count -gt 0) {
    $detail = ($missingRequired | ForEach-Object { "    $($_.Path)  -  $($_.Why)" }) -join "`n"
    Fail @"
the source checkout is missing required state, so the new worktree cannot be
verified as usable:

$detail

Nothing was created. Restore these in $RepoRoot and run this again.
"@
}
Ok "all $requiredCount required items are present in the source"

# A stray copy of a config file at the repository root is read by nothing here,
# and its existence makes it look like configuration is in place.
$strayEnv = Join-Path $RepoRoot '.env'
if (Test-Path -LiteralPath $strayEnv) {
    Warn 'there is a .env at the repository root. Nothing reads it - configuration'
    Warn 'is resolved per package (contracts/.env, frontend/.env). It will not be'
    Warn 'copied. Consider deleting it so it stops looking authoritative.'
}

# --- Create the worktree ----------------------------------------------------

Step "Fetching $From"
Push-Location $RepoRoot
try {
    & git fetch --prune
    if ($LASTEXITCODE -ne 0) { Fail 'git fetch failed.' }

    Step 'Creating the worktree'
    & git worktree add $Path -b $Branch $From
    if ($LASTEXITCODE -ne 0) { Fail 'git worktree add failed. Nothing was seeded.' }
}
finally {
    Pop-Location
}
Ok "worktree created at $Path"

# --- Seed ------------------------------------------------------------------

Step 'Copying local state'

$copied  = @()
$skipped = @()
$rebuild = @()

foreach ($item in $Manifest) {

    # Regenerable by definition: a build step reproduces it exactly, in
    # seconds. Copying it would trade megabytes for nothing.
    if ($item.Tier -eq 'regenerable') {
        $label = if ($item.ContainsKey('Path')) { $item.Path } else { $item.Glob }
        $rebuild += "$label  ->  $($item.Rebuild)"
        continue
    }

    if ($item.ContainsKey('Glob')) {
        $pattern = Join-Path $RepoRoot ($item.Glob -replace '/', '\')
        # Not $matches: that name is an automatic variable.
        $found = @(Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue)
        if ($found.Count -eq 0) {
            if ($item.Tier -eq 'irrecoverable') {
                Warn "$($item.Glob) matched nothing and NOTHING REBUILDS IT."
                Warn "      $($item.Why)"
                Warn '      Fine if it was never created. If it existed, it is gone.'
            }
            else {
                $skipped += "$($item.Glob) (none found) - $($item.Why)"
            }
            continue
        }
        foreach ($m in $found) {
            $relative = $m.FullName.Substring($RepoRoot.Length).TrimStart('\')
            $target   = Join-Path $Path $relative
            $parent   = Split-Path -Parent $target
            if (-not (Test-Path -LiteralPath $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            }
            Copy-Item -LiteralPath $m.FullName -Destination $target -Force
            $copied += $relative
        }
        continue
    }

    $source = Join-Path $RepoRoot $item.Path
    $target = Join-Path $Path     $item.Path

    if (-not (Test-Path -LiteralPath $source)) {
        # Required items were checked above, so reaching here means the item is
        # optional - but "optional" is not "unimportant". An irrecoverable item
        # that is simply absent may never have been created, which is fine; the
        # script cannot tell that apart from a loss, so it says so out loud
        # instead of filing it under routine skips.
        if ($item.Tier -eq 'irrecoverable') {
            Warn "$($item.Path) is absent in the source and NOTHING REBUILDS IT."
            Warn "      $($item.Why)"
            Warn '      Fine if it was never created. If it existed, it is gone.'
        }
        else {
            $skipped += "$($item.Path) (absent in source) - $($item.Why). Rebuild: $($item.Rebuild)"
        }
        continue
    }

    $parent = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if (Test-Path -LiteralPath $source -PathType Container) {
        Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
    }
    else {
        Copy-Item -LiteralPath $source -Destination $target -Force
    }
    $copied += $item.Path
}

foreach ($c in $copied)  { Ok $c }
foreach ($s in $skipped) { Note "not copied: $s" }
foreach ($r in $rebuild) { Note "regenerable, deliberately not copied: $r" }

# Verify rather than assume. Two classes are checked: everything required, and
# every irrecoverable item that WAS present in the source. A copy of something
# with no rebuild command that silently did not land is the worst outcome this
# script can produce, because the worktree looks ready.
$notLanded = @()
foreach ($item in $Manifest) {
    if ($item.ContainsKey('Glob')) { continue }
    if ($item.Tier -eq 'regenerable') { continue }

    $mustLand = $item.Required -or
                ($item.Tier -eq 'irrecoverable' -and
                 (Test-Path -LiteralPath (Join-Path $RepoRoot $item.Path)))

    if ($mustLand -and -not (Test-Path -LiteralPath (Join-Path $Path $item.Path))) {
        $notLanded += "$($item.Path)  [$($item.Tier)]"
    }
}
if ($notLanded.Count -gt 0) {
    Fail @"
state that had to land did not:
    $($notLanded -join "`n    ")
The worktree exists but is not usable. Remove it with:
    git worktree remove "$Path"
"@
}
Ok "required and irrecoverable state verified in the destination"

# --- Dependencies -----------------------------------------------------------
#
# Installed per worktree, never shared. See the header.

if ($SkipInstall) {
    Note 'npm ci skipped. Run it in contracts/ and frontend/ before anything else.'
}
else {
    foreach ($pkg in @('contracts', 'frontend')) {
        $pkgPath = Join-Path $Path $pkg
        if (-not (Test-Path -LiteralPath (Join-Path $pkgPath 'package.json'))) {
            Note "no package.json in $pkg; nothing to install"
            continue
        }
        Step "npm ci in $pkg"
        Push-Location $pkgPath
        try {
            & npm ci
            if ($LASTEXITCODE -ne 0) {
                Warn "npm ci failed in $pkg. The worktree is seeded but will not build."
            }
            else {
                Ok "$pkg dependencies installed"
            }
        }
        finally {
            Pop-Location
        }
    }
}

# --- Report -----------------------------------------------------------------

Write-Host ''
Write-Host 'Done.' -ForegroundColor White
Write-Host "  cd `"$Path`""
Write-Host ''
if ($rebuild.Count -gt 0) {
    Write-Host '  Regenerable, so it was not copied. Run these when you need them:' -ForegroundColor DarkGray
    foreach ($r in $rebuild) {
        Write-Host "    $r" -ForegroundColor DarkGray
    }
    Write-Host '    (compile from the compiler toolchain, not from a Windows shell)' -ForegroundColor DarkGray
    Write-Host ''
}
Write-Host '  When the branch is merged, remove the worktree with' -ForegroundColor DarkGray
Write-Host "    git worktree remove `"$Path`"" -ForegroundColor DarkGray
Write-Host '  never with a recursive delete: that leaves a stale reference behind.' -ForegroundColor DarkGray
Write-Host ''
