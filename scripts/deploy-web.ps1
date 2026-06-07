# Deploy frontend (miapitza-web). MUST run from client/ — root uploads the API image and fails healthcheck.
$ErrorActionPreference = "Stop"
$clientDir = Join-Path (Join-Path $PSScriptRoot "..") "client" | Resolve-Path
Set-Location $clientDir
Write-Host "Deploying miapitza-web from $clientDir"
railway up -s miapitza-web -d
