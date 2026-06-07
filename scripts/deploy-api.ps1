# Deploy API (miapitza) from repository root.
$ErrorActionPreference = "Stop"
$rootDir = (Join-Path $PSScriptRoot "..") | Resolve-Path
Set-Location $rootDir
Write-Host "Deploying miapitza API from $rootDir"
railway up -s miapitza -d
