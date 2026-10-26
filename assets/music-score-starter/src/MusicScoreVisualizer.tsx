import React, {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  continueRender,
  delayRender,
  cancelRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {ThreeCanvas} from '@remotion/three';
import {useThree, useStore} from '@react-three/fiber';
import * as THREE from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {BokehPass} from 'three/examples/jsm/postprocessing/BokehPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import rawData from './score-data.json';
import type {ScoreData} from './types';
import {STYLE, SCORE_SCALE, VELOCITY_RESPONSE, LANDING_RIPPLE, AURORA, PAPER_COLOR, MONO, DEBUG,
  DARK_STAGE, SCENE_BG, VIGNETTE, BALL_ARCS, ARC_GAIN, ARC_RADIUS, WHITE_CORE} from './config';
import {cameraTrack} from './camera';
const data: ScoreData = rawData;
import {
  INTRO_FRAMES,
  arcPoint,
  buildSlots,
  performanceAt,
  type Activation,
} from './performance';

const S = SCORE_SCALE;
const violet = new THREE.Color('#bda0ff');
const amber = new THREE.Color('#ffbc6d');
// Aurora mode: pitch → hue (low notes warm red, high notes cool indigo).
// staff2 sits a touch deeper so hands stay distinguishable.
const pitchColor = (pitch: number, staff: number) => {
  const hue = 0.98 + ((Math.max(36, Math.min(88, pitch)) - 36) / 52) * 0.76;
  return new THREE.Color().setHSL(hue % 1, 0.82, staff === 1 ? 0.68 : 0.58);
};
// 弧线颜色由预设决定：
// - classic / cyberpunk 都跟随球色（BALL_ARCS）；两者球色都是音高色，弧线随旋律变色
// - ink 用固定紫/橙
const arcColorFor = (staff: number) => new THREE.Color(staff === 2 ? '#f97316' : '#7c3aed');
const staffColor = (pitch: number, staff: number) =>
  AURORA ? pitchColor(pitch, staff) : staff === 1 ? violet : amber;
const slotsByStaff = {
  1: buildSlots(data.activations, 1),
  2: buildSlots(data.activations, 2),
};

// SVG is engraved from MusicXML. Rasterization happens only at GPU texture upload,
// retaining the same viewBox transform as the measured SVG notehead coordinates.
const useScoreTexture = () => {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [handle] = useState(() => delayRender('Load engraved MusicXML SVG'));
  useEffect(() => {
    let disposed = false;
    let result: THREE.CanvasTexture | undefined;
    fetch(staticFile(data.svgPath))
      .then((r) => r.text())
      .then((svg) => {
        const image = new Image();
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        if (doc.querySelector('parsererror')) throw new Error('Invalid score SVG');
        doc.documentElement.setAttribute('width', String(data.width*4));
        doc.documentElement.setAttribute('height', String(data.height*4));
        const url = URL.createObjectURL(new Blob(
          [new XMLSerializer().serializeToString(doc.documentElement)],
          {type:'image/svg+xml'},
        ));
        image.onload = () => {
          const canvas = document.createElement('canvas');
          // 纹理尺寸自适应：GPU 纹理上限 16384px（坑 #11），长曲谱自动降采样防死锁。
          const TEX = Math.min(4, 16384 / (data.height + 100));
          canvas.width = Math.round(data.width * TEX);
          canvas.height = Math.round((data.height + 100) * TEX);
          const ctx = canvas.getContext('2d')!;
          const K = TEX / 4; // 文字与偏移随纹理缩放
          ctx.fillStyle = PAPER_COLOR;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 400 * K, data.width * TEX, data.height * TEX);
          ctx.fillStyle = '#121018';
          ctx.textAlign = 'center';
          ctx.font = Math.round(72*K) + 'px Georgia';
          ctx.fillText(data.title, canvas.width/2, 158*K);
          ctx.font = Math.round(38*K) + 'px Georgia';
          ctx.fillText(data.subtitle, canvas.width/2, 222*K);
          ctx.font = Math.round(30*K) + 'px Georgia';
          ctx.textAlign = 'right';
          ctx.fillText(data.composer, canvas.width-170*K, 320*K);
          result = new THREE.CanvasTexture(canvas);
          result.colorSpace = THREE.SRGBColorSpace;
          result.anisotropy = 16;
          result.needsUpdate = true;
          URL.revokeObjectURL(url);
          if (!disposed) setTexture(result);
          else result.dispose();
          continueRender(handle);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          cancelRender(new Error('Score SVG failed to load'));
        };
        image.src = url;
      })
      .catch(cancelRender);
    return () => {
      disposed = true;
      result?.dispose();
    };
  }, [handle]);
  return texture;
};

const inkTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
  g.addColorStop(0, 'rgba(30,22,14,0.8)');
  g.addColorStop(0.4, 'rgba(30,22,14,0.5)');
  g.addColorStop(0.7, 'rgba(30,22,14,0.2)');
  g.addColorStop(1, 'rgba(30,22,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
};

const glowTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.23, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
};

// 符头光环寿命（秒）。1.8s：球离开槽位后光圈暂留渐隐（参考赛博片的多圈拖尾观感）；
// 到达确认窗口内仍必须看到球，防提前亮。
const RING_LIFE = 1.8;

const NoteRing: React.FC<{
  note: Activation;
  t: number;
  glow: THREE.Texture;
  balls: {x: number; z: number; op: number}[];
}> = ({note, t, glow, balls}) => {
  const age = t - note.time;
  if (age < 0 || age > RING_LIFE) return null;
  if (DEBUG.hideRings) return null;
  // 光环必须"球到了才亮"。此前只按谱面时间触发（note.time 起亮 0.9s），
  // 而球在符头上只停留 0.02~0.2s 就飞走 → 实测 52% 的音符是环亮着、球早不在，
  // 表现为空槽位常亮。现在硬绑定到球，球走环灭。
  if (note.kind === 'attack') {
    const ARRIVE = 0.15;
    const onBall = balls.some(
      (b) => b.op > 0.08 && Math.hypot(b.x - note.x * S, b.z - note.y * S) < 0.25,
    );
    if (age < ARRIVE && !onBall) return null;
  }
  // 落地迸发粒子：方向由 scoreId 确定性哈希（渲染可复现），数量随力度增长
  const seed = [...note.scoreId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const burstCount = Math.round((12 + (note.velocity / 90) * 14) * (VELOCITY_RESPONSE ? 1 : 0.5));
  // 寿命从 1.6s 收到 0.85s：粒子飞散过久会在已弹过的符头周围留下散点（残影观感）
  const burstLife = 0.85;
  const burstPos: number[] = [];
  if (age > 0 && age < burstLife && !DEBUG.hideParticles) {
    for (let i = 0; i < burstCount; i++) {
      const h = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
      const f1 = h - Math.floor(h);
      const h2 = Math.sin(seed * 39.346 + i * 11.135) * 24634.6345;
      const f2 = h2 - Math.floor(h2);
      const angle = f1 * Math.PI * 2;
      const spread = (0.45 + f2 * 0.65) * (1 - Math.exp(-age * 3.4)) * (age / burstLife);
      const rise = Math.sin(Math.min(1, age / burstLife) * Math.PI) * (0.24 + f2 * 0.28);
      burstPos.push(Math.cos(angle) * spread, 0.045 + rise, Math.sin(angle) * spread);
    }
  }
  const sustain = note.kind === 'sustain';
  const flash = Math.exp(-age / 0.14) * (sustain ? 0.55 : 1);
  const fade = Math.max(0, 1 - age / RING_LIFE) ** 1.15;
  const velScale = VELOCITY_RESPONSE ? Math.max(0.55, note.velocity / 90) : 1;
  const expansion = 1 + 0.23 * velScale * (1 - Math.exp(-age / 0.055));
  // Cascade second ring: delayed + wider, velocity-gated (forte gets the double ripple).
  const ring2 = LANDING_RIPPLE && !sustain && note.velocity >= 78;
  // 浅色纸上 4x 增益会把彩虹环刷成纯白（HDR 截断）；暗场/深纸保留参考片的高增益做霓虹感
  const DARK_PAPER = PAPER_COLOR === '#191824';
  const ringBoost = MONO ? 0.85 : (DARK_STAGE || DARK_PAPER) ? 1.05 + 3.6 * flash : 0.9 + 1.5 * flash;
  const color = staffColor(note.pitch, note.staff)
    .clone()
    .lerp(new THREE.Color('#d9c8a8'), MONO ? 0.62 : 0)
    .multiplyScalar(ringBoost * (note.velocity / 80));
  return (
    <group
      position={[note.x * S, 0.028, note.y * S]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={expansion}
    >
      <mesh>
        <ringGeometry args={[0.132, 0.176, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={fade * (sustain ? 0.8 : 1)}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      {ring2 && (
        <mesh position={[0, 0, 0.001]} scale={1 + 0.62 * Math.max(0, (age - 0.1) / 0.5) + 0.3 * (1 - flash)}>
          <ringGeometry args={[0.179, 0.19, 64]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={Math.max(0, flash * 0.3 * Math.max(0, 1 - age / 1.4))}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      )}
      <mesh position={[0, 0, 0.001]} scale={1 + 0.3 * (1 - flash)}>
        <ringGeometry args={[0.179, 0.19, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={flash * 0.42}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      {burstPos.length > 0 && (
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[new Float32Array(burstPos), 3]} />
          </bufferGeometry>
          <pointsMaterial
            map={glow}
            color={color.clone().multiplyScalar(1.8)}
            size={0.095}
            transparent
            opacity={Math.max(0, Math.min(1, (burstLife - age) / (burstLife * 0.75))) * 1.0}
            toneMapped={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      )}
    </group>
  );
};


// 水墨晕染（移植自工作台 inkwash）：每音 8-12 个墨点，纸面外扩，
// 越散越大越淡，寿命 ~1.8s。方向由 scoreId 确定性哈希，渲染可复现。
const InkBurst: React.FC<{note: Activation; t: number; tex: THREE.Texture}> = ({note, t, tex}) => {
  const age = t - note.time;
  if (!MONO || age < 0 || age > 1.8) return null;
  const seed = [...note.scoreId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const count = 14;
  const prog = age / 1.8;
  // 中间值：能看出洇开，但不糊住发光的球
  const opacity = (1 - prog * 0.65) * 0.62;
  if (opacity <= 0.01) return null;
  return (
    <group>
      {Array.from({length: count}, (_, i) => {
        const h = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
        const f1 = h - Math.floor(h);
        const h2 = Math.sin(seed * 39.346 + i * 11.135) * 24634.6345;
        const f2 = h2 - Math.floor(h2);
        const angle = (i / count) * Math.PI * 2 + (f1 - 0.5) * 0.8;
        const dist = Math.min(0.6, (0.3 + f2 * 0.4) * age * 1.05);
        const size = 0.34 + age * 0.22;
        return (
          <sprite key={i} position={[
            note.x * S + Math.cos(angle) * dist,
            0.045,
            note.y * S + Math.sin(angle) * dist,
          ]} scale={[size, size, 1]}>
            <spriteMaterial map={tex} color={'#241c14'} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
          </sprite>
        );
      })}
    </group>
  );
};

const Ball: React.FC<{
  targets: Activation[];
  t: number;
  glow: THREE.Texture;
  color: THREE.Color;
}> = ({targets, t, glow, color: baseColor}) => {
  if (!targets.length) return null;
  const motion = performanceAt(targets, t);
  // Aurora: the ball takes the hue of the note it is currently on.
  const curNote = motion.departing ? motion.from : motion.to;
  const color = AURORA && curNote ? staffColor(curNote.pitch, curNote.staff) : baseColor;
  // 经典参考片：球芯是纯白；其余预设保留暖米色芯
  const core = color
    .clone()
    .lerp(new THREE.Color(WHITE_CORE ? '#ffffff' : '#e8d9bd'), MONO ? 0 : 0.58)
    .multiplyScalar(motion.landed ? (MONO ? 2.4 : 2.8) : (MONO ? 1.8 : 1.6));
  const power = motion.landed ? 1 : 0.4;
  // 飞行弧：一颗球一条，从它自己的上一位置飞到当前符头。
  // 单音 = 一条弧依次点亮；和弦 = 几颗球几条弧同时点亮（副球本来就都从主球上一落点
  // 附近起飞，天然呈扇形）。不再额外补画弧、也不再画分叉尾迹——那才是画面乱的原因。
  const points = Array.from(
    {length: 25},
    (_, i) => new THREE.Vector3(...arcPoint(motion.from, motion.to, (motion.u * i) / 24)),
  );
  return (
    <group>
      {/* An actual opaque, high-luminance sphere remains legible with Bloom disabled. */}
      <group position={motion.position} visible={motion.opacity > 0.01}>
        <mesh
          scale={[
            (1 + motion.pulse * 0.075) * (motion.squashX ?? 1) * (MONO ? 1.3 : 1),
            (1 - motion.pulse * 0.15) * (motion.squashY ?? 1) * (MONO ? 1.3 : 1),
            (1 + motion.pulse * 0.075) * (motion.squashX ?? 1) * (MONO ? 1.3 : 1),
          ]}
        >
          <sphereGeometry args={[0.083, 24, 16]} />
          <meshBasicMaterial color={core} toneMapped={false} transparent opacity={motion.opacity} />
        </mesh>
        {MONO && (
          <mesh scale={0.28}>
            <sphereGeometry args={[0.083, 16, 12]} />
            <meshBasicMaterial color={'#ffffff'} toneMapped={false} transparent opacity={0.55 * motion.opacity} />
          </mesh>
        )}
        {motion.landed && !motion.departing && motion.opacity > 0.4 && (
          <mesh rotation={[Math.PI / 2 + 0.35, t * 2.2, 0.2]}>
            <ringGeometry args={[0.135, 0.15, 40]} />
            <meshBasicMaterial
              color={color.clone().multiplyScalar(MONO ? 1.6 : 1.4)}
              transparent
              opacity={(MONO ? 0.5 : 0.5) * motion.opacity}
              toneMapped={false}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        )}
        <sprite scale={[MONO ? 0.42 : 0.34, MONO ? 0.42 : 0.34, 1]}>
          <spriteMaterial
            map={glow}
            // 浅色纸上与经典同一套发光逻辑：球色提亮做光晕，彩色墨才通透
            color={color.clone().multiplyScalar(MONO ? 1.55 : 1.25)}
            transparent
            opacity={(MONO ? 0.26 : 0.17) * power * motion.opacity}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      </group>
      {motion.trailOpacity > 0 &&
        motion.opacity > 0.01 &&
        !DEBUG.hideArcs &&
        motion.from.system === motion.to.system &&
        motion.to.time - motion.from.time <= 1.2 &&
        motion.from.scoreId !== motion.to.scoreId && (
          <mesh>
            <tubeGeometry args={[new THREE.CatmullRomCurve3(points), 24, ARC_RADIUS, 6, false]} />
            <meshBasicMaterial
              // 参考片：弧线和球同色。经典=球色×2，赛博=当前音高色×1（随旋律变色）
              color={BALL_ARCS ? color.clone().multiplyScalar(ARC_GAIN) : arcColorFor(motion.to.staff)}
              transparent
              opacity={motion.trailOpacity * motion.opacity}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        )}
    </group>
  );
};

const Performer: React.FC<{staff: 1 | 2; t: number; glow: THREE.Texture}> = ({
  staff,
  t,
  glow,
}) => {
  const color = staffColor(60, staff); // MONO/AURORA 都要经过这里，不能硬编码紫橙
  const slots = slotsByStaff[staff];
  if (!slots.length) return null;
  return (
    <group>
      {slots.map((targets, i) => (
        <Ball key={i} targets={targets} t={t} glow={glow} color={color} />
      ))}
    </group>
  );
};

const Scene: React.FC<{texture: THREE.Texture}> = ({texture}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = (frame - INTRO_FRAMES) / fps;
  const state = useThree();
  const store = useStore();
  const {camera, gl, scene, size} = state;
  const glow = useMemo(glowTexture, []);
  const inkTex = useMemo(inkTexture, []);
  // 本帧所有球的位置：光环要"球到了才亮"，需要拿它做判定
  const ballState = useMemo(() => {
    const out: {x: number; z: number; op: number}[] = [];
    for (const staff of [1, 2] as const) {
      for (const targets of slotsByStaff[staff]) {
        const m = performanceAt(targets, t);
        if (m.opacity > 0.08) out.push({x: m.position[0], z: m.position[2], op: m.opacity});
      }
    }
    return out;
  }, [t]);
  const pipeline = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const dof = new BokehPass(scene, camera, {
      focus: 17,
      aperture: 0.0008,
      maxblur: 0.004,
    });
    composer.addPass(dof);
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      0.65,
      0.6,
      0.8,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return {composer, dof, bloom};
  }, [gl, scene, camera, size.width, size.height]);
  useLayoutEffect(() => {
    pipeline.composer.setSize(size.width, size.height);
    // Subscribe only to ThreeCanvas's render dispatch. No clock-driven animation.
    const callback = {current: () => pipeline.composer.render(0)};
    return state.internal.subscribe(callback, 1, store);
  }, [pipeline, state, size, store]);
  useLayoutEffect(() => {
    const track = cameraTrack(data.camera,t);
    const x = track.x;
    const dolly = 1 - 0.018 * Math.max(0,t) / data.musicDuration;
    const distance = STYLE.cameraDistance * dolly;
    const aimZ = track.z - .65;
    camera.position.set(x + .65 - 5.85*distance, 9.3*distance, aimZ + 13.85*distance);
    camera.up.set(.055,1,0);
    camera.lookAt(x+.65,0,aimZ);
    camera.updateMatrixWorld();
    const focusPoint = new THREE.Vector3(x, 0, track.z).applyMatrix4(
      camera.matrixWorldInverse,
    );
    (pipeline.dof.uniforms as Record<string, THREE.IUniform>).focus.value =
      -focusPoint.z;
    pipeline.bloom.strength =
      0.57 +
      0.1 *
        Math.max(
          ...data.events.map((n) =>
            t >= n.time ? Math.exp(-(t - n.time) / 0.12) : 0,
          ),
        );
  }, [t, camera, pipeline]);
  useEffect(() => {
    state.advance(frame / fps);
  }, [frame, fps, state, pipeline]);
  useEffect(
    () => () => {
      glow.dispose();
      pipeline.composer.dispose();
      pipeline.bloom.dispose();
      pipeline.dof.dispose();
    },
    [glow, pipeline],
  );
  return (
    <>
      <color attach="background" args={[SCENE_BG]} />
      {/* Restore readable paper while preserving the dark palette and emissive contrast. */}
      <ambientLight intensity={STYLE.ambient} />
      <directionalLight
        position={[10, 18, -10]}
        intensity={STYLE.directional}
        color="#d2cbdc"
      />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(data.width * S) / 2, -0.006, ((data.height - 100) * S) / 2]}
      >
        <planeGeometry args={[data.width * S, (data.height + 100) * S]} />
        <meshStandardMaterial map={texture} roughness={1} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[22, -0.035, 12]}>
        <planeGeometry args={[1000, 1000]} />
        {/* 经典暗场：外围纸面和谱面一样吃灯光，纸边才不会亮成一圈 */}
        {DARK_STAGE
          ? <meshStandardMaterial color={PAPER_COLOR} roughness={1} />
          : <meshBasicMaterial color={PAPER_COLOR} />}
      </mesh>
      <Performer staff={1} t={t} glow={glow} />
      <Performer staff={2} t={t} glow={glow} />
      {data.activations.filter((note, i, all) => t >= note.time && t-note.time <= RING_LIFE && !all.some((other,j) => j>i && other.scoreId===note.scoreId && other.time<=t)).map((note) => (
        <NoteRing key={note.eventId} note={note} t={t} glow={glow} balls={ballState} />
      ))}
      {MONO && data.activations.filter((note) => t >= note.time && t - note.time <= 1.8).map((note) => (
        <InkBurst key={'ink-' + note.eventId} note={note} t={t} tex={inkTex} />
      ))}
    </>
  );
};

const ReadyVisualizer: React.FC = () => {
  const {width, height} = useVideoConfig();
  const texture = useScoreTexture();
  return (
    <AbsoluteFill style={{background: '#111015'}}>
      {texture && (
        <ThreeCanvas
          width={width}
          height={height}
          frameloop="never"
          dpr={1}
          camera={{fov: 43, near: 0.1, far: 180}}
          gl={{
            antialias: true,
            alpha: false,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: STYLE.exposure,
            preserveDrawingBuffer: true,
          }}
        >
          <Scene texture={texture} />
        </ThreeCanvas>
      )}
      {/* 经典参考片的暗角：四周压暗、中心留亮，乐谱才有"聚光灯"感 */}
      {VIGNETTE && (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse at 50% 52%, transparent 30%, rgba(7,5,12,.20) 76%, rgba(3,2,7,.5) 110%)',
          }}
        />
      )}
      <Sequence from={INTRO_FRAMES}>
      <Audio
        src={staticFile(data.audioPath)}
      />
      </Sequence>
    </AbsoluteFill>
  );
};

export const MusicScoreVisualizer: React.FC = () => {
  if (!data.activations.length || !data.camera.length) return (
    <AbsoluteFill style={{background:'#19171d',color:'#ddd',justifyContent:'center',alignItems:'center',fontSize:38}}>
      请先按 README 生成自己的谱面、音轨与 score-data.json
    </AbsoluteFill>
  );
  return <ReadyVisualizer />;
};
