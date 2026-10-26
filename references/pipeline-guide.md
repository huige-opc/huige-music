# 制作规范：映射、运动模型与验收

综合原效果包文档与业界多球运动模型规范，适配本项目（Remotion + React Three Fiber）实现。

## 一、数据职责划分（不可颠倒）

| 素材 | 职责 |
|---|---|
| MXL/MusicXML | 曲谱视觉与谱面结构（Verovio 渲染 SVG，禁止截图糊弄） |
| MIDI | 动画唯一时间源（音符触发顺序、时值、力度） |
| 音频 | 只做配音，必须先验证同步；不同步则用同一 MIDI 合成音轨替代 |

核心链路：`MIDI Note On → 曲谱音符 → 渲染符头坐标 → Three.js 世界坐标 → 驱动球/环/镜头`。

**偷懒实现一律禁止**：均匀铺点依次点亮、按音频音量乱跳、把谱面当背景图、2D 伪 3D、做成通用频谱。

## 二、解析与映射

### MusicXML/MXL 解析（read-music.py）
- MXL 先读 `META-INF/container.xml` 定位真实谱面文件，用 XML 解析器（不是正则）。
- 光标规则：和弦音共享前一个 onset；`backup`/`forward` 改变光标；线性递增的解析器必然错位声部。
- 保留稳定 ID（`m{小节}n{序号}`），制谱时传给 Verovio 使 SVG 符头携带同 ID。

### 符头几何（note-geometry.mjs）
- 视觉目标是**符头本身**，不是音符组的包围盒。
- 坐标用 `getScreenCTM().inverse()` 变换到根 viewBox 坐标系。
- 拼接多页时必须验证：同一 note id 拼接前后坐标一致（误差 <1）。

### MIDI ↔ 符头匹配（build-data.mjs）
按拍位置+音高为主键，声部一致性做代价项，逐级兜底（见 pitfalls.md 第 8 条）。验收指标：
- MIDI 事件数 = 已映射数（未匹配必须为 0 或逐条说明）；
- staff/voice 一致性；同音高重复音的顺序；
- 首段、中段、末段抽样核对落点。

## 三、运动模型（performance.ts）

- **连续跳跃**：相邻落点之间的完整时间做低弧跳跃，落地即起跳，禁止「停一会儿再猛冲」。同一坐标的重复音原地小跳，仍触发独立环。
- **混合多球**：每声部主球贯穿全曲（轨迹线连续）；和弦副球分落其他符头，连续和弦间用最小代价配对（permMatch 全排列，N≤4）保持槽位稳定；断链副球随音值结束淡出。
- **和弦判定（2026-10-25 辉哥定）**：同声部、同 x（同一柱）、时间差 ≤80ms、音高不同 → 视为一个和弦。
  转写出的同柱双音常有 20~80ms 抖动，只认「时间完全相同」会拆成两次单音、只画一根弧。
  规则：**A 音符 1 个槽位、B 音符垂直 2 个槽位 → 从 A 到 B 必须 2 根弧**（几槽位几条弧）。
- **入场**：首音前约 0.15s 低空渐显下落，首响恰落地；休止超过 0.65s 淡出。
- **环**：每个起音一个发光环，扩张后 1.8s 内淡出（球离开后暂留渐隐）；延音（tie）不产生新起音环。
- 副球淡出属正常现象（球=手已离键，环=音还在响），向用户说明避免误会为 bug。

## 四、镜头（build-data.mjs 的 camera 字段）

- 按时间严格递增的 `{time, x, y}` 关键帧（SVG 坐标），y 取上下谱表中点保证双手可见。
- 普通跟随：每 1.6s 一个关键帧；**换行**：行尾停 0.3s → 0.55s 对角斜扫到下行行首；**翻页**同机理加大 y 距离。
- Hermite 插值（camera.ts）自带加减速，扫掠不生硬。
- 换行无休止时也要保证主球飞行与镜头过渡衔接，不能丢拍。

## 五、时间与音频

