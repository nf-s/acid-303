Grain vocal sample catalog

24 edited clips from Kenney's Voiceover Pack and Voiceover Pack (Fighter).
The source pages and both bundled licenses identify the recordings as CC0.
Original license and performer credit files are retained in licenses/.

Primary sources:
https://kenney.nl/assets/voiceover-pack
https://kenney.nl/assets/voiceover-pack-fighter

The catalog has eight female, eight male and eight fighter-announcer clips:
16 short words, five vowel windows and three consonant/onset cuts. No complete
multi-word game announcements are included. Vowel labels identify the source
word; they do not claim a precise phonetic transcription.

WAV format: mono, 44100 Hz, 16-bit PCM. Edits remove leading/trailing silence
and DC offset, add short fades, and normalize peaks to -1 dBFS. Per-file source
paths, checksums, extraction times and processing parameters are in catalog.json.
Each sample includes 128 absolute-amplitude peak bins for waveform display.

rootNote 60 (MIDI C4) is a sampler unity-playback reference. Natural speech is
not tuned to a fixed note; this is not a detected fundamental or pitch claim.

Source credits: Giselle (female) and Jeffrey M. Smith (male). The fighter pack
does not name its performer; no performer identity has been inferred.

The source landing pages advertise 90 and 45 assets. The downloaded archives
contain 46 clips per voice folder (46 female, 46 male, 46 fighter), excluding
preview files. The selection contains 24 files regardless of those source totals.

Rebuild with build-vocals.py using Python+numpy+ffmpeg and extracted official
packs in GRAIN_VOCAL_SOURCE_DIR. provenance.json retains archive hashes.
