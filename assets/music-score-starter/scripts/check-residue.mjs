// 球/弧一致性检测（辉哥 2026-10-25 反馈："球都跳到下一个位置了，还有2条弧线"）
// 只用真实运动模型算，不依赖像素，三件事：
//   1) 落位：每个音弹下的瞬间，符头上必须有球（不留空白槽位）
//   2) 残留：音符结束 0.9s 后，符头上不能再有球（跑过的槽位不能还亮）
//   3) 同步：弧可见时球必须可见（弧不能脱离球活着）
// 用法：node scripts/check-residue.mjs [score-data.json]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const dataFile = process.argv[2] || 'src/score-data.json';
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const settings = JSON.parse(fs.readFileSync('src/settings.json', 'utf8'));

const tmp = path.join('output', '_perf.mjs');
fs.mkdirSync('output', {recursive: true});
execFileSync(
  process.execPath,
  ['node_modules/esbuild/bin/esbuild', 'src/performance.ts', '--bundle', '--format=esm', '--outfile=' + tmp],
  {stdio: 'pipe'},
);
const {buildSlots, performanceAt, SCORE_SCALE} = await import(pathToFileURL(path.resolve(tmp)).href);

const fps = settings.fps || 30;
const T0 = data.windowStart ?? 0; // 事件时间是绝对值，帧遍历必须从这里起算
const dur = data.musicDuration;
const attacks = data.events.filter((e) => e.kind === 'attack' && e.time <= dur);
const slots = [...buildSlots(attacks, 1), ...buildSlots(attacks, 2)];

const ballsAt = (t) => {
  const out = [];
  for (const slot of slots) {
    const m = performanceAt(slot, t);
    out.push({
      x: m.position[0],
      z: m.position[2],
      op: m.opacity,
      trail: m.trailOpacity,
      from: m.from.eventId,
      to: m.to.eventId,
    });
  }
  return out;
};
const near = (balls, x, y, r) => balls.some((b) => b.op > 0.08 && Math.hypot(b.x - x * SCORE_SCALE, b.z - y * SCORE_SCALE) < r);

// 1) 落位：球是“经过”符头的（flight 覆盖整个间隔），onset 前后 0.08s 内任一刻到位即算落位
const missed = [];
for (const n of attacks) {
  let hit = false;
  for (let dt = -0.02; dt <= 0.08 && !hit; dt += 1 / 120) {
    if (near(ballsAt(n.time + dt), n.x, n.y, 0.3)) hit = true;
  }
  if (!hit) missed.push(n);
}
// 2) 残留：只查之后 1s 内没有新音落在同一位置的符头，避免重复音误判
const stuck = [];
for (const n of attacks) {
  const t = n.time + Math.max(n.duration, 0) + 0.9;
  if (t > dur) continue;
  const later = attacks.some((m) => m !== n && Math.abs(m.x - n.x) < 3 && Math.abs(m.y - n.y) < 3 && m.time > n.time && m.time <= t + 1);
  if (later) continue;
  if (near(ballsAt(t), n.x, n.y, 0.25)) stuck.push({n, t});
}
// 3) 同步
let trailFrames = 0;
let desync = 0;
for (let f = 0; f < Math.ceil((data.musicDuration - T0) * fps); f++) {
  for (const b of ballsAt(T0 + f / fps)) {
    if (b.trail > 0.05) {
      trailFrames++;
      if (b.op < 0.05) desync++;
    }
  }
}

// 4) 一致性：每个音符"球停在其符头上且还明显亮着"的时长应该基本一样，
//    否则同一个符头会有的立刻黑、有的还亮着（辉哥 2026-10-25 反馈）
// 只统计"该音符自己的球"，否则和弦里相邻音的球会被误算进来
const slotOf = new Map();
for (const slot of slots) for (const tg of slot) if (!slotOf.has(tg.eventId)) slotOf.set(tg.eventId, slot);
const lit = [];
for (const n of attacks) {
  const slot = slotOf.get(n.eventId);
  let sec = 0;
  const step = 1 / 120;
  for (let dt = 0; dt <= 2.4; dt += step) {
    const t = n.time + dt;
    if (t > dur) break;
    const m = performanceAt(slot, t);
    if (m.opacity > 0.3 && Math.hypot(m.position[0] - n.x * SCORE_SCALE, m.position[2] - n.y * SCORE_SCALE) < 0.25) sec += step;
  }
  lit.push({id: n.eventId, sec: +sec.toFixed(2)});
}
const secs = lit.map((l) => l.sec).sort((a, b) => a - b);
const med = secs[Math.floor(secs.length / 2)];

