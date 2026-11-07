Music vocal additions

catalog-v2.json contains the 24 unchanged legacy entries followed by 24 new
music-vocal samples. catalog.json and the old audio URLs remain unchanged.

Indices 24–31: Soul — eight short sung house words and phrases.
Indices 32–39: Air — eight stable vowel/ad-lib regions tuned to their nearest semitone.
Indices 40–47: Dance — five rhythmic house ad-libs and three dance shouts.

The recordings come from Producer Space's CC0 Soulful House Vocals, Euphoric
Trance Vocals and Dance Vocal Shouts packs. They are source vocal recordings,
not generated speech. See licenses/producer-space-CC0.txt and provenance-v2.json.

All outputs are mono 44.1kHz PCM16 WAV, peak-normalized to -1dBFS with short
fades. Durations are 0.32–2.33 seconds. Each file is smaller than 256KiB.
128 absolute-amplitude waveform bins are supplied per file.

Pitch metadata:
- tuned-chop: measured periodic vowel/ad-lib, shifted to their nearest semitone with preserved formants using Rubber Band.
  The original register is retained; the largest correction is 18.3 cents.
  Median output pitches are within 4 cents of their stated rootNote; natural
  within-sample pitch movement remains. Root notes are 73,66,63,63,65,57,57,62.
- source-key: a sung word or phrase retaining its source melody. rootNote is
  the source key tonic near the vocal range; it is a transposition anchor,
  not a claim that the entire phrase sings one fixed pitch. Source key and
  BPM are retained. Audio has not been forced onto a single note.
- playback-reference: unpitched words use neutral rootNote 60.

The old 24 recordings keep their original neutral playback rootNote 60.
A phrase can contain notes outside a newly selected project scale; transposing
it does not rewrite its melody. Use the tuned chops for single-note sequencing.

Rebuild:
  GRAIN_DANCE_SOURCE_DIR=/path/to/cache python3 build-vocals-v2.py
Requires numpy and FFmpeg with the Rubber Band filter. Missing selected files
are downloaded individually from the official archive; source SHA256 and
archive MD5 must both match selection-v2.json. Never overwrites catalog.json.

Audition: /vocals/audition-v2.html
The source selection, stable-pitch crops, waveforms, clipping, fades and browser
decoding were checked. No auditory quality judgement is claimed from an agent
runtime that cannot hear playback; the audition page is supplied for listening.
