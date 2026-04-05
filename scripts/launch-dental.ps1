param(
  [ValidateSet('Run', 'Reset')]
  [string]$Mode = 'Run'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LogDir = Join-Path $Root 'run-logs'
$LaunchLog = Join-Path $LogDir "launch-$Timestamp.log"
$DevLog = Join-Path $LogDir "dev-$Timestamp.log"
$ValidationDbPath = Join-Path $Root 'prisma\validation.db'
$ValidationDbUrl = 'file:./validation.db'
$PortsToProbe = @(3000, 3001)
$MinimumSupportedNode20 = [Version]'20.19.0'
$MinimumSupportedNode22 = [Version]'22.12.0'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-Log {
  param([Parameter(Mandatory = $true)][string]$Message)

  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $Message
  Write-Host $line
  Add-Content -LiteralPath $LaunchLog -Value $line
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$OutputLog,
    [int]$Retries = 0,
    [int]$RetryDelaySeconds = 2
  )
  for ($attempt = 1; $attempt -le ($Retries + 1); $attempt += 1) {
    Write-Log "Running: $Label"
    Write-Log "Command: $FilePath $($Arguments -join ' ')"
    $previousPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & $FilePath @Arguments >> $OutputLog 2>&1
    } finally {
      $ErrorActionPreference = $previousPreference
    }

    if ($LASTEXITCODE -eq 0) {
      Write-Log "Completed: $Label"
      return
    }

    if ($attempt -gt $Retries) {
      throw "$Label failed with exit code $LASTEXITCODE. See $OutputLog"
    }

    Write-Log "$Label failed with exit code $LASTEXITCODE. Retrying in $RetryDelaySeconds second(s)."
    Start-Sleep -Seconds $RetryDelaySeconds
  }
}

function Test-HttpPort {
  param([Parameter(Mandatory = $true)][int]$Port)

  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/signin" -TimeoutSec 2 -UseBasicParsing
    return $response.StatusCode -eq 200 -and $response.Content -match 'Dental Ledger Studio'
  } catch {
    return $false
  }
}

function ConvertTo-Version {
  param([Parameter(Mandatory = $true)][string]$RawVersion)

  $clean = $RawVersion.Trim()
  if ($clean.StartsWith('v')) {
    $clean = $clean.Substring(1)
  }
  return [Version]$clean
}

function Get-NpmCommand {
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCmd) {
    return $npmCmd.Source
  }

  $npm = Get-Command npm -ErrorAction SilentlyContinue
  if ($npm) {
    return $npm.Source
  }

  throw 'npm was not found on PATH. Install Node.js 20+ and re-run.'
}

function Test-DependenciesNeedInstall {
  if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    return $true
  }

  $repoLock = Join-Path $Root 'package-lock.json'
  $nodeModulesLock = Join-Path $Root 'node_modules\.package-lock.json'
  if (-not (Test-Path -LiteralPath $nodeModulesLock)) {
    Write-Log 'node_modules exists but npm metadata is missing. Refreshing dependencies.'
    return $true
  }

  $repoLockWriteTime = (Get-Item -LiteralPath $repoLock).LastWriteTimeUtc
  $nodeModulesLockWriteTime = (Get-Item -LiteralPath $nodeModulesLock).LastWriteTimeUtc
  if ($repoLockWriteTime -gt $nodeModulesLockWriteTime) {
    Write-Log 'package-lock.json is newer than node_modules metadata. Refreshing dependencies.'
    return $true
  }

  return -not (Test-Path -LiteralPath (Join-Path $Root 'node_modules\happy-dom'))
}

function Get-RepoNextNodeProcesses {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
    $_.CommandLine -and
    $_.CommandLine.Contains($Root) -and
    (
      $_.CommandLine.Contains('next\dist\bin\next') -or
      $_.CommandLine.Contains('.next\dev\') -or
      $_.CommandLine.Contains('next\dist\server\lib\start-server')
    )
  }
}

function Stop-RepoNextNodeProcesses {
  $processes = @(Get-RepoNextNodeProcesses | Sort-Object ProcessId -Descending)
  if ($processes.Count -eq 0) {
    return
  }

  Write-Log 'Stopping existing repo-owned Next.js processes so Prisma can regenerate cleanly.'
  foreach ($process in $processes) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Log "Stopped process $($process.ProcessId): $($process.CommandLine)"
    } catch {
      Write-Log "Could not stop process $($process.ProcessId): $($_.Exception.Message)"
    }
  }
  Start-Sleep -Seconds 2
}

function Remove-ValidationDatabase {
  Write-Log 'Reset mode selected. Clearing the validation SQLite database only.'
  foreach ($basePath in @($ValidationDbPath, (Join-Path $Root 'validation.db'))) {
    foreach ($suffix in @('', '-wal', '-shm', '-journal')) {
      $candidate = "$basePath$suffix"
      if (Test-Path -LiteralPath $candidate) {
        Remove-Item -LiteralPath $candidate -Force
        Write-Log "Removed: $candidate"
      }
    }
  }
}

function Clear-GeneratedArtifacts {
  $nextPath = Join-Path $Root '.next'
  if (Test-Path -LiteralPath $nextPath) {
    Remove-Item -LiteralPath $nextPath -Recurse -Force
    Write-Log "Removed generated Next.js output: $nextPath"
  }

  $tsBuildInfoPath = Join-Path $Root 'tsconfig.tsbuildinfo'
  if (Test-Path -LiteralPath $tsBuildInfoPath) {
    Remove-Item -LiteralPath $tsBuildInfoPath -Force
    Write-Log "Removed TypeScript incremental cache: $tsBuildInfoPath"
  }
}

