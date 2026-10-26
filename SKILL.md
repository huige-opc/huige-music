---
name: huige-music
description: "3D music animation from real sheet music — glowing balls hop across an engraved score while the camera glides along the page (Remotion + React Three Fiber + Verovio). 制作「发光小球在真实曲谱上跳跃演奏、镜头沿谱面滑行」的 3D 音乐动画视频（Remotion + React Three Fiber + Verovio）。当用户提供曲谱（MXL/MusicXML）、MIDI、音频，要求制作音符跳动/曲谱动画/音乐可视化视频，或要求换曲、调整该类动画（球、轨迹、镜头、亮度、和弦表现）时使用本技能。基于已验证的致爱丽丝全曲项目模板与踩坑清单。"
agent_created: true
---

# Huige Music — 3D 曲谱音符跳动动画

> 作者：辉哥 · 协议：MIT（见 LICENSE）

从曲谱素材（MXL/MusicXML + MIDI + 音频）制作「发光小球在真实曲谱上跳跃演奏」的 1080p MP4。核心链路：`MIDI 音符事件 → 映射到 Verovio 渲染出的符头坐标 → 驱动多球跳跃/圆环/镜头`。

## 快速开始

1. 复制 `assets/music-score-starter/` 到工作目录，`npm install`（依赖版本已锁定，勿升级）。
2. 准备素材到 `materials/`：曲谱 `.mxl`、MIDI `.mid`（可选音频）。
3. 按下方流水线顺序执行脚本，生成三样换曲产物：`public/score/score.svg`、`public/score/piano.wav`、`src/score-data.json`。
4. `npm run typecheck && npm run validate`，先渲 10 秒低清预览核对映射，确认后再渲全曲 1080p。
5. 渲染必须指定本地浏览器（禁止下载 Chrome Headless Shell），Chrome 优先、Edge 兜底：
   `npm run render -- --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"`
   无 Chrome 时用 Edge：`--browser-executable="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"`
   测试片段用 remotion CLI 直渲：`--frames=START-END --scale=0.5 --muted`。

## 素材策略（展示用途：音频优先，曲谱是升级项）

本技能用于演示/展示视频，**默认走音频转写路线**——用户只要说曲名，不需要找曲谱：

1. **找音频**（任一即可，按顺序尝试）：
   - 内置曲库 `assets/score-library.json`（69 首名曲，MuseTrainer 公版曲库，`git clone --depth 1 --filter=blob:limit=200k https://github.com/musetrainer/library` 整库直下）：有曲谱的曲子用 gen-midi 生成同源 MIDI（音质最稳）
   - 视频平台音频：yt-dlp / B 站、YouTube 搜索「曲名 piano」抽音频
   - 曲谱站 MXL 直下：ScoreBase（公版曲子提供免费 MXL/MIDI/PDF）
   - archive.org（免登录直链）：搜曲名，常有演奏录音
   - 谱面站的试听 mp3（如弹琴吧 oss 直链，照谱合成的音频，转写质量最好）
2. **转写**：basic-pitch 音频 → MIDI → snap-grid.py 节拍吸附 → generate-score.py 自动制谱
   （完整流程与坑见 `references/no-score-fallback.md`；Python 必须 3.13）
3. **渲染**：标准流水线。音频轨用 fluidsynth 从转写 MIDI 合成（保证与动画同步）

**升级路径**（追求谱面权威时才用）：找到人工编订的 MXL+MIDI → 标准曲谱流水线。
同源性检查、曲谱/MIDI 对照等严格流程仅在走这条路径时适用。

音频选择要点：优先钢琴独奏、无鼓点无演唱、时长≥选段+10s、音量电平稳定（响度差异大
的现场录音转写质量差）。转写准确率约 95%+，演示用途可接受，需向用户说明这一点。

## 流水线（project/scripts/ 内全部脚本已就绪）

