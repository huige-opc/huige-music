// Build src/score-data.json from Verovio analysis + notehead geometry.
// Matching: MIDI event (beat,pitch) -> score note -> SVG notehead coordinate.
import fs from 'node:fs';

const [analysisPath, geometryPath, outPath, rangeArg, titleArg, subtitleArg, composerArg, startArg] = process.argv.slice(2);
const RANGE_SECONDS = rangeArg ? Number(rangeArg) : 10;
// 可选第 8 参数：窗口起点（秒）。用于取全曲中后段的快板，不传则从 0 开始。
const START_SECONDS = startArg ? Number(startArg) : 0;
const END_SECONDS = START_SECONDS + RANGE_SECONDS;
const TITLE = titleArg || 'Für Elise';
const SUBTITLE = subtitleArg || 'Bagatelle No. 25 · WoO 59';
const COMPOSER = composerArg || 'Ludwig van Beethoven';

const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
const geometry = JSON.parse(fs.readFileSync(geometryPath, 'utf8'));

// --- System assignment happens AFTER matching (see below): systems are
// derived from staff-1 notehead rows so both staves of one system share an index.

// --- Score pitched notes (with stable ids) ---
// 只保留当前 geometry 里真实存在的符头：分页/裁页渲染时，别把别的页的符头也拿来匹配。
const scoreNotes = analysis.score.notes.filter(
  (n) => !n.rest && n.pitch != null && geometry.notes[n.id],
);

// Beat -> seconds via the MIDI tempo map (handles rit./accel. correctly)
const PPQ = analysis.midi.ppq;
const tempoMap = analysis.midi.tempoMap; // [{tick, bpm, time}]
const secOfBeat = (beat) => {
  const tick = beat * PPQ;
  let total = 0;
  let lastTick = 0;
  let us = 500000;
  for (const t of tempoMap) {
    if (t.tick > tick) break;
    total += ((t.tick - lastTick) / PPQ) * (us / 1e6);
    lastTick = t.tick;
    us = Math.round(60_000_000 / t.bpm);
  }
  return total + ((tick - lastTick) / PPQ) * (us / 1e6);
};

// --- 人声双轨（vocal2score）识别 ---
// 人声方案里 MIDI 固定 60BPM（1 拍=1 秒，动画时间源），谱面用真实 BPM；
// 两套拍系不能直接比 beat，必须在秒域匹配（vocal-pipeline.md 第 1 条）。
// 判据：MIDI 只有 60BPM，而谱面 tempo 不是 60 → 走 vocal 分支。
const MIDI_BPM = analysis.midi.tempoMap.length === 1 ? analysis.midi.tempoMap[0].bpm : null;
const SCORE_BPM = analysis.score.tempi && analysis.score.tempi.length
  ? analysis.score.tempi[analysis.score.tempi.length - 1].bpm
  : MIDI_BPM;
const VOCAL = MIDI_BPM != null && Math.abs(MIDI_BPM - 60) < 0.1 && SCORE_BPM && Math.abs(SCORE_BPM - 60) > 1;
const scoreSecOfBeat = (beat) => beat * 60 / SCORE_BPM;
const expectedStaffOf = (ev) => (ev.track === 1 ? 1 : 2);
const staffOK = (n, ev) => !VOCAL || n.staff === expectedStaffOf(ev);
const timingDistance = (n, ev) => (VOCAL
  ? Math.abs(scoreSecOfBeat(n.beat) - ev.time)
  : Math.abs(n.beat - ev.beat));

// --- MIDI events within range ---
const midiEvents = analysis.midi.events
  .filter((e) => e.time >= START_SECONDS && e.time < END_SECONDS)
  .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

// --- Tie continuation noteheads (no MIDI onset of their own) ---
const tieNotes = scoreNotes.filter((n) => n.ties.includes('stop'));