- MIDI tempo map 换算秒（secOfBeat），渐慢/变速自动生效。
- 音频从对齐 MIDI 用 fluidsynth 合成（`-g 0.7` 防削波），天然与动画零漂移；如用真人录音，须以首/中/尾 onset 锚点验证：固定误差→整体偏移；渐增误差→tempo 漂移，禁止硬贴。
- 渐慢等表情标记：用 add-rit.py 写入 MIDI tempo 事件，动画音频同步跟随。
- 渲染器对音频统一加 introFrames 延迟（render.mjs 已处理），音轨本身不得预置静音。

## 六、验收清单（顺序执行，不可跳过数据审计）

1. **数据**：typecheck + validate 通过；映射数=事件数、未匹配=0（或逐条说明）；两次构建结果一致（确定性）。
2. **短预览**：先渲 10-20 秒低清（`--frames --scale=0.5 --muted`），抽帧核对：球落符头、和弦分球、镜头取景。
3. **全片抽帧**：换行点、翻页点、和弦密集段、结尾各抽 2-4 帧；黑屏/花屏/错位即回查数据。
4. **成片规格**：ffprobe 验证分辨率/帧率/时长/音轨；抽编码后帧而非仅预览。
5. **交付报告**：说明素材来源、映射方法与各级兜底计数、音频对齐决策、输出路径、重建命令。

## 七、换曲流程摘要

换曲 = 重建三样产物：`public/score/score.svg`（compose-pages）、`public/score/piano.wav`（fluidsynth）、`src/score-data.json`（build-data）。禁止复用旧曲数据或旧镜头路径；settings.json 视觉参数可沿用微调。

## 八、工程原则（fail-closed 与确定性）

综合业界规范提纯，与运动模型同等重要：

1. **Fail-closed**：谱面无法渲染、音符数异常、符头几何缺失、onset 无法可辩护地匹配时——构建报错优于「可见但错误」的成片。可见但错误的音符是最坏的失败模式。
2. **冻结数据产物**：渲染帧循环内禁止重新解析 MusicXML/MIDI，一切读 score-data.json。
3. **确定性时间**：动画必须由显式时间驱动（Remotion useCurrentFrame），禁止依赖墙钟时间或结果不确定的物理引擎。
4. **读轴审计**：从左到右的谱面，球/镜头的 x 方向大幅倒退 = 诊断失败（除非制谱明确回行）。加入运动审计项。
5. **4K 是二次导出**：先让 1080p 通过全部验收，再出 4K。像素比 clamp 到 4 以内，composition 尺寸不变，由导出预设决定输出分辨率；ffprobe 复核 + 密集段/和弦段/结尾抽帧。

## 九、交付前自动验收（acceptance.mjs，强制）

每次渲染产物必须通过 `node scripts/acceptance.mjs <成片.mp4>` 全部 PASS 才能交付：
编码 h264 / 像素格式 yuv420p / **色彩范围 tv** / **色彩矩阵 bt709** / 分辨率 / 时长匹配 / 音轨存在 /
完整解码零错误 / 音量非静音 / 12 帧采样无全黑帧 / 谱面空白带均匀 / **机位朝向检测（翻转泄漏专项）**。
未通过 = 禁止交付。机器拦截，不依赖人眼。

## 九点五、色彩交付：yuv420p + tv + bt709（2026-10-24 写死）

**病根**：逐帧渲染（Chrome canvas）产出的是 RGB 全范围画面；Remotion 的 `colorSpace` 默认是 `default`，
ffmpeg 于是按全范围推断，把成片标成 `yuvj420p / pc`，矩阵还停在 BT.601（`bt470bg`）。
- 全范围标记 + 播放器按 16–235 解释 → 画面发灰、黑不够黑
- 1080p 用 BT.601 矩阵 → 饱和色（紫/红/霓虹青）轻微偏色

**规则（已写进 render.mjs，不可由用户改）**：

```bash
node .../remotion-cli.js render src/index.ts MusicScoreVisualizer out.mp4 \
  --color-space=bt709 --pixel-format=yuv420p
```

渲染直出即为 `yuv420p / tv / bt709`；音频 mux 用 `-c:v copy` 并补
`-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`（纯元数据，不重编码）。

