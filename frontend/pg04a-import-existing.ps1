$ErrorActionPreference = 'Stop'
$credential = Read-Host 'Netlify personal access token' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential)
try {
  $env:NETLIFY_AUTH_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:NETLIFY_SITE_ID = '9c6caa64-65d2-492f-bc6c-15edf1357ac2'
  $env:PG03B_SCENARIO_DIR = Join-Path $env:USERPROFILE '.codex\trycove-pg04a-recovery\existing-batch'
  Push-Location $PSScriptRoot
  try { node ./pg04a-import-inventory.mjs; if ($LASTEXITCODE -ne 0) { throw 'Import failed.' } }
  finally { Pop-Location }
} finally {
  Remove-Item Env:NETLIFY_AUTH_TOKEN -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $credential.Dispose()
}
