# Insert written-out ritardando (66/60/48 BPM) at the end of a SMF file, per score markings.
from pathlib import Path
import struct, sys

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
PPQ = 384
RIT = [(155.25, 66), (155.5, 60), (155.75, 48)]  # (beat, bpm) from score m105

data = bytearray(src.read_bytes())
fmt, ntrks, division = struct.unpack('>HHH', data[8:14])
assert division == PPQ, f'unexpected PPQ {division}'
off = 8 + int.from_bytes(data[4:8], 'big')

def vlq(n):
    out = bytearray([n & 0x7F])
    n >>= 7
    while n:
        out.insert(0, 0x80 | (n & 0x7F))
        n >>= 7
    return bytes(out)

def read_vlq(d, p):
    n = 0
    while True:
        v = d[p]; p += 1; n = (n << 7) | (v & 127)
        if v < 128: return n, p

done = False
for _ in range(ntrks):
    assert data[off:off+4] == b'MTrk'
    size = int.from_bytes(data[off+4:off+8], 'big')
    trk = data[off+8:off+8+size]
    p, tick, events, has_tempo, eot_tick = 0, 0, [], False, None
    while p < len(trk):
        start = p
        delta, p = read_vlq(trk, p)
        tick += delta
        status = trk[p]
        if status < 128: raise AssertionError('running status in control track')
        p += 1
        is_eot = False
        if status == 0xFF:
            mtype = trk[p]; p += 1
            ln, p = read_vlq(trk, p)
            p += ln
            if mtype == 0x51: has_tempo = True
            if mtype == 0x2F: is_eot = True; eot_tick = tick
        elif status in (0xF0, 0xF7):
            ln, p = read_vlq(trk, p); p += ln
        else:
            p += 1 + (0 if (status >> 4) in (12, 13) else 1)
        if not is_eot:
            events.append((tick, bytes(trk[start:p])))
    if has_tempo:
        for beat, bpm in RIT:
            us = round(60_000_000 / bpm)
            events.append((round(beat * PPQ), vlq(0) + b'\xff\x51\x03' + us.to_bytes(3, 'big')))
        events.sort(key=lambda x: x[0])
        out = bytearray(); last = 0
        for t, ev in events:
            _, p2 = read_vlq(ev, 0)
            out += vlq(t - last) + ev[p2:]
            last = t
        out += vlq(0) + b'\xff\x2f\x00'  # EOT must stay last
        new_trk = bytes(out)
        new = bytearray(data[:off] + b'MTrk' + struct.pack('>I', len(new_trk)) + new_trk)
        new += data[off+8+size:]
        dst.write_bytes(bytes(new))
        print(f'rit. inserted at beats {[b for b, _ in RIT]} -> {dst}')
        done = True
        break
    off += 8 + size
assert done, 'no tempo meta found'
