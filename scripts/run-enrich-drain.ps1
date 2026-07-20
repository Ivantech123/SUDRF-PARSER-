$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot\..

$env:FI_COURTS = "all"
$env:FI_PREFIXES = "all"
$env:FI_CONCURRENCY = "24"
$env:SLICE_PAUSE_MS = "0"
$env:FI_FLUSH_EVERY = "80"
$env:CATALOG_SKIP_BAK = "1"
$env:CATALOG_LOCK_STALE_MS = "60000"
$env:FI_FROM_CATALOG = "1"
Remove-Item Env:FI_SCHEDULE_ONLY -ErrorAction SilentlyContinue
Remove-Item Env:CATALOG_SINGLE_WRITER -ErrorAction SilentlyContinue

function Get-Pending {
  node --import tsx -e "import {resolve} from 'node:path'; import {CaseCatalog} from './src/cases/store.ts'; const c=new CaseCatalog(); c.load(resolve('./cases-store.json')); console.log(c.enrichmentStats().pending)"
}

Write-Host "=== ENRICH 2026 REMAINING ==="
$env:FI_FROM_DATE = "01.01.2026"
$env:FI_TO_DATE = "31.12.2026"
$env:FI_LIMIT = "2000"
npm run collect:fi-mordovia
Write-Host "pending after 2026: $(Get-Pending)"

Write-Host "=== ENRICH DRAIN ALL PENDING ==="
Remove-Item Env:FI_FROM_DATE -ErrorAction SilentlyContinue
Remove-Item Env:FI_TO_DATE -ErrorAction SilentlyContinue
$env:FI_LIMIT = "20000"

$pass = 0
while ($pass -lt 12) {
  $pass++
  Write-Host "`n======== PASS $pass ========"
  npm run collect:fi-mordovia
  if ($LASTEXITCODE -ne 0) {
    Write-Host "exit $LASTEXITCODE"
    Start-Sleep 8
  }
  $pending = Get-Pending
  Write-Host "pending=$pending"
  if ([int]$pending -lt 500) {
    Write-Host "queue drained enough"
    break
  }
}

Write-Host "=== ENRICH DONE ==="
node --import tsx -e "import {resolve} from 'node:path'; import {CaseCatalog} from './src/cases/store.ts'; const c=new CaseCatalog(); c.load(resolve('./cases-store.json')); console.log(JSON.stringify({size:c.size,...c.enrichmentStats()},null,2));"
