[CmdletBinding(DefaultParameterSetName = 'Resources')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Resources')]
    [ValidateNotNullOrEmpty()]
    [string] $InstalledResources,

    [Parameter(Mandatory, ParameterSetName = 'Resources')]
    [ValidateNotNullOrEmpty()]
    [string] $SourceArchive,

    [Parameter(ParameterSetName = 'Resources')]
    [string] $HistoricalArchive,

    [Parameter(Mandatory, ParameterSetName = 'Expanded')]
    [ValidateNotNullOrEmpty()]
    [string] $InstalledExtractedPath,

    [Parameter(Mandatory, ParameterSetName = 'Expanded')]
    [ValidateNotNullOrEmpty()]
    [string] $SourceExpandedPath,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string] $DestinationRoot,

    [switch] $SkipManifest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedSourceHash = 'A4700739A908C4AE3309A4709F7A69A01594DB837EEDBC5EE1BB799A08F82700'
$ExpectedHistoricalHash = '67E62F35A9BEBB0F73C45A6B139B80780A3EF4182695C8DF795E557866C3F48B'
$repoRoot = Split-Path -Parent $PSScriptRoot
$destination = [System.IO.Path]::GetFullPath($DestinationRoot)
$scratch = $null
$rootsFile = $null

function Assert-ExistingPath {
    param([string] $LiteralPath, [string] $Label, [switch] $Leaf)
    if (-not (Test-Path -LiteralPath $LiteralPath -PathType $(if ($Leaf) { 'Leaf' } else { 'Container' }))) {
        throw "$Label was not found: $LiteralPath"
    }
}

function Assert-ChildPath {
    param([string] $Parent, [string] $Child)
    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $childFull = [System.IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing operation outside destination root: $childFull"
    }
}

