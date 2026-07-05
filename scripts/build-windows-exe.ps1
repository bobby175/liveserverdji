$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$windowsDist = Join-Path $distRoot 'windows'
$pkgCache = Join-Path $projectRoot '.pkg-cache'
$exePath = Join-Path $windowsDist 'DJI-Live-Server.exe'
$ffmpegSource = Join-Path $projectRoot 'node_modules\ffmpeg-static\ffmpeg.exe'
$ffmpegTarget = Join-Path $windowsDist 'ffmpeg.exe'

Set-Location $projectRoot

if (Test-Path $windowsDist) {
    Remove-Item -LiteralPath $windowsDist -Recurse -Force
}

New-Item -ItemType Directory -Path $windowsDist | Out-Null

$env:PKG_CACHE_PATH = $pkgCache
npx pkg . --targets node18-win-x64 --output $exePath

if ($LASTEXITCODE -ne 0) {
    throw "pkg failed with exit code $LASTEXITCODE"
}

if (!(Test-Path $exePath)) {
    throw "Expected exe was not created: $exePath"
}

if (Test-Path $ffmpegSource) {
    Copy-Item -LiteralPath $ffmpegSource -Destination $ffmpegTarget -Force
    Write-Host "Copied FFmpeg to $ffmpegTarget"
} else {
    Write-Warning "ffmpeg-static binary not found. HLS will stay disabled unless ffmpeg.exe is placed beside the exe or FFMPEG_PATH is set."
}

Write-Host ''
Write-Host 'Windows build ready:'
Write-Host "  $exePath"
Write-Host ''
Write-Host 'Run it, then open:'
Write-Host '  http://localhost:3000'
