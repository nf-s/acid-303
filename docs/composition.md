# Sequence, automation and shared chords

Project version 6 separates three durations: each instrument's notes or gates,
its automation curves, and the shared four-chord progression. They use one
absolute transport clock at 24 ticks per quarter note. Tempo always counts
quarter notes; changing a meter does not change that reference.

## Independent automation

Every instrument has `timing` and `automationBars`. A null `automationBars`
means **Follow sequence**. Selecting 1, 2, 4, 8 or 16 gives the curves their own
bar count while retaining that instrument's meter and straight/triplet grid.
A one-bar bass pattern can therefore repeat eight times under an eight-bar
filter curve. Notes and automation wrap separately; neither resets the other.

`automationTiming(track)` returns the effective curve timing.
`automationPosition(track, absoluteTick, swing)` resolves the visible curve
position from the audible transport clock. The `automated*` model functions
accept an unwrapped logical grid position and wrap against the automation
length, not the note length. Pad curves interpolate between adjacent points;
the other instruments retain their existing step-based parameter behavior.

The typed `resize*Automation` helpers change only automation metadata and
curves. Existing note, gate, velocity, trim and chord data stays intact.
Extending repeats the current curve; shortening retains the opening portion.
Sequence resizing preserves an independent automation duration. Meter/grid
changes resample by beat position. Linked Pad sequence resizing retains its
previous cyclic interpolation behavior so an existing long Pad contour keeps
its shape.

The editor shows note context repeated beneath a longer automation loop.
Shared Chords is a compact disclosure above the examples; its full editor scrolls
with the page instead of enlarging the sticky transport. Each follower offers an
Edit chords shortcut. Sequence starts open and Automation collapsed; selecting a
knob opens the latter without replacing or duplicating the musical controls.
Sequence paging still edits actual note cells; automation paging and Whole loop
use the effective curve length. Sequencers have their own Page / Whole loop
switch and bars-per-page choice in their pattern controls. Pages of several
bars keep whole bars together; one bar per page keeps the original 16 or 12
cell split. Live knob markers resolve the automation phase
without changing the manual base pointer.

Record remains local to the device. Its lane bindings receive
`automationTiming(track)`, so a held control writes the correct later bar rather
than overwriting the first note loop. Cloud and Tension performance notes still
write into their sequence loop, while their moved controls use the independent
curve loop. A timing change ends an existing recording touch before it can
write with stale dimensions.

## Shared progression

`project.progression` stores four scale-degree/inversion chord slots and its own
2, 4, 8 or 16-bar timing. It produces no sound by itself. Pad, Arp and Vocal can
follow it; the other instruments retain their authored pitches.

Each slot may also carry `quality` and `borrow`. Both are optional; an absent
`quality` is the original stacked diatonic seventh, so every existing project,
example and link keeps its exact data and sound. `chordNotes` builds Triad, 7th,
9th and Add9 by stacking scale thirds (in the borrowed scale when set), and Sus2,
Sus4 and Power from exact intervals (0-2-7, 0-5-7, 0-7-12). Inversions rotate the
lowest note up as before and are limited to the chord size (Power has none); the
voicing stays at or below B5. `borrow` builds the chord from the parallel mode on
the same tonic, ignored in Pentatonic. `chordLabel` names the result (Fm9, Csus2,
A♭add9, B♭5, Bm7♭5, Em7♭9); a root lowered by borrowing is spelled as a flat,
other names keep the app's sharps. `chordNumeral` gives the roman numeral against
the project scale: lower case for minor, ° for diminished, ♭/♯ for a borrowed root.

`CHORD_PROGRESSIONS` is the library: 60 entries, each written in one scale with
optional per-chord type and borrowing, grouped by feel. The first eight keep the
ids and exact chords used by the Grain examples. `progressionEntryChords` turns
an entry into stored chords for the current key: it adds borrowing only where the
scale would otherwise change a chord, and chooses inversions (unless the entry
fixes them) by starting in root position, moving each next chord the least, and
reusing a repeated chord's voicing. The panel lists an entry in every scale where
it produces the same chords as written (all entries in Pentatonic), and marks the
entry matching the current chords, ignoring inversions.

Chord previews do not touch the project or history. `AudioEngine.previewChords`
plays a short filtered saw/triangle (Grain) or sine/triangle (Fluff) voice with
the root in the C2–B2 octave into the master bus: about 1.3 s for one chord, or a
sequence two beats apart (0.55–1 s) for an audition. While the transport runs it
plays at half level and leaves the instruments untouched; choosing a progression
plays it only while stopped. Guests and blocked sessions do not preview. WAV
export renders a separate offline engine and never includes previews.

