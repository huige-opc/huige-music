# huige-music 更新日志

## 2026-10-25（三画风改造：经典 / 赛博 / 水墨）

### 变更
- **风格收口为 3 个**：删除 `aurora`、`teaching` 两个对外预设；PRESETS 只留 classic / cyberpunk / ink。
  音高色温机制保留，经典与赛博都用。
- **经典复刻《岁月如笔写春秋-人声版》**：纸色仍 `#c4bfb8`，灯光回到 0.52/0.62/0.68 暗场；
  场景底 `#111015`、外围纸面受光、加径向暗角；符头环走旧版 `1.05+3.6×flash`；球芯改纯白。
  对应 `config.ts` 的 `darkStage/bg/vignette/ballArcs/whiteCore`
  与 `MusicScoreVisualizer.tsx` 的 `DARK_STAGE/SCENE_BG/VIGNETTE/BALL_ARCS/WHITE_CORE` 分支。
- **经典也改用音高色（辉哥 2026-10-25 定）**：`PRESETS.classic.aurora=true`，球/环/弧线都取当前音符的
  音高色，随旋律变色；弧线 `arcGain=1 / arcRadius=0.013`。纸色、灯光、暗角仍是参考片的值。
- **水墨也改用音高色**：`PRESETS.ink.aurora=true + ballArcs`，球/环/弧线取音高色；
  墨晕、纸色 `#cfc4ae`、灯光 0.74/0.80/0.80 全部不动（保持“不浓也不暗”）。
  样片 `projects/minuet/`（小步舞曲·水墨 10s）。
- **和弦多弧修正（辉哥 2026-10-25 反馈）**：`buildSlots` 的和弦判定改为
  「同声部 + 同 x + 时间差 ≤80ms + 音高不同」，不再只认时间完全相同。
  转写出的同柱双音有 20~80ms 抖动，旧逻辑拆成两次单音只画一根弧；现在 A 1 槽 → B 垂直 2 槽 = 2 根弧。
- **build-data 恢复人声双轨匹配**：MIDI 60BPM + 谱面真 BPM 时自动走秒域（`scoreSecOfBeat`）
  + track→staff 严格绑定（vocal-pipeline.md 第 1/2 条）；标准钢琴谱仍走原 beat 域。
- **新增 `scripts/verify-score-slots.mjs`**：渲染前检查槽位覆盖 / 同刻重复 / 同柱和弦完整，
  FAIL 不进入渲染。`projects/suiyue` 实测 57/57 槽位、12 个和弦全完整、0 同刻重复。
- **弧球同步**：`performanceAt` 的 `trailOpacity` 增加 `landed` 条件——球没落地前不提前显示弧。
  `check-residue.mjs` 的「弧球同步」由 1497 处脱节降为 0；suiyue 段 motion 检查全部 PASS。
- **禁止同一符头二次动作**：`build-data.mjs` 最后兜底不再复用已用符头（找不到未用符头就 unmatched），
  否则同一个槽位会在短时间内做两次动作（辉哥 2026-10-25：和弦下面槽位出现 2 次动作）。
  `verify-score-slots.mjs` 现在把「同刻重复」和「间隔>80ms 的重复使用」都判 FAIL。
  suiyue 段重建后：57/57 槽位、12/12 和弦、0 重复；13 个 MIDI 事件因谱面无对应符头/重复音不生成球。
- **新增 `scripts/verify-chord-arcs.mjs`**：用与 `buildSlots` 相同的 80ms/x 和弦判定，
  检查「几槽位几条弧」。suiyue 段 8 个和弦、弧数不足 0。
- **`check-residue.mjs` 同步规则**（辉哥 2026-10-25 明确授权，改后已撤回授权标记）：
  第 5 段多弧和弦分组从 `staff + time.toFixed(3)` 改为「同声部 + 同 x + ≤80ms + 音高不同」，
  并逐音检查落位。suiyue 段全部 PASS（落位 0 漏、弧球脱节 0、多弧 0 不足）。
- **新增 `projects/` 项目目录**：以后本机调试/样片项目都放技能目录 `projects/` 下，不污染 `assets` 模板。
  首批项目：`projects/qiuri/`（秋日私语·经典 10s）、`projects/fur-elise/`（致爱丽丝·赛博 10s）。
