# SmartFactory ERP - Windows PowerShell Docker MySQL Backup Script
$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectDir "backups"
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

$EnvFile = Join-Path $ProjectDir ".env"
$EnvMap = @{}
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      $EnvMap[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
}

$DbName = if ($EnvMap["DB_NAME"]) { $EnvMap["DB_NAME"] } else { "smartfactory_erp" }
$RootPw = $EnvMap["MYSQL_ROOT_PASSWORD"]
if (-not $RootPw) { throw "MYSQL_ROOT_PASSWORD must be set in .env" }

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$OutFile = Join-Path $BackupDir "smartfactory_erp_$Stamp.sql"

Write-Host "[BACKUP] Dumping $DbName from Docker container..."
docker compose -f (Join-Path $ProjectDir "docker-compose.yml") exec -T db mysqldump -u root "-p$RootPw" --single-transaction --routines --triggers $DbName | Out-File -FilePath $OutFile -Encoding utf8
Write-Host "[BACKUP] Saved to $OutFile"
