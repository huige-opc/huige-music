# 无曲谱兜底方案：从音频生成曲谱（Audio → MIDI → MusicXML）

当目标曲目**找不到公开曲谱/MIDI**（登录墙、专有格式、冷门曲目）时，只要有一段较干净的音频
（最好是照谱面合成的试听音频，其次是清晰的单乐器演奏录音），可以走本方案自动生成曲谱。
已验证案例：《秋日私语》（弹琴吧试听 mp3 → 97 音符 20 秒片段，全部映射成功）。

## 前置条件

- Python 3.13（**3.14 不行**：onnxruntime/numpy 尚无适配轮子，会报编译错误）。
  推荐用 WorkBuddy 自带的 `~/.workbuddy/binaries/python/versions/3.13.12/python.exe`，
  先 `pip install --upgrade pip setuptools wheel` 再装依赖。
- 依赖：`pip install numpy onnxruntime librosa resampy pretty_midi mir_eval music21`，
  然后 `pip install basic-pitch --no-deps`（它的依赖解析会强制旧 numpy 导致编译失败，
  必须 no-deps 绕过）。
- basic-pitch 首次运行会从 GitHub 下载模型（约 170MB），需网络。

## 流程（scripts/ 内脚本已就绪）

```bash
PY313=<python 3.13 路径>

# 1. 音频转写 MIDI（支持 mp3/wav/m4a）
$PY313 -c "
from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import predict, Model
model = Model(ICASSP_2022_MODEL_PATH)
out, midi, ev = predict('audio.mp3')
midi.write('transcribed.mid')"

# 2. 裁剪时间窗 + 节拍网格吸附（start/end 为秒，bpm 按曲子实际速度）
$PY313 scripts/snap-grid.py transcribed.mid fixed.mid 0 30 72

# 3. 从 MIDI 直出 MusicXML（十六分网格、4/4、双谱表；第3参可传 bpm）
$PY313 scripts/generate-score.py fixed.mid score.musicxml 72

# 4. 打包 mxl（zip：META-INF/container.xml + score.xml），走标准流水线
python scripts/read-music.py score.mxl fixed.mid output/analysis
node scripts/engrave.mjs ...   # 之后与正常流程完全相同
```

选段技巧：**取音乐身份最强的段落**（旋律已进入的主歌/副歌），避开纯伴奏引子——
否则 20 秒里只有琶音铺底，和其它曲子片段观感雷同。

BPM 估计：数一段连续等间距音符（如分解和弦的八分音符）的秒间隔 t，
`bpm = 30 / t`（八分）或 `60 / t`（四分）。snap-grid 的偏移搜索会吸收 ±100ms 级的误差。

## 本方案特有的坑（全部踩过）

1. **Python 版本**：3.14 装 basic-pitch 必败（numpy/onnxruntime 无轮子）。用 3.13。
2. **依赖安装顺序**：先装 numpy/onnxruntime/librosa/pretty_midi/mir_eval/music21，
   最后 `--no-deps` 装 basic-pitch；直接装会触发 numpy 源码编译失败。
3. **basic-pitch 没有 CLI 入口**（`python -m basic_pitch.cli` 不存在），用 inference API。
4. **音符时值含延音**：转写出的 MIDI 音符时值是「带踏板的发声时长」，相邻音符严重重叠。
   直接序列化会把后续音符顶到错误节拍。必须：同一谱表内每个音符截断到下一音符起点
   （generate-score.py 已内置），或者用 snap-grid 后的干净网格。
5. **节拍网格错位**：转写 MIDI 的 tempo 是 basic-pitch 写的 120bpm 恒定值，与曲子实际
   速度不符，直接量化会让全谱节拍错乱（曾出现音符时值 ×2、整体平移 2 拍）。
   必须先做网格吸附（snap-grid.py 的偏移搜索），吸附后平均误差 <50ms 即可用。
6. **MusicXML 的 backup 语义**：单 part 双谱表时，第二谱表内容前必须 `<backup>` 回到
   小节开头；**第 1 小节也不例外**。漏发会让第 1 小节左手音符整体错位一小节
   （与第二小节内容重叠）；错放到每个声部前则会让第一声部节拍变负。
   曲谱生成后必须抽查解析出的节拍（前几拍的谱面 beat vs MIDI beat）。
7. **声部归属是按音高机械切分**（≥C4 → 上谱表），个别跨分界的音可能归错手；
   谱面没有指法/乐句标记，符杠是机械的——视觉干净但非出版级。
8. **转写准确率**：钢琴独奏约 95%+，偶发错音/漏音/八度偏差。作为演示视频可用；
   严谨发布建议人工校对或换有正版曲谱的曲子。
9. **中间产物要用新鲜的**：多轮调试时极易拿旧 mxl/旧分析文件跑流水线，
   症状诡异且浪费排查时间。每步生成后立即验证内容（dump 前几拍对比），再进下一步。

## 与标准流程的衔接

snap-grid + generate-score 的产物（score.mxl + fixed.mid）就是标准流水线的标准输入：
`read-music.py score.mxl fixed.mid output/analysis` 之后完全一致。
音频轨用 fluidsynth 从 fixed.mid 合成（不要用原始录音——转写时值有量化，两者不同步）。
