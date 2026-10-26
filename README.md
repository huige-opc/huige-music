# huige-music — 3D 曲谱音符跳动动画技能

> 作者：辉哥 · 开源协议：MIT

**3D music animation from real sheet music** — glowing balls hop across an engraved score while the camera glides along the page, rendered with Remotion + React Three Fiber + Verovio.

「发光小球在真实曲谱上跳跃演奏、镜头沿谱面滑行」的 3D 音乐动画视频制作技能。基于已验证的贝多芬《致爱丽丝》全曲项目（1080p / 131 秒 / 905 音符全匹配）沉淀而成。

## 技能能做什么

- 输入曲谱（MXL/MusicXML）+ MIDI（+可选音频），输出「球在谱上跳」的 1080p MP4
- 换曲、调整视觉（球、轨迹、镜头、亮度）、修复该类动画的映射问题
- 素材不全时帮你找公版曲谱/MIDI 下载源

## 目录结构

```
huige-music/
├── SKILL.md                        # 技能主文件：触发条件、快速开始、流水线、视觉规则
├── references/
│   ├── pipeline-guide.md           # 制作规范：映射、运动模型、镜头、时间音频、验收清单
│   └── pitfalls.md                 # 9 条实战踩坑（Verovio MIDI 反复展开、SVG 拼接漂移、
│                                   #   灯光超限黑屏、SMF 二进制陷阱等，动手前必读）
└── assets/
    ├── music-score-starter/        # 完整可运行项目模板（README 见其目录内）
    ├── example-20s.mp4             # 20 秒效果示例（含音轨，960×540）
    └── example-materials/          # 示例素材：MXL + MIDI + 成品 score-data.json + 复现命令
```

## 快速体验（3 分钟看到效果）

不用自己找素材：

```bash
# 1. 复制模板并安装依赖
cp -r assets/music-score-starter my-song && cd my-song && npm install

# 2. 用示例素材直接生成（素材在 example-materials/，命令见其 README.md）

# 3. 渲染预览
npm run render -- --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"
```

想换成自己的曲子：准备 MXL 曲谱 + 对应 MIDI，按 `SKILL.md` 的流水线跑一遍即可。

## 视觉风格（已定稿，改动需谨慎）

- 三种画风：经典（暗场暖灰乐谱 + 音高色球/环/弧线）/ 赛博朋克（深紫纸 + 同套音高霓虹）/ 水墨古韵（暖墨纸 + 墨晕 + 音高色球/环/弧线）
- 每个声部一颗主球贯穿全曲（发光轨迹连续），和弦自动分出副球各落一个符头
- 球带贴身小光晕；无纸面大面积彩光
- 镜头沿阅读方向平滑滑行，换行/翻页用「行尾停顿 + 斜扫」过渡
- 谱面标记的速度变化（如结尾渐慢）会体现在动画和音频里

## 环境要求

- Node.js 18+、npm、FFmpeg/FFprobe、Python 3（仅标准库脚本）
- Chrome 或 Edge（渲染用本地浏览器，禁止下载 Chrome Headless Shell）
- 可选：fluidsynth + 音源 .sf2（合成钢琴音轨用）

## 许可证

MIT

---

## 📮 联系

有任何问题或建议，欢迎联系：

- 微信：**HgAiAgent**（扫码添加，拉你进交流群）
- 邮箱：[szlihui801@gmail.com](mailto:szlihui801@gmail.com)
- 公众号：**辉哥AI**
- GitHub：[huige-opc](https://github.com/huige-opc)

如果这个项目对你有帮助，欢迎 star。
