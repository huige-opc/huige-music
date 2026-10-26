/** Stateless performance motion: arrival is at the MIDI onset, never delayed after it. */
export type Activation = {
  time: number;
  x: number;
  y: number;
  staff: number;
  pitch: number;
  velocity: number;
  duration: number;
  scoreId: string;
  kind: string;
  system: number;
  eventId: string;
};
import {FPS, INTRO_FRAMES, SCORE_SCALE, JUMP_STYLE} from './config';
export {INTRO_FRAMES, SCORE_SCALE};
export const INTRO_SECONDS = INTRO_FRAMES / FPS;

/**
 * Stable multi-ball slots (ported from the hyperframes-score-animation motion model).
 * One slot per simultaneous note; slots keep their identity across chord split/merge;
 * matching between consecutive events is minimum-cost over distance.
 */
export const permMatch = (
  sources: Activation[],
  targets: Activation[],
): (number | null)[] => {
  // Returns target index per source slot (null = slot unused this event).
  const n = sources.length;
  const m = targets.length;
  const cost = sources.map((s) =>
    targets.map((t) => Math.hypot(t.x - s.x, t.y - s.y)),
  );
  let best: (number | null)[] = sources.map(() => null);
  let bestCost = Infinity;
  const used = new Array(m).fill(false);
  const assign: (number | null)[] = [];
  const walk = (i: number, acc: number) => {
    if (acc >= bestCost) return;
    if (i === n) {
      bestCost = acc;
      best = [...assign];
      return;
    }
    assign.push(null);
    walk(i + 1, acc); // slot stays unused
    assign.pop();
    for (let j = 0; j < m; j++) {
      if (used[j]) continue;
      used[j] = true;
      assign.push(j);
      walk(i + 1, acc + cost[i][j]);
      assign.pop();
      used[j] = false;
    }
  };
  walk(0, 0);
  return best;
};

export const buildSlots = (notes: Activation[], staff: number): Activation[][] => {
  // Hybrid model: slot 0 is the continuous PRIMARY ball (one target per event, like the
  // single-ball version, so its trail chain never breaks). Extra chord notes become
  // SECONDARY slots that split out for the chord and fade afterwards.
  const events: Activation[][] = [];
  for (const note of notes
    .filter((n) => n.staff === staff && n.kind === 'attack')
    .sort((a, b) => a.time - b.time || a.pitch - b.pitch)) {
    const last = events[events.length - 1];
    // 和弦判定不能只认"时间完全相同"：转写出来的同柱双音常有 20~80ms 抖动，
    // 按 1e-6 分组会把它们拆成两次单音，结果只画一根弧（辉哥 2026-10-25 反馈）。
    // 同谱行、同 x（同一列）、时间差 ≤80ms、音高不同 → 视为一个和弦。
    const CHORD_TIME = 0.08;
    const CHORD_X = 2;
    if (
      last &&
      last[0].system === note.system &&
      Math.abs(last[0].x - note.x) <= CHORD_X &&
      Math.abs(last[0].time - note.time) <= CHORD_TIME &&
      last[0].pitch !== note.pitch
    ) last.push(note);
    else events.push([note]);
  }
  const primary: Activation[] = [];
  const secondaries: (Activation[])[] = []; // per event, notes other than the primary
  for (const points of events) {
    const ordered = [...points].sort(
      (a, b) =>
        (a.kind === 'attack' ? 0 : 1) - (b.kind === 'attack' ? 0 : 1) ||
        (staff === 1 ? b.pitch - a.pitch : a.pitch - b.pitch),
    );
    primary.push(ordered[0]);
    secondaries.push(ordered.slice(1));
  }
  const slots: Activation[][] = [primary];
  // 副球保持"单跳"：只为本次和弦存在，与主球在同一 onset 弹下、同一时刻亮起。
  // （曾尝试把副音串成连续链，结果副球会在和弦之间继续飞，破坏了与时间轴的同步。）
  // 多弧由渲染层的 ChordArcs 负责：它按"此刻这个符头上有没有球"来画，球走弧消。
  secondaries.forEach((points, k) => {
    const prevPrim = k > 0 ? primary[k - 1] : null;
    const prevSecs = k > 0 ? secondaries[k - 1] : [];
    points.forEach((p, j) => {
      // 弧只能"从上一个槽位引到下一个槽位"：起点必须是真实符头。
      // 先找上一个和弦里同序号的副音，没有就用上一个主音；
      // 绝不能用虚构偏移点（x-34*(j+1) 之类），否则弧会多出一截落在空白处的尾巴。
      const origin = prevSecs[j] ?? prevPrim ?? null;
      const linked =
        !!origin && origin.system === p.system && p.time - origin.time <= 1.2;
      const takeoffTime = linked
        ? Math.max(origin!.time, p.time - 0.5)
        : Math.max(0, p.time - 0.02);
      const takeoff: Activation = linked
        ? {
            ...p,
            x: origin!.x,
            y: origin!.y,
            time: takeoffTime,
            duration: p.time - takeoffTime,
            pitch: origin!.pitch,
            scoreId: origin!.scoreId,
            eventId: origin!.eventId + '-to-' + p.eventId,
          }
        : // 跨系统/间隔过久：没有可连的上一个槽位，就地落位，不画任何多余的线
          {
            ...p,
            x: p.x,
            y: p.y,
            time: takeoffTime,
            duration: 0.02,
            eventId: p.eventId + '-in',
          };
      slots.push([takeoff, p]);
    });
  });
  return slots;
};

