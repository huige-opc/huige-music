// Compose engraved pages into one tall SVG (page 1 at top), preserving note ids.
// Each page's nested definition-scale <svg> is replaced by an equivalent scale(<k>) group.
import fs from 'node:fs';
const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw Error('Usage: node scripts/compose-pages.mjs engraved-dir output.svg');
const pages = fs.readdirSync(dir).filter((f) => /^page-\d+\.svg$/.test(f)).sort(
  (a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]),
);
if (!pages.length) throw Error('no page SVGs found');
// Verovio CSS scopes all colors to the ROOT svg id (#<id> path {stroke: currentColor}).
// Stripping the root svg would kill staff-line colors, so carry the id over.
const ROOT_ID = (fs.readFileSync(`${dir}/${pages[0]}`, 'utf8').match(/<svg[^>]*\sid="([^"]+)"/) || [])[1];
const GAP = 34;
let width = 0;
const groups = [];
let offsetY = 0;
for (const f of pages) {
  const raw = fs.readFileSync(`${dir}/${f}`, 'utf8');
  // Page structure: root <svg viewBox="0 0 rw rh"> <svg class="definition-scale" viewBox="0 0 nw nh"> content </svg> </svg>.
  // Some pages contain EXTRA nested svg closers; strip EVERY svg tag and keep inner content.
  const rootVb = raw.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!rootVb) throw Error(`no viewBox in ${f}`);
  const rw = Number(rootVb[1]);
  const rh = Number(rootVb[2]);
  const nestedW = Number((raw.match(/class="definition-scale"[^>]*viewBox="0 0 ([\d.]+)/) || [])[1]);
  if (!nestedW) throw Error(`no definition-scale svg in ${f}`);
  const scale = rw / nestedW;
  const content = raw.replace(/<svg[^>]*>/g, '').replace(/<\/svg\s*>/g, '');
  const h = rh;
  width = Math.max(width, rw);
  groups.push({content: `<g transform="scale(${scale})">\n${content}\n</g>`, offsetY, h});
  offsetY += h + GAP;
}
const totalH = offsetY - GAP;
// Dark theme: invert score ink to light (极夜反色) — inject scoped override style.
// 隐藏规则写死：深色纸预设必须墨色反转。自动读 settings.preset，用户无需传参。
const DARK_PRESETS = ['cyberpunk'];
let presetName = 'cyberpunk';
try {
  const st = JSON.parse(fs.readFileSync(new URL('../src/settings.json', import.meta.url), 'utf8'));
  presetName = st.preset || presetName;
} catch (e) { /* settings 缺失时用默认预设 */ }
const DARK = DARK_PRESETS.includes(presetName) || process.argv.includes('--dark');
const darkStyle = DARK
  ? `<style>#${ROOT_ID} path, #${ROOT_ID} use, #${ROOT_ID} rect, #${ROOT_ID} ellipse, #${ROOT_ID} polygon, #${ROOT_ID} text {fill:#e8e6f0 !important; stroke:#e8e6f0 !important;}</style>`
  : '';
const body = groups
  .map((g) => `<g transform="translate(0 ${g.offsetY})">\n${g.content}\n</g>`)
  .join('\n');
fs.writeFileSync(
  out,
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${ROOT_ID ? ` id="${ROOT_ID}"` : ''} viewBox="0 0 ${width} ${totalH}">\n${darkStyle}\n${body}\n</svg>\n`,
);
console.log('composed', pages.length, 'pages ->', `${width}x${totalH}`, '->', out);
