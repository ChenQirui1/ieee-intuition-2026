param(
  [Alias("Host")]
  [string]$BindHost = $env:HOST,
  [int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8000 }),
  [switch]$NoReload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if ([string]::IsNullOrWhiteSpace($BindHost)) {
  $BindHost = "0.0.0.0"
}

if (-not (Test-Path ".venv")) {
  Write-Error "Virtual environment not found at $scriptDir\.venv. Create it first: python -m venv .venv"
}

$activatePs1 = Join-Path $scriptDir ".venv\Scripts\Activate.ps1"
if (-not (Test-Path $activatePs1)) {
  Write-Error "Could not find activation script: $activatePs1"
}

. $activatePs1

$uvicornArgs = @("main:app", "--host", $BindHost, "--port", "$Port")
if (-not $NoReload) {
  $uvicornArgs += "--reload"
}

Write-Host "Starting FastAPI server on http://$BindHost`:$Port"
python -m uvicorn @uvicornArgs