```
1. python scripts/read-music.py 素谱.mxl 素谱.mid output/analysis
   → 解析曲谱结构(带稳定ID m{n}n{ni}) + MIDI事件(拍位/秒/声部)
2. node scripts/engrave.mjs output/analysis/identified.musicxml output/engraved
   → Verovio 逐页导出 SVG（内含音符ID）
3. node scripts/compose-pages.mjs output/engraved public/score/score.svg
   → 多页拼接成单张SVG（自动剥嵌套 definition-scale svg）
4. node scripts/note-geometry.mjs public/score/score.svg output/geometry-all.json
   → 无头浏览器提取每个符头坐标
5. node scripts/build-data.mjs analysis/music-analysis.json geometry-all.json src/score-data.json <秒数> [标题] [副标题] [作曲] [窗口起点秒]
   → MIDI↔符头匹配 + 谱行归属 + 镜头路径，输出 score-data.json
   （人声双轨：MIDI 60BPM + 谱面真 BPM 时自动走秒域 + track→staff 严格绑定）
6. node scripts/verify-score-slots.mjs analysis/music-analysis.json geometry-all.json src/score-data.json
   → 乐谱槽位检查：不跳过槽位 / 同刻不重复 / 同柱和弦完整；FAIL 禁止渲染
6b. node scripts/verify-chord-arcs.mjs src/score-data.json
   → 和弦多弧检查：同柱抖动（≤80ms）也算和弦，几槽位必须几条弧；FAIL 禁止渲染
7. fluidsynth 生成音轨（tools/ 下无则装）:
   fluidsynth -ni -g 0.7 -F public/score/piano.wav <音源.sf2> 对齐的.mid
8. npm run typecheck && npm run validate && 渲染
```

渐慢/变速：用 `scripts/add-rit.py` 向 MIDI 插入 tempo 事件（参数写死 PPQ=384，换曲需核对），重跑步骤 1 和 6，动画与音频自动跟随。

分段渲染：`npm run render -- --seg=175-225` —— 只渲音乐 175~225 秒（自动换算帧号、
自动切片对齐人声音轨、输出 `output/seg-175-225.mp4`）。规则：**渲染范围先跟用户确认**
（全曲还是分段、哪一段），别默认全曲；同一段渲过且数据未变就直接用旧文件，别重复渲。
全曲渲染不加 --seg 即可。

## 用户风格入口（三层规则）

1. **默认即答案**：用户没提风格 → 一律 classic（经典暗场）出片，不问不选。
2. **关键词覆盖**：用户句子里带「水墨/古风」→ ink；「赛博/电音/霓虹」→ cyberpunk；
   「原版/经典/复古」→ classic。只有这三个画风。
3. **出片后轻提示（全量披露）**：交付成片时附一句——
   「本片为经典暗场风。想要 赛博朋克 / 水墨古韵 版本，回复风格名即可。」
   （当前风格 + 另外两个可换项一次列全，用户才知道选择空间。）
预设机制与扩展方法见 `references/style-presets.md`（二次开发者向）。

## 无曲谱兜底（音频转写）

找不到曲谱/MIDI 时：一段音频也能出片——basic-pitch 听音转写 MIDI → snap-grid.py 节拍网格吸附 → generate-score.py 直出双谱表 MusicXML → 标准流水线。脚本（snap-grid.py / generate-score.py，BPM 可传参）与完整注意事项见 `references/no-score-fallback.md`：Python 版本（必须 3.13）、依赖安装顺序、延音截断、backup 语义、BPM 估算、选段技巧等 9 个特有坑。转写准确率约 95%+，谱面为程序生成（无指法/乐句标记），演示够用、非出版级。选段要取旋律已进入的段落，避开纯伴奏引子（否则与其它曲子片段观感雷同）。

## 带人声演唱（流行歌双轨方案）

要"球跟人声唱、伴奏也跳"的流行歌效果：Demucs 把原曲拆成人声/伴奏两条 stem，各自
basic-pitch 转音符，vocal2score.py 直出**双谱表 MusicXML + 双轨 MIDI**（MIDI 60BPM
使 1 拍=1 秒，动画时间天然同步原曲；谱面按 librosa 实测真实 BPM 量化成正常乐谱），
build-data 按**秒域+轨道严格绑定**匹配，音轨用带人声的原曲。
完整流程、网易/B站取歌接口、人声真伪校验（轨能量比值）、验收清单见
`references/vocal-pipeline.md`；脚本 `scripts/vocal2score.py`。
已验证案例：《岁月如笔写春秋》走心女版 247 秒全曲（人声 420 + 伴奏 701 音符）。