function Copy-DirectoryContent {
    param([string] $Source, [string] $Destination, [switch] $ExcludeSourceMaps)
    Assert-ExistingPath -LiteralPath $Source -Label 'Recovery source directory'
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    if ($ExcludeSourceMaps) {
        Get-ChildItem -LiteralPath $Source -Recurse -File -Force | Where-Object { $_.Extension -ne '.map' } | ForEach-Object {
            $relative = $_.FullName.Substring([System.IO.Path]::GetFullPath($Source).TrimEnd('\').Length).TrimStart('\')
            $target = Join-Path $Destination $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
        return
    }
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

function Copy-RequiredFile {
    param([string] $Source, [string] $Destination)
    Assert-ExistingPath -LiteralPath $Source -Label 'Recovery source file' -Leaf
    $parent = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

try {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    if ($PSCmdlet.ParameterSetName -eq 'Resources') {
        Assert-ExistingPath -LiteralPath $InstalledResources -Label 'Installed resources'
        Assert-ExistingPath -LiteralPath $SourceArchive -Label 'Source archive' -Leaf
        $sourceHash = (Get-FileHash -LiteralPath $SourceArchive -Algorithm SHA256).Hash
        if ($sourceHash -ne $ExpectedSourceHash) {
            throw "Source archive SHA-256 mismatch. Expected $ExpectedSourceHash; observed $sourceHash"
        }
        if ($HistoricalArchive) {
            Assert-ExistingPath -LiteralPath $HistoricalArchive -Label 'Historical archive' -Leaf
            $historicalHash = (Get-FileHash -LiteralPath $HistoricalArchive -Algorithm SHA256).Hash
            if ($historicalHash -ne $ExpectedHistoricalHash) {
                throw "Historical archive SHA-256 mismatch. Expected $ExpectedHistoricalHash; observed $historicalHash"
            }
        }

        $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('earth-radio-recovery-' + [guid]::NewGuid().ToString('N'))
        $installed = Join-Path $scratch 'installed'
        $source = Join-Path $scratch 'source'
        New-Item -ItemType Directory -Path $installed, $source -Force | Out-Null
        $asarCli = Join-Path $repoRoot 'node_modules\.bin\asar.cmd'
        Assert-ExistingPath -LiteralPath $asarCli -Label 'Repository ASAR CLI' -Leaf
        $appAsar = Join-Path $InstalledResources 'app.asar'
        Assert-ExistingPath -LiteralPath $appAsar -Label 'Installed app.asar' -Leaf
        & $asarCli extract $appAsar $installed
        if ($LASTEXITCODE -ne 0) { throw "ASAR extraction failed with exit code $LASTEXITCODE" }
        $unpackedServer = Join-Path $InstalledResources 'app.asar.unpacked\server'
        if (Test-Path -LiteralPath $unpackedServer -PathType Container) {
            Copy-DirectoryContent -Source $unpackedServer -Destination (Join-Path $installed 'server')
        }
        Expand-Archive -LiteralPath $SourceArchive -DestinationPath $source -Force
    } else {
        Assert-ExistingPath -LiteralPath $InstalledExtractedPath -Label 'Expanded installed application'
        Assert-ExistingPath -LiteralPath $SourceExpandedPath -Label 'Expanded source archive'
        $installed = [System.IO.Path]::GetFullPath($InstalledExtractedPath)
        $source = [System.IO.Path]::GetFullPath($SourceExpandedPath)
    }

    $managedDirectories = @('site', 'electron', 'server', 'src-recovered', 'docs\recovered')
    foreach ($relative in $managedDirectories) {
        $target = Join-Path $destination $relative
        Assert-ChildPath -Parent $destination -Child $target
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }

    Copy-DirectoryContent -Source (Join-Path $installed 'dist') -Destination (Join-Path $destination 'site') -ExcludeSourceMaps
    Copy-DirectoryContent -Source (Join-Path $installed 'electron') -Destination (Join-Path $destination 'electron')
    Copy-DirectoryContent -Source (Join-Path $installed 'server') -Destination (Join-Path $destination 'server')
    Copy-DirectoryContent -Source (Join-Path $source 'recovered_src\src') -Destination (Join-Path $destination 'src-recovered')
    Copy-DirectoryContent -Source (Join-Path $source 'docs') -Destination (Join-Path $destination 'docs\recovered')
    Copy-RequiredFile -Source (Join-Path $source 'tests\smoke-metadata.mjs') -Destination (Join-Path $destination 'tests\smoke-metadata.mjs')
    Copy-RequiredFile -Source (Join-Path $source 'tests\smoke-desktop.mjs') -Destination (Join-Path $destination 'tests\smoke-desktop.mjs')
    Copy-RequiredFile -Source (Join-Path $source 'scripts\release-manifest.mjs') -Destination (Join-Path $destination 'scripts\release-manifest.mjs')
    Copy-RequiredFile -Source (Join-Path $source 'electron-builder.yml') -Destination (Join-Path $destination 'electron-builder.yml')

    if (-not $SkipManifest) {
        $roots = @(
            @{ root = (Join-Path $destination 'site'); source = 'installed-runtime/site' },
            @{ root = (Join-Path $destination 'electron'); source = 'installed-runtime/electron' },
            @{ root = (Join-Path $destination 'server'); source = 'installed-runtime/server' },
            @{ root = (Join-Path $destination 'src-recovered'); source = 'source-archive/recovered-src' },
            @{ root = (Join-Path $destination 'docs\recovered'); source = 'source-archive/docs' }
        )
        $rootsJson = $roots | ConvertTo-Json -Compress
        $rootsFile = Join-Path ([System.IO.Path]::GetTempPath()) ('earth-radio-roots-' + [guid]::NewGuid().ToString('N') + '.json')
        [System.IO.File]::WriteAllText($rootsFile, $rootsJson, [System.Text.UTF8Encoding]::new($false))
        $manifest = Join-Path $destination 'docs\provenance\recovery-manifest.json'
        $moduleUri = ([uri](Join-Path $repoRoot 'scripts\recovery-inventory.mjs')).AbsoluteUri
        $nodeProgram = "import { readFileSync } from 'node:fs'; import { writeInventory } from '$moduleUri'; const roots=JSON.parse(readFileSync(process.argv[1], 'utf8')); await writeInventory({roots, output:process.argv[2]});"
        & node --input-type=module -e $nodeProgram $rootsFile $manifest
        if ($LASTEXITCODE -ne 0) { throw "Recovery manifest generation failed with exit code $LASTEXITCODE" }
    }

    $selectedCount = (Get-ChildItem -LiteralPath (Join-Path $destination 'site'), (Join-Path $destination 'electron'), (Join-Path $destination 'server'), (Join-Path $destination 'src-recovered') -Recurse -File).Count
    Write-Output "Earth Radio recovery import completed: $selectedCount selected files"
    exit 0
} catch {
    Write-Error $_
    exit 1
} finally {
    if ($scratch -and (Test-Path -LiteralPath $scratch)) {
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
    if ($rootsFile -and (Test-Path -LiteralPath $rootsFile)) {
        Remove-Item -LiteralPath $rootsFile -Force
    }
}