// 4b) 真正要灭的：球离开符头之后，这个符头还亮多久（辉哥说的"球走了槽位还亮"）
const leftover = [];
for (const n of attacks) {
  const slot = slotOf.get(n.eventId);
  let tLeave = null;
  const step = 1 / 120;
  for (let dt = 0; dt <= 2.4; dt += step) {
    const t = n.time + dt;
    if (t > dur) break;
    const m = performanceAt(slot, t);
    if (Math.hypot(m.position[0] - n.x * SCORE_SCALE, m.position[2] - n.y * SCORE_SCALE) > 0.3) {
      tLeave = t;
      break;
    }
  }
  if (tLeave === null) continue;
  // 重复音不算残留：同一坐标上还有别的音符要弹时，球提前进场，符头本来就该亮
  const repeats = attacks.filter(
    (m) => m !== n && Math.abs(m.x - n.x) < 8 && Math.abs(m.y - n.y) < 8,
  );
  let sec = 0;
  for (let dt = 0; dt <= 1.2; dt += step) {
    const t = tLeave + dt;
    if (t > dur) break;
    if (repeats.some((m) => t >= m.time - 0.5 && t <= m.time + 0.5)) continue;
    if (ballsAt(t).some((q) => q.op > 0.3 && Math.hypot(q.x - n.x * SCORE_SCALE, q.z - n.y * SCORE_SCALE) < 0.25)) sec += step;
  }
  if (sec > 0.05) leftover.push({id: n.eventId, sec: +sec.toFixed(2)});
}

const ok = (c) => (c ? 'PASS' : 'FAIL');
console.log(`${ok(!missed.length)}: 落位（弹奏瞬间符头上必须有球） | 漏 ${missed.length} 个${missed.length ? ' 例: ' + missed.slice(0, 5).map((n) => n.eventId).join(',') : ''}`);
console.log(`${ok(!stuck.length)}: 无残留球（音尾+0.9s 符头上不能还有球） | 残留 ${stuck.length} 处${stuck.length ? ' 例: ' + stuck.slice(0, 5).map((s) => `${s.n.eventId}@${s.t.toFixed(2)}s`).join(',') : ''}`);
console.log(`${ok(!desync)}: 弧球同步（弧可见时球必须可见） | 采样 ${trailFrames} 个「帧×轨迹」，脱节 ${desync}`);
console.log(`INFO: 落地闪光时长（随节奏变化，不作判定） | 中位 ${med}s 最短 ${secs[0]}s 最长 ${secs[secs.length - 1]}s`);

// 5) 多弧：和弦落地瞬间，几个槽位有球就画几条弧（2 音 2 条、3 音 3 条）
// 和弦判定与 buildSlots 一致：同声部、同 x（同柱）、时间差 ≤80ms、音高不同。
// 只按 time.toFixed(3) 分组会漏掉转写出的 20~80ms 抖动，误判为"单音只画一条弧"。
const CHORD_TIME = 0.08;
const CHORD_X = 2;
const grp = [];
for (const a of [...attacks].sort((x, y) => x.time - y.time || x.pitch - y.pitch)) {
  const g = grp[grp.length - 1];
  if (
    g &&
    g[0].staff === a.staff &&
    Math.abs(g[0].x - a.x) <= CHORD_X &&
    Math.abs(g[0].time - a.time) <= CHORD_TIME &&
    g.every((x) => x.pitch !== a.pitch)
  ) g.push(a);
  else grp.push([a]);
}
const shortArcs = [];
for (const g of grp) {
  if (g.length < 2) continue;
  let got = 0;
  for (const x of g) {
    const b = ballsAt(x.time + 0.02);
    if (near(b, x.x, x.y, 0.25)) got++;
  }
  if (got !== g.length) shortArcs.push({t: +g[0].time.toFixed(2), want: g.length, got});
}
console.log(
  `${ok(!shortArcs.length)}: 和弦多弧（几槽位几条弧） | ${shortArcs.length} 个和弦弧数不足` +
    (shortArcs.length ? `: ${shortArcs.slice(0, 8).map((s) => `t=${s.t}s ${s.want}音只画${s.got}条`).join('; ')}` : ''),
);

