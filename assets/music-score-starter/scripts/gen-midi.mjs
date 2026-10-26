// Export MIDI from MusicXML via Verovio so score (SVG) and timing (MIDI) share one source.
import fs from 'node:fs';
import path from 'node:path';
import createModule from 'verovio/wasm';
import {VerovioToolkit} from 'verovio/esm';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node scripts/gen-midi.mjs score.musicxml output.mid');
const tk = new VerovioToolkit(await createModule());
if (!tk.loadData(fs.readFileSync(input, 'utf8'))) throw Error(tk.getLog());
const b64 = tk.renderToMIDI(1);
fs.mkdirSync(path.dirname(path.resolve(output)), {recursive: true});
fs.writeFileSync(output, Buffer.from(b64, 'base64'));
console.log('MIDI written:', output, fs.statSync(output).size, 'bytes');