- **赛博颜色回正（参考片机制）**：弧线不再用固定青/橙，改为跟随球色（`BALL_ARCS + ARC_GAIN=1`）。
  赛博球色本身由 `pitchColor(pitch)` 实时计算，所以不同时间段/不同音符的球、环、弧线颜色都不同；
  光圈寿命回到 `RING_LIFE=1.8s`（离开槽位后暂留渐隐，形成多圈彩色拖尾）。
  追溯：`MusicScoreVisualizer.tsx pitchColor/staffColor/Ball/NoteRing` + `config.ts PRESETS.cyberpunk.aurora`；
  参考片源项目 `D:\workBuddy\2026-10-23-12-43-27\marriage\project`。

### 修复
- `render.mjs` 的 `--seg=16-26`（等号写法）此前被静默忽略，会渲整曲；现在空格与等号两种写法都识别。

### 验证（projects/qiuri 秋日私语 16-26s，1920×1080）
- 参考片纸面取色：左上 (59,55,57) / 中心 (85,81,81) / 底部 (63,59,60)
- 新经典成片：左上 (60,55,57) / 中心 (85,79,78) / 底部 (63,58,60)
- `acceptance.mjs` 15 项全 PASS（含 bt709/yuv420p/tv、几何漂移 0.0、无黑帧）。

### 未动
- 赛博与水墨的视觉、运动模型、验收闸门、色彩交付（bt709/yuv420p）全部保持不变。

## 2026-10-24（大版本：效果栈 + 交付体系）

### 新增
- **人声双轨流水线**：Demucs 拆分 → 双谱表（vocal-pipeline.md、vocal2score.py、watchdog.ps1）
- **风格预设系统**：classic / aurora / cyberpunk / ink / teaching，settings.json 一行切换
- **效果栈定稿**：音高→HSL 色温映射、Q弹形变（体积守恒）、力度涟漪（双环）、迸发粒子（空中爆裂）、待机轨道环、和弦分裂起飞、副球汇聚弧
- **暗色主题**：compose-pages `--dark` 墨色反转 + 舞台自发光纸色（深色纸必备）
- **自动验收**：acceptance.mjs 11 项不变量闸门（编码/时长/音轨/解码/黑帧/空白带均匀/机位翻转/纹理自适应）
- **渲染器**：`--gl=angle` 默认、浏览器自动探测（Edge 兜底）、`--seg` 分段渲染、自检排除自身 PID
- **纹理自适应**：TEX = min(4, 16384/(height+100))，长曲谱自动降采样防 GPU 超限

### 修复
- 读轴守卫：按声部追踪位置、从 geometry 查真实坐标（双声部 0 倒跳）
- 页边距清零 + GAP 34：页边界空白带 56-62 → 统一 26-44
- 暗色主题选择器补全 polygon/text（符梁、力度记号可见）
- 深色预设灯光提升（远处谱行可见）

### 交付五公理
1. 单一事实来源（每参数一处定义）
2. 每个加工参数配一条不变量检查
3. 闸门式交付（acceptance 全 PASS 才交付）
4. 交付物唯一性（单一最终文件名，旧版即删）
5. 实验隔离（实验改动不上主模板，合入前 diff 审查）

### 事故档案（供后人避坑）
- 旧数据渲染交付（修脚本没重建数据就渲染）
- 机位翻转实验泄漏进主模板 → 全项目镜像构图
- 页边距/GAP 导致页边界大缝（透视放大成"缺一大块谱"）
- 播放器路径缓存导致"改了没变化"（改唯一文件名破除）

## 2026-10-24 色彩交付修正（yuv420p / tv / bt709）

**问题**：逐帧渲染产出 RGB 全范围画面，Remotion 默认 colorSpace='default'，ffmpeg 按全范围推断 →
成片标成 yuvj420p/pc，矩阵为 BT.601(bt470bg)。播放器按 16–235 解释时画面发灰；1080p 用 601 矩阵则饱和色偏色。

**改动**
- `scripts/render.mjs`：渲染参数写死 `--color-space=bt709 --pixel-format=yuv420p`；音频 mux 时补
  `-colorspace/-color_primaries/-color_trc bt709 -color_range tv`（copy，不重编码）
- `scripts/acceptance.mjs`：新增「色彩范围 tv」「色彩矩阵 bt709」两项，未过即禁止交付
- `references/pipeline-guide.md` 新增第九章五节：色彩交付规则 + 历史成片补救命令（zscale 换矩阵换范围）
- 已用新链路重渲/转换全部成片，8 个产物统一 `yuv420p, tv, bt709, bt709, bt709`

**教训**：只改标记不转数据 = 色偏更严重；历史文件必须 zscale 变换矩阵与范围后再打标。

