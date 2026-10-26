// 交付前自动验收：每个渲染产物必须全部 PASS 才能交付。
// 用法: node scripts/acceptance.mjs <video.mp4> [--expect-duration=秒]
// 检查项：编码格式 / 时长 / 音轨 / 解码完整性 / 逐帧黑屏检测 / 亮度分布 / 音量
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';

const video = process.argv[2];
if (!video || !fs.existsSync(video)) { console.error('FAIL: 文件不存在', video); process.exit(1); }
const args = process.argv.slice(3);
const expectDur = Number((args.find(a => a.startsWith('--expect-duration=')) || '').split('=')[1]) || null;

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, {encoding: 'utf8'});
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' | ' + detail : ''}`);
  if (!ok) failures++;
};

// 1. 容器与编码
const probe = run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries',
  'stream=codec_name,pix_fmt,width,height,avg_frame_rate,color_range,color_space,color_primaries,color_transfer', '-show_entries', 'format=duration',
  '-of', 'json', video]);
const meta = JSON.parse(probe.stdout);
const v = meta.streams[0];
check('视频编码 h264', v.codec_name === 'h264');
check('像素格式 yuv420p（播放兼容）', v.pix_fmt === 'yuv420p', `实际 ${v.pix_fmt}`);
// 色彩交付不变量：全范围(yuvj/pc)会让部分播放器发灰；1080p 必须是 BT.709 矩阵
check('色彩范围有限 tv（非 pc 全范围）', v.color_range === 'tv', `实际 ${v.color_range || '未标注'}`);
check('色彩矩阵 BT.709（1080p 标准）', v.color_space === 'bt709', `实际 ${v.color_space || '未标注'}`);
if (v.color_primaries !== 'bt709' || v.color_transfer !== 'bt709') {
  console.log(`WARN: 原色/传递特性未标注 bt709 (primaries=${v.color_primaries || 'unknown'}, trc=${v.color_transfer || 'unknown'}) — 播放器一般按 HD 默认 bt709 处理`);
}
check('分辨率 1920x1080', v.width === 1920 && v.height === 1080, `${v.width}x${v.height}`);
const dur = Number(meta.format.duration);
check('时长合理', dur > 1, `${dur.toFixed(2)}s`);
if (expectDur) check(`时长匹配预期 ${expectDur}s`, Math.abs(dur - expectDur) < 0.6, `实际 ${dur.toFixed(2)}s`);

// 1.5 几何一致性（2026-10-24《月光》事故专项）：谱面重拼后没重建 geometry/score-data，
// 球会整体落在空白处——而"激活坐标 vs geometry"是自我比对永远为 0，必须用当前 SVG 重算再比。
{
  const svgPath = 'public/score/score.svg';
  const geoPath = 'output/geometry.json';
  if (!fs.existsSync(svgPath)) {
    check('几何一致性（需谱面与几何数据）', false, 'public/score/score.svg 缺失');
  } else if (!fs.existsSync(geoPath)) {
    check('几何一致性（需谱面与几何数据）', false, 'output/geometry.json 缺失');
  } else {
    const svgT = fs.statSync(svgPath).mtimeMs;
    const geoT = fs.statSync(geoPath).mtimeMs;
    check('几何数据不早于谱面（时效）', geoT >= svgT - 1000,
      `svg ${new Date(svgT).toISOString().slice(5, 16)} / geo ${new Date(geoT).toISOString().slice(5, 16)}`);

    run('node', ['scripts/note-geometry.mjs', svgPath, 'output/geo-verify.json']);
    if (!fs.existsSync('output/geo-verify.json')) {
      check('符头坐标与当前谱面一致（最大漂移 ≤2）', false, '重算几何失败');
    } else {
      const oldG = JSON.parse(fs.readFileSync(geoPath, 'utf8')).notes;
      const newG = JSON.parse(fs.readFileSync('output/geo-verify.json', 'utf8')).notes;
      const ids = Object.keys(oldG).filter((k) => newG[k]);
      const drift = ids.map((k) => Math.hypot(oldG[k].x - newG[k].x, oldG[k].y - newG[k].y)).sort((a, b) => a - b);
      const maxD = drift.length ? drift[drift.length - 1] : 0;
      const medD = drift.length ? drift[Math.floor(drift.length / 2)] : 0;
      check('符头坐标与当前谱面一致（最大漂移 ≤2）', drift.length > 0 && maxD <= 2,
        `共有 ${drift.length} 符头，中位 ${medD.toFixed(1)}，最大 ${maxD.toFixed(1)}`);
      fs.rmSync('output/geo-verify.json', {force: true});
    }
  }
}

// 2. 音轨
const aprobe = run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries',
  'stream=codec_name', '-of', 'json', video]);
const aStreams = JSON.parse(aprobe.stdout).streams || [];
check('音轨存在 (aac)', aStreams.length > 0 && aStreams[0].codec_name === 'aac');

// 3. 完整解码（零错误）
const decode = run('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-']);
check('完整解码零错误', decode.stderr.trim() === '', decode.stderr.split('\n')[0] || '');

// 4. 音量非静音
const vol = run('ffmpeg', ['-i', video, '-af', 'volumedetect', '-f', 'null', '-']);
const maxVol = Number((vol.stderr.match(/max_volume: (-?[\d.]+) dB/) || [0, -99])[1]);
check('音轨非静音 (max > -40dB)', maxVol > -40, `max ${maxVol} dB`);

// 5. 逐帧采样：黑屏检测 + 亮度分布（12 帧）
const dur2 = dur;
const shots = [];
for (let i = 0; i < 12; i++) shots.push(Math.round(((i + 0.5) / 12) * dur2 * 30));
fs.mkdirSync('output/acceptance', {recursive: true});
const tmpFrames = [];
shots.forEach((f, i) => {
  const out = `output/acceptance/f${i}.png`;
  run('ffmpeg', ['-y', '-v', 'error', '-ss', String(f / 30), '-i', video, '-frames:v', '1', out]);
  tmpFrames.push(out);
});
let blackFrames = [];
tmpFrames.forEach((f, i) => {
  const probe2 = run('node', ['-e', `
    const {execSync} = require('child_process');
    // 用 ffmpeg 统计亮度，避免依赖 PIL
  `]);
  const lum = run('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const buf = lum.stdout;
  if (!buf.length) { blackFrames.push(shots[i]); return; }
  let sum = 0;
  for (const b of buf) sum += b;
  const mean = sum / buf.length;
  if (mean < 6) blackFrames.push(shots[i]);
  shots[i] = {frame: shots[i], mean: Number(mean.toFixed(1))};
});
check('无全黑帧（12 帧采样，均值 <6 判黑）', blackFrames.length === 0,
  blackFrames.length ? '黑帧位置(秒): ' + blackFrames.map(t => (t / 30).toFixed(1)).join(', ') : '全部正常');

// 5.4 布局不变量：谱面空白带均匀性（页边界不得明显宽于页内行距）
{
  const {openBrowser} = await import('@remotion/renderer');
  const svg = fs.readFileSync('public/score/score.svg', 'utf8');
  const browser = await openBrowser('chrome', {browserExecutable: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage({context: undefined, logLevel: 'error', indent: false, pageIndex: 0, onBrowserLog: () => {}});
    const bands = await page.evaluate(async (s) => {
      const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
      const vb = doc.documentElement.getAttribute('viewBox').split(' ').map(Number);
      doc.documentElement.setAttribute('width', '1120');
      doc.documentElement.setAttribute('height', String(vb[3]));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc.documentElement)], {type: 'image/svg+xml'}));
      const img = new Image();
      await new Promise((ok) => { img.onload = ok; img.src = url; });
      const c = document.createElement('canvas');
      c.width = 1120; c.height = vb[3];
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1120, vb[3]);
      ctx.drawImage(img, 0, 0, 1120, vb[3]);
      const data = ctx.getImageData(0, 0, 1120, vb[3]).data;
      const out = []; let start = -1;
      for (let y = 0; y < vb[3]; y++) {
        let ink = 0;
        for (let x = 0; x < 1120; x += 2) { const i = (y * 1120 + x) * 4; if (data[i] > 150) ink++; }
        if (ink < 3) { if (start < 0) start = y; }
        else if (start >= 0) { if (y - start >= 25) out.push(y - start); start = -1; }
      }
      return out;
    }, svg);
    const sorted = [...bands].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const worst = Math.max(...bands, 0);
    check('谱面空白带均匀（最宽 ≤ 中位数×1.5）', bands.length === 0 || worst <= median * 1.5,
      '空白带: ' + bands.join(',') + ' | 中位 ' + median + ' 最宽 ' + worst);
  } finally { await browser.close({silent: true}); }
}

// 5.5 机位翻转检测（翻转泄漏事故的专项检查）：源码必须包含原始机位特征
const vis = fs.readFileSync('src/MusicScoreVisualizer.tsx', 'utf8');
check('机位朝向正确（无翻转泄漏）', vis.includes('aimZ + 13.85*distance') && !vis.includes('aimZ - 13.85*distance'));

// 6. 清理采样帧
tmpFrames.forEach((f) => fs.rmSync(f, {force: true}));
fs.rmSync('output/acceptance', {recursive: true, force: true});

console.log(failures === 0 ? '\n=== 验收全部通过，可交付 ===' : `\n=== ${failures} 项未通过，禁止交付 ===`);
process.exit(failures === 0 ? 0 : 1);
