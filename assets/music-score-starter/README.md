# music-score-starter — 项目模板

「发光小球在真实曲谱上跳跃演奏」的 Remotion 项目模板。视觉实现（连续跳跃、入场、圆环、轨迹、混合多球、景深和镜头）已调好，Agent 换曲时只需重建三样产物。

**它不是「拖入任意 MIDI 就自动生成」的软件。** 新曲仍需将 MIDI 与 MXL 的真实音符位置对应，并生成镜头路径；空数据启动会显示「待配置」，不是假演示。

## 直接发给 Agent

> 请先阅读本包 README 和技能的 references/pipeline-guide.md、references/pitfalls.md，复用 src 中的视觉实现，不要重新设计效果。我的素材在：[目录]。检查并安装缺少的兼容依赖，用我的 MXL 生成 SVG，从实际符头获取坐标，用 MIDI 建立完整映射，生成 src/score-data.json 和镜头路径。处理和弦、延音、倚音/颤音、反复和换行；不能套用旧曲时间或均匀铺点。真人音频先验证同步，不同步则用同一 MIDI 生成音轨。先做短片段低清预览并核对映射，再导出所需时长的 1080p 视频。遇到未匹配音符请报告并修复，不要跳过。

## 目录说明

| 文件 | 作用 | 换曲时 |
|---|---|---|
| src/performance.ts | 混合多球运动模型：主球贯穿全曲 + 和弦副球分落（buildSlots）+ 连续跳跃 | 通常不改 |
| src/MusicScoreVisualizer.tsx | 球/环/轨迹渲染、SVG 纹理、后期处理（Bloom+DOF） | 尽量保留 |
| src/camera.ts | Hermite 插值镜头跟随 | 不改 |
| src/settings.json | 已调好的亮度、曝光、镜头距离等参数 | 按谱面密度微调 |
| src/score-data.json | **换曲产物**：标题、SVG尺寸、事件、坐标、时长、镜头路径 | 必须重建 |
| src/types.ts | 数据接口 | 通常不改 |
| src/compositions.tsx | Composition 注册，按时长算帧数 | 自动 |
| scripts/read-music.py | 解析 MXL 结构 + MIDI 事件（纯标准库） | 每次换曲运行 |
| scripts/engrave.mjs | Verovio 逐页导出带稳定 ID 的 SVG | 每次换曲运行 |
| scripts/compose-pages.mjs | 多页 SVG 拼接（剥嵌套 definition-scale，防坐标漂移） | 多页曲运行 |
| scripts/note-geometry.mjs | 无头浏览器提取符头坐标 | 每次换曲运行 |
| scripts/build-data.mjs | MIDI↔符头匹配 + 谱行归属 + 镜头路径 → score-data.json | 每次换曲运行 |
| scripts/vocal2score.py | 人声+伴奏双轨转谱（配合 vocal-pipeline.md） | 按需 |
| scripts/snap-grid.py | 转写 MIDI 节拍网格吸附（无曲谱兜底） | 按需 |
| scripts/generate-score.py | MIDI 直出双谱表 MusicXML（无曲谱兜底） | 按需 |
| scripts/add-rit.py | 向 MIDI 插入渐慢/变速 tempo 事件 | 按需 |
| scripts/gen-midi.mjs | Verovio 导出 MIDI（⚠️会展开反复/颤音，慎用，见 pitfalls.md 第 2 条） | 一般不用 |
| scripts/validate.mjs | 数据结构完整性检查 | 每次构建运行 |
| scripts/render.mjs | 渲染 + 按入场时长封装音轨 → output/music-score.mp4 | 渲染时运行 |
| public/score/ | 放两样产物：score.svg + piano.wav | 由流水线生成 |

## 使用流程

完整复现命令见 `../example-materials/README.md`（致爱丽丝示例可全程照抄）；规范与验收标准见技能的 `references/pipeline-guide.md`，**踩坑必读 `references/pitfalls.md`**。

```bash
npm install                # 依赖版本已锁定，所有 @remotion 包同版本，勿升级
# ... 跑流水线生成三样产物（score.svg / piano.wav / score-data.json）...
npm run typecheck && npm run validate
npm run render -- --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"
```

## 渲染命令

```bash
# 全曲 1080p（Chrome 优先，无 Chrome 用 Edge）
npm run render -- --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"

# 测试片段（低清静音，快速核对映射）
node node_modules/@remotion/cli/remotion-cli.js render src/index.ts MusicScoreVisualizer \
  output/test.mp4 --frames=0-300 --scale=0.5 --muted \
  --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"

# GPU 兼容问题加：--gl=angle（按操作系统诊断，不要盲目套用）
```

浏览器路径：Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`；Edge `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`。

## 效果原则（勿破坏）

- 主球落地后直接开始下一跳，轨迹线全片连续；禁止停顿后猛冲赶节奏。
- 和弦：全部符头亮环，副球分落其他符头；主球每拍连续，副球随音值结束淡出（属正常现象，非 bug）。
- 球带贴身小光晕；无纸面大面积彩光（点光源 distance≤3.5）。
- 真实 3D 近距镜头，手机缩到最小也能看清球与符头的关系。
- 每次换曲重建坐标、时间、镜头，禁止复用上一首 score-data。
- MIDI 是动画唯一时间源；录音必须单独验证同步，不能靠波形音量代替音符。

## 支持边界

视觉为钢琴双谱表（staff 1/2）+ 单张拼接 SVG 纸面（compose-pages.mjs 已支持多页拼接）。读取工具支持单一 piano part 的普通 MusicXML 的 MXL、PPQ 计时的 SMF 0/1。多 part、移调、特殊装饰音仍需 Agent 明确处理。不要把脚本「解析成功」误当成「已正确对齐」。

音频输入从音乐时间 0 开始、与 MIDI 已对齐，不预加开场静音（render.mjs 统一添加入场延迟）。模板不含钢琴音源，用 fluidsynth + .sf2 音源从对齐 MIDI 合成。

## 许可

项目代码以 **MIT 协议**开源（作者：辉哥，见技能根目录 LICENSE），可自由使用、修改、再分发。

第三方依赖遵循各自许可；Verovio 由 npm 安装，仅离线制谱使用。示例中的致爱丽丝曲谱与 MIDI 为公有领域素材；原始录音、付费下载曲谱和音源不因使用本代码而获得再分发授权。
