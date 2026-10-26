# Generate clean 4/4 MusicXML directly from grid-snapped transcription MIDI.
import pretty_midi, zipfile, sys

BPM = float(sys.argv[3]) if len(sys.argv) > 3 else 72.0
SEC16 = 60 / BPM / 4
TYPES = {4: ('16th', 0), 8: ('eighth', 0), 12: ('quarter', 1), 16: ('quarter', 0),
         24: ('half', 1), 32: ('half', 0), 48: ('whole', 1), 64: ('whole', 0)}
NAMES = ['C', 'C', 'D', 'E', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B']
ALTERS = [0, 1, 0, -1, 0, 0, 1, 0, 1, 0, 1, -1]

def note_xml(p, dur, typ, dots, sf, chord):
    step, alt, octave = NAMES[p % 12], ALTERS[p % 12], p // 12 - 1
    alter = f'<alter>{alt}</alter>' if alt else ''
    accid = f'<accidental>{"sharp" if alt == 1 else "flat"}</accidental>' if alt else ''
    return (f'<note>{"<chord/>" if chord else ""}'
            f'<pitch><step>{step}</step>{alter}<octave>{octave}</octave></pitch>'
            f'<duration>{dur}</duration><voice>{sf}</voice><type>{typ}</type>{accid}'
            f'{"<dot/>" * dots}<staff>{sf}</staff></note>')

def rest_xml(dur, sf):
    return f'<note><rest/><duration>{dur}</duration><voice>{sf}</voice><staff>{sf}</staff></note>'

def main(midi_path, out_xml):
    pm = pretty_midi.PrettyMIDI(midi_path)
    notes = sorted(pm.instruments[0].notes, key=lambda n: n.start)
    end_time = max(n.end for n in notes)
    measures = int((end_time / SEC16 + 15) // 16) + 1

    fixed = []
    # 转写 MIDI 的音符时值含踏板延音（互相重叠）。同一谱表内把每个音符的
    # 结束点截断到下一个音符的起点，避免序列化时把后续音符顶到错误节拍。
    by_staff = {1: [], 2: []}
    for n in notes:
        by_staff[1 if n.pitch >= 60 else 2].append(n)
    capped = []
    for sf, lst in by_staff.items():
        lst = sorted(lst, key=lambda n: n.start)
        for i, n in enumerate(lst):
            end = n.end
            if i + 1 < len(lst):
                end = min(end, lst[i + 1].start)
            capped.append((n.start, end, n.pitch, n.velocity, sf))
    capped.sort(key=lambda x: (x[0], x[2]))
    for st_t, en_t, p, v, sf in capped:
        st = round(st_t / SEC16) * 4
        en = max(st + 4, round(en_t / SEC16) * 4)
        dur = en - st
        best = min(TYPES.keys(), key=lambda k: (abs(k - dur), k))
        typ, dots = TYPES[best]
        fixed.append((st, st + best, p, v, sf, typ, dots))

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
           '"http://www.musicxml.org/dtds/partwise.dtd">',
           '<score-partwise version="4.0">',
           '  <work><work-title>A Comme Amour</work-title></work>',
           '  <identification><creator type="composer">Paul de Senneville</creator></identification>',
           '  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>',
           '  <part id="P1">']
    for m in range(measures):
        mstart = m * 64
        out.append(f'    <measure number="{m + 1}">')
        if m == 0:
            out.append('      <attributes><divisions>16</divisions><key><fifths>-4</fifths></key>'
                       '<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>'
                       '<clef number="1"><sign>G</sign><line>2</line></clef>'
                       '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>')
        for sf in (1, 2):
            mnotes = sorted([x for x in fixed if x[4] == sf and mstart <= x[0] < mstart + 64],
                            key=lambda x: (x[0], x[2]))
            if sf == 2:
                out.append('      <backup><duration>64</duration></backup>')
            cursor, prev_st = mstart, None
            for st, en, p, v, sfx, typ, dots in mnotes:
                if st > cursor:
                    out.append('      ' + rest_xml(st - cursor, sf))
                    prev_st = None
                chord = prev_st == st
                out.append('      ' + note_xml(p, en - st, typ, dots, sfx, chord))
                prev_st = st
                cursor = max(cursor, en)
            if cursor < mstart + 64:
                out.append('      ' + rest_xml(mstart + 64 - cursor, sf))
        out.append('    </measure>')
    out += ['  </part>', '</score-partwise>']
    xml = '\n'.join(out)
    open(out_xml, 'w', encoding='utf-8').write(xml)

    mxl_path = out_xml.replace('.musicxml', '.mxl')
    container = ('<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>'
                 '<rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>'
                 '</rootfiles></container>')
    with zipfile.ZipFile(mxl_path, 'w') as z:
        z.writestr('META-INF/container.xml', container)
        z.writestr('score.xml', xml)
    print(f'generated: {measures} measures, {len(fixed)} notes -> {mxl_path}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'materials/qiuri_fixed.mid',
         sys.argv[2] if len(sys.argv) > 2 else 'output/qiuri_score.musicxml')
