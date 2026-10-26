# 示例素材：贝多芬《致爱丽丝》WoO 59（公版）

| 文件 | 用途 |
|---|---|
| Fur_Elise.mxl | 曲谱（MusicXML 压缩包，来自 MuseTrainer 公版曲库，53 小节 / 904 实音） |
| fur_elise_rit.mid | 动画时间源 MIDI（Mutopia 版 + 结尾渐慢 66/60/48 BPM，与曲谱逐拍对齐） |
| score-data.example.json | 生成好的 score-data.json 成品（可直接覆盖 src/score-data.json 对照验证） |
| ../example-20s.mp4 | 用以上素材生成的 20 秒效果示例（0-20 秒，960×540） |

## 用这套素材复现效果

```bash
# 1. 复制 music-score-starter 到工作目录并安装依赖
cd music-score-starter && npm install

# 2. 素材就位
mkdir -p materials ../output/analysis ../output/engraved
cp ../example-materials/Fur_Elise.mxl ../example-materials/fur_elise_rit.mid materials/

# 3. 跑流水线
python scripts/read-music.py materials/Fur_Elise.mxl materials/fur_elise_rit.mid ../output/analysis
node scripts/engrave.mjs ../output/analysis/identified.musicxml ../output/engraved
node scripts/compose-pages.mjs ../output/engraved public/score/score.svg
node scripts/note-geometry.mjs public/score/score.svg ../output/geometry-all.json
node scripts/build-data.mjs ../output/analysis/music-analysis.json ../output/geometry-all.json src/score-data.json 130.79

# 4. 音轨（需 fluidsynth + 音源，下载见 references/pitfalls.md）
fluidsynth -ni -g 0.7 -F public/score/piano.wav <音源.sf2> materials/fur_elise_rit.mid

# 5. 校验并渲染（Chrome 优先，无 Chrome 用 Edge）
npm run typecheck && npm run validate
npm run render -- --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe"
# Edge: --browser-executable="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
```

预期结果：与 ../example-20s.mp4 开头 20 秒一致；全曲 130.97 秒 1080p，渲染约 7 分钟。
