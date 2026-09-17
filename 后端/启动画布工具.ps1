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

# 从一段 HTML 里按文档顺序抽出所有 <script src="..."> 的 src（相对路径）。
# 外链（http/https/协议相对 //）与内联（data:）不参与：否则指纹会随外网可用性抖动。
function Get-ScriptSrcsFromHtml {
  param([string]$Html)
  $srcs = @()
  foreach ($tag in [regex]::Matches($Html, '<script\b[^>]*>', 'IgnoreCase')) {
    $m = [regex]::Match($tag.Value, '\bsrc\s*=\s*[""'']([^""'']+)[""'']', 'IgnoreCase')
    if (-not $m.Success) { continue }
    $src = $m.Groups[1].Value.Trim()
    if ($src -match '^(?:[a-z]+:)?//' -or $src.StartsWith('data:')) { continue }
    $srcs += ($src -replace '\?.*$', '' -replace '^\./', '')
  }
  return ,$srcs
}

# 「端口上这一份，是不是本机这一份？」——按 index.html 声明的「全部脚本」合并指纹认人。
# 为什么必须按内容认：旧版画布、别处副本，页面同样含「设计沟通画布」和 app.js，
# 光凭 Test-CanvasPage 会把它们都认成「画布已经开着」，于是直接「打开正在运行的画布」，
# 用户看到的就是旧版，而不是本机刚合并出来的这一份。
# 为什么不再「只比 app.js 一个文件」：前端已从单个 app.js 拆成
# constants/state/canvas/node/edge/inspector/ai-bridge/modules/marquee/app/events 一长串脚本，
# app.js 只剩几 KB 的装配壳。只看它，等于 12 个文件里只验 1 个，其余被换成旧版也发现不了。
# 改成「全部脚本合并指纹」——与测试侧 _served-target.mjs 同口径，拆分前后都成立：
# 不拆时指纹里只有一个 app.js（退化回旧口径），拆后自动覆盖全部，不为「拆没拆」写分支。
function Get-BundleFingerprint {
  param(
    # 本机传 -FrontendDir（直接读磁盘），远端传 -BaseUrl（HTTP 取回），二选一
    [string]$FrontendDir,
    [string]$BaseUrl
  )

  $names = @()
  $byteLists = @()

  if ($FrontendDir) {
    $indexPath = Join-Path $FrontendDir "index.html"
    if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { return $null }
    $indexBytes = Get-Content -LiteralPath $indexPath -AsByteStream -Raw
    $names += "index.html"; $byteLists += ,$indexBytes
    $html = [System.Text.Encoding]::UTF8.GetString($indexBytes)
    foreach ($src in (Get-ScriptSrcsFromHtml -Html $html)) {
      $p = Join-Path $FrontendDir $src
      if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $null }
      $names += $src; $byteLists += ,(Get-Content -LiteralPath $p -AsByteStream -Raw)
    }
  } else {
    try {
      $res = Invoke-WebRequest -Uri "$BaseUrl/index.html" -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -ne 200) { return $null }
      $indexBytes = $res.RawContentStream.ToArray()
    } catch { return $null }
    $names += "index.html"; $byteLists += ,$indexBytes
    $html = [System.Text.Encoding]::UTF8.GetString($indexBytes)
    foreach ($src in (Get-ScriptSrcsFromHtml -Html $html)) {
      try {
        $res = Invoke-WebRequest -Uri "$BaseUrl/$src" -UseBasicParsing -TimeoutSec 2
        if ($res.StatusCode -ne 200) { return $null }
        $bytes = $res.RawContentStream.ToArray()
      } catch { return $null }
      if (-not $bytes -or $bytes.Length -eq 0) { return $null }
      $names += $src; $byteLists += ,$bytes
    }
  }

  # 指纹算法（与 _served-target.mjs 一致）：对每个 (文件名, 字节) 拼
  # "name<NUL>len<NUL>sha256<LF>"，再对这些拼接串整体算 sha256。
  # 文件名进指纹是刻意的：光比内容会漏掉「两个文件对调」「少了一个文件」这类变动。
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $sb = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt $names.Count; $i++) {
      $fileSha = ([System.BitConverter]::ToString($sha256.ComputeHash($byteLists[$i]))).Replace("-", "").ToLowerInvariant()
      [void]$sb.Append("$($names[$i])`0$($byteLists[$i].Length)`0$fileSha`n")
    }
    $combined = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
    return ([System.BitConverter]::ToString($sha256.ComputeHash($combined))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Test-SameAsLocalFrontend {
  param([int]$CandidatePort)

  $localFingerprint = Get-BundleFingerprint -FrontendDir $frontendRoot
  if (-not $localFingerprint) { return $null }   # 本机脚本缺失，比不了，交回老判断
  try {
    $remoteFingerprint = Get-BundleFingerprint -BaseUrl "http://$address`:$CandidatePort"
  } catch {
    return $null
  }
  if (-not $remoteFingerprint) { return $null }
  return ($localFingerprint -eq $remoteFingerprint)
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
    $sameAsLocal = Test-SameAsLocalFrontend -CandidatePort $selectedPort
    Write-Host "检测到画布已经在运行：$runningUrl"
    if ($sameAsLocal -eq $false) {
      Write-Host "注意：端口上这一份不是本机这一份（前端内容对不上，通常是旧版画布，或别处目录的副本）。"
      Write-Host "      选 2 看到的很可能不是新版；要拿到本机这一份（新版），请选 1。"
    }
    $restartHint = if ($sameAsLocal -eq $false) { "（推荐）" } else { "" }
    Write-Host "请选择："
    Write-Host "1. 终止当前画布进程并重新启动$restartHint"
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

$serverScript = Join-Path $PSScriptRoot "canvas_server.py"
if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
  throw "找不到后端服务脚本：$serverScript"
}

$serverProcess = $null
try {
  $serverProcess = Start-Process -FilePath $pythonCommand.Source -ArgumentList @(
    $serverScript, $Port
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
