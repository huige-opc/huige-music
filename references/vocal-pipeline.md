# 带人声演唱的音符跳动视频（人声+伴奏双轨流水线）

适用场景：流行歌曲成片，画面上方球跟**人声**旋律跳、下方球跟**伴奏**跳，
音轨用带人声的原曲。与 no-score-fallback.md（单音频转单声部谱）互补：
本方案用 Demucs 把原曲拆成"人声/伴奏"两条 stem，各自转谱面声部。
已验证案例：《岁月如笔写春秋》走心女版（247 秒，433+701 音符，全流程跑通）。

## 流水线总览

    原曲音频 (mp3/wav)
      ├─ Demucs htdemucs_ft --two-stems=vocals ─→ vocals.wav + no_vocals.wav
      │       （质量校验：人声轨RMS / 伴奏轨RMS > 0.1 才算真带人声，
      │         网易"花姐63秒版"实为伴奏片段，人声RMS仅0.012，靠这步拦下）
      ├─ vocals.wav ─ basic-pitch(onset .6/frame .4/amp .25/音域50-84/单声部) ─→ 人声音符
      ├─ no_vocals.wav ─ basic-pitch(onset .7/frame .5/amp .30/音域36-84/保留复调) ─→ 伴奏音符
      └─ scripts/vocal2score.py vocals.wav no_vocals.wav out/
              ├─ vocal.mid      60BPM（1拍=1秒，动画时间源=音频秒，天然同步）
              ├─ vocal-score.mxl 双谱表 MusicXML（真BPM量化、调号、延音线、和弦）
              └─ vocal-notes.json
      然后：read-music → engrave → compose-pages → note-geometry → build-data（自动识别 vocal）
          → verify-score-slots + verify-chord-arcs（槽位/重复/多弧检查）

    音轨：public/score/piano.wav = 原曲转 wav（含人声），音频时间0=MIDI时间0。

## 关键设计（踩坑换来的，勿改）

1. **双拍系解耦**：MIDI 用 60BPM 让拍位=真实秒（动画时间源）；
   谱面用真实 BPM（librosa 实测，如 112.3）+ 八分音符网格量化，刻出来才像正常乐谱。
   build-data 匹配必须在**秒域**：`scoreSecOfBeat = beat*60/SCORE_BPM`（SCORE_BPM 取自
   analysis.score.tempi），容差 0.15s。两套拍系绝不能直接比。
   **当前 build-data.mjs 已自动识别**：MIDI 只有 60BPM、谱面 tempo 非 60 → 自动走秒域，
   不需要另写脚本或手工分支。
2. **轨道-谱表严格绑定**：track1→staff1（人声）、track2→staff2（伴奏），
   四层匹配（主匹配/变体/装饰音/重复音）全部绑定，禁止跨声部（坑 #14）。
3. **量化单调**：格位沿真实时间非降序，防滑音顺序对调（坑 #15）。
4. **人声单声部化**：同刻重叠时保振幅大的音；伴奏保留复调（和弦），
   同格同音去重、同格不同音成 `<chord/>`。
5. **音域过滤**：人声 50-84（MIDI），杀贝斯泄漏（pitch 29）和八度误判（pitch 87 簇）。

## 歌曲源获取（网易接口实测可用）

    # 搜索（fee=8 免费可取；fee=0 全免费）
    curl "https://music.163.com/api/search/get?s=<歌名>&type=1&limit=20"
    # 取 320K 直链（无需登录）
    curl "https://music.163.com/api/song/enhance/player/url?id=<id>&ids=[<id>]&br=320000"
    # 备选：B站视频拆音频（view API 取 cid → playurl fnval=16 → dash audio baseUrl，
    # 下载需带 Referer: https://www.bilibili.com）
    # ⚠️ 网易部分条目是伴奏片段，下载后必须做人声轨能量校验（见上）。

## 验收清单（成片前）

- [ ] 人声/伴奏轨 RMS 比值 > 0.1（防伴奏假唱）
- [ ] 同谱行倒跳统计（按 staff 分组，x 回退>8px/1.5s 内）趋近 0
- [ ] `verify-score-slots.mjs`：槽位覆盖、同刻/重复符头、同柱和弦完整全部 PASS
- [ ] `verify-chord-arcs.mjs`：同柱和弦几槽位几条弧，0 不足
- [ ] 纹理高度 (viewBoxH+100)*4 ≤ 16384（坑 #11）
- [ ] 音画同步：抽 3 个起音（开头/中间/结尾）核对球落地 vs 人声起唱
- [ ] npm run validate PASS

## 环境依赖（vocal-midi-env）

Python 3.12 venv（3.13/3.14 会有 numpy/tensorflow 轮子问题，见 no-score-fallback.md）：
`pip install numpy demucs music21 pretty_midi onnxruntime librosa`
`pip install basic-pitch --no-deps`（绕开它锁死的 numpy~=1.23）+ 手动装
tensorflow-cpu、librosa、mir-eval、pretty-midi、resampy、scikit-learn、scipy、typing-extensions。
basic-pitch 模型加载报错时改用包内自带 `saved_models/icassp_2022/nmp.onnx`（onnxruntime 路线）。
