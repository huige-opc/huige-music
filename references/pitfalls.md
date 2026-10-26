# 踩坑清单（全部实际踩过，动手前必读）

## 1. MIDI 与曲谱不同源（最致命）

网上 MIDI 和曲谱常是**不同改编版**。实例：Mutopia 致爱丽丝 MIDI 1810 个 note-on vs MuseTrainer 曲谱 1106 条记录，硬凑映射必错。

**对策**：先对比两者的音符数、拍位序列、声部分布（staff1/staff2 计数），一致才用。不一致就换源，不要试图修复。
本项目的幸运组合：MuseTrainer `Fur_Elise.mxl`（904 实音，staff 分布 517/387）与 Mutopia MIDI（905 事件，轨道分布 517/388）逐拍对齐——先验证再采用。

## 2. Verovio 导出 MIDI 会展开反复和颤音

Verovio 6.3 的 `renderToMIDI()` 会把曲谱中的反复记号（repeat barlines）展开演奏、颤音展开成逐音事件，导致反复段之后 MIDI 拍位与谱面**系统性错位**。本例中曲谱 8-10 小节有反复记号，Verovio MIDI 在 beat 12 之后全部对不上。

**对策**：
- `tk.setOptions({expandRepeats: false})` 在 Verovio 6.3 **不是合法选项**（会报 Unsupported option），无法关闭；
- 弃用 Verovio MIDI，改用与曲谱逐拍对齐的第三方 MIDI 做时间源，音频也从它合成；
- 或者接受「曲谱印着渐慢/反复但演奏不体现」的妥协，并向用户说明。

## 3. 拼接 SVG 后坐标整体漂移

Verovio 每页 SVG 的结构是：外层 `<svg viewBox="0 0 1120 1048">` 内嵌一层 `<svg class="definition-scale" viewBox="0 0 28000 26190">`（约 1/25 缩放）。直接把多页内容嵌进一张大 SVG 时，嵌套 svg 会按 preserveAspectRatio 在大画布里**垂直居中**，所有坐标平移 (大画布高-页高)/2（实测 +1143），且三页互相错位。

**对策**：`compose-pages.mjs` 的做法——剥掉外层标签后，把每页的嵌套 definition-scale svg 替换为等效 `<g transform="scale(rw/nw)">`，再包 `translate(0, offsetY)`。验证方法：拼接前后抽查同一 note id 的坐标，误差应 <1。

## 4. 谱行（system）归属不能用最近邻

staff2（低音谱表）符头的 y 恰好落在本系统 staff1 中心与下一系统 staff1 中心的正中间，最近邻聚类会把它分给下一个系统，造成「同拍音符跨系统」→ 分段时间倒挂 → 镜头路径崩溃。

**对策**：只用 **staff1 音符的 y 聚类**定系统（每个系统恰有一条上谱表行，天然一一对应）；staff2 音符按「y+40 以下最近的 staff1 中心」归上。验证：按系统分段后时间必须单调递增。

## 5. 点光源数量超限 → 谱面纸全黑

多球版若每颗球常驻一个 pointLight，几十个光源超出 Three.js/WebGL 灯光上限，**着色器编译失败**：所有受光照材质（谱面纸 meshStandardMaterial、地面）渲染成黑色，而自发光材质（球、环用 meshBasicMaterial）正常显示——画面变成黑纸亮球。

**对策**：只在球可见时挂载光源（`motion.opacity > 0.01 && <pointLight/>`）。若渲染结果黑屏但有球，先查灯光数。

## 6. 修改 SMF 文件的两个二进制陷阱

向 MIDI 插入 tempo 事件（做渐慢/变速）时：
- **MTrk 块长度是 4 字节大端整数，不是 VLQ**（写成 VLQ 整个文件错位）；
- **EOT（FF 2F）必须在 track 末尾**——LilyPond 导出的 MIDI 里 EOT 紧跟 tempo 就在开头，直接插入事件会排在 EOT 之后，合成器在 EOT 处停止，渐慢被静默忽略。

**对策**：解析后删掉 EOT → 排序插入 tempo → 重新在末尾补 EOT → 用 `struct.pack('>I', len)` 写块长。参考 `scripts/add-rit.py`。

## 7. 球的轨迹线与多球的冲突

纯多球模型（每个音符一个激活槽位）会导致：无音的拍球淡出、下个音淡入，**飞行过程不存在 → 轨迹线消失**，且球闪烁感强。

**对策**：混合模型——每声部 1 颗主球贯穿全曲每一拍（目标链连续，轨迹线永不断），和弦副球单独成槽、连续和弦间最小代价配对，断链即淡出。见 `src/performance.ts` 的 `buildSlots`。

## 8. 版本差异音符的兜底匹配