**历史成片补救**（源已丢失时）——必须是「换矩阵 + 换范围」，不能只改标记：

```bash
# 全范围 601 → 有限范围 709
ffmpeg -i in.mp4 -vf "zscale=rangein=full:range=limited:matrixin=470bg:matrix=709,format=yuv420p" \
  -c:v libx264 -crf 16 -preset medium -c:a copy out.mp4
# 有限范围 601 → 有限范围 709
ffmpeg -i in.mp4 -vf "zscale=rangein=limited:range=limited:matrixin=470bg:matrix=709,format=yuv420p" ...
# 补原色/传递特性标记（copy，无损）
ffmpeg -i out.mp4 -c copy -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 final.mp4
```

实测保真度：601 全范围 → 709 有限范围往返 + CRF16 一次编码，SSIM 0.994。
**只改标记不转数据 = 色偏更严重**（数据仍是 601，标记改成 709 等于双重错误）。

## 十、页边界空白带（2026-10-24 实测根治）

多页曲谱拼接时，Verovio 每页自带上下页边距，页边界处的空白带（页底边距+页间隙+下页顶边距）
可达正常行距的 2-3 倍，近距离透视放大后像「画面突然缺了一大块谱」。
**分辨率法则：engrave 时 pageMarginTop/Bottom 清零 + compose GAP = 34（对齐页内行距）**。只收 GAP 不收页边距仍会留下 1.5-2 倍的页边界缝（实测）。
验收方法（已固化进 acceptance.mjs）：光栅化拼接 SVG 逐行统计墨迹，空白带最宽不得超过中位数×1.5，否则禁止交付。

## 十一、重建链路不变量（2026-10-24《月光》事故，最重要的一条）

谱面 → 几何 → 映射是一条**必须同源**的链：

```
score.svg  ──note-geometry──▶  output/geometry.json  ──build-data──▶  src/score-data.json
   （拼接/重拼）                    （符头像素坐标）                    （激活时间↔符头 id）
```

**任何一步重做，后面全部作废。** 只重拼 score.svg 而不重建 geometry，球就会整体落在空白处——
《月光》就是这样错的：几何数据比谱面旧一天，1720 个符头里 80% 偏移 >15 单位，中位 92、最大 230。

**三道闸（已落地）**
1. `note-geometry.mjs` 把谱面内容 sha1 写进 `geometry.svgHash`
2. `render.mjs` 渲染前比对当前谱面 sha1，不一致直接退出并打印重建命令
3. `acceptance.mjs` 双重校验：时效（geometry 不早于 svg）+ 用当前 SVG 重算几何逐个比对，最大漂移 >2 即 FAIL

**重建命令**
```bash
node scripts/note-geometry.mjs public/score/score.svg output/geometry.json
node scripts/build-data.mjs output/analysis/music-analysis.json output/geometry.json   src/score-data.json <范围秒> "<标题>" "<副标题>" "<作曲>"
```

**验收陷阱（写给自己）**：拿「激活坐标 vs geometry」当校验是**自我比对**——激活坐标本来就是构建时从 geometry
复制过去的，永远 0 偏差，什么都证明不了。必须用**当前谱面重新算一遍**再比。

## 十二、从全曲后段取窗（快板片段）

`build-data.mjs` 第 8 个参数是**窗口起点（秒）**，不传则从 0 开始：

```bash
node scripts/build-data.mjs output/analysis/music-analysis.json output/geometry.json   src/score-data.json 10 "Clair de Lune" "《月光》" "Claude Debussy" 184
node scripts/render.mjs --seg 184-194
```

规则：
- `--seg` 用**绝对秒**（与谱面/音频同一时间轴），音频由 render.mjs 自动 `atrim=start=`
- `musicDuration = 窗口末 + 0.2s`，否则末帧等于 durationInFrames 会报 frame range 越界
- 挑窗方法：统计 MIDI events 的 10 秒滑窗密度，取最密且不跨页边界的位置
- 谱面是全曲的，取后段不需要重新刻谱；但 geometry 必须覆盖该段（本次已有 1720 符头）
