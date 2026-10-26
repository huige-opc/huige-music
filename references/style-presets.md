# 风格预设系统（二次开发指南）

面向二次开发者：如何使用、修改、扩展渲染器的风格预设，以及如何为终端用户设计风格选择入口。
**只有三个画风：经典 / 赛博 / 水墨。**

## 架构位置

```
settings.json  ──"preset": "classic"──→  src/config.ts PRESETS 表  ──→  渲染器各组件
     （用户唯一可改字段）                    （风格 → 参数的映射表）          （读取导出常量）
```

- `settings.json` 的 `"preset"` 字段是**唯一入口**，值为 PRESETS 表的键名。
- `config.ts` 的 `PRESETS` 表把风格名解析为渲染参数并导出常量。
- 渲染器（`MusicScoreVisualizer.tsx` / `performance.ts`）只读 `config.ts` 的导出常量，
  不直接读 settings——保证风格切换不需要改渲染代码。

## 内置预设

| 键名 | 风格 | 组合 |
|---|---|---|
| `classic`（默认） | 经典暗场 | 暗场暖灰纸 + 音高色球/环/弧线（随旋律变色）+ elastic + 力度 + 涟漪 + 暗角；弧线 = 球色×1、管径 0.013，球芯纯白 |
| `cyberpunk` | 赛博朋克 | 音高霓虹（aurora）+ staccato + 深紫纸 `#191824` + 深紫底 `#221f30`；同一套音高色，弧线管径 0.017 |
| `ink` | 水墨古韵 | **墨色模式(mono)**：墨晕 + float + 暖墨纸 `#cfc4ae`；球/环/弧线取音高色，墨晕只做纸面 |

切换方式：改 `settings.json` 的 `"preset"` 值 → 直接重渲，无需改任何代码。

## PRESETS 字段说明

| 字段 | 类型 | 作用 |
|---|---|---|
| `aurora` | boolean | true = 音高→HSL 色温映射（低音暖红→高音冷蓝，球/环/弧线实时取色）；false = 退回紫橙双色。三种画风都开 |
| `jumpStyle` | string | 跳跃曲线：`elastic`（Q弹律动）/ `fluid`（优雅流光）/ `staccato`（敏捷顿音）/ `float`（浮空漫步） |
| `velocityResponse` | boolean | MIDI 力度驱动落地环亮度与半径 |
| `landingRipple` | boolean | 力度 ≥78 的重音落地触发第二道级联涟漪环 |
| `paper` | string | 谱面纸颜色（hex） |
| `mono` | boolean? | 水墨墨晕模式（墨点洇染；球/环/弧线颜色仍走 aurora 音高色） |
| `darkStage` | boolean? | 暗场：外围纸面改受光材质（纸边不会被照成全亮）、符头环走霓虹增益 |
| `bg` | string? | 三维场景底色 |
| `vignette` | boolean? | 叠加径向暗角（四周压暗、中心留亮） |
| `ballArcs` | boolean? | 弧线跟随球色（经典/赛博都是当前音高色×1），而不是另配固定色 |
| `arcGain` | number? | 弧线对球色的增益：classic / cyberpunk 都是 1；不填按 1 |
| `arcRadius` | number? | 弧线管径：classic 0.013 / cyberpunk 0.017；不填按 0.013 |
| `whiteCore` | boolean? | 球芯混向纯白（经典参考片），false 时混向暖米 `#e8d9bd` |

## 经典参考片复刻参数（勿随手调亮）

`classic` 的纸色/灯光/暗角/球芯是照 `D:\视频发布文件\岁月如笔写春秋-人声版.mp4` 对齐的，源项目
`D:\workBuddy\2026-10-23-12-49-38\suiyue-vocal`。

> 2026-10-25 辉哥定：**经典也改用当前音符的音高色**（球/环/弧线随旋律变色），不再固定紫橙。
> 下面表里“弧线”一行已按新规则更新；纸色/灯光/暗角仍是参考片的值。

