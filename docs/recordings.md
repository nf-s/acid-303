# Recorded vocal samples

Grain records up to ten seconds from the microphone, saves the result in IndexedDB, and uses it in the existing Vocal instrument. Recording does not upload audio. Share, Create session, and the explicit Use in session action prepare a shared sample before changing the shared project. Guests may capture microphone input, but their capture graph outputs silence; musical playback and preview remain on the host.

The recorder uses an AudioWorklet with a frame limit, downmixes input to mono, resamples locally, and reuses the WAV encoder. Stop, Cancel, permission failure, page exit, and late permission responses release microphone tracks. The module is imported with `?url&no-inline`: the production worklet must be a separate same-origin JavaScript asset to satisfy the existing CSP. `Permissions-Policy` allows `microphone=(self)`; camera and location remain disabled.

Capture and import peak-normalize PCM after resampling to 0.8 (about −2 dBFS).
Peaks below 0.0001 are left quiet and nonfinite samples become zero. Repeated
normalization is idempotent. Existing custom recordings normalize their decoded
playback buffer after integrity validation; source WAV bytes, hashes, asset IDs
and shared links remain intact. Built-in samples retain their authored levels.
The custom waveform reflects the normalized peaks. Gain beside the waveform
adds −24 to +24 dB before Tone/Drive, defaults to 0 dB, and double-tap resets it.
It is separate from the mixer Level and has its own automatable/recordable lane.
Tapping a knob opens automation without scrolling the control away; keyboard
activation still reveals the editor. This preserves double-tap reset and prevents
a compatibility click from landing on an unrelated control after a layout jump.

Import WAV accepts ordinary mono/stereo 16-bit PCM at 24, 44.1, or 48 kHz, up to 2 MiB and ten seconds. RIFF sizes, padded chunk boundaries, format fields, alignment, and duration are checked before PCM allocation. Unsupported codecs and malformed input are rejected. Valid imports are downmixed and resampled locally; the server never accepts these larger original files.

## Local and shared data

- Canonical audio: 24,000 Hz, one channel, 16-bit PCM, a fixed 44-byte WAV header, 0.05–10 seconds. Maximum encoded size: 480,044 bytes.
- Local library: at most 24 records, each holding canonical ArrayBuffer bytes and validated metadata; read operations reconstruct a Blob. This avoids a reproduced WebKit Blob persistence failure. Browser storage can be unavailable or evicted; Download preserves a WAV outside browser storage. No PCM is stored in localStorage, track links, session patches, or room snapshots.
- Project references contain an ID, SHA-256, display name, duration, playback reference C4, and 128 waveform peaks. Shared references also contain a read capability. Names are rendered as text, never HTML.
- Explicit upload creates a separate random 128-bit asset ID and independent 256-bit read and delete capabilities. Only the read capability enters the shared project. Pending upload credentials remain on the owner's device so retries use the same ID without consuming another quota entry.
- The loader validates the WAV, duration, and hash before decoding. Cache/source identity includes the recording ID and content hash. A missing local or expired shared recording leaves that vocal unavailable; it does not substitute a built-in sound. A previously downloaded local copy can still play offline.
- Explicit sharing verifies an existing shared reference. If it has expired and a valid local copy remains, sharing uploads a fresh asset with new capabilities. Normal playback never uploads or restores an expired remote asset automatically.

Anyone with a track or session link can download the included recording. This is capability-based private access, not account-based access or end-to-end encryption. The Worker stores capability hashes and never needs to log audio or bearer values. Deleting a shared copy prevents new downloads; downloaded copies remain on their devices. Origin checks restrict browser access but are not a substitute for capability authentication.

## Storage and API

`SampleStore` is a new SQLite Durable Object export in the existing `grain-sessions` Worker. The existing `SessionRoom` namespace and room data remain intact. The first hexadecimal digit of a validated sample ID, modulo eight, selects one of eight fixed quota buckets. No R2, D1, Cron Trigger, public bucket, or new sign-in is required.