即使同源，MIDI 与曲谱仍有少量差异（内声部记谱不同、重复音多一次）。逐级兜底：
1. 精确匹配：音高相同 + 拍差 ≤0.2（代价含声部一致性）；
2. 版本差异：拍差 ≤0.05 + 音高差 ≤2 半音；
3. 装饰音展开：与前一个已匹配事件间隔 <0.3s 且音高差 ≤2 → 重用其符头；
4. 重复音重用：1 拍内最近的同名符头（允许同符头多次触发）。

每级都计数并在结果中报告，不允许静默丢弃。

## 9. 工具链注意

- **渲染必须用本地浏览器**：`--browser-executable` 指定，禁止下载 Chrome Headless Shell（曾卡死 10 分钟）。Chrome 优先（`C:/Program Files/Google/Chrome/Application/chrome.exe`），没装 Chrome 用 Edge（`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`），两者同为 Chromium 内核均验证可用。
- fluidsynth Windows 版从 GitHub FluidSynth/fluidsynth releases 下载；音源 GeneralUser GS（31MB）够用且小。
- 多页曲谱 engrave 会导出所有页，**不能只取第一页悄悄丢弃**——要么全拼，要么明确告知用户取舍。
- 改 MIDI 前先备份；改完用 read-music.py 重新解析验证 tempo map 与事件数不变。

## 10. 渲染必须 --gl=angle，否则慢 7 倍且可能空转（2026-10-24 实测）

无独显机器（仅 Intel 核显）上，headless Chrome 默认用 SwiftShader（纯 CPU 软件模拟 WebGL）：
1080P 实测 1.5 帧/秒，且渲染中途可能锁死。加 `--gl=angle` 后走核显 DirectX 硬件加速：
10.5 帧/秒，快 7 倍。**render.mjs 已默认带上**，直接调 remotion CLI 时必须手动加。
证据：1201 帧 1080P，软件渲染 8 分钟未完且 CPU 归零卡死；angle 模式 1 分 55 秒完成。

## 11. 谱面纹理有 GPU 硬上限 16384px，超限=渲染死锁（2026-10-24 实测）

渲染器把整张曲谱 SVG 光栅化成 Canvas 纹理：`(viewBox高度+100)×4`。超过 16384px
（GPU 纹理上限）时 Remotion 不报错、只空转。engrave scale 越大页越高，极易踩中。
**约束公式：viewBox 高度 ≤ 3984**。scale 40 + 双谱表 115 小节 = 3162px（安全）；
scale 55 = 6389px（死锁）。改 scale 前先算，渲染卡死先查这条。

## 12. 重刻前必须清空 engraved 目录（残留页会混入拼接）

engrave 按页数输出 page-N.svg，但**不删除旧文件**。上次 4 页、这次 3 页时，
compose-pages 会把过期的 page-4 一起拼进去（尺寸、比例全是旧的）。
每次重跑 engrave 前：`rm -f output/engraved/*.svg`。

## 13. 渲染前必须确认无残留渲染进程（双实例互锁=永远空转；互锁检测必须排除自身 PID）
本进程命令行本身就含 render.mjs——互锁查询若不排除 process.pid，会永远误报"发现 1 个残留"而拒绝启动（2026-10-24 实测）。

被中断/超时的渲染可能留下 node+chrome 残留进程，两个实例抢写同一输出文件会互相锁死，
重启多少次都没用。启动渲染前先查杀残留，看门狗（scripts/watchdog.ps1）报空转时第一时间查这条。
注意：wmic 在部分 Windows 上已废弃、返回空，CPU 检测一律用
`Get-Process node,chrome | Measure-Object CPU`（PowerShell）。

## 14. 多声部（人声+伴奏）映射必须轨道-谱表严格绑定（球会倒跳）

双轨 MIDI（track1=人声/staff1，track2=伴奏/staff2）若允许跨声部匹配（哪怕只加代价罚分），
伴奏事件会抢占人声符头：人声球提前跳到后面的符头再跳回——肉眼看就是"球往回跳又朝前跳"。
build-data 必须四层全部绑定 expectedStaff（主匹配/变体兜底/装饰音重用/重复音重用）。
验收脚本：按 staff 分组后统计"同 system 内 1.5s 内 x 回退>8px"次数，应趋近 0
（同符头重复音**不再允许复用**，见坑 #20）。

## 15. 人声量化的格位必须沿真实时间单调（滑音顺序对调=倒跳的另一根源）

歌手滑音让两音实差仅 50ms，各自 snap 到相邻格子后**顺序可能对调**：谱面按格位印刷、
动画按真实秒触发，顺序打架球就倒跳。转谱脚本（scripts/vocal2score.py）在量化后强制
`qb[i] = max(qb[i], qb[i-1])`（沿真实时间序），同格不同音高自然并成和弦（同 x 无倒跳）。

## 16. 渲染空转监测：用看门狗，别干等