| 项目 | 值 | 落地 |
|---|---|---|
| 纸色 | `#c4bfb8`，谱线保持黑墨（**不做**墨色反转） | `config.ts PRESETS.classic.paper` + `compose-pages.mjs DARK_PRESETS` 只含 cyberpunk |
| 灯光 | ambient 0.52 / directional 0.62 / exposure 0.68 | `config.ts PRESETS.classic` → `STYLE` |
| 场景底色 | `#111015` | `config.ts SCENE_BG` → `Scene` 的 `<color>` |
| 外围纸面 | `meshStandardMaterial` 受光（不是 meshBasic 全亮） | `MusicScoreVisualizer.tsx Scene` 的 `DARK_STAGE` 分支 |
| 暗角 | 径向渐变，中心 transparent 30% → 边缘 rgba(3,2,7,.5) | `MusicScoreVisualizer.tsx ReadyVisualizer` 的 `VIGNETTE` |
| 符头环增益 | `1.05 + 3.6 × flash`（旧版高增益） | `NoteRing` 的 `ringBoost`（`DARK_STAGE` 分支） |
| 弧线 | 当前音高色 × 1，管径 0.013 | `Ball` 的 `BALL_ARCS` 分支 + `ARC_GAIN/ARC_RADIUS` |
| 球芯 | 音高色 → 纯白 0.58 混色 | `Ball` 的 `WHITE_CORE` 分支 |

改这几个数之前先和辉哥确认——这是他从旧片里指定的"一样一样的效果"。

## 隐藏规则写死原则（用户不可修改）

以下规则**全部硬编码在代码里**，不开放给用户改。理由：用户改错 → 生成出问题 → 怪技能不行。

| 隐藏规则 | 写死位置 | 用户能否改 |
|---|---|---|
| 页边距清零（pageMarginTop/Bottom=0） | engrave.mjs | ✗ |
| 页间隙 GAP=34（对齐行内距） | compose-pages.mjs | ✗ |
| 深色纸自动墨色反转（仅 cyberpunk） | compose-pages.mjs `DARK_PRESETS` | ✗（无需传 --dark） |
| 灯光三参数（ambient/directional/exposure） | config.ts PRESETS 每预设写死 | ✗ |
| 经典暗场/暗角/球色弧线/白核 | config.ts + MusicScoreVisualizer.tsx | ✗ |
| 纹理尺寸上限 16384 自适应 | MusicScoreVisualizer.tsx | ✗ |
| 机位朝向（z 偏移 +13.85） | MusicScoreVisualizer.tsx | ✗（翻转检测会拦） |
| 读轴单声部单调守卫 | build-data.mjs | ✗ |
| **色彩交付 yuv420p + tv + bt709** | render.mjs 的 --color-space / --pixel-format | ✗（不接受手动覆盖） |
| 验收阈值（空白带≤中位×1.5、色彩范围、矩阵等） | acceptance.mjs | ✗ |

**用户可改的只有三样**：曲名、风格预设名（settings.preset）、取段时长。其余一律写死。

## 预设切换的机械流程（必守，缺一步就出事故）

> 实测事故：只改 settings 里的 preset 不清谱面 → 黑墨配深纸全隐形；只改 preset 不重渲 → 交付旧画面。

| 步骤 | 命令 | 说明 |
|---|---|---|
| 1. 改预设 | settings.json 的 preset 字段 | 唯一入口 |
| 2. 重拼谱面 | node scripts/compose-pages.mjs output/engraved public/score/score.svg | **必须重拼**：自动按 preset 决定墨色反不反转（从 cyberpunk 切走时必须重拼，否则谱线仍是反色） |
| 3. 重渲 | npm run render（默认全曲；分段用 --seg） | 数据无需重建（数据与风格无关） |
| 4. 过闸 | node scripts/acceptance.mjs 成片.mp4 --expect-duration=N | 全 PASS 才交付 |
| 5. 交付 | 唯一文件名（版本+时间），删旧版 | 防缓存/防混淆 |

| 预设 | 纸色模式 | compose 参数 |
|---|---|---|
| **classic（默认）** | 暗场暖灰纸（黑墨） | 不带 --dark |
| ink | 浅暖墨纸（黑墨） | 不带 --dark |
| cyberpunk | 深紫纸（墨色反转） | 自动 --dark |

## 新增一个预设（三步）

1. `src/config.ts` 的 `PRESETS` 表加一行（字段照填，可选字段不填取默认）。
2. 若需要新的跳跃曲线：在 `performance.ts` 的 `JUMP_PROFILES` 加档案——
   4 个参数：`amp`（空中拉伸幅度 0.1-0.35）、`bounce`（回弹弹性 0.3-1.3）、
   `impact`（落地压扁 0.1-0.5）、`freq`（回弹振荡频率 14-32）。
