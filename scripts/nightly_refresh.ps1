# Nightly data refresh for mlb-market-value.
# Registered as a Windows Task Scheduler job (see README) so it runs
# independent of whether Claude Code or any other app is open --
# unlike an in-app scheduled task, which only fires while that app is running.
#
# Re-ingests the current season and recomputes player value. The dashboard is
# rendered live by the API (no offline HTML build), so a refreshed database
# shows up on the next page load once the API's snapshot cache expires (or
# immediately with ?refresh=1). Does NOT publish/update the live Claude
# Artifact link -- that requires the Artifact tool from an interactive Claude
# session, which this script has no access to. Ask Claude to republish when
# you want the live link to reflect fresh data.
#
# Logging uses Start-Transcript rather than `2>&1 | Tee-Object`: piping a
# native command's stderr through PowerShell wraps each line in a
# NativeCommandError, which (combined with $ErrorActionPreference = "Stop")
# kills the script on ordinary stderr chatter -- like pybaseball's tqdm
# progress bars, which write to stderr and aren't actual errors.

# Resolve repo root from this script's own location so the job works on any
# machine regardless of where the repo is cloned.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $RepoRoot "backend"
$LogDir = Join-Path $RepoRoot "scripts\logs"
$Season = 2026

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir ("refresh_{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))
Start-Transcript -Path $LogFile | Out-Null

function Run-Step($workdir, $exe, $stepArgs, $label) {
    Write-Output ">>> $label"
    Set-Location $workdir
    & $exe @stepArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Output "!!! FAILED: $label (exit code $LASTEXITCODE)"
        Stop-Transcript | Out-Null
        exit 1
    }
}

Write-Output "=== Nightly refresh starting (season $Season) ==="

Run-Step $Backend "py" @("-m", "app.pipeline.run_ingest", "--season", $Season) "run_ingest.py"
Run-Step $Backend "py" @("-m", "app.pipeline.run_compute_value", "--season", $Season) "run_compute_value.py"

Write-Output "=== Nightly refresh completed successfully ==="
Stop-Transcript | Out-Null

# Keep the last 30 log files, prune older ones.
Get-ChildItem $LogDir -Filter "refresh_*.log" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force
