# 渲染看门狗：检测 Remotion 渲染空转/卡死/完成
# 用法（渲染启动后另开一个终端/后台任务运行）：
#   powershell -File scripts/watchdog.ps1 -OutputFile output/silent.mp4 [-MaxMinutes 15]
# 判定：输出文件出现=完成退出(0)；连续3次采样(12s间隔)CPU增量<1s=空转退出(1)；超时退出(2)。
param(
    [string]$OutputFile = "output/silent.mp4",
    [int]$MaxMinutes = 15,
    [double]$StallDelta = 1.0
)
$baseline = (Get-Process node,chrome -ErrorAction SilentlyContinue | Where-Object {$_.CPU} | Measure-Object CPU -Sum).Sum
$streak = 0
$deadline = (Get-Date).AddMinutes($MaxMinutes)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 12
    if (Test-Path $OutputFile) { "RENDERED size=" + (Get-Item $OutputFile).Length; exit 0 }
    $cpu = (Get-Process node,chrome -ErrorAction SilentlyContinue | Where-Object {$_.CPU} | Measure-Object CPU -Sum).Sum
    $delta = [math]::Round($cpu - $baseline, 1)
    $baseline = $cpu
    if ($delta -lt $StallDelta) { $streak++ } else { $streak = 0 }
    "$(Get-Date -Format HH:mm:ss) cpuΔ12s=$delta streak=$streak"
    if ($streak -ge 3) { "STALL x3 — 渲染空转，先查：1)是否有第二个渲染实例残留 2)纹理是否超GPU上限(见pitfalls #10/#11)"; exit 1 }
}
"TIMEOUT ${MaxMinutes}min"; exit 2