Each bucket permits 64 active samples, 32 MiB of canonical audio, and 12 successful new uploads per UTC day. The aggregate upper bounds are 512 active samples, 256 MiB, and 96 uploads/day. A full bucket can reject an upload while another has room; this deliberately avoids cross-object quota reconciliation. Idempotent retries do not consume another entry. Deletion frees active capacity but does not reset the daily upload allowance.

The Worker accepts only `PUT /samples/:id`, `GET /samples/:id`, and `DELETE /samples/:id`, with bearer credentials in headers. Uploads require `audio/wav`, validate the complete fixed PCM format, enforce the actual streamed size even without Content-Length, and stop after 15 seconds. The edge reads the bounded request before one buffered storage call; a slow uploader cannot hold a Durable Object open. Reads are authenticated before loading the BLOB. Responses use `private, no-store`; the explicit local IndexedDB cache is separate from HTTP caching.

The SQLite transaction checks quota and writes the BLOB, metadata, and counters atomically. Primary-key reads and the `(expires_at, id)` index avoid scans. Each object uses one alarm for its next expiry and deletes at most its 64 bounded rows per alarm. A successful authenticated download extends expiry at most once per UTC day. Retention is 30 days rounded up to the next day, giving 30–31 days from the last server access. Local playback without a request cannot renew server retention.

Native Worker rate limits add approximate per-location throttling: six uploads/minute and sixty reads/deletes/minute per IP. Durable counters enforce the actual accepted-upload/storage bounds. These limits do not constitute a complete billing cap and can be exhausted by anonymous abuse; failure keeps the local recording intact. Cloudflare documents why strict worldwide quotas require durable coordination rather than the approximate binding alone. [Rate-limit semantics](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## Cost review

Current Cloudflare documentation lists an 8 MB SQLite BLOB/row limit and 10 GB per object, well above the selected clip and bucket bounds. [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

SQLite Durable Objects include 5 GB of storage on the Workers paid plan, with excess at $0.20/GB-month. Paid compute includes one million DO requests and 400,000 GB-seconds monthly; excess rates are $0.15/million requests and $12.50/million GB-seconds. SQL includes 25 billion rows read and 50 million rows written monthly; excess rates are $0.001/million reads and $1/million writes. Alarm changes and deletes count as writes. Each active object is billed at 128 MB, and billable units round up. Existing account usage shares those allowances, so zero incremental cost is not guaranteed. [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

The maximum 512 full-length clips contain about 0.246 GB of PCM, plus metadata/index overhead. R2's $0.015/GB-month storage rate is lower, but a second metadata/expiry service and coordinated quota handling would add complexity for this bounded size. R2 can be reconsidered if usage grows substantially. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Runtime tests use a representative full 64-row bucket: primary-key metadata lookup reads one row, earliest-expiry lookup reads one row, and EXPLAIN QUERY PLAN selects the expiry index. Tests also verify atomic daily limits under concurrent requests, idempotency, eviction/restart, byte/count limits, authenticated deletion, alarm cleanup, forbidden origins, and malformed streamed bodies. These measurements cover the stated queries, not a claim that an entire API operation consumes one row.

## Release and verification

Run root TypeScript/unit/browser checks and the Worker type/runtime tests. Build with the existing `cf` workflow, review the generated resource diff, and confirm it adds only the SampleStore namespace and the two sample rate-limit bindings. Preserve the existing SessionRoom namespace and compatibility state. The release also retains the pre-existing reserved WebSocket close-code fix and its three regression tests.

Deploy the compatible Worker first, read back its bundle and bindings, and verify an old room survives while v6 peers can share recording references. Then deploy the exact reviewed Pages payload using the existing config-free staging process. Include the current microphone/analytics headers and the emitted worklet asset; preserve native Pages analytics and the Grain launcher. Verify recording under the real CSP without bypass. Delete identified sample/room fixtures after live verification; do not create production fixtures until release GO.

Browser tests generate a MediaStream to exercise the actual capture worklet, resampling, IndexedDB, private upload/download, cancellation, permission denial, and host/guest paths without opening a physical microphone. Physical mobile microphone permissions and hardware are a separate manual check.