## 渲染稳定性（必读）

- `render.mjs` 已默认 `--gl=angle`（核显硬件加速）：不加会掉到 CPU 软渲染，慢 7 倍且可能空转（pitfalls #10）。
- 谱面纹理 GPU 上限 16384px：viewBox 高度 ≤3984，超限=渲染死锁不报错（pitfalls #11）。
- 渲染启动前查杀残留渲染进程；渲染时另跑 `scripts/watchdog.ps1` 看门狗，空转 3 次采样即报警（pitfalls #13/#16、#12 残留页清理）。

## 环境与工具清单（全部验证过）

| 工具 | 用途 | 获取/安装 |
|---|---|---|
| Node.js 18+ + npm | Remotion 渲染与脚本 | 官网安装；依赖用模板锁定版本 |
| FFmpeg / FFprobe | 合成、抽帧、格式转换、校验 | 官网或 winget；必须加入 PATH |
| Python 3.13 | 流水线脚本（纯标准库部分任意 Python3） | **兜底转写必须 3.13**（3.14 无 onnxruntime 轮子） |
| Verovio 6.3 (npm) | MusicXML → SVG 制谱 | 已在模板 package.json，勿升级 |
| Chrome 或 Edge | 无头渲染 | `--browser-executable` 指定，禁止下载 Headless Shell |
| fluidsynth + .sf2 音源 | MIDI → WAV 音轨 | Windows 用 GitHub FluidSynth release；音源 GeneralUser GS（约 31MB） |
| basic-pitch + music21 | 音频转写 MIDI（兜底才需要） | `pip install`，顺序见 no-score-fallback.md；Python 3.13 |
| git | 拉取公版曲谱库 | 浅克隆 MuseTrainer library（69 首名曲 MXL） |
| yt-dlp (pip) | 视频/音频平台抽音频（兜底找音频用） | pip install yt-dlp；B 站/YouTube 均可，抽音轨转 mp3 |

## 素材情况与处理策略（碰到什么情况怎么办）

| 情况 | 处理 |
|---|---|
| 曲谱 MXL + 同源 MIDI 都有 | 标准流水线（最优路径）。先核对同源性：音符数/拍位/声部分布 |
| 只有曲谱 MXL | 检查曲内反复记号：无反复 → Verovio gen-midi 生成同源 MIDI（天然对齐）；有反复 → gen-midi 的 MIDI 会错位（pitfalls 第 2 条），改找外部 MIDI 或走兜底 |
| 只有 MIDI | 找配套曲谱（MuseTrainer/Mutopia/MuseScore.com）；找不到 → 走无曲谱兜底（MIDI 当转写结果用，跳过转写步骤） |
| 只有音频 | 器乐/钢琴独奏走无曲谱兜底（no-score-fallback.md）；**流行歌带人声演唱走双轨方案**（vocal-pipeline.md：Demucs 拆人声/伴奏 → 双谱表） |
| 素材在登录墙后（MuseScore Pro/弹琴吧/MidiShow） | 不硬绕。换公版替代曲，或请用户手动下载后放入目录 |
| 版权曲（在版权期内） | 非商用演示可按用户指示直接做；发布风险由用户自担，需提醒 |
| 曲谱与 MIDI 不同源 | 禁止硬凑映射。换源，或走兜底方案 |
| 多页曲谱 | compose-pages.mjs 自动拼接（勿只取第一页） |
| 曲内有反复记号但想要直通演奏 | 去除 MusicXML 中的 `<repeat>` 标记后重新制谱 |

## 数据契约（score-data.json，build-data.mjs 自动生成）

events/activations 每项含 time/x/y/staff/pitch/velocity/duration/scoreId/kind/system/eventId；camera 为 {time,x,y} 关键帧（SVG 坐标，渲染器乘 scoreScale）。换曲时三样产物全部重建，禁止复用旧曲数据。

