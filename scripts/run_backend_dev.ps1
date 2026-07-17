$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
Set-Location $repoRoot

$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
	throw "Python executable not found at: $pythonExe. Did you create the venv in $repoRoot\\.venv?"
}

# Tell watchfiles (used by uvicorn --reload) to ignore large folders.
# On Windows, the separator is ';'.
$uploadsDir = $env:APP_UPLOADS_DIR
if (-not $uploadsDir) { $uploadsDir = $env:UPLOADS_DIR }
if (-not $uploadsDir -and $env:LOCALAPPDATA) {
	$uploadsDir = Join-Path $env:LOCALAPPDATA "codebase_visualizer\uploaded_workspaces"
}

$ignore = @(
	(Join-Path $repoRoot "uploaded_workspaces"),
	(Join-Path $repoRoot ".venv")
)
if ($uploadsDir) { $ignore += $uploadsDir }

$env:WATCHFILES_IGNORE_PATHS = ($ignore -join ';')

Write-Host "Uploads dir: $uploadsDir"
Write-Host "WATCHFILES_IGNORE_PATHS: $env:WATCHFILES_IGNORE_PATHS"
Write-Host "Tip: open in Explorer with: explorer `"$uploadsDir`""

& $pythonExe -m uvicorn backend.main:app --reload --reload-dir (Join-Path $repoRoot "backend") --port 8000


/*
cd C:\Users\PRATEEK\Desktop\codebase_visualizer
powershell -ExecutionPolicy Bypass -File .\scripts\run_backend_dev.ps1
*/

/*
C:\Users\PRATEEK\AppData\Local\codebase_visualizer\uploaded_workspaces
*/