3. `settings.json` 的 `"preset"` 改成新键名，重渲验证。

## 用户风格入口（供集成者参考）

1. **默认即答案**：用户没提风格 → 一律 `classic`（经典暗场）出片。90% 的交互到此为止。
2. **关键词覆盖**：用户句子里的风格词映射预设——
   「水墨/古风」→ ink；「赛博/电音/霓虹」→ cyberpunk；「原版/经典/复古」→ classic。
   **只认这三个**，不再提供极光/教学等内部实验风格。
3. **出片后轻提示（全量披露）**：交付成片时附一句
   「本片为经典暗场风。想要 赛博朋克 / 水墨古韵 版本，回复风格名即可。」
   ——必须列全当前风格 + 另外两个可换项，用户才知道完整选择空间。

## 音高→颜色（三种画风“不同时间段颜色不同”的机制）

经典、赛博、水墨的球/环/弧线都不是固定色，而是**每个音符实时取音高色**：

```ts
// src/MusicScoreVisualizer.tsx
const pitchColor = (pitch, staff) => {
  const hue = 0.98 + ((Math.max(36, Math.min(88, pitch)) - 36) / 52) * 0.76;
  return new THREE.Color().setHSL(hue % 1, 0.82, staff === 1 ? 0.68 : 0.58);
};
const staffColor = (pitch, staff) => AURORA ? pitchColor(pitch, staff) : (staff === 1 ? violet : amber);
```

- `AURORA` 在 classic / cyberpunk / ink 三个预设里都打开。
- `Ball` 用当前音符 `curNote.pitch` 取色 → 球的芯/光晕/点光源跟着音高变。
- `NoteRing` 用 `note.pitch` 取色 → 每个落地环颜色不同，且 `RING_LIFE=1.8s` 暂留，形成多圈彩色拖尾。
- 弧线在 `BALL_ARCS` 下直接取 `color`（当前球色），所以弧线也会随旋律变色。
- 低音（36）→ 暖红，高音（88）→ 冷靛蓝；中间音是紫/青/绿。经典是暗场暖灰纸，赛博是深紫纸，
  水墨是暖墨纸 + 墨晕；三套纸色下的颜色机制相同。水墨的墨晕只做纸面洇染，不改变球/环/弧线取色。
  参考片 `03-赛博朋克-梦中的婚礼-10s.mp4` 用的就是这套
  （源项目 `D:\workBuddy\2026-10-23-12-43-27\marriage\project`）。

## 调参速查

| 想要 | 改哪里 |
|---|---|
| 经典整体更亮/更暗 | `PRESETS.classic` 的 ambient / directional / exposure（参考片值 0.52/0.62/0.68，动了就不再是参考片） |
| 暗角更重/更轻 | `ReadyVisualizer` 的 `VIGNETTE` 径向渐变三段 rgba |
| 经典/赛博弧线更亮/更暗 | `PRESETS.<预设>.arcGain`（现在都是 1）；管径看 `arcRadius`（经典 0.013 / 赛博 0.017） |
| 弧线/球随旋律变色 | `pitchColor` 的 hue 区间 `0.98 + x*0.76`；`aurora=true` 时球/环/弧线统一取当前音高色 |
| 符头环更亮/更暗 | `NoteRing` 的 `ringBoost`：浅色纸 0.9+1.5×flash，暗场/深纸 1.05+3.6×flash |
| 球跳得更 Q 弹/更顿挫 | `JUMP_PROFILES` 的 `bounce`↑ / `impact`↑ |
| 球跳得更飘逸 | `jumpStyle: float` 或 `amp`↓ |
| 落地涟漪更明显 | NoteRing 的 `ring2` opacity 与 `0.62` 扩散系数 |
| 强弱对比更夸张 | `velScale` 的 `/90` 改 `/70`（下限 0.55 相应调整） |
| 色温偏移（仅赛博） | `pitchColor` 的 hue 区间 `0.98 + x*0.76` |
| 换行运镜弧度 | build-data.mjs 蛇形段的 `+130`（横向探出）与 `+18`（纵向下沉） |