export const groupLandings = (notes: Activation[], staff: number) => {
  const groups: Activation[][] = [];
  // The dataset defines the requested musical range; no piece-specific cutoff.
  for (const note of notes
    .filter((n) => n.staff === staff)
    .sort((a, b) => a.time - b.time)) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0].time - note.time) < 1e-6) last.push(note);
    else groups.push([note]);
  }
  return groups.map(
    (group) =>
      [...group].sort(
        (a, b) =>
          (a.kind === 'attack' ? 0 : 1) - (b.kind === 'attack' ? 0 : 1) ||
          (staff === 1 ? b.pitch - a.pitch : a.pitch - b.pitch),
      )[0],
  );
};
// Jump curve profiles (ported from the workbench motion model):
// elastic=Q弹律动 fluid=优雅流光 staccato=敏捷顿音 float=浮空漫步
// 球落地后的"待命"亮度：弹完的符头只留一个很暗的轮廓，不抢眼、也不留亮斑
const RESTING_GLOW = 0.16;

const JUMP_PROFILES: Record<string, {amp: number; bounce: number; impact: number; freq: number}> = {
  elastic: {amp: 0.3, bounce: 1.0, impact: 0.38, freq: 26},
  fluid: {amp: 0.18, bounce: 0.55, impact: 0.2, freq: 18},
  staccato: {amp: 0.35, bounce: 1.3, impact: 0.5, freq: 32},
  float: {amp: 0.12, bounce: 0.3, impact: 0.1, freq: 14},
};
export const arcPoint = (
  a: Activation,
  b: Activation,
  u: number,
): [number, number, number] => {
  const phase = Math.max(0, Math.min(1, u));
  const p = phase; // Constant lateral flight: no braking / rushing between contacts.
  const distance = Math.hypot(b.x - a.x, b.y - a.y) * SCORE_SCALE;
  // Every interval is one complete flight, including repeated identical positions.
  const interval = Math.max(0, b.time - a.time);
  const prof = JUMP_PROFILES[JUMP_STYLE] || JUMP_PROFILES.elastic;
  const hopHeight = (0.27 + Math.min(0.13, distance * 0.045)) * prof.amp / 0.27 * Math.min(1, Math.max(0.18, interval / 0.22));
  return [
    (a.x + (b.x - a.x) * p) * SCORE_SCALE,
    0.097 + 4 * phase * (1 - phase) * hopHeight,
    (a.y + (b.y - a.y) * p) * SCORE_SCALE,
  ];
};
export const performanceAt = (targets: Activation[], t: number) => {
  let i = 0;
  while (i + 1 < targets.length && targets[i + 1].time <= t) i++;
  const current = targets[i], next = targets[i + 1];
  const age = t-current.time;
  const landed = age >= 0;
  // 休息判定放宽到 1.4s：和弦前一个音常隔半拍到一拍，原阈值 0.65 会让主球“不走”，
  // 结果只有副球那条弧，看起来永远是一条线。
  const resting = !!next && (next.system !== current.system || next.time-current.time-current.duration > 1.4);
  const enteringNext = resting && t >= next.time-INTRO_SECONDS;
  const entryTarget = enteringNext ? next : current;
  const entryPhase = Math.max(0,Math.min(1,(t-entryTarget.time+INTRO_SECONDS)/INTRO_SECONDS));
  // 长音不再用整段间隔慢慢飘：球先留在原位，最后 MAX_FLIGHT 秒快速跳过去。
  // 否则镜头右移时球相对画面往左漂，观感就是"后退"。
  const MAX_FLIGHT = 0.5;
  const interval = next ? next.time - current.time : Infinity;
  const flight = Math.min(interval, MAX_FLIGHT);
  const flightStart = next ? next.time - flight : Infinity;
  const departing = !!next && landed && !resting && t >= flightStart;
  const u = departing ? Math.max(0, Math.min(1, (t - flightStart) / flight)) : 1;
  const position = departing ? arcPoint(current,next,u) : arcPoint(entryTarget,entryTarget,1);
  let opacity = 1;
  if (!landed || enteringNext) {
    // 只有真正进入进场窗口（entryPhase > 0）才可见。
    // 此前这里对 !landed 无条件兜底 0.55，导致**所有未来音符的球在第一帧就亮着**，
    // 表现为片头/远处一排槽位常亮（辉哥 2026-10-25 截图）。
    const entering = entryPhase > 0;
    opacity = entering ? Math.max(0.55, Math.min(1, entryPhase * 2.5)) : 0;
    position[1] = .097+.18*(1-entryPhase*entryPhase);
  } else if (resting || !next) {
    // 停留时长与音长解耦：固定 0.35s 后 0.3s 淡出。此前用 current.duration，
    // 长音的球会在符头上多留一秒以上，于是同一个符头"有的黑得快、有的还亮着"。
    opacity = Math.max(0,Math.min(1,(current.time+.35-t)/.3));
  }
  opacity = Math.max(0, Math.min(1, opacity));
  // 落地后迅速回落到一个很低的"待命"亮度，而不是整段保持全亮。
  // 球是演奏位置指示器，不是发光残留：弹完的符头必须立刻暗下去，且与音长无关。
  if (landed && !departing && !enteringNext) {
    opacity = (RESTING_GLOW + (1 - RESTING_GLOW) * Math.exp(-Math.max(0, age) / 0.16)) * opacity;
  } else if (departing) {
    // 起飞亮度平滑爬升：否则球会在旧符头上先暗下去、起飞瞬间又回弹成全亮，
    // 看起来就是"这个槽位还亮着"。前 30% 行程内保持暗，离开后才亮起来。
    opacity = (RESTING_GLOW + (1 - RESTING_GLOW) * Math.min(1, u / 0.3)) * opacity;
  }
  const pulse = landed && !enteringNext ? Math.exp(-Math.max(0,age)/.1) : 0;
  const from = departing ? current : targets[Math.max(0,i-1)];
  const to = departing ? next : current;
  // 落地后弧线只留 0.12s（约 3 帧）：球跳到下一个位置时，旧位置的弧必须跟着消失。
  // 弧只能和球同时可见：age<0（还没落地）时不能提前亮，否则就是"球没到、弧先出现"。
  const trailOpacity = departing
    ? .72
    : (landed && from.system === to.system ? .6 * Math.max(0, 1 - age / .12) : 0);
  // Squash & stretch (volume-conserving) + landing impact squash + secondary micro-bounce.
  const prof = JUMP_PROFILES[JUMP_STYLE] || JUMP_PROFILES.elastic;
  let squashY = 1;
  if (departing) {
    squashY = 1 + Math.sin(u * Math.PI) * prof.amp * prof.bounce; // stretch mid-flight
  } else if (age < 0.35) {
    const impactSquash = prof.impact * Math.exp(-age / 0.05);
    const bounce = Math.max(0, Math.sin(age * prof.freq) * 0.038 * prof.bounce * Math.exp(-age * 6));
    squashY = Math.max(0.62, 1 - impactSquash + bounce);
  }
  const squashX = 1 / Math.sqrt(Math.max(0.2, squashY));
  return {position,pulse,landed,opacity,from,to,u,trailOpacity,departing,squashX,squashY};
};
