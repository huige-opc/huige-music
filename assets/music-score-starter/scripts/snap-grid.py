# Trim + tempo-grid-snap a transcribed MIDI so it aligns to a musical grid.
# Usage: python snap-grid.py in.mid out.mid [start_sec] [end_sec] [bpm]
# - Trims to [start, end) seconds, shifts to 0
# - Snaps onsets to the 16th-note grid of `bpm` (global offset searched to minimize error)
# - Duration pitfall: note tails carry pedal sustain and overlap the next notes;
#   each note is truncated at the next onset in the OUTPUT (generate-score.py also caps per staff).
import pretty_midi, sys

def main():
    src, dst = sys.argv[1], sys.argv[2]
    start = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
    end = float(sys.argv[4]) if len(sys.argv) > 4 else 30.0
    bpm = float(sys.argv[5]) if len(sys.argv) > 5 else 72.0
    SEC16 = 60 / bpm / 4

    pm = pretty_midi.PrettyMIDI(src)
    notes = [n for n in pm.instruments[0].notes if start <= n.start < end]
    notes.sort(key=lambda n: n.start)
    if not notes:
        raise SystemExit('no notes in window')
    # Trim and shift
    for n in notes:
        n.start -= start
        n.end -= start

    # Global offset search: anchor the 16th grid to minimize snapping error
    best = None
    for i in range(50):
        off = i * SEC16 / 50
        err = sum(min((n.start - off) % SEC16, SEC16 - (n.start - off) % SEC16) for n in notes)
        if best is None or err < best[1]:
            best = (off, err)
    off, err = best
    print(f'grid offset {off * 1000:.1f}ms, mean snap error {err / len(notes) * 1000:.1f}ms')

    new = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    inst = pretty_midi.Instrument(program=0)
    for n in notes:
        st = max(0.0, round((n.start - off) / SEC16) * SEC16)
        en = max(st + SEC16, round((n.end - off) / SEC16) * SEC16)
        inst.notes.append(pretty_midi.Note(velocity=n.velocity, pitch=n.pitch, start=st, end=en))
    new.instruments.append(inst)
    new.write(dst)
    print(f'written {dst}: {len(inst.notes)} notes, tempo {bpm}')

if __name__ == '__main__':
    main()
