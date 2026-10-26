# Vocal + accompaniment -> two-staff MusicXML (grand-staff look) + aligned MIDI.
# MIDI: 60bpm (1 beat = 1 sec); track1 = vocal (staff1), track2 = accompaniment (staff2).
# Engraving: real tempo 112.3bpm, eighth-note quantization, key sig, ties.
import sys, zipfile, json
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

import numpy as np
import pretty_midi
from basic_pitch.inference import predict
from basic_pitch import ICASSP_2022_MODEL_PATH

vocals_wav, accomp_wav, out_dir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)

NOM_BPM = 112.3
KEY_FIFTHS = 0
MODEL_PATH = Path(ICASSP_2022_MODEL_PATH).parent / 'nmp.onnx'

def extract(wav, onset_t, frame_t, min_ms, lo, hi, amp_min, mono):
    _, _, ne = predict(wav, MODEL_PATH, minimum_note_length=min_ms,
                       melodia_trick=True, onset_threshold=onset_t, frame_threshold=frame_t)
    raw = [(s, e, int(p), float(a)) for s, e, p, a, _ in ne]
    raw.sort(key=lambda n: (n[0], -n[3]))
    out = []
    for s, e, p, a in raw:
        if e - s < 0.09 or a < amp_min or not (lo <= p <= hi):
            continue
        if mono and out:  # monophonic: resolve overlaps, keep louder
            ps, pe, pp, pa = out[-1]
            if s < pe - 0.03:
                if a <= pa and p != pp:
                    continue
                out[-1] = (ps, s, pp, pa)
        out.append((s, e, p, a))
    return out

print('extracting vocal...')
vocal = extract(vocals_wav, 0.6, 0.4, 100, 50, 84, 0.25, mono=True)
print(f'vocal notes: {len(vocal)}')
print('extracting accompaniment...')
acc = extract(accomp_wav, 0.7, 0.5, 150, 36, 84, 0.30, mono=False)
print(f'accompaniment notes: {len(acc)}')

# ---- MIDI: 60bpm, track1=vocal, track2=accompaniment ----
pm = pretty_midi.PrettyMIDI(initial_tempo=60.0)
iv = pretty_midi.Instrument(program=53)
for s, e, p, a in vocal:
    iv.notes.append(pretty_midi.Note(velocity=max(40, min(110, int(a * 127))), pitch=p, start=s, end=e))
pm.instruments.append(iv)
ia = pretty_midi.Instrument(program=0)
for s, e, p, a in acc:
    ia.notes.append(pretty_midi.Note(velocity=max(30, min(90, int(a * 100))), pitch=p, start=s, end=e))
pm.instruments.append(ia)
pm.write(str(out_dir / 'vocal.mid'))

# ---- engraving: quantize both parts to eighth grid at real tempo ----
SEC_PER_BEAT = 60.0 / NOM_BPM
GRID_BEATS = 0.5
BPB = 4.0
DIV = 4

def quantize(notes):
    q = []
    for s, e, p, a in notes:
        qb = round((s / SEC_PER_BEAT) / GRID_BEATS) * GRID_BEATS
        qd = max(GRID_BEATS, round(((e - s) / SEC_PER_BEAT) / GRID_BEATS) * GRID_BEATS)
        q.append([qb, qd, p])
    # notes arrive in real-time order; force quantized slots non-decreasing so
    # score print order == real order (prevents backward ball jumps on 50ms
    # pitch slides that quantize into neighboring slots out of order)
    prev = -1e9
    for item in q:
        if item[0] < prev:
            item[0] = prev
        prev = item[0]
    q.sort(key=lambda x: (x[0], x[2]))
    dedup = []
    for qb, qd, p in q:
        if dedup and dedup[-1][0] == qb and dedup[-1][2] == p:
            dedup[-1][1] = max(dedup[-1][1], qd)
            continue
        dedup.append([qb, qd, p])
    return dedup

vq = quantize(vocal)
aq = quantize(acc)
total_beats = max(
    max((b + d for b, d, _ in vq), default=BPB),
    max((b + d for b, d, _ in aq), default=BPB))
n_meas = int(np.ceil(total_beats / BPB))

TYPE = {0.5: ('eighth', 0), 1.0: ('quarter', 0), 1.5: ('quarter', 1),
        2.0: ('half', 0), 3.0: ('half', 1), 4.0: ('whole', 0)}
REST_TYPE = {0.5: 'eighth', 1.0: 'quarter', 2.0: 'half', 4.0: 'whole'}
SPLIT = [4.0, 3.0, 2.0, 1.5, 1.0, 0.5]

def pitch_xml(p):
    names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    nm = names[p % 12]
    return nm[0], (1 if '#' in nm else 0), p // 12 - 1

def dur_pieces(d):
    out = []
    r = round(d * 2) / 2
    while r > 1e-6:
        for L in SPLIT:
            if L <= r + 1e-6:
                out.append(L); r -= L; break
        else:
            out.append(0.5); r -= 0.5
    return out

