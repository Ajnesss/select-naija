# Select Naija UK check point (Windows).
# Checks the region-locked provider links from a real UK connection and uploads the results.
# Needs: Git for Windows and Node.js. Run by hand, or nightly via Task Scheduler (see README).
# Touches only its own folder and the Ajnesss/select-naija repo; nothing to do with Select DE.

$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/Ajnesss/select-naija'
$Dir = Join-Path $env:USERPROFILE 'select-naija-checks'
$Log = Join-Path $Dir 'last-run.log'

if (-not (Test-Path (Join-Path $Dir '.git'))) {
    git clone --depth 1 $Repo $Dir
}
Set-Location $Dir
git pull --rebase --quiet origin main

$env:VERIFY_COUNTRY = 'GB'
node scripts/verify.js *>&1 | Tee-Object -FilePath $Log
if ($LASTEXITCODE -eq 3) {
    Write-Host 'Not on a UK connection (VPN on?). Nothing uploaded.'
    exit 3
}
if ($LASTEXITCODE -ne 0) { throw "Verifier failed, see $Log" }
node scripts/report.js | Out-Null

git add data/status-uk.json reports/
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git -c user.name='select-naija-uk-check' -c user.email='uk-check@users.noreply.github.com' commit --quiet -m "UK verification $(Get-Date -Format yyyy-MM-dd)"
    git pull --rebase --quiet origin main
    git push --quiet origin main
    Write-Host 'UK results uploaded.'
} else {
    Write-Host 'No changes.'
}
