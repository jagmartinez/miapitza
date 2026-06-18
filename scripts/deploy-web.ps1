# Deploy frontend (miapitza-web). Use client/ as archive root so Railway builds client/Dockerfile, not the API image.
$ErrorActionPreference = "Stop"
$rootDir = Join-Path $PSScriptRoot ".." | Resolve-Path
Set-Location $rootDir
Write-Host "Deploying miapitza-web from $rootDir (client as build root)"
railway up client --path-as-root -s miapitza-web -d
