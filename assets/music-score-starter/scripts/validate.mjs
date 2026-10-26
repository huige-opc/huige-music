import fs from 'node:fs';
import assert from 'node:assert/strict';
const d=JSON.parse(fs.readFileSync('src/score-data.json'));
assert.ok(d.events.length&&d.activations.length,'Empty template: first generate your own score-data.json.');
assert.ok(d.musicDuration>0&&d.width>0&&d.height>0);
const ids=new Set();
for(const n of d.activations){
 for(const k of ['time','duration','pitch','velocity','x','y','system'])assert.ok(Number.isFinite(n[k]),'Invalid '+k);
 assert.ok([1,2].includes(n.staff)&&n.time>=0&&n.time<d.musicDuration);
 assert.ok(n.scoreId&&n.eventId&&!ids.has(n.eventId),'Missing/duplicate eventId');
 assert.ok(n.x>=0&&n.x<=d.width&&n.y>=0&&n.y<=d.height,'Note outside score bounds');
 ids.add(n.eventId);
}
for(const e of d.events)assert.ok(ids.has(e.eventId),'MIDI event missing activation');
assert.ok(d.camera.length>0,'Camera path is required');
d.camera.forEach((k,i)=>{
 assert.ok([k.time,k.x,k.y].every(Number.isFinite));
 if(i)assert.ok(k.time>d.camera[i-1].time,'Camera times must strictly increase');
});
for(const field of ['svgPath','audioPath']){
 assert.ok(typeof d[field]==='string'&&!d[field].includes('..'));
 assert.ok(fs.existsSync('public/'+d[field]),'Missing '+field);
}
console.log('PASS: data structure and required assets. Still audit MIDI/MXL mapping and render framing separately.');
