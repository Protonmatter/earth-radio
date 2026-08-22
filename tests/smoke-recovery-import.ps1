$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$importer = Join-Path $repoRoot 'scripts\Import-EarthRadioRecovery.ps1'
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('earth-radio-import-test-' + [guid]::NewGuid().ToString('N'))

try {
    $installed = Join-Path $scratch 'installed'
    $archive = Join-Path $scratch 'archive'
    $destination = Join-Path $scratch 'destination'
    New-Item -ItemType Directory -Path `
        (Join-Path $installed 'dist'), `
        (Join-Path $installed 'dist\assets'), `
        (Join-Path $installed 'electron'), `
        (Join-Path $installed 'server'), `
        (Join-Path $archive 'recovered_src\src'), `
        (Join-Path $archive 'tests'), `
        (Join-Path $archive 'scripts'), `
        (Join-Path $archive 'docs'), `
        $destination -Force | Out-Null

    Set-Content -LiteralPath (Join-Path $installed 'dist\index.html') -Value 'installed-web' -NoNewline
    Set-Content -LiteralPath (Join-Path $installed 'dist\assets\app.js.map') -Value 'stale-map' -NoNewline
    Set-Content -LiteralPath (Join-Path $installed 'electron\main.mjs') -Value 'installed-electron' -NoNewline
    Set-Content -LiteralPath (Join-Path $installed 'server\desktop-proxy.mjs') -Value 'installed-server' -NoNewline
    Set-Content -LiteralPath (Join-Path $archive 'recovered_src\src\main.ts') -Value 'recovered-source' -NoNewline
    Set-Content -LiteralPath (Join-Path $archive 'tests\smoke-metadata.mjs') -Value 'metadata-test' -NoNewline
    Set-Content -LiteralPath (Join-Path $archive 'tests\smoke-desktop.mjs') -Value 'desktop-test' -NoNewline
    Set-Content -LiteralPath (Join-Path $archive 'scripts\release-manifest.mjs') -Value 'manifest-script' -NoNewline
    Set-Content -LiteralPath (Join-Path $archive 'docs\BUILD_STATE.md') -Value 'historical-doc' -NoNewline
    Set-Content -LiteralPath (Join-Path $archive 'electron-builder.yml') -Value 'builder-config' -NoNewline

    & $importer `
        -InstalledExtractedPath $installed `
        -SourceExpandedPath $archive `
        -DestinationRoot $destination
    if ($LASTEXITCODE -ne 0) { throw "Importer exited $LASTEXITCODE" }
    if ((Get-Content (Join-Path $destination 'site\index.html') -Raw) -ne 'installed-web') { throw 'installed web did not win' }
    if (Test-Path (Join-Path $destination 'site\assets\app.js.map')) { throw 'stale source map was imported' }
    if ((Get-Content (Join-Path $destination 'server\desktop-proxy.mjs') -Raw) -ne 'installed-server') { throw 'installed server did not win' }
    if (-not (Test-Path (Join-Path $destination 'src-recovered\main.ts'))) { throw 'recovered source missing' }
    if (-not (Test-Path (Join-Path $destination 'tests\smoke-metadata.mjs'))) { throw 'metadata smoke missing' }
    if (-not (Test-Path (Join-Path $destination 'scripts\release-manifest.mjs'))) { throw 'release script missing' }
    if (-not (Test-Path (Join-Path $destination 'docs\recovered\BUILD_STATE.md'))) { throw 'historical documentation missing' }
    if (-not (Test-Path (Join-Path $destination 'electron-builder.yml'))) { throw 'builder config missing' }
    if (-not (Test-Path (Join-Path $destination 'docs\provenance\recovery-manifest.json'))) { throw 'recovery manifest missing' }
    Write-Output 'recovery importer smoke checks passed'
} finally {
    if (Test-Path -LiteralPath $scratch) {
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