def note_xml(p, piece, tie_start, tie_stop, staff, chord=False):
    typ, dots = TYPE.get(piece, ('quarter', 0))
    dots_x = '<dot/>' * dots
    ts = '<tie type="start"/>' if tie_start else ''
    tp = '<tie type="stop"/>' if tie_stop else ''
    nt = ''
    if tie_start and tie_stop:
        nt = '<notations><tied type="stop"/><tied type="start"/></notations>'
    elif tie_start:
        nt = '<notations><tied type="start"/></notations>'
    elif tie_stop:
        nt = '<notations><tied type="stop"/></notations>'
    step, alter, octv = pitch_xml(p)
    alter_x = f'<alter>{alter}</alter>' if alter else ''
    chord_x = '<chord/>' if chord else ''
    return (f'      <note>{chord_x}{tp}{ts}'
            f'<pitch><step>{step}</step>{alter_x}<octave>{octv}</octave></pitch>'
            f'<duration>{int(piece*DIV)}</duration><voice>{staff}</voice><type>{typ}</type>{dots_x}'
            f'{nt}<staff>{staff}</staff></note>')

def rest_xml(rem):
    out = []
    r = round(rem * 2) / 2
    while r > 1e-6:
        for L in (4.0, 2.0, 1.0, 0.5):
            if L <= r + 1e-6:
                break
        out.append(L); r -= L
    return out

def staff_measures(q, staff):
    """Return {measure_index: xml_lines}. Chords (same qb, multiple pitches) kept:
    all pitches emitted at the same slot (MusicXML <chord/>), duration = max of group."""
    # group by quantized onset
    groups = []
    for qb, qd, p in q:
        if groups and abs(groups[-1][0] - qb) < 1e-6:
            groups[-1][1].append((p, qd))
        else:
            groups.append([qb, [(p, qd)]])
    res = {}
    gi = 0
    for m in range(n_meas):
        m_start = m * BPB
        lines = []
        cursor = m_start
        while gi < len(groups) and groups[gi][0] < m_start + BPB - 1e-6:
            qb, members = groups[gi]; gi += 1
            if qb < cursor - 1e-6:
                continue
            for L in rest_xml(qb - cursor):
                take = min(L, m_start + BPB - cursor)
                if take <= 1e-6:
                    break
                lines.append(f'      <note><rest/><duration>{int(take*DIV)}</duration>'
                             f'<voice>{staff}</voice><type>{REST_TYPE.get(round(take*2)/2,"quarter")}</type>'
                             f'<staff>{staff}</staff></note>')
                cursor += take
            if cursor >= m_start + BPB - 1e-6:
                groups.insert(gi, [m_start + BPB, members])
                continue
            room = m_start + BPB - cursor
            d = min(max(qd for _, qd in members), room)
            pieces = dur_pieces(d)
            for k, piece in enumerate(pieces):
                for j, (p, _) in enumerate(sorted(members, key=lambda x: -x[0])):
                    chord = j > 0
                    lines.append(note_xml(p, piece, k < len(pieces) - 1, k > 0, staff, chord))
            cursor += d
        for L in rest_xml(m_start + BPB - cursor):
            take = min(L, m_start + BPB - cursor)
            if take <= 1e-6:
                break
            lines.append(f'      <note><rest/><duration>{int(take*DIV)}</duration>'
                         f'<voice>{staff}</voice><type>{REST_TYPE.get(round(take*2)/2,"quarter")}</type>'
                         f'<staff>{staff}</staff></note>')
            cursor += take
        res[m] = lines
    return res

vm = staff_measures(vq, 1)
am = staff_measures(aq, 2)

x = ['<?xml version="1.0" encoding="UTF-8"?>',
     '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
     '<score-partwise version="4.0">',
     '  <work><work-title>岁月如笔写春秋</work-title></work>',
     '  <identification><creator type="composer">欧阳尚尚 曲 / 日月同辉 词</creator></identification>',
     '  <part-list><score-part id="P1"><part-name>Vocal</part-name>'
     '<score-instrument id="P1-I1"><instrument-name>Voice</instrument-name></score-instrument></score-part></part-list>',
     '  <part id="P1">']
for m in range(n_meas):
    x.append(f'    <measure number="{m+1}">')
    if m == 0:
        x.append('      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>'
                 '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'
                 '<clef number="1"><sign>G</sign><line>2</line></clef>'
                 '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>')
        x.append(f'      <direction placement="above"><sound tempo="{NOM_BPM:g}"/></direction>')
    x.extend(vm.get(m, []))
    x.append(f'      <backup><duration>{int(BPB*DIV)}</duration></backup>')
    x.extend(am.get(m, []))
    x.append('    </measure>')
x += ['  </part>', '</score-partwise>']
musicxml = '\n'.join(x)
(out_dir / 'vocal-score.musicxml').write_text(musicxml, encoding='utf-8')

mxl_path = out_dir / 'vocal-score.mxl'
with zipfile.ZipFile(mxl_path, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('META-INF/container.xml',
               '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
               '<rootfile full-path="vocal-score.musicxml"/></rootfiles></container>')
    z.writestr('vocal-score.musicxml', musicxml)

json.dump({'vocal': [{'start': s, 'end': e, 'pitch': p, 'amp': a} for s, e, p, a in vocal],
           'accomp': [{'start': s, 'end': e, 'pitch': p, 'amp': a} for s, e, p, a in acc],
           'bpm': NOM_BPM, 'keyFifths': KEY_FIFTHS},
          open(out_dir / 'vocal-notes.json', 'w'))
print('DONE:', mxl_path, f'| measures: {n_meas} @ {NOM_BPM}bpm | vocal {len(vq)} acc {len(aq)}')