// --- Match MIDI events to score notes by (pitch, beat) ---
const used = new Set();
const activations = [];
const unmatched = [];
let variantCount = 0;
let ornamentCount = 0;
// 读轴守卫：按声部分别追踪读轴位置——每个声部自己的 x 不得倒退。
// （不能看全局上一个激活：右手旋律与左手伴奏在时间上交错，跨行分支会放过一切）
const lastXByStaff = {1: null, 2: null};
const lastYByStaff = {1: null, 2: null};
const axisOK = (n) => {
  const pos = geometry.notes[n.id];
  if (!pos) return false;
  const prevX = lastXByStaff[n.staff];
  const prevY = lastYByStaff[n.staff];
  if (prevX == null) return true;
  if (Math.abs(pos.y - prevY) < 80) return pos.x >= prevX - 8;
  return true; // 该声部换行允许
};
for (const ev of midiEvents) {
  let best = null;
  let bestCost = Infinity;
  for (const n of scoreNotes) {
    if (used.has(n.id)) continue;
    if (n.pitch !== ev.pitch) continue;
    if (!staffOK(n, ev)) continue;
    const dB = timingDistance(n, ev);
    if (dB > (VOCAL ? 0.15 : 0.2)) continue;
    if (!VOCAL && !axisOK(n)) continue;
    const cost = VOCAL ? dB * 20 : dB * 10 + (n.staff === (ev.track === 1 ? 1 : 2) ? 0 : 0.5);
    if (cost < bestCost) { bestCost = cost; best = n; }
  }
  if (!best) {
    // Edition variant: same beat, pitch differs slightly (inner-voice notation).
    let variants = 0;
    for (const n of scoreNotes) {
      if (used.has(n.id)) continue;
      if (!staffOK(n, ev)) continue;
      if (timingDistance(n, ev) > 0.05) continue;
      if (Math.abs(n.pitch - ev.pitch) > 2) continue;
      if (!VOCAL && !axisOK(n)) continue;
      variants++;
      if (!best) best = n;
    }
    if (!best) {
      // Ornament expansion (trill/mordent): alternate pitch right after a matched
      // event on the same notehead. Reuse that notehead with a fresh eventId.
      const prev = activations.at(-1);
      if (
        prev &&
        (!VOCAL || prev.staff === expectedStaffOf(ev)) &&
        ev.time - prev.time < 0.3 &&
        Math.abs(ev.pitch - prev.pitch) <= 2
      ) {
        best = scoreNotes.find((n) => n.id === prev.scoreId);
      }
    }
    if (!best) {
      // Last resort: repeated inner voice — reuse the nearest same-pitch notehead.
      // 读轴守卫：同谱行内不允许匹配到身后符头（否则球往回跳）。
      // 最后兜底也只能找"还没被用过"的符头：复用已用符头会让同一个槽位
      // 在短时间内做两次动作（辉哥 2026-10-25：下面槽位出现 2 次动作）。
      // 找不到就给 unmatched，宁可不画，也不重复占用槽位。
      const cands = scoreNotes
        .filter((n) => !used.has(n.id) && n.pitch === ev.pitch && staffOK(n, ev) && (VOCAL || axisOK(n)))
        .sort((a, b) => timingDistance(a, ev) - timingDistance(b, ev));
      if (cands.length && timingDistance(cands[0], ev) <= (VOCAL ? 0.6 : 1)) {
        best = cands[0];
        ornamentCount++;
      }
    }
    if (!best) { unmatched.push(ev); continue; }
  }
  used.add(best.id);
  lastXByStaff[best.staff] = geometry.notes[best.id].x;
  lastYByStaff[best.staff] = geometry.notes[best.id].y;
  const pos = geometry.notes[best.id];
  if (!pos) { unmatched.push(ev); continue; }
  activations.push({
    time: ev.time,
    x: pos.x,
    y: pos.y,
    staff: best.staff,
    pitch: ev.pitch,
    velocity: ev.velocity,
    duration: ev.duration,
    scoreId: best.id,
    kind: 'attack',
    system: 0, // assigned after matching
    eventId: `e${activations.length}`,
  });
}

// --- Tie continuations as sustain activations (skip if an attack already fires there) ---
let sustainCount = 0;
for (const n of tieNotes) {
  if (activations.some((a) => a.scoreId === n.id)) continue;
  const pos = geometry.notes[n.id];
  if (!pos) continue;
  const toSec = VOCAL ? scoreSecOfBeat : secOfBeat;
  const time = toSec(n.beat);
  if (time < START_SECONDS || time >= END_SECONDS) continue;
  activations.push({
    time,
    x: pos.x,
    y: pos.y,
    staff: n.staff,
    pitch: n.pitch,
    velocity: 40,
    duration: toSec(n.beat + (n.durationBeats || 0)) - time,
    scoreId: n.id,
    kind: 'sustain',
    system: 0, // assigned after matching
    eventId: `e${activations.length}`,
  });
  sustainCount++;
}

// --- System assignment: cluster staff-1 notehead y (one row per system) ---
const upperYs = activations.filter((a) => a.staff === 1).map((a) => a.y).sort((a, b) => a - b);
if (!upperYs.length) throw Error('no staff-1 activations; cannot derive systems');
const sysRows = [[upperYs[0]]];
for (const y of upperYs.slice(1)) {
  if (y - sysRows[sysRows.length - 1].at(-1) > 45) sysRows.push([]);
  sysRows[sysRows.length - 1].push(y);
}
const sysCenters = sysRows.map((r) => r.reduce((s, v) => s + v, 0) / r.length);
// Staff-2 notes sit BELOW their system's staff-1 row, roughly midway to the next
// system; assign by the closest staff-1 center at or above (y + margin).
const systemOf = (y) => {
  let sys = 0;
  for (let i = 0; i < sysCenters.length; i++) {
    if (sysCenters[i] <= y + 40) sys = i; else break;
  }
  return sys;
};
for (const a of activations) a.system = systemOf(a.y);
activations.sort((a, b) => a.time - b.time || a.staff - b.staff);
activations.forEach((a, i) => (a.eventId = `e${i}`));

