# Stop concurrent catalog writers, reparse parties/category from 2010, then resume Tier-2 gapfill.
$ErrorActionPreference = "Continue"

Write-Host "======== REPARSE Mordovia parties/category 2010+ ========" -ForegroundColor Cyan
$env:FI_COURTS = "all"
$env:REPARSE_FROM_YEAR = "2010"
$env:REPARSE_FORCE = "0"
$env:REPARSE_LIMIT = "8000"
$env:FI_CONCURRENCY = "5"
$env:SLICE_PAUSE_MS = "400"
$env:FI_FLUSH_EVERY = "20"
$env:REPARSE_RETRIES = "6"
$env:REPARSE_LIMIT = "20000"
npm run reparse:mordovia

Write-Host "`n======== RESUME Tier-2 gap-fill ========" -ForegroundColor Cyan
$env:FI_COURTS = "all"
$env:T2_FROM_YEAR = "2010"
$env:T2_TO_YEAR = (Get-Date).Year.ToString()
$env:T2_DELO_IDS = "5,4,41"
$env:T2_GRANULARITY = "yearly"
$env:T2_PAUSE_MS = "500"
npm run gapfill:mordovia

Write-Host "`n======== DRAIN PENDING ========" -ForegroundColor Cyan
$env:FI_FROM_CATALOG = "1"
$env:FI_PREFIXES = "all"
$env:FI_LIMIT = "20000"
$env:FI_CONCURRENCY = "24"
for ($i = 1; $i -le 15; $i++) {
  $pending = node -e "const s=require('./cases-store.json'); console.log(Object.values(s.cases||{}).filter(x=>x.caseUrl&&!x.enrichedAt).length)"
  Write-Host "[drain] $i pending=$pending"
  if ([int]$pending -le 0) { break }
  npm run collect:fi-mordovia
}

npm run audit:mordovia
