# UTF-8
#requires -Version 7.0
[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 4173
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$toolRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $toolRoot "前端"
$address = "127.0.0.1"
$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue

if (-not (Test-Path -LiteralPath $frontendRoot -PathType Container)) {
  Write-Error "找不到前端目录：$frontendRoot"
  exit 1
}

if (-not $pythonCommand) {
  Write-Error "找不到 Python，无法启动本地 HTTP 服务。"
  exit 1
}

function Get-PortListeners {
  param([int]$CandidatePort)

  @(Get-NetTCPConnection -LocalPort $CandidatePort -State Listen -ErrorAction SilentlyContinue)
}

function Test-CanvasPage {
  param([int]$CandidatePort)

  try {
    $candidateUrl = "http://$address`:$CandidatePort/index.html"
    $response = Invoke-WebRequest -Uri $candidateUrl -UseBasicParsing -TimeoutSec 2
    $content = [string]$response.Content
    return $response.StatusCode -eq 200 -and
      $content.Contains("设计沟通画布") -and
      $content.Contains('app.js')
  } catch {
    return $false
  }
}

function Stop-CanvasListeners {
  param(
    [object[]]$Listeners,
    [int]$CandidatePort
  )

  $processIds = @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  if (-not $processIds) {
    throw "已识别出正在运行的画布，但无法读取它的进程号，不能安全终止。"
  }

  foreach ($processId in $processIds) {
    Write-Host "正在终止画布服务进程 $processId ..."
    Stop-Process -Id $processId -Force -ErrorAction Stop
  }

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (-not (Get-PortListeners -CandidatePort $CandidatePort)) {
      return
    }
    Start-Sleep -Milliseconds 150
  }

  throw "旧画布服务未能及时释放端口 $CandidatePort。"
}

$selectedPort = $Port
$canvasReused = $false
while ($true) {
  $existingListener = Get-PortListeners -CandidatePort $selectedPort
  if (-not $existingListener) {
    break
  }

  if (Test-CanvasPage -CandidatePort $selectedPort) {
    $runningUrl = "http://$address`:$selectedPort/index.html"
    Write-Host "检测到画布已经在运行：$runningUrl"
    Write-Host "请选择："
    Write-Host "1. 终止当前画布进程并重新启动"
    Write-Host "2. 打开正在运行的画布"

    do {
      $choice = Read-Host "请输入 1 或 2"
    } while ($choice -notin @("1", "2"))

    if ($choice -eq "2") {
      Start-Process $runningUrl
      Write-Host "已打开正在运行的画布：$runningUrl"
      exit 0
    }

    Stop-CanvasListeners -Listeners $existingListener -CandidatePort $selectedPort
    $canvasReused = $true
    break
  }

  $nextPort = $selectedPort + 1
  if ($nextPort -gt 65535) {
    Write-Error "端口 $Port 及其后续端口均不可用。"
    exit 2
  }
  Write-Host "端口 $selectedPort 已被其他程序占用，自动尝试端口 $nextPort。"
  $selectedPort = $nextPort
}

$Port = $selectedPort
$url = "http://$address`:$Port/index.html"
if ($canvasReused) {
  Write-Host "旧画布已终止，正在重新启动端口 $Port。"
}

$serverProcess = $null
try {
  $serverProcess = Start-Process -FilePath $pythonCommand.Source -ArgumentList @(
    "-m", "http.server", $Port, "--bind", $address
  ) -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 150
    if ($serverProcess.HasExited) {
      throw "本地 HTTP 服务提前退出。"
    }
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      # 服务尚未就绪，继续等待。
    }
  }

  if (-not $ready) {
    throw "本地 HTTP 服务启动超时。"
  }

  Start-Process $url
  Write-Host "画布已启动：$url"
  Write-Host "关闭此窗口即可停止本次服务。"
  Wait-Process -Id $serverProcess.Id
} catch {
  Write-Error $_
  exit 1
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