// --- Camera path: follow the playing position; y = midpoint between hands.
// System changes get a "hold at line end -> fast diagonal sweep to next line" transition.
const SWEEP = 0.55;   // seconds for the line-change sweep
const HOLD = 0.3;     // seconds the camera rests at the end of a line
const keys = [];
const pushKey = (t, x, y) => {
  if (keys.length && t <= keys[keys.length - 1].time + 1e-4) return;
  keys.push({time: t, x, y});
};

// Group activations into system segments
const segments = [];
for (const a of activations) {
  const seg = segments[segments.length - 1];
  if (!seg || seg.system !== a.system) segments.push({system: a.system, notes: [a]});
  else seg.notes.push(a);
}

for (let s = 0; s < segments.length; s++) {
  const seg = segments[s];
  const next = segments[s + 1];
  const segEnd = next ? next.notes[0].time : END_SECONDS;
  const handsMid = (seg, t) => {
    const up = seg.notes.filter((n) => n.staff === 1 && n.time <= t).at(-1);
    const down = seg.notes.filter((n) => n.staff === 2 && n.time <= t).at(-1);
    if (up && down) return (up.y + down.y) / 2;
    const ref = up ?? down ?? seg.notes[0];
    return ref.y + (ref.staff === 1 ? 22 : -22);
  };
  // Normal following keys inside the segment
  for (let t = seg.notes[0].time; t < segEnd - HOLD; t += 1.6) {
    const ref = seg.notes.filter((n) => n.time <= t).at(-1);
    if (ref) pushKey(Math.max(t, START_SECONDS), ref.x, handsMid(seg, ref.time));
  }
  if (!next) {
    const last = seg.notes.at(-1);
    pushKey(END_SECONDS, last.x + 60, handsMid(seg, last.time));
    break;
  }
  // Hold at line end, then sweep to next line start
  const lastNote = seg.notes.filter((n) => n.time < segEnd).at(-1);
  const firstNext = next.notes[0];
  pushKey(segEnd - HOLD, lastNote.x + 35, handsMid(seg, lastNote.time));
  // Serpentine arc: the camera swings past the right margin while descending,
  // then curves into the next line start (大弧缓冲, no hard diagonal sweep).
  const crossesSystem = next.system !== seg.system || Math.abs(firstNext.y - lastNote.y) > 30;
  if (crossesSystem) {
    const midT = segEnd - HOLD + SWEEP * 0.55;
    const midX = Math.max(lastNote.x, firstNext.x) + 130;
    const midY = (handsMid(seg, lastNote.time) + handsMid(next, firstNext.time)) / 2 + 18;
    pushKey(midT, midX, midY);
  }
  pushKey(segEnd - HOLD + SWEEP, firstNext.x - 55, handsMid(next, firstNext.time));
}
keys[0].time = 0;

// --- Report ---
const upper = activations.filter((a) => a.staff === 1);
const lower = activations.filter((a) => a.staff === 2);
console.log(`range ${RANGE_SECONDS}s | midi events ${midiEvents.length} | attacks ${activations.length - sustainCount} | sustains ${sustainCount}`);
console.log(`upper(staff1) ${upper.length} | lower(staff2) ${lower.length} | unmatched ${unmatched.length} | edition variants ${variantCount} | ornaments ${ornamentCount}`);
if (unmatched.length) {
  console.log('unmatched:', unmatched.map((e) => `beat ${e.beat} pitch ${e.pitch}`).join(', '));
}

// --- Output ---
const lastEnd = Math.max(...activations.map((a) => a.time + Math.max(a.duration, 0.4)));
const data = {
  title: TITLE,
  subtitle: SUBTITLE,
  composer: COMPOSER,
  svgPath: 'score/score.svg',
  audioPath: 'score/piano.wav',
  width: geometry.width,
  height: geometry.height,
  // 留 0.2s 余量：否则窗口末帧正好等于 durationInFrames，Remotion 会判越界
  musicDuration: Math.min(END_SECONDS + 0.2, Math.max(lastEnd + 0.2, END_SECONDS + 0.2)),
  windowStart: START_SECONDS,
  events: activations,
  activations,
  camera: keys,
};
fs.writeFileSync(outPath, JSON.stringify(data, null, 1));
console.log('written', outPath, '| musicDuration', data.musicDuration.toFixed(2), '| camera keys', keys.length);
