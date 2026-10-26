// 和弦多弧检查（辉哥 2026-10-25：A 1 槽 → B 垂直 2 槽必须 2 根弧）
// 与 buildSlots 使用同一套和弦判定：同声部 + 同 x（≤2）+ 时间差 ≤80ms + 音高不同。
// 用法: node scripts/verify-chord-arcs.mjs [score-data.json]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const dataFile = process.argv[2] || 'src/score-data.json';
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const tmp = path.join('output', '_chord_perf.mjs');
fs.mkdirSync('output', {recursive: true});
execFileSync(
  process.execPath,
  ['node_modules/esbuild/bin/esbuild', 'src/performance.ts', '--bundle', '--format=esm', '--outfile=' + tmp],
  {stdio: 'pipe'},
);
const {buildSlots, performanceAt, SCORE_SCALE} = await import(pathToFileURL(path.resolve(tmp)).href);

const attacks = data.events.filter((e) => e.kind === 'attack');
const slots = [...buildSlots(attacks, 1), ...buildSlots(attacks, 2)];
const ballsAt = (t) => slots.map((s) => {
  const m = performanceAt(s, t);
  return {x: m.position[0], z: m.position[2], op: m.opacity, trail: m.trailOpacity};
});
const near = (balls, x, y, r) => balls.some(
  (b) => b.op > 0.08 && Math.hypot(b.x - x * SCORE_SCALE, b.z - y * SCORE_SCALE) < r,
);

const CHORD_TIME = 0.08;
const CHORD_X = 2;
const groups = [];
for (const a of [...attacks].sort((x, y) => x.time - y.time || x.pitch - y.pitch)) {
  const g = groups[groups.length - 1];
  if (
    g &&
    g[0].staff === a.staff &&
    Math.abs(g[0].x - a.x) <= CHORD_X &&
    Math.abs(g[0].time - a.time) <= CHORD_TIME &&
    g.every((x) => x.pitch !== a.pitch)
  ) g.push(a);
  else groups.push([a]);
}

const chords = groups.filter((g) => g.length > 1);
const short = [];
for (const g of chords) {
  let got = 0;
  for (const n of g) {
    if (near(ballsAt(n.time + 0.02), n.x, n.y, 0.3)) got++;
  }
  if (got !== g.length) {
    short.push({
      t: +g[0].time.toFixed(3),
      notes: g.map((n) => `${n.pitch}@${n.scoreId}`),
      want: g.length,
      got,
    });
  }
}

console.log(`${short.length ? 'FAIL' : 'PASS'}: 和弦多弧（几槽位几条弧） | ${chords.length} 个和弦，弧数不足 ${short.length}`);
if (short.length) console.log(JSON.stringify(short.slice(0, 8), null, 2));
fs.rmSync(tmp, {force: true});
if (short.length) process.exitCode = 1;
