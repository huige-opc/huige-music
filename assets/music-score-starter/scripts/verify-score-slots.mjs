// 乐谱槽位检查（辉哥 2026-10-25：防止重复匹配、槽位音符被跳过）
// 用法: node scripts/verify-score-slots.mjs <analysis.json> <geometry.json> [score-data.json]
// 检查三件事：
//   1) 窗口内每个非延音/非装饰音谱面音符是否都有球（不跳过槽位）
//   2) 同一个符头是否被绑定了两次以上（重复；同刻重复=FAIL，间隔>80ms 视为重复音=INFO）
//   3) 同柱和弦（同声部、同 x、时间差≤80ms、音高不同）是否每个音都有球
import fs from 'node:fs';

const [analysisPath, geometryPath, dataPathArg] = process.argv.slice(2);
if (!analysisPath || !geometryPath) {
  throw Error('Usage: node scripts/verify-score-slots.mjs analysis.json geometry.json [score-data.json]');
}
const dataPath = dataPathArg || 'src/score-data.json';
const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
const geometry = JSON.parse(fs.readFileSync(geometryPath, 'utf8'));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const T0 = data.windowStart ?? 0;
const T1 = data.musicDuration;
const BPM = analysis.score.tempi && analysis.score.tempi.length
  ? analysis.score.tempi[0].bpm : 60;
const secOfBeat = (beat) => beat * 60 / BPM;

const notes = analysis.score.notes.filter(
  (n) => !n.rest && n.pitch != null && geometry.notes[n.id],
);
const attacks = data.activations.filter((a) => a.kind === 'attack');
const byScoreId = new Map();
for (const a of attacks) {
  if (!byScoreId.has(a.scoreId)) byScoreId.set(a.scoreId, []);
  byScoreId.get(a.scoreId).push(a);
}

// 1) 槽位覆盖：窗口内该有起音的音符（延音 stop / 装饰音不单独算）
const windowNotes = notes.filter((n) => {
  const t = secOfBeat(n.beat);
  return t >= T0 && t < T1 && !(n.ties || []).includes('stop') && !n.grace;
});
const missing = windowNotes.filter((n) => !byScoreId.has(n.id));

// 2) 重复使用同一符头
const duplicates = [];
for (const [id, arr] of byScoreId) {
  if (arr.length < 2) continue;
  const sorted = [...arr].sort((a, b) => a.time - b.time);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i].time - sorted[i - 1].time);
  duplicates.push({id, times: sorted.map((a) => +a.time.toFixed(3)), pitch: sorted[0].pitch, maxGap: +maxGap.toFixed(3)});
}
const sameInstantDup = duplicates.filter((d) => d.maxGap <= 0.08);
const repeatedNotes = duplicates.filter((d) => d.maxGap > 0.08);

// 3) 和弦完整：同柱（同声部、同 x、时间差≤80ms、音高不同）
const CHORD_TIME = 0.08;
const CHORD_X = 2;
const groupNotes = (list) => {
  const out = [];
  for (const n of [...list].sort((a, b) => secOfBeat(a.beat) - secOfBeat(b.beat) || a.pitch - b.pitch)) {
    const g = out[out.length - 1];
    const x = geometry.notes[n.id].x;
    if (
      g &&
      g.notes[0].staff === n.staff &&
      Math.abs(geometry.notes[g.notes[0].id].x - x) <= CHORD_X &&
      Math.abs(secOfBeat(g.notes[0].beat) - secOfBeat(n.beat)) <= CHORD_TIME &&
      g.notes.every((m) => m.pitch !== n.pitch)
    ) g.notes.push(n);
    else out.push({notes: [n]});
  }
  return out;
};
const chordGroups = groupNotes(windowNotes).filter((g) => g.notes.length > 1);
const incompleteChords = [];
for (const g of chordGroups) {
  const missingHere = g.notes.filter((n) => !byScoreId.has(n.id));
  if (missingHere.length) {
    incompleteChords.push({
      t: +secOfBeat(g.notes[0].beat).toFixed(3),
      want: g.notes.length,
      missing: missingHere.map((n) => n.id),
    });
  }
}

const ok = (c) => (c ? 'PASS' : 'FAIL');
console.log(`${ok(!missing.length)}: 槽位覆盖（窗口内音符都有球） | ${windowNotes.length - missing.length}/${windowNotes.length}${missing.length ? ' 缺: ' + missing.slice(0, 8).map((n) => `${n.id}@${secOfBeat(n.beat).toFixed(2)}`).join(',') : ''}`);
console.log(`${ok(!incompleteChords.length)}: 和弦完整（同柱每个音都有球） | ${chordGroups.length} 个和弦${incompleteChords.length ? ' 缺: ' + JSON.stringify(incompleteChords.slice(0, 6)) : ''}`);
console.log(`${ok(!sameInstantDup.length)}: 同刻重复符头 | ${sameInstantDup.length}${sameInstantDup.length ? ': ' + JSON.stringify(sameInstantDup.slice(0, 6)) : ''}`);
// 间隔>80ms 的重复使用也会让同一个槽位做两次动作（辉哥 2026-10-25 反馈），同样判 FAIL。
console.log(`${ok(!repeatedNotes.length)}: 重复使用符头（间隔>80ms 也会二次动作） | ${repeatedNotes.length}${repeatedNotes.length ? ': ' + repeatedNotes.slice(0, 6).map((d) => `${d.id}(${d.times.join('/')})`).join(' ') : ''}`);

if (missing.length || incompleteChords.length || sameInstantDup.length || repeatedNotes.length) process.exitCode = 1;
