# Select Naija UK check point (Windows).
# Checks the region-locked provider links from a real UK connection and uploads the results.
# Optional extra: Select Naija checks itself nightly without this. A UK result from the last 7 days
# takes precedence for its links. Needs: Git for Windows and Node.js.
# Touches only its own folder and the Ajnesss/select-naija repo; nothing to do with Select DE.
#
# Works in Windows PowerShell 5.1: errors are checked through exit codes, because 5.1 turns
# ordinary messages that programs print (git progress, warnings) into errors.

$ErrorActionPreference = 'Continue'
$Repo = 'https://github.com/Ajnesss/select-naija'
$Dir = Join-Path $env:USERPROFILE 'select-naija-checks'
$Log = Join-Path $Dir 'last-run.log'

function Fail($message) {
    Write-Host "STOPPED: $message" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $Dir '.git'))) {
    git clone --quiet --depth 1 $Repo $Dir
    if ($LASTEXITCODE -ne 0) { Fail 'could not download the Select Naija repo.' }
}
Set-Location $Dir
git pull --rebase --quiet origin main
if ($LASTEXITCODE -ne 0) { Fail 'could not update from GitHub (check your internet connection).' }

$env:VERIFY_COUNTRY = 'GB'
node scripts/verify.js | Tee-Object -FilePath $Log
$code = $LASTEXITCODE
if ($code -eq 3) {
    Write-Host 'Not on a UK connection (VPN on?). Nothing uploaded.' -ForegroundColor Yellow
    exit 3
}
if ($code -ne 0) { Fail "the link check failed, see $Log" }

node scripts/report.js | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'the coverage report failed.' }

git add data/status-uk.json reports/
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host 'No changes to upload.' -ForegroundColor Green
    exit 0
}
git -c user.name='select-naija-uk-check' -c user.email='uk-check@users.noreply.github.com' commit --quiet -m "UK verification $(Get-Date -Format yyyy-MM-dd)"
git pull --rebase --quiet origin main
if ($LASTEXITCODE -ne 0) { Fail 'could not merge with the latest GitHub version.' }
git push --quiet origin main
if ($LASTEXITCODE -ne 0) { Fail 'could not upload to GitHub (sign-in needed?).' }
Write-Host 'UK results uploaded. Select Naija picks them up within about 25 minutes.' -ForegroundColor Green
