import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
function run(command,args){
 const r=spawnSync(command,args,{stdio:'inherit'});
 if(r.error)throw r.error;
 if(r.status!==0)process.exit(r.status??1);
}
const data=JSON.parse(fs.readFileSync('src/score-data.json'));
const settings=JSON.parse(fs.readFileSync('src/settings.json'));
const fps=settings.fps, INTRO=settings.introFrames;
// 解析 --seg=START-END（音乐秒）：分段渲染模式。
// 规则：先和用户确认渲染范围再启动；同一段只需渲一次，成片前别重复渲。
const argv=[...process.argv.slice(2)];
// 同时接受 `--seg 16-26` 与 `--seg=16-26`（SKILL.md 写的是等号形式，旧解析只认空格）。
const segIdx=argv.findIndex((a) => a === '--seg' || a.startsWith('--seg='));
let seg=null;
if(segIdx>=0){
  const raw = argv[segIdx].includes('=') ? argv[segIdx].split('=')[1] : argv[segIdx+1];
  const [s,e]=String(raw).split('-').map(Number);
  if(!(e>s&&s>=0)) throw Error(`--seg invalid: ${raw}`);
  seg={s,e};
  argv.splice(segIdx, argv[segIdx].includes('=') ? 1 : 2);
}
fs.mkdirSync('output',{recursive:true});
// 生成侧守卫（2026-10-24 月光事故）：谱面内容变了但几何/映射没重建 → 球整体落在空白处。
// 用内容哈希判断，不用时间戳（重新 compose 同布局不应误报）。
{
  const crypto = await import('node:crypto');
  const svg = fs.readFileSync('public/score/score.svg');
  const structural = svg.toString().replace(/<style[\s\S]*?<\/style>/g, '');
  const hash = crypto.createHash('sha1').update(structural).digest('hex');
  const geoPath = 'output/geometry.json';
  if (!fs.existsSync(geoPath)) { console.error('✗ 缺少 output/geometry.json，先跑 note-geometry.mjs'); process.exit(1); }
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  if (geo.svgHash !== hash) {
    console.error('✗ 谱面已变化但几何数据未重建（球会落在空白处）。执行：');
    console.error('   node scripts/note-geometry.mjs public/score/score.svg output/geometry.json');
    console.error('   node scripts/build-data.mjs <analysis> output/geometry.json src/score-data.json <秒> <标题> <副标题> <作曲>');
    process.exit(1);
  }
}

// 残留渲染进程互锁检查（pitfalls #13）：发现即退出，让调用者先清理。
// ⚠️ 必须排除自身 PID（process.pid）——本进程命令行就含 'render.mjs'，
// 否则永远"发现 1 个残留"而拒绝启动（2026-10-24 实测踩坑）。
{
  const chk=spawnSync('powershell',['-NoProfile','-Command',
    `(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ProcessId -ne ${process.pid} -and $_.CommandLine -match 'remotion-cli|render.mjs'} | Measure-Object).Count`],{encoding:'utf8'});
  const n=parseInt((chk.stdout||'').trim());
  if(n>0){ console.error(`发现 ${n} 个残留渲染进程，先查杀再重试（pitfalls #13）：`);
    console.error("powershell \"Get-CimInstance Win32_Process -Filter \\\"Name='node.exe'\\\" | Where-Object {$_.CommandLine -match 'remotion-cli|render.mjs'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}\"");
    process.exit(1); }
}
// Invoke the installed CLI directly, without shell quoting differences on Windows.
// --gl=angle is MANDATORY: without it headless Chrome falls back to SwiftShader
// (pure-CPU WebGL) — 7x slower and prone to mid-render stalls, even on machines
// with only an iGPU. ANGLE routes WebGL through the integrated GPU via DirectX.
const silentOut = seg ? `output/silent-${seg.s}-${seg.e}.mp4` : 'output/silent.mp4';
const framesArg = seg ? ['--frames', String(Math.round(seg.s*fps+INTRO))+'-'+String(Math.round(seg.e*fps+INTRO))] : [];
// 浏览器解析（分享给他人也能跑，不写死路径）：
// 1) 命令行传了 --browser-executable → 尊重用户
// 2) 否则按常见安装位自动探测 Chrome/Edge（pitfalls #9：禁用 Headless Shell 下载）
// 3) 都找不到才降级让 Remotion 下载 Headless Shell，并明确警告
function findBrowser(){
  const locals = process.env.LOCALAPPDATA || '';
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    locals ? locals.replaceAll('\\\\','/') + '/Google/Chrome/Application/chrome.exe' : '',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}
const browserGiven = argv.some((a) => a === '--browser-executable');
const browser = browserGiven ? null : findBrowser();
const browserArg = browser ? ['--browser-executable', browser] : [];
if (!browser && !browserGiven) {
  console.warn('⚠️ 未找到本地 Chrome/Edge：将下载 Chrome Headless Shell（慢且不推荐）。建议安装 Chrome 后重试，或 --browser-executable 指定浏览器路径。');
}
// 色彩交付（写死，不靠后处理）：H.264 成片必须是 yuv420p + 有限范围 + BT.709。
// Remotion 默认 colorSpace='default'，ffmpeg 会把全范围 RGB 标成 yuvj420p(pc)，
// 部分播放器按 16-235 解释 → 发灰；且默认矩阵是 BT.601，1080p 应为 BT.709。
const colorArgs = [
  ...(argv.some((a) => a.startsWith('--color-space')) ? [] : ['--color-space=bt709']),
  ...(argv.some((a) => a.startsWith('--pixel-format')) ? [] : ['--pixel-format=yuv420p']),
];
run(process.execPath,['node_modules/@remotion/cli/remotion-cli.js','render','src/index.ts','MusicScoreVisualizer',silentOut,'--muted','--concurrency=2','--codec=h264','--crf=17','--gl=angle',...colorArgs,...browserArg,...framesArg,...argv]);
const rate=48000;
let ffargs;
if(seg){
  // 分段：音频切片对齐段起点（帧号已含 INTRO 偏移，段起点=seg.s 音乐秒）
  const dur=seg.e-seg.s;
  ffargs=['-y','-i',silentOut,'-i','public/'+data.audioPath,
   '-filter_complex',`[1:a]aresample=${rate},atrim=start=${seg.s},asetpts=PTS-STARTPTS[a]`,
   '-map','0:v:0','-map','[a]','-t',String(dur),'-c:v','copy','-c:a','aac','-b:a','256k',
   '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-movflags','+faststart',
   seg.output || `output/seg-${seg.s}-${seg.e}.mp4`];
}else{
  // 全曲：音频延迟 INTRO 帧入场
  const delay=Math.round(INTRO/fps*rate),duration=(Math.ceil(data.musicDuration*fps)+INTRO)/fps;
  ffargs=['-y','-i',silentOut,'-i','public/'+data.audioPath,
   '-filter_complex',`[1:a]aresample=${rate},adelay=${delay}S:all=1,apad[a]`,
   '-map','0:v:0','-map','[a]','-t',String(duration),'-c:v','copy','-c:a','aac','-b:a','256k',
   '-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-movflags','+faststart',
   'output/music-score.mp4'];
}
run('ffmpeg',ffargs);
console.log(seg ? `Final: output/seg-${seg.s}-${seg.e}.mp4 (${seg.s}-${seg.e}s 带人声).`
                : 'Final: output/music-score.mp4. Verify audio offset and clipping before sharing.');