- **Pad:** Follow chords is on by default. Chords begin and end at the shared
  progression boundaries. Pad's instrument timing and automation length remain
  independent. Turning Follow chords off restores its saved local chord cards
  and local chord duration.
- **Arp:** Follow chords is off by default. When enabled, each onset reads the
  active chord's voicing (three to five notes, depending on Type) instead of the saved selected-note pool. The register
  stays near the lowest saved note, within the existing base note range.
  Direction, Played order, rate, octave count, gates, accents and random seed
  retain their behavior. The saved note pool is preserved for switching back.
- **Vocal:** Follow chords is off by default. Each onset shifts its saved note
  by the signed number of scale degrees between the first chord root and the
  active root. This keeps the first chord's authored pitch unchanged and
  preserves scale membership, bounded to C2–C6. The shifted pitch is held for
  that note's duration; subsequent chord changes do not bend an already playing
  sample. Chord inversion does not change the root shift. Over a borrowed chord
  the note moves through, and snaps to, the scale it borrows from, so it stays a
  chord or scale tone of that chord. This transposes the recording as a whole,
  not individual notes inside a sung phrase.

Straight grids retain swing; explicit triplet grids remain evenly spaced.
Pad chord boundaries and Pad automation can use different grids. Its scheduler
orders both by their audible tick, preventing a future swung chord from being
processed before an earlier triplet control update. Arp and Vocal select the
chord active at their audible onset, including when their grids differ from the
progression grid.

## Migration and persistence

The project boundary accepts older saved versions. Missing `automationBars`
becomes null, preserving the former sequence/curve relationship and every
stored value. Arp and Vocal remain independent of chords by default. Pad follows
by default, and migration copies its final saved local chords and timing into
the shared progression, so the existing arrangement retains its chord notes,
length and swing. The earlier 16-knot Pad migration still runs before this copy.
Authored examples likewise copy their final Pad arrangement into the shared
progression; new metadata must be excluded when comparing their old musical
fingerprints.

The fields belong to the project, so local persistence, Undo/Redo, snapshot
links and sessions carry them together. Local microphone recordings remain
valid in local saved projects. A snapshot link must first upload a recording:
encoding rejects local-only references, and decoding rejects an incoming
local-only reference rather than resolving it against another device's storage.
Recording storage and access are documented separately.

## Export and bounds

WAV rendering uses the same tick scheduler and parameter resolvers as live
playback. Its cycle calculation includes enabled note loops, non-empty
automation loops, the ordered Arp note cycle, and the shared progression when
an enabled instrument follows it. A following Pad's unused local chord duration
does not extend the export; its active automation still can.

Export includes a complete common cycle when that cycle fits within 128
quarter-note beats, with at least two 4/4 bars. If combining independent meters
would exceed that limit, it exports the longest active cycle as a labelled
excerpt. Random Arp order is also labelled incomplete. Instrument releases,
late automated decay/release values and performance-effect tails are retained.

Curves contain at most 480 points each. There are 97 lanes across twelve
instruments. The project boundary remains 1 MiB of decoded JSON; the compressed
snapshot link limit is 600,000 characters. A maximum-length randomized fixture
with all 97 curves has been round-tripped through real browser URL fragments in
Chrome and desktop WebKit. These checks do not establish every messaging app's
or URL-sharing service's own length limit.

## Verification

Model tests cover linked and independent resizing, migration, shared chord
selection, scale-degree shifts, recording phase and bounded export cycles.
`src/progression-library.test.ts` compares plain chords against the previous
voicing and label code in every key and scale, checks every Type and Borrow in
several keys, and applies every library entry in every scale.
`tests/chord-preview.spec.ts` observes preview oscillators and the master
analyser in both modes, stopped and playing, and checks the saved project and
Undo are unchanged, colour persistence through Undo, reload and links, library
audition and apply, phone widths, and that export ignores previews while colours
change the rendered audio.
`tests/composition-audio.spec.ts` renders an eight-bar automation curve over a
one-bar bass sequence, compares followed/local Pad audio, checks both directions
of swung/triplet chord scheduling, verifies held Vocal pitch, and exercises the
maximum-length share in Chrome and desktop WebKit. Existing synthesis profiles
are unchanged.
