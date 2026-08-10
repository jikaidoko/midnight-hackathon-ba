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

    Two rules it will not bend:

    1. A required item missing from the source is an ERROR, not a skip.
       An absent contracts/.env does not raise anything at runtime: the code
       falls back to a default network and returns data that looks valid. A
       guard that cannot measure its subject must fail, because its silence is
       indistinguishable from its approval.

    2. node_modules is never copied, linked or shared. It is installed per
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
# Required means: this must exist in the source checkout. If it does not, the
# script stops rather than producing a worktree that looks ready and is not.
#
# Order matters only for readability; the whole manifest is copied.

$Manifest = @(
    @{ Path = 'contracts/.env';                Required = $true;
       Why  = 'network and contract selection; absent means a silent fallback' }
    @{ Path = 'frontend/.env';                 Required = $true;
       Why  = 'interface mode; absent means mock data with no warning' }
    @{ Path = 'CLAUDE.md';                     Required = $true;
       Why  = 'the only working-notes file, deliberately untracked' }

    @{ Path = 'contracts/.wallet-state';       Required = $false;
       Why  = 'wallet sync state; rebuilding it costs hours' }
    @{ Path = 'contracts/.zk-params';          Required = $false;
       Why  = 'cached proving parameters, tens of megabytes' }
    @{ Path = 'contracts/midnight-level-db';   Required = $false;
       Why  = 'local private state database' }
    @{ Path = 'contracts/src/managed';         Required = $false;
       Why  = 'compiler output; rebuild with the compiler, not from Windows' }
    @{ Path = 'frontend/public/zk';            Required = $false;
       Why  = 'published proving assets; rebuild with npm run copy-zk' }

    @{ Glob = 'contracts/deployment.*.json';   Required = $false;
       Why  = 'deployment records; they carry the authority secret' }
    @{ Glob = 'contracts/subjects.*.json';     Required = $false;
       Why  = 'reporter credentials' }
)

# Sentinel: a manifest that lost its required entries would seed nothing and
# report success. Refuse to run rather than approve by omission.
$requiredCount = @($Manifest | Where-Object { $_.Required }).Count
if ($requiredCount -lt 1) {
    Fail 'the seed manifest declares no required item. It was gutted; nothing here can be trusted.'
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

foreach ($item in $Manifest) {

    if ($item.ContainsKey('Glob')) {
        $pattern = Join-Path $RepoRoot ($item.Glob -replace '/', '\')
        # Not $matches: that name is an automatic variable.
        $found = @(Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue)
        if ($found.Count -eq 0) {
            $skipped += "$($item.Glob) (none found) - $($item.Why)"
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
        # Required items were checked above; reaching here means optional.
        $skipped += "$($item.Path) (absent in source) - $($item.Why)"
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

# Verify the required set landed, rather than assuming the copies worked.
$notLanded = @()
foreach ($item in $Manifest) {
    if ($item.ContainsKey('Glob')) { continue }
    if (-not $item.Required) { continue }
    if (-not (Test-Path -LiteralPath (Join-Path $Path $item.Path))) {
        $notLanded += $item.Path
    }
}
if ($notLanded.Count -gt 0) {
    Fail @"
required state did not land in the worktree:
    $($notLanded -join "`n    ")
The worktree exists but is not usable. Remove it with:
    git worktree remove "$Path"
"@
}
Ok 'every required item verified in the destination'

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
Write-Host '  Still manual, if you need it:' -ForegroundColor DarkGray
Write-Host '    - contracts/src/managed is compiler output. Rebuild it with the' -ForegroundColor DarkGray
Write-Host '      compiler toolchain, not from a Windows shell.' -ForegroundColor DarkGray
Write-Host '    - frontend/public/zk is rebuilt with: npm run copy-zk' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  When the branch is merged, remove the worktree with' -ForegroundColor DarkGray
Write-Host "    git worktree remove `"$Path`"" -ForegroundColor DarkGray
Write-Host '  never with a recursive delete: that leaves a stale reference behind.' -ForegroundColor DarkGray
Write-Host ''