渲染启动后在另一个后台任务跑 `scripts/watchdog.ps1`：每 12 秒采样 node/chrome 的
CPU 增量（PowerShell Get-Process），连续 3 次增量<1s 判定空转退出(1)；输出文件出现退出(0)；
超时退出(2)。空转时按 #13 查残留进程、按 #11 查纹理上限、按 #10 查 --gl=angle。
经验：输出文件要等 Remotion 编码完才落盘，"没看到文件"≠没在渲，以 CPU 增量为准。

## 17. 拼接 SVG 丢失 Verovio CSS 作用域 id → 谱线隐形

Verovio 的 CSS 把所有颜色作用域到根 svg 的 id：`#<id> path {stroke: currentColor}`。
staff 谱线路径只有 `stroke-width` 没有颜色属性，完全依赖这条规则；符头/符梁走 SVG 默认
fill=black 不受影响。拼接脚本剥掉根 svg 后 id 丢失 → **谱面只剩符头符梁，五线谱隐形**，
且黑调画面里极难察觉（曾带病交付两版才发现）。

**对策**：compose-pages.mjs 拼接时把根 id 带到新根 svg 上（`ROOT_ID` 逻辑）。验证方法：
光栅化纹理后沿谱线坐标采样像素亮度，或直接目视检查纹理图。另外部分曲谱页面含**多个**
嵌套 `</svg>`（不同导出源结构不同），剥离 svg 标签要用全局替换而非「只删最后一个」。

## 18. 渲染范围必须先确认；分段渲染用 render.mjs --seg（2026-10-24）

流程缺陷实录：未确认范围就启动全曲渲染，用户改需求后杀进程重来——来回折腾且被质疑
"渲染逻辑有问题"。规则修正：
1. **启动渲染前必须与用户确认范围**（全曲 / 分段 / 哪几段）。
2. 分段渲染已内置：`npm run render -- --seg=175-225`（自动帧号换算含 INTRO 偏移、
   音频切片 atrim 对齐段起点、输出 output/seg-175-225.mp4），不要手搓 ffmpeg。
3. 同一段在 score-data 未变时**不要重复渲染**，直接复用旧文件。
4. 渲染固定四步：确认范围 → 查杀残留进程（render.mjs 已内置检查）→ 单实例启动 → 挂 watchdog.ps1。

## 19. 和弦只认「时间完全相同」→ 同柱双音只画一根弧（2026-10-25）

转写出的同柱双音（同一 x、不同音高）常有 20~80ms 抖动。`buildSlots` 原来用
`Math.abs(time diff) < 1e-6` 分组，两个音被拆成两次单音：第一颗落位后立刻飞走，
用户看到「A 1 槽 → B 垂直 2 槽」只有 1 根弧。

**对策**：和弦判定 = 同声部 + 同 x（≤2 纸面单位）+ 时间差 ≤80ms + 音高不同。
`scripts/verify-chord-arcs.mjs` 用同一套判定检查「几槽位几条弧」，FAIL 不渲染。
血训：写检查器时也要用同一套容差，否则检查器用 `toFixed(3)` 分组，永远测不出这个问题。

## 20. 复用已用符头 → 同一槽位短时间二次动作（2026-10-25）

`build-data.mjs` 的「重复音最后兜底」会复用已经匹配过的符头。同一个槽位先弹下方和弦音、
再跳上去、又跳回同一符头，观感就是「下面槽位做了 2 次动作」。

**对策**：最后兜底只找**未使用**的符头；找不到就 unmatched（宁可不画，不重复占槽）。
`verify-score-slots.mjs` 把「同刻重复」和「间隔>80ms 的重复使用」都判 FAIL。

## 21. 人声双轨：MIDI 60BPM 与谱面真 BPM 直接比 beat → 大量 unmatched（2026-10-25）

vocal2score 的 MIDI 固定 60BPM（1 拍=1 秒），谱面用真实 BPM（如 112.3）。
用 `Math.abs(n.beat - ev.beat)` 匹配会大面积失配（实测 70 个事件只中 16 个）。

**对策**：`build-data.mjs` 自动识别（MIDI 60BPM + 谱面非 60）→ 秒域匹配
`scoreSecOfBeat = beat*60/SCORE_BPM`，容差 0.15s，并加 track→staff 严格绑定。
标准钢琴谱（MIDI 与谱面同 BPM）仍走原 beat 域。

## 22. 弧先于球出现：trailOpacity 没看 landed（2026-10-25）

`performanceAt` 在 `age<0`（音符还没到）时 `1 - age/0.12 > 1`，`trailOpacity` 被算成正值，
画面就是「球没落地、弧已经先亮着」。`check-residue.mjs` 的「弧球同步」报了 1497 处脱节。

**对策**：非 departing 分支加 `landed &&`，只有落地后的 0.12s 残弧才可见。