## 视觉规则（勿破坏，用户已确认过的取舍）

效果已定稿为**三画风：经典 / 赛博 / 水墨**（settings.json preset 切换）。默认 classic：暗场暖灰乐谱（纸色 #c4bfb8 + 低曝光）+ 球/环/弧线都取当前音符的音高色（随旋律变色），弧线管径 0.013；纸色/灯光/暗角/球芯复刻《岁月如笔写春秋-人声版》。赛博 = 深紫纸 + 同一套音高色，弧线管径 0.017；水墨 = 暖墨纸 + 墨晕，球/环/弧线同样取音高色（墨晕只做纸面洇染）。**用户侧只有这三个名字**；PRESETS 表以外的风格不对外宣传。

- 球是「手」、环是「音」：和弦分副球落各符头，主球落地即起跳，不停顿。
- 和弦判定：同声部、同 x、时间差 ≤80ms、音高不同 = 一个和弦；**几槽位几条弧**（A 1 槽 → B 垂直 2 槽 = 2 根弧）。
- **同一符头不得二次动作**：build-data 最后兜底只找未使用符头，找不到就 unmatched；`verify-score-slots.mjs` FAIL 禁止渲染。
- 主球轨迹线必须连续（每拍都在飞），副球随音值结束淡出属正常现象，不是 bug。
- 球保留贴身小光晕；禁止纸面大面积彩光（大光板已删，点光源 distance≤3.5）。
- 结尾渐慢要体现；镜头换行=行尾停0.3s+0.55s斜扫，翻页同理加大距离。

### 色彩交付（写死，勿改）
渲染必须带 `--color-space=bt709 --pixel-format=yuv420p`（render.mjs 已内置）：逐帧渲染产出的是 RGB 全范围画面，
不声明就会被 ffmpeg 标成 yuvj420p/pc + BT.601，导致播放发灰、霓虹色偏色。成片一律 `yuv420p / tv / bt709`，
acceptance.mjs 不过即禁止交付。历史文件补救必须用 zscale 换矩阵换范围，**不能只改标记**（详见 pipeline-guide 第九点五节）。

## 渲染参数

settings.json：fps 30 / introFrames 5 / scoreScale 0.04 / preset(classic|cyberpunk|ink)。灯光由预设写死：classic 0.52/0.62/0.68（暗场参考片），cyberpunk 0.78/0.88/0.80，ink 0.74/0.80/0.80；用户不可覆盖。渲染输出 output/music-score.mp4，全曲 131 秒约 7 分钟渲完。

## 技能内容导览

- `assets/music-score-starter/` —— 完整可运行项目模板（依赖已锁定的 Remotion 4.0.518 + R3F + Verovio，含全部流水线脚本与混合多球运动模型）
- `projects/` —— 本机调试/样片项目目录（辉哥 2026-10-25 定：以后新项目统一放这里，不污染模板；node_modules 用 junction 共享）
- `assets/example-20s.mp4` —— 致爱丽丝 0-20 秒效果示例（960×540 含音轨）
- `assets/example-materials/` —— 示例全套素材（MXL 曲谱、对齐 MIDI、成品 score-data.json、复现命令）
- `references/pipeline-guide.md` —— 制作规范：数据职责、映射方法、运动模型、镜头、时间音频、验收清单
- `references/style-presets.md` —— 风格预设系统二次开发指南（PRESETS 表、扩展方法、调参速查）
- `references/vocal-pipeline.md` —— 带人声流行歌双轨方案（Demucs 拆分、双拍系、验收清单）
- `references/prompts.md` —— 提示词模板：环境准备 / 简单版 / 详细版（含分析阶段），可直接复制使用
- `references/pitfalls.md` —— 踩坑清单（Verovio MIDI 反复展开、嵌套 SVG 漂移、灯光超限黑屏、SMF 二进制陷阱等，动手前必读）

## 踩坑清单

动手前必读 `references/pitfalls.md`——每一个坑都花过真实排查时间。
