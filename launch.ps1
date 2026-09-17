# 画布工具本体的纯 ASCII 名引导脚本（2026-09-17 新增）。
#
# 为什么需要它：本工具的双击入口是 启动画布工具.bat。按本机全局编码规则，
# .bat / .cmd 必须是纯 ASCII（不得含任何非 ASCII 字节），中文一律挪进它调用的
# .ps1；而本工具的目录名（画布工具本体、后端）与主脚本名（启动画布工具.ps1）
# 都含中文，没法写进 .bat。于是 .bat 只认这个英文名的引导脚本，
# 中文路径全部留在本文件里。
#
# 它只做三件事：拼出主脚本完整路径、校验它存在、原样转发参数与退出码。
# 参数 -Port 与主脚本一致；主脚本若将来新增参数，本文件要同步加。
#requires -Version 7.0
[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 4173
)

$ErrorActionPreference = "Stop"

$target = Join-Path $PSScriptRoot "后端\启动画布工具.ps1"

if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
  Write-Error "找不到主启动脚本：$target"
  exit 1
}

& $target -Port $Port

if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
exit 0