## 2026-10-24 五风格展示素材 + 三处视觉修正

为技能介绍片产出 5 段 10 秒素材（经典紫橙/秋日私语、极光幻彩/致爱丽丝、赛博朋克/梦中的婚礼、水墨古韵/小步舞曲、教学纯净/月光），过程中修掉三个问题：

1. **水墨模式未生效**：`Performer` 里球色硬编码 `staff === 1 ? violet : amber`，绕过 `staffColor`，导致 MONO/HDR 全部失效。改为统一走 `staffColor(60, staff)`。
2. **浅色纸落地环被刷成白色**：环亮度 `1.05 + 3.6×flash` 在亮纸上 HDR 截断成白，彩虹环看不出颜色。改为按纸色分支：浅色 `0.9 + 1.5×flash`，深色沿用高增益做霓虹。
3. **浅色预设过暗**：ambient 0.52 / exposure 0.68 让象牙纸渲成灰色。上调 classic/aurora 0.78/0.82、ink 0.74/0.80、teaching 0.84/0.88，纸面恢复象牙白。

**新增交付物**：桌面 `钢琴可视化-五风格素材/` 五段 1920×1080 / yuv420p / tv / bt709 / AAC 素材。

## 2026-10-24 《月光》符头错位（重大 BUG）+ 校验体系修正

**现象**：教学风格《月光》里球全部落在空白处，没在符头上弹。

**根因**：`clair-de-lune` 的 `score.svg` 在 10-24 20:15 重拼过（页边距清零 + GAP 34），但 `geometry.json`
仍是 10-23 15:33 的旧版，`score-data.json` 也是旧的。1720 个符头中 80% 偏移 >15 单位，中位 92、最大 230。

**为什么之前没抓到**：此前的"校验"是拿 `score-data` 的激活坐标去比 `geometry`——而这些坐标本来就是
构建时从 geometry 复制的，永远 0 偏差，属于自我比对。等于没查。

**修复**
- 重建 clair 的 geometry + score-data，偏移归零，成片重渲
- `note-geometry.mjs` 写入 `geometry.svgHash`
- `render.mjs` 渲染前做 sha1 守卫，谱面变了没重建 → 直接拒绝渲染并打印命令
- `acceptance.mjs` 新增两项硬闸：几何时效 + 用当前 SVG 重算逐个比对（最大漂移 ≤2）
- 其余 5 个项目全部重建校验：marriage/qiuri/minuet 漂移 0.0，fur-elise 0.6（亚像素），clair 重建后 0.0

**教训**：不变量必须用「独立重算」验证，不能用「同一来源的两份拷贝互相比」。

## 2026-10-24 水墨辉光 + 后段取窗

- 水墨球辉光：加色混合下深墨几乎不发光，`MONO` 分支改用暖纸色（#f3e6c8）柔光晕，半径 0.34→0.46、透明度 0.17→0.6；落点待机环同步改暖色
- `build-data.mjs` 新增第 8 参数「窗口起点秒」，可从全曲后段取快板（月光 184-194s，127 音/10s，原 1-11s 只有 49 音/20s）
- `musicDuration` 统一 +0.2s 余量，修掉「末帧 = durationInFrames」越界

### 修正：水墨球改为彩色墨 + 经典式发光（同日二次调整）
初版用暖奶油色柔光晕，观感发灰发土。改为传统彩色墨——花青 #46648f（右手）/ 赭石 #9a6a44（左手），
并直接沿用经典的发光逻辑：球色提亮 1.8×（落点 2.4×）做球核、同色光晕 0.26、白核高光 0.28。
同时把墨晕收敛到 0.45 透明度、尺寸 0.22→0.38、并按声部上色（花青/赭石），避免黑烟盖住发光的球。

### 五风格素材：05 由《月光》换成《贝多芬第五》
《月光》整曲前 20 秒只有 49 个音，快板段虽密但听感仍偏淡。改用贝五开场 Allegro con brio（10 秒 42 音，
短-短-短-长动机），教学风格下谱面清晰、气势足。同步发现 symphony5 的 geometry 陈旧（漂移中位 322 / 最大 552），
重建后归零；旧成片作废删除。

### 02 换成《致爱丽丝》开头主题
极光风格改用 0-10s 的 Poco moto 主题（E-D#-E 动机，55 音/10s），替换原来的中段 24.5-34.5s，熟悉度更高。
注意 fur-elise 的 score-data 现仅为 0-10s 窗口，全曲重渲需重新执行 build-data（analysis 位于 fur-elise/output/analysis）。