// 7) 弧起点必须是真实符头：弧只能"从上一个槽位引到下一个槽位"，
//    从空白处（虚构偏移点）长出来的那截就是辉哥说的"尾巴"。
let fakeOrigin = 0;
const fakeSamples = [];
for (let f = 0; f < Math.ceil((data.musicDuration - T0) * fps); f++) {
  const t = T0 + f / fps;
  for (const slot of slots) {
    const m = performanceAt(slot, t);
    if (m.trailOpacity * m.opacity < 0.05) continue;
    if (m.from.system !== m.to.system) continue;
    if (Math.abs(m.from.x - m.to.x) + Math.abs(m.from.y - m.to.y) < 3) continue;
    const onNote = attacks.some((a) => Math.abs(a.x - m.from.x) < 3 && Math.abs(a.y - m.from.y) < 3);
    if (!onNote) {
      fakeOrigin++;
      if (fakeSamples.length < 5) fakeSamples.push(`${m.from.eventId}@${t.toFixed(2)}s`);
    }
  }
}
console.log(
  `${ok(!fakeOrigin)}: 弧起点都在真实符头上（无尾巴） | 虚构起点 ${fakeOrigin} 处${fakeOrigin ? ': ' + fakeSamples.join(' ') : ''}`,
);

// 6) 弧长收敛：横穿画面的长弧是"乱"的主因
const MAX_SPAN = 400;
let maxSpan = 0;
let spanSamples = 0;
for (let f = 0; f < Math.ceil((data.musicDuration - T0) * fps); f++) {
  const t = T0 + f / fps;
  for (const slot of slots) {
    const m = performanceAt(slot, t);
    if (m.trailOpacity * m.opacity < 0.05) continue;
    if (m.from.system !== m.to.system) continue;
    const d = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
    const nearFade = Math.max(0, 1 - d / MAX_SPAN);
    if (nearFade <= 0.02) continue;
    spanSamples++;
    maxSpan = Math.max(maxSpan, d);
  }
}
console.log(`${ok(maxSpan <= MAX_SPAN)}: 弧长收敛（不横穿画面） | 可见弧 ${spanSamples} 个样本，最长 ${maxSpan.toFixed(0)} 纸面单位（上限 ${MAX_SPAN}）`);
console.log(
  `${ok(!leftover.length)}: 球离开后符头不再亮 | ${leftover.length} 处仍在亮` +
    (leftover.length ? `: ${leftover.slice(0, 8).map((l) => `${l.id}(${l.sec}s)`).join(' ')}` : ''),
);
// 8) 未来音符不得提前亮：t 早于「首个 target - 进场窗口」时球必须不可见
//    （此前 !landed 无条件兜底 0.55，导致片头右侧一排未来槽位常亮）
const INTRO = (settings.introFrames || 5) / fps;
let earlyLit = 0;
const earlySamples = [];
for (const slot of slots) {
  const first = slot[0];
  for (let f = 0; f < Math.ceil((data.musicDuration - T0) * fps); f++) {
    const t = T0 + f / fps;
    if (t >= first.time - INTRO - 1e-6) break;
    const m = performanceAt(slot, t);
    if (m.opacity > 0.05) {
      earlyLit++;
      if (earlySamples.length < 6) earlySamples.push(`${first.eventId}@${(t - T0).toFixed(2)}s`);
      break;
    }
  }
}
console.log(
  `${ok(!earlyLit)}: 未来音符不提前亮 | ${earlyLit} 个 slot 在音符到来前就亮着${earlyLit ? ': ' + earlySamples.join(' ') : ''}`,
);

if (missed.length || stuck.length || desync || leftover.length || shortArcs.length || maxSpan > MAX_SPAN) process.exitCode = 1;
fs.rmSync(tmp, {force: true});
fs.rmSync(path.join('output', '_perf2.mjs'), {force: true});