function Test-ValidationSeedRequired {
  $probeLog = Join-Path $LogDir "validation-seed-check-$Timestamp.log"
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & node (Join-Path $Root 'scripts\inspect-validation-db.cjs') *> $probeLog
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the validation database. See $LaunchLog."
  }

  $countText = (Get-Content -LiteralPath $probeLog -Raw -ErrorAction SilentlyContinue).Trim()
  Remove-Item -LiteralPath $probeLog -Force -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace($countText)) {
    return $true
  }

  return [int]$countText -le 0
}

function Start-DevServer {
  param(
    [Parameter(Mandatory = $true)][string]$NpmCommand,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  $command = "cd /d `"$WorkingDirectory`" && set `"DATABASE_URL=$ValidationDbUrl`" && $NpmCommand run dev"
  Write-Log 'Starting the Next.js dev server against the validation database.'
  Write-Log "Dev log: $DevLog"
  $process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $command) -PassThru -WindowStyle Hidden
  return $process
}

Write-Log "=== Dental launcher started ($Mode mode) ==="
Write-Log "Project root: $Root"
Write-Log "Validation DB: $ValidationDbPath"
Write-Log "Launch log: $LaunchLog"
Write-Log "Dev log: $DevLog"

if (-not (Test-Path -LiteralPath (Join-Path $Root 'package.json'))) {
  throw 'package.json was not found. Run the launcher from the repo root.'
}

$NpmCommand = Get-NpmCommand
Write-Log "Using npm command: $NpmCommand"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node was not found on PATH. Install Node.js 20+ and re-run.'
}

$WriteNodeVersion = (node -v).Trim()
$WriteNpmVersion = (& $NpmCommand --version).Trim()
Write-Log "Node version: $WriteNodeVersion"
Write-Log "npm version: $WriteNpmVersion"

$NodeVersion = ConvertTo-Version -RawVersion $WriteNodeVersion
if (
  -not (
    ($NodeVersion.Major -eq 20 -and $NodeVersion -ge $MinimumSupportedNode20) -or
    ($NodeVersion.Major -ge 22 -and $NodeVersion -ge $MinimumSupportedNode22)
  )
) {
  Write-Log 'Warning: Vite prefers Node 20.19.0+ or 22.12.0+. Continuing, but upgrade Node if launch validation starts failing.'
}

$env:DATABASE_URL = $ValidationDbUrl

Stop-RepoNextNodeProcesses
Clear-GeneratedArtifacts

if ($Mode -eq 'Reset') {
  Remove-ValidationDatabase
}

if (-not (Test-Path -LiteralPath $ValidationDbPath)) {
  New-Item -ItemType File -Path $ValidationDbPath -Force | Out-Null
  Write-Log "Created validation database placeholder: $ValidationDbPath"
}

if (Test-DependenciesNeedInstall) {
  Invoke-LoggedCommand -Label 'Install dependencies' -FilePath $NpmCommand -Arguments @('install') -OutputLog $LaunchLog
} else {
  Write-Log 'Dependencies already present. Skipping npm install.'
}

Invoke-LoggedCommand -Label 'Prisma generate' -FilePath $NpmCommand -Arguments @('run', 'prisma:generate') -OutputLog $LaunchLog -Retries 2 -RetryDelaySeconds 2
Invoke-LoggedCommand -Label 'Prisma push' -FilePath $NpmCommand -Arguments @('run', 'prisma:push') -OutputLog $LaunchLog

$shouldSeed = $Mode -eq 'Reset'
if (-not $shouldSeed) {
  $shouldSeed = Test-ValidationSeedRequired
}

if ($shouldSeed) {
  Write-Log 'Validation database is missing or empty. Seeding demo data.'
  Invoke-LoggedCommand -Label 'Seed demo data' -FilePath $NpmCommand -Arguments @('run', 'seed') -OutputLog $LaunchLog
} else {
  Write-Log 'Validation database already contains data. Skipping seed.'
}

Invoke-LoggedCommand -Label 'Typecheck' -FilePath $NpmCommand -Arguments @('run', 'typecheck') -OutputLog $LaunchLog
Invoke-LoggedCommand -Label 'Lint' -FilePath $NpmCommand -Arguments @('run', 'lint') -OutputLog $LaunchLog
Invoke-LoggedCommand -Label 'Tests' -FilePath $NpmCommand -Arguments @('run', 'test') -OutputLog $LaunchLog

$DevProcess = Start-DevServer -NpmCommand $NpmCommand -WorkingDirectory $Root

$ResponsivePort = $null
$maxAttempts = 60
for ($attempt = 1; $attempt -le $maxAttempts; $attempt += 1) {
  foreach ($port in $PortsToProbe) {
    if (Test-HttpPort -Port $port) {
      $ResponsivePort = $port
      break
    }
  }
  if ($ResponsivePort) {
    break
  }

  if ($DevProcess.HasExited) {
    throw "The dev server exited before it became healthy. Check $DevLog."
  }

  Start-Sleep -Seconds 1
}

if (-not $ResponsivePort) {
  if (-not $DevProcess.HasExited) {
    Stop-Process -Id $DevProcess.Id -Force
  }
  throw "The dev server did not respond on ports 3000 or 3001. Check $DevLog."
}

Write-Log "Dev server is healthy on port $ResponsivePort."
Start-Process "http://localhost:$ResponsivePort"
Write-Log "Browser opened at http://localhost:$ResponsivePort"
Write-Log 'The launcher has finished. Leave the dev server window open for live development.'
