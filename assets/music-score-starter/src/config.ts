import settings from './settings.json';
export const FPS = settings.fps;
export const INTRO_FRAMES = settings.introFrames;
export const SCORE_SCALE = settings.scoreScale;
// 三个画风：经典 / 赛博 / 水墨（settings.json 的 preset 是唯一入口）。
type Preset = {
  aurora: boolean;
  jumpStyle: string;
  velocityResponse: boolean;
  landingRipple: boolean;
  paper: string;
  ambient: number;
  directional: number;
  exposure: number;
  mono?: boolean;
  // 暗场：外围纸面受光变暗、符头环走霓虹增益、可叠加暗角（只有经典用）
  darkStage?: boolean;
  bg?: string;
  vignette?: boolean;
  // 弧线跟随球色（球色在 aurora 模式下就是音高色）
  ballArcs?: boolean;
  arcGain?: number;
  arcRadius?: number;
  whiteCore?: boolean;
};
export const PRESETS: Record<string, Preset> = {
  // 经典：暗场暖灰纸 + 音高色球/环/弧线（随旋律变色）。纸/灯光/暗角对齐参考片。
  classic: {
    aurora: true, jumpStyle: 'elastic', velocityResponse: true, landingRipple: true,
    paper: '#c4bfb8', ambient: 0.52, directional: 0.62, exposure: 0.68,
    darkStage: true, bg: '#111015', vignette: true, ballArcs: true, arcGain: 1, arcRadius: 0.013, whiteCore: true,
  },
  // 赛博：深紫纸 + 音高霓虹（aurora 色温映射只在赛博内部使用）
  cyberpunk: {
    aurora: true, jumpStyle: 'staccato', velocityResponse: true, landingRipple: true,
    paper: '#191824', ambient: 0.78, directional: 0.88, exposure: 0.8, bg: '#221f30',
    ballArcs: true, arcGain: 1, arcRadius: 0.017,
  },
  // 水墨：暖墨纸 + 墨晕 + 音高色球/环/弧线（墨晕只做纸面洇染）
  ink: {
    aurora: true, jumpStyle: 'float', velocityResponse: false, landingRipple: true,
    paper: '#cfc4ae', ambient: 0.74, directional: 0.8, exposure: 0.8, mono: true,
    ballArcs: true, arcGain: 1, arcRadius: 0.013,
  },
};
const preset = PRESETS[(settings as any).preset] || PRESETS.classic;
export const AURORA = preset.aurora;
export const JUMP_STYLE = preset.jumpStyle;
export const VELOCITY_RESPONSE = preset.velocityResponse;
export const LANDING_RIPPLE = preset.landingRipple;
export const PAPER_COLOR = preset.paper;
export const MONO = !!preset.mono;
export const DARK_STAGE = !!preset.darkStage;
export const SCENE_BG = preset.bg ?? (preset.paper === '#191824' ? '#221f30' : '#0d0c12');
export const VIGNETTE = !!preset.vignette;
export const BALL_ARCS = !!preset.ballArcs;
export const ARC_GAIN = preset.arcGain ?? 1;
export const ARC_RADIUS = preset.arcRadius ?? 0.013;
export const WHITE_CORE = !!preset.whiteCore;
// 灯光也由预设写死：用户不可通过 settings 覆盖（隐藏规则不可修改原则）
const styleOverride = (settings as any).style || {};
export const STYLE = {
  cameraDistance: styleOverride.cameraDistance ?? 0.8,
  ambient: preset.ambient,
  directional: preset.directional,
  exposure: preset.exposure,
};

// 临时调试开关：用于消融对比，定位哪个元素让画面不干净
export const DEBUG = (settings as any).debug ?? {};
