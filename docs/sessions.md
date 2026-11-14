# Shared sessions

The static application stays at https://acid-303.pages.dev/. The separate
`grain-sessions` Worker coordinates shared musical projects. The API
origin is https://grain-sessions.nf-s.workers.dev. This production backend was
deployed and verified on 7 November 2026.

A session has one host and up to seven guests. Only the host plays audio.
Guests can edit every musical field and request Play, Stop or Restart. The host
must unlock browser audio with a user gesture. A disconnected host is never
replaced by a guest. Reconnecting the host replaces its old connection with
nonretryable WebSocket close code `4009`; the old browser must stop playback.

Sessions expire 24 hours after creation. The host can end a session earlier.
Ending or expiration closes its sockets, deletes the stored project and revokes
both credentials. Local projects and snapshot Share links remain independent.

## Session controls and connection screen

The Session button sits in the transport's tool row beside Mixer, Tempo, Scale,
Share, Undo, Redo, Motion and Export WAV. Mixer, Tempo, Scale and Session each
open one panel below the row; Tempo and Scale show the current BPM and key.
The session panel opens once when a session first connects, so the host sees
the invite link.

While a session cannot be edited, a full-screen screen (`src/session-overlay.ts`)
covers the studio and makes it inert: joining or starting, reconnecting, failed,
ended, or a guest waiting for a disconnected host. It always offers a way out
(Leave session, Cancel or Continue solo) and, after a failure, Retry. A
WebSocket handshake rejected with 404, 403 or 410 reaches the browser only as
close code `1006`, so a room that never welcomes the client fails after three
attempts (about two seconds) instead of retrying for most of a minute. Once a
client has been welcomed, reconnects keep the capped backoff described below.

Only the host changes the studio mode (Grain or Fluff). Guests see the mode
switch disabled and follow the host's mode with the rest of the shared project.
In a session the host's switch revoices the shared track instead of opening the
other mode's locally saved project. The Worker rejects guest patches that change
`mode` with `invalid-patch`; the client also keeps the current mode when a
guest uses Undo or Redo. The Worker has enforced this, and carried `mode` and
per-track `family`, since the [host-only mode release](#host-only-mode-production-release-evidence).

## Data and authentication

- `POST /sessions` accepts `{project}` validated by the shared musical schema.
  It returns a random 128-bit room ID, distinct 256-bit host and guest tokens,
  and `expiresAt`. Creation also normalizes scale-locked pitches.
- `GET /sessions/:roomId?clientId=<id>` upgrades to a WebSocket. The browser sends
  protocols `["grain-session-v5", token]`. The response selects only
  the requested compatible version (`grain-session-v7`, `grain-session-v6`, `grain-session-v5`, `grain-session-v4` or `grain-session-v3`); credentials are never put in an API URL or echoed as the
  selected protocol. The server derives the role from the token.
- Only token SHA-256 hashes are stored. Comparison uses the Workers
  constant-time comparison API. Guest links contain only the guest token in the
  URL fragment. Possession of that link grants editing access, not host access.
- The production Origin allowlist contains only `https://acid-303.pages.dev`.
  The development config additionally accepts HTTP/HTTPS `localhost` and
  `127.0.0.1`, including ports 4317 and 4319. Missing and other origins fail.
  Origin checks complement token authentication; they are not authentication.
- HTTP bodies and incoming WebSocket messages are limited to 1 MiB. Patches
  contain at most 4,096 changes, eight path segments, array indexes up to 479,
  and bounded JSON values. Sparse array changes group up to 480 unique cell
  entries without replacing untouched cells.
  Prototype keys, unknown paths and invalid resulting projects are rejected.
- One room retains at most 16 writer identities until expiry for reconnect
  deduplication. Up to eight connections are active at once; a host slot is
  reserved. A guest cannot reuse an active host's identity to replace it.

`src/session-protocol.ts` defines the complete Zod-validated wire contract and
shared `diffProject` / `applyProjectChanges` functions. Equal-length arrays merge
per index. Variable-length collections, such as selected arp notes, replace
atomically. Changing a pattern length replaces its arrays and timing in the
same validated transaction. Accepted changes are applied to the current authoritative project,
normalized through the musical schema and broadcast in server revision order.
The server's canonical diff includes any additional scale corrections.

Each accepted patch contains a client ID and increasing sequence number. The
server persists the project, revision and that client's last sequence in one
SQLite row before broadcasting. Retried sequences receive an acknowledgement
without a second write. A reconnecting client's welcome includes the current
project and its acknowledged sequence. The browser rebases pending changes on
that authoritative state. Concurrent changes to different fields survive;
concurrent changes to the same field follow server order.

Transient disconnects retain the room credentials and queued edits. New edits and
reconnect replay share a 100 ms sending interval; snapshots are requested once
per recovery, with a 1.1 second cooldown after edit throttling. A throttled edit
does not block clocks, Stop, or recovery messages. Packet overload closes with
retryable code `1013`, leaving room state and acknowledgements intact. The client
also retries the old server's `1008` message-rate close, and continues reconnecting
with a capped backoff while its known room is unexpired. Host audio stops on
connection loss and does not automatically restart; guests remain silent.
A protocol upgrade (`4010`) explicitly asks the user to reload, preserving the
room and credentials instead of describing it as unavailable. This resilience
update retains protocol v3 and needs no namespace, schema or binding migration.

The regression reproduced 43 unacknowledged edits replaying as 43 patches plus
19 snapshot requests within one second, triggering the old 60-packet limit.
The corrected Chrome/Worker run recovered all 43 edits, sent nine patches during
the first second, and stayed connected. Client unit checks cover throttling,
queued-edit preservation, host loss, replacement, prolonged outages and reload
instructions. Runtime tests verify that throttling preserves the room and its
sequence state. Existing two-browser tests verify host-only audio and guest role
retention. No extra database operation is introduced; replayed acknowledgements
still avoid writes and steady editing now batches at up to 10 Hz instead of 20 Hz.

The host sends `clock` messages containing `playing` and `absoluteTick`, in
24 ticks per quarter note. Steady playback clocks are capped at 20 per second;
Play, Stop and Restart transitions send immediately. Each client resolves its
per-instrument pages from that shared clock, timing metadata and swing.
Guests cannot send authoritative clocks or end the room. Guest transport
requests are routed to the host; they do not claim playback has started.
Guest patches are rejected while the host is disconnected. Presence and clock
state are stored in hibernating WebSocket attachments, not SQLite. Plaintext
`ping` / `pong` is reserved for the hibernation auto-response heartbeat.

## Vocal gain compatibility

Protocol v7 adds `supportsVocalGain`; project version remains 6 with additive
`vocal.gain` (default 0.5, representing 0 dB) and `vocal.automation.gain`
(default null). Older saved projects keep unity input gain. Host protocol 7 or
later advertises gain playback support; a new guest with an older host sees the
Gain control disabled with a local explanation. Other vocal controls remain
available.

Protocol v6 peers retain all composition and recording fields, but their wire
projection omits gain and its curve. v3–v5 projections omit them too. An older
peer's whole-track or automation replacement preserves canonical gain. If an
older peer changes Vocal timing, the hidden gain curve resamples to the resulting
automation length. Older protocols cannot write gain directly. These changes do
not require a namespace migration or force an existing tab to reload.

## Timing migration and coordinated rollout

Project version 3 adds independent instrument timing and centered global FX.
Older projects retain their one-bar, 16-step sequencers. Pad progression lengths
move from `pad.bars` to `pad.timing.bars`; the old 16 automation knots expand by
cyclic interpolation across the existing progression. Musical controls and
scale remain intact. Maximum lengths are 240 cells for the original drum, Bass,
Texture and Arp sequencers and 480 for Pads, Vocal, Cloud and Tension, with all non-null automation lanes matching their instrument length.

The Worker accepts old project snapshots through the same validated migration
used by local imports. Existing room credentials, expiry, revision and client
sequence acknowledgements remain intact. A migrated snapshot is written on the
next accepted edit; migration itself does not add a storage write.

The timing and sound-catalog upgrades required v1/v2 tabs to reload. Those
protocols still receive `reload-required` and close `4010`, without displacing a
current host. The vocal release preserves compatible v3 connections as described
below; no Durable Object namespace migration or deletion is required.

## Vocal compatibility

Project version 4 adds the independently timed Vocal sampler, its note rectangles
and eight automation lanes. Older projects migrate with vocals muted; their
existing music, timing, revision, credentials and deduplication state remain
unchanged. Vocal audio files are static Pages assets. The Worker stores musical
parameters only and never fetches, decodes or streams audio.

Deploy the v4-compatible Worker before the new Pages client. Authoritative room
state uses Project 4, but existing v3 sockets remain open. A v3 welcome projects
the previous fields with version 3 and omits vocals. Vocal-only edits become empty
v3 patches with the original revision, client ID and sequence, preserving ordering
and acknowledgements. Older edits apply to the complete authoritative snapshot
and cannot erase or overwrite the new vocal instrument. Host replacement still
requires the host credential and closes only that replaced host connection.

V4 welcome and presence messages include `supportsVocal`, derived from the active
host's protocol. V3 messages omit this field to satisfy their strict schemas. A
new guest editing alongside an old host sees that the host must reload to hear
vocals; guests remain silent and are never promoted. A v4 host supports both old
and new guests. V3 retained connections and reconnects survive Durable Object
hibernation; no release-induced reload is required for them.

The compatibility checks use the real frozen `70d764c` v3 frontend with a new v4
guest. Vocal edits, empty legacy revisions, subsequent old-client edits, host-only
Play/Stop, old-host reload/reconnect and room ending pass. Runtime coverage also
checks v3 hibernation, an authenticated upgrade to a v4 host, the capability flag,
and an 80-lane maximum snapshot with 480 vocal notes. The payload limit stays
1 MiB and the indexed snapshot read/update remains one row each. No endpoint,
binding, storage table, polling query or clock write is added.

## Cloud, Tension and musical vocal compatibility

Project version 5 adds independently timed Cloud and Tension tracks, each with
six sounds and eight automation lanes. Both migrate muted. The vocal catalog
also expands from 24 to 48 samples; existing sample indices keep their meanings.
The Worker stores parameters only, with no audio fetching or synthesis.

The v5 Worker remains compatible with active v3 and v4 sockets and their saved
credentials. It projects v4 snapshots without Cloud and Tension, and v3 snapshots
without those tracks or Vocal. Unsupported-only edits still deliver empty patches
with the original revision and acknowledgement. Legacy edits apply to the full
canonical project, preserving hidden instruments. A v4 peer sees a new vocal
sample as muted sample 0; its whole-track edits preserve the hidden sample and
mute state. It can explicitly choose an older supported sample, but cannot send
an unsupported sample index or unmute a masked sample accidentally.

V5 welcome and presence messages report `supportsVocal` for host protocol 4 or
newer, and `supportsVocalMusic`, `supportsCloud` and `supportsTension` for protocol 5. Older peers receive only fields accepted by their strict schemas. Guests can
see when the active host needs to reload for a newer sound; they remain silent.
An authenticated host upgrade starts stopped and retains the same room state.

The maximum snapshot now contains 96 automation lanes. The 1 MiB message limit,
4,096-change limit and indexed single-row persistence are unchanged. Very large
project differences compact changed instrument roots into bounded replacements.
A v4 vocal projection may serialize one complete vocal track per vocal edit,
which adds bounded CPU and outgoing bytes but no database query or write beyond
the accepted edit. The final 20 workerd tests cover all three protocol versions,
hibernation, hidden-state preservation, highest sample indices and measured
maximum-snapshot row costs.

## Composition compatibility (v6)

Project and wire protocol version 6 add the shared progression, each track's
independent automation length, follower switches and custom recording references.
Existing room snapshots migrate through the same project boundary; the
SessionRoom namespace, credentials, expiry and ordered revision history remain.
Local-only recording references are rejected at room creation and patch boundaries.
Audio bytes never enter room snapshots or patches; see [recording storage](recordings.md).

Clients on v3–v5 receive projections in their supported format. New metadata is
omitted, automation is projected to their visible sequence length, and a following
Pad receives the shared chord progression. Custom vocals and Arp/Vocal followers
are masked where the older engine cannot play them. The canonical room retains
the full curves and sources. Legacy whole-track and sparse drum replacements merge
with hidden state; ambiguous edits to an independent curve or its timing are
rejected rather than truncating it. Legacy Pad chord edits map to shared Chords.
A current guest warns when the host cannot play the new composition features;
existing clients are not forcibly reloaded or disconnected for this upgrade.

Each legacy patch can include a complete projected changed track/root. This costs
bounded serialization and outbound bytes, with no additional database query or
write. The decoded project and message boundary remains 1 MiB. Schema, projection,
sparse replacement, hibernation and host capability tests cover the new fields.
The pre-existing reserved-close-code handling is retained: the runtime replies to
close events, so application code does not echo reserved codes such as 1005/1006.

## Sound catalog compatibility

The expanded sound catalog introduced wire protocol v3 with Project
version 3. The current release supports those clients alongside v4, v5 and v6. Instrument timing, controls and saved patterns are unchanged. Hats
have eight rebuilt sounds; the other drums have seven, Bass eleven, Texture
eight, Arp eight and Pads eight. Each drum's boundary validates its own catalog;
index 7 is valid for hats and rejected for the other drums.

Existing room snapshots, credentials and deduplication records remain valid.
The v3 Worker closes both legacy v1 and v2 sockets with `reload-required` and
4010 after authentication, including restored hibernating sockets. It sends no
new catalog state to legacy clients and does not let a legacy host replace an
active v3 host. Current source tests cover highest indices across all nine
instruments and reconnection after an old socket closes. The protocol-v3 production evidence below verifies the coordinated upgrade.

This catalog update adds no endpoint, storage row, binding or message type.
The 1 MiB payload boundary, 20 Hz clock cap, indexed snapshot queries and the
metered usage review below remain unchanged.

## Runtime and tests

Each room is a SQLite-backed Durable Object with a single `session_state` row.
There are no polling queries, client-list tables, secondary indexes, triggers,
listing endpoints or server-side audio. Unknown room IDs do not allocate a
persisted room table. The schema is allocated only for validated creation.

The server accepts sockets using the hibernation API. It restores connections
and playback state from attachments after eviction. No interval runs in the
Durable Object. Idle heartbeat replies use the runtime's auto-response API and
do not wake application code. Expiry uses a single alarm.

From `workers/sessions`:

```sh
npm ci
npm run types
npm run check
npm test
npm run build
npm exec -- cf deploy --dry-run --prebuilt
npm run dev
```

The isolated package includes Node 24 for the current `cf` CLI and uses the
Cloudflare Vite/Vitest integrations. `npm run dev` serves port 8787. Generated
runtime/binding declarations live under ignored `.cloudflare/types`; regenerate
them from `cloudflare.config.ts`. `SessionEnv` refines the generated namespace
with its RPC class type because named self-bindings currently infer an untyped
namespace. It does not replace generated binding declarations.

The real workerd tests cover credential roles, untrusted origins, concurrent
patch order, persistence across hibernation, deduplication, clock recovery,
host loss/reconnect/replacement, capacity, malformed/oversized messages,
creation and packet-rate limits, heartbeat auto-response, unknown-room storage,
expiration and revocation. A regression test concurrently edits the final arp
and pad automation lanes, recovers them after hibernation and edits a single
restored curve cell. Additional tests cover old-client rejection without host
displacement, stored v2 migration with preserved deduplication, and a maximum
96-lane project with sparse edits to cells 478–479. Disposable room storage also verifies query plans
and measured SQLite row costs. The frontend additionally tests separate host
and guest browsers against the local Worker.

## Metered usage review

Reviewed 7 November 2026. The connected account can inspect Workers but cannot
read billing subscriptions with its current scope; its Free/Paid plan was not
confirmed. Included allowances are shared with other account applications.
No account plan is changed by this implementation.

Current [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/):

| Meter               | Free allowance  | Paid allowance and overage                   |
| ------------------- | --------------- | -------------------------------------------- |
| DO requests         | 100,000/day     | 1 million/month, then $0.15/million          |
| DO duration         | 13,000 GB-s/day | 400,000 GB-s/month, then $12.50/million GB-s |
| SQLite rows read    | 5 million/day   | 25 billion/month, then $0.001/million        |
| SQLite rows written | 100,000/day     | 50 million/month, then $1/million            |
| SQLite storage      | 5 GB total      | 5 GB-month, then $0.20/GB-month              |

Incoming WebSocket messages use the 20:1 request billing ratio; outgoing messages
are not charged as requests. Hibernation-eligible idle time is not billed as
active duration. An alarm update counts as a row write, and deletes count as
writes. Expired room data is removed using `deleteAll`, including metadata.
See [hibernation behavior](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

The HTTP Worker separately counts room creation and initial WebSocket upgrades;
subsequent WebSocket messages do not count as Worker HTTP requests. The Workers
Paid plan has a $5/month account minimum, 10 million requests and 30 million CPU
milliseconds included; overage is $0.30/million requests and $0.02/million CPU
milliseconds. Workers Free allows 100,000 requests/day. Static Pages requests
remain free. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Measured on populated disposable room rows in workerd:

| Action               | HTTP / DO messages        | SQLite reads                   | SQLite writes                   |
| -------------------- | ------------------------- | ------------------------------ | ------------------------------- |
| Create room          | 1 HTTP + 1 DO RPC         | 0 existing rows                | 1 snapshot + 1 alarm            |
| Join/reconnect       | 1 HTTP + 1 DO upgrade     | 0 warm; 1 cold snapshot load   | 0                               |
| Accepted edit batch  | 1 incoming WS + broadcast | 1 UPSERT lookup; +1 if cold    | 1 snapshot                      |
| Duplicate edit batch | 1 incoming WS + ack       | 0 warm; 1 if cold              | 0                               |
| Sync                 | 1 incoming WS + welcome   | 0 warm; 1 if cold              | 0                               |
| Clock / presence     | WS event + broadcast      | 0, including after hibernation | 0                               |
| Idle heartbeat       | WS auto-response          | 0                              | 0                               |
| End / expiry         | WS message or alarm       | no snapshot load               | deletion of stored row/metadata |

The hot query is `SELECT data FROM session_state WHERE id = 1`.
`EXPLAIN QUERY PLAN` reports `SEARCH session_state USING INTEGER PRIMARY KEY
(rowid=?)`; measured rows read is 1. The production UPSERT on an existing
snapshot reads 1 row and writes 1 row. The disposable probe verifies that
16 clocks leave the stored row byte-for-byte unchanged. No count or broad scan
runs on a user action. The cached snapshot saves a read per warm edit; the
client batches continuous gestures and reconnect replay to at most 10 edit
messages/second. Full-project
replacement can be a larger message, but remains one bounded snapshot write.
The maximum-length randomized 96-lane fixture, including 480 vocal notes and
480 Cloud and Tension cells each, exceeds 530 kB and stays below
1 MiB. Its indexed lookup and update still measure one row read and one row
written; byte size, serialization and schema validation CPU increase despite
that unchanged row count. Sparse curve patches reduce wire duplication, while
each accepted edit still persists the complete authoritative snapshot.

For a one-hour room with three people, clocks at the 20/second ceiling, one
accepted edit/second total and a heartbeat every 15 seconds per device:
72,000 clocks + 3,600 edits + 720 heartbeats = 76,320 incoming messages, or about
3,816 billed DO request units before upgrades/creation/expiry. There are 3,600
edit-row writes plus creation and deletion overhead, and 3,600 UPSERT row reads
plus cold loads. Outgoing fan-out adds no request fee. At an explicitly assumed
average 5 ms active handler time per non-heartbeat message, duration is about
48.4 GB-s. This is an assumption, not a measured CPU guarantee for maximum-size
projects; inspect actual duration after release. Charging the whole hour at the
allocated 128 MB gives a conservative 460.8 GB-s upper bound, not expected
hibernation behavior. These examples do not guarantee available free quota or
estimate other account applications' usage.

Creation checks a 6/minute per-IP limiter and a 60/minute aggregate limiter.
Upgrades check 60/minute per IP. These limits are approximate **per Cloudflare
location**, not worldwide or strict budget caps. A shared mobile/NAT IP can
reach the creation limit. Socket handlers permit 60 application packets/second
and 24 edit batches/second per connection, with maximum eight active clients.
Twenty-four hours, bounded snapshots, bounded participants and dedupe identities
cap retained room data. A sustained group drawing continuously is intentionally
more expensive than the example; eight updated clients at 10 edits/second would write
288,000 rows/hour (legacy clients can still send up to their former 20 Hz). See the [Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Logs are sampled at 10% and traces at 1%; application code emits no project or
token logs. Workers Logs currently includes 200,000 events/day on Free and
20 million/month on Paid, then $0.60/million. Recheck observability pricing for
releases after 1 December 2026, when the published pricing changes. Inspect DO
request/duration, SQLite rows, stored bytes and sampled errors after launch.
See [Workers Logs pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing).

## Host-only mode production release evidence

Worker version `fe279eb4-7ae9-40c3-bd3e-9411c13e66c6` was published on
14 November 2026 at 03:47:23 UTC from commit `6d771c8`, in deployment
`7a5b4417-bd11-4235-bfe8-f3e6e954d6b8` at 100%. It also ships the shared
schema changes since protocol v7: project `mode` (default Grain) and optional
per-track `family`. Both are additive, so the wire protocol stays v7.

- Module: 452,958 bytes, SHA-256
  `677c35340e1ba6bd30448f0f329dc321d92e8138f6841d6dbbd0b0970b63b95d`; the
  downloaded `index.js` matches the local build byte-for-byte.
- Namespaces `ffe237d4fde14ba99780aa4f28eb4bec` (SessionRoom) and
  `f368b26b743f4b3393c20bdd93f866bd` (SampleStore), the five rate limits,
  origin, localhost denial, compatibility settings and 10% logs / 1% traces are
  unchanged.
- `cf deploy` always runs strict and refuses a Worker last uploaded through the
  script API when non-interactive; an interactive terminal asks to confirm
  instead. That deploy enabled Preview URLs by default; they were disabled again
  through the API and `previewUrls: false` is now set in `cloudflare.config.ts`.
  The workers.dev route stayed enabled.

`/health` returned 200. Creation from the canonical origin passed the origin
check; localhost, other and missing origins returned 403. One test room was
created at 03:49:02.412 UTC. A guest `mode` patch received `invalid-patch`
("Only the host can change the studio"); the host's `mode` and `bass` (with
`family`) patch reached the guest as revision 1, and the guest's snapshot
reported `mode: "fluff"` and `bass.family: "grain"`. The host ended the room at
03:49:02.898 UTC; a guest reconnect was refused. No test room remains active.

Before release: 32 workerd tests, strict typechecking, generated binding types,
production build and dry-run passed; the frontend passed 4,274 unit tests and
the updated browser specs. The matching Pages client went live the same day; see
[the Pages release](deployment.md#session-screen-and-tool-row-release).

## Protocol v7 production release evidence

Worker version `ed96973a-7d39-49df-908d-bccfa3d29603` was published on
8 November 2026 with no namespace, rate-limit or resource changes. Existing v6
sockets survived and preserved the new gain curve during older-peer edits.
See [vocal gain release evidence](vocal-gain-release.md) for hashes, live checks
and identified test-room cleanup.

## Protocol v6 production release evidence

Source `00522b0` was released on 8 November 2026. Worker version
`4a1cab38-0323-46c8-91b6-a1b3f21870f7` retains SessionRoom namespace
`ffe237d4fde14ba99780aa4f28eb4bec` and adds SampleStore namespace
`f368b26b743f4b3393c20bdd93f866bd`. Old v5 host/guest pages stayed connected
through Worker and Pages upgrades; a fresh v6 guest joined and edited the same
room with the correct older-host capabilities. Test rooms and recording assets
were cleaned up. Full hashes, tests and continuity results are recorded in
[the Stage 12 release](stage12-release.md).

## Protocol v5 production release evidence

Released 7 November 2026 at 14:05:13 UTC from commit `a0ff876`, using the frozen
production bundle and authenticated Cloudflare API. Worker version
`78889346-26cb-4ed2-b175-0b83c69f2f3a` serves 100% in deployment
`f3b13d35-4937-4b8d-9758-eae182c98c8a`. The downloaded module matches the local
426,317-byte artifact, SHA-256
`86258c5161ead75bc7859ea8be3e5a809098a26bdf17b85fb6300b656f41c8ff`.
The SQLite namespace `ffe237d4fde14ba99780aa4f28eb4bec`, origin allowlist,
rate bindings and observability settings are unchanged. Export reconciliation
created, changed and deleted no namespaces. Health returned 200; missing and
unapproved Origins returned 403.

One identified test room was created at 14:04:41.344 UTC before deployment.
Its v4 host and v3 guest stayed connected through the update without close events.
A v5 guest then recovered the same revision and edited Cloud, Tension and vocal
sample 47. Legacy projections, empty v3 revisions, v4 masked vocal edits,
hidden-state preservation, host-only clocks and an authenticated v5 host upgrade
all passed. The replacement host started stopped and the previous host closed
with code 4009. The room was ended and its credentials revoked at 14:05:28.738 UTC;
no test room remains.

Before publication, 20 workerd tests, generated types, strict typechecking,
production build and deployment dry-run passed. The coordinated frontend passed
190 unit tests. Chrome and WebKit each rendered every new performance sound at
default and extreme settings and verified all sixteen automated controls.
The durable audio regression also checks held Cloud playback, release/resume,
independent simultaneous Tension strikes, Stop cleanup and silent guests.

## Vocal compatibility production release evidence

Released 7 November 2026 at 13:32:22 UTC from commit `2edeabb`, using the
authenticated Cloudflare API and the frozen production bundle.

- Worker version: `3c56cfca-efd3-4922-8842-40602c104ab5`, deployed at 100%.
- Deployment: `87b4e001-a0c6-46af-8de8-5be5769f8af7`.
- SQLite namespace remains `ffe237d4fde14ba99780aa4f28eb4bec`.
- Downloaded production module: 417,344 bytes, SHA-256
  `3ad4ae9fd22af2c49c81c816b2d206431f9afc797667595a264a9c7b2e104cfe`,
  matching the verified local bundle byte-for-byte.

The canonical-origin upgrade probe created one disposable v3 room at
13:31:55.982 UTC, before the update. Its existing v3 host and guest sockets
remained connected across deployment. The probe verified legacy welcome
projection, v4 vocal state and host capability reporting, empty projected patch
revisions, and old-client edits preserving the new vocal track. Guest clocks
were rejected; legacy host clocks still worked. An authenticated v4 host
replacement retained the room and acknowledgements, closed the previous host
with 4009, and started stopped. The test room was ended and its credentials
revoked at 13:32:31.256 UTC. No user room was ended.

Read-back confirmed the existing origin, localhost disabled, all three rate
bindings, SQLite namespace, 10% logs and 1% traces. Health returned 200;
disallowed and missing Origins returned 403. No resource reconciliation or
account setting changes occurred. Before deployment, 18 workerd tests, strict
typechecking, the production build and dry-run passed against the final vocal
schema. Frontend deployment follows this backend compatibility verification.

## Session recovery production release evidence

On 7 November 2026 at 12:25 UTC, checkpoint `b9b4815` was deployed through the
authenticated Cloudflare API. Worker version
`050ccabe-6e63-4fe3-a89b-a1104b633673` is at 100% in deployment
`2261beb1-daf2-41a3-9d2c-2022928a218d`. The downloaded 412,882-byte module has
SHA-256 `449811a3096d6b3933e7a87324103bf452ff06e7242f8c4e6531a2ef8b901b38`, matching
the checked production artifact. Protocol v3, the existing namespace
`ffe237d4fde14ba99780aa4f28eb4bec`, origins, rate bindings and observability remain
unchanged; namespace reconciliation created, updated and deleted nothing.

One disposable host/guest room was created at 12:25:13 UTC before the update.
Both sockets stayed connected through deployment; its project, revision and
sequence acknowledgement survived. The production probe verified edit
throttling while clock, snapshot and Stop remained usable, retryable packet
close `1013`, preserved state after reconnect, duplicate-edit acknowledgement,
guest transport routing, and rejection of guest clocks and End. A reconnecting
host remained stopped. The test room was explicitly ended at 12:25:56 UTC; no
user room was touched. Health returned 200, and missing/untrusted origins 403.

Before release, 17 workerd tests, 18 focused client/sync/protocol tests, all six
existing session browser tests, generated types, strict typechecks, build and
prebuilt dry-run passed. The 43-edit interruption regression also passed in
Chrome and mobile WebKit, retaining every queued edit without a flood. Root
verified the complete 145-test unit suite before checkpointing. The matching
Pages client update follows separately; existing protocol-v3 clients remain
compatible with this Worker.

## Release

Production publication is a coordinated release, not part of `npm run build`.
The application's existing public access policy is explicit: no sign-in. The
Worker's high-entropy session credentials authorize room access. Durable Object
bindings require this separate Worker; no Pages migration or account-wide
Workers-subdomain change is needed.

1. Finish the shared model changes, regenerate types, typecheck and run both
   protocol and Worker runtime tests plus the frontend multi-browser tests.
2. Build production output and inspect `.cloudflare/output/v0/workers/default/worker.config.json`:
   localhost must be disabled and the canonical Pages origin unchanged. Confirm
   the SQLite `SessionRoom` and `SampleStore` bindings; preserve the existing
   SessionRoom namespace and review any resource additions before publishing.
3. Run `npm exec -- cf deploy --dry-run --prebuilt`. After the coordinated GO,
   publish with `npm exec -- cf deploy --prebuilt` using the verified account.
   The cf config describes this Worker's SQLite Durable Object exports.
   If the CLI has no login or rejects the existing script-API ownership, the
   authenticated Cloudflare connector can upload
   the same built module with the production config's bindings and declarative
   `exports` metadata, then enable this script's workers.dev route. Do not use
   a temporary account or change the account-wide subdomain.
4. Read back the deployed Worker settings and namespaces. Verify `/health`, a
   real canonical-origin creation, host and guest joins, ordered edits, host
   replacement, denied credentials/origins, and end/revocation. Delete test
   rooms by ending them. Confirm a localhost Origin is denied in production.
5. Set the static app's `VITE_SESSION_API` to the verified production origin and
   use the existing Pages release process. Verify the complete host/guest flow
   on the canonical Pages origin, including guest silence and host disconnect.

The public launcher continues to point to the app's existing Pages URL. The
backend API is not a separate launcher application.

## Protocol v3 release evidence

Released 7 November 2026 at 11:48:04 UTC from commit `0b3aff6`, using the frozen
412,890-byte production module. Worker version
`5bda2f8d-b03c-48f4-834a-0bd67f7114a6` is deployed at 100% in deployment
`4c09a706-e7e4-40a4-b9e8-0bff86612142`. Downloaded production SHA-256:
`cf559d3c16ffbaeed2cd65913219054fc2afb123f7aca02a920dd28325e5749d`.
It exactly matches the validated bundle. SQLite namespace
`ffe237d4fde14ba99780aa4f28eb4bec`, origin, localhost denial, rate bindings,
observability and route settings remain unchanged. Export reconciliation
created, changed and deleted no namespaces. Health returned 200; other,
localhost and missing origins returned 403.

One canonical-origin test room was created on v2 at 11:47:36.395 UTC, before the
upload. Its saved BPM, revision, host credential and acknowledged client sequence
survived the live upgrade. Both old v2 sockets closed with 4010. Reconnected v3
host and guest successfully applied ordered edits selecting every highest sound
index: Kick/Snare/Clap/Rim 6, Hat 7, Bass 10, Texture/Arp/Pads 7. Host tick clocks
worked; guest clocks and invalid tokens were denied. Authenticated v1/v2 upgrade
attempts received `reload-required` without replacing the v3 host. The room was
ended at 11:51:59.620 UTC, all sockets closed, and credential revocation was
verified by a failed reconnect. No test room remains active.

Before release, 15 workerd tests, strict typechecking, generated binding types,
production build and dry-run passed. The frozen frontend passed 130 unit tests
and 47 browser tests, including maximum catalog sharing and sessions. Chrome
and WebKit rendered each new sound at normal and extreme settings, verified all
eight automation controls, and rendered dense full mixes below the 0.95 output
ceiling with silent tails. Existing non-hat voices remained within one 16-bit
PCM unit of the prior release. The separate Pages publication uses the same
frozen sound commit and verifies host-only audio on the public origin.

## Protocol v2 release evidence

Released 7 November 2026 at 11:29:25 UTC from commit `5d79ac2`, using the
verified frozen production module and authenticated Cloudflare API. The Worker
version is `cd4f6600-ca6f-41c4-a502-2b0b0340f8b7`, deployed at 100% in deployment
`db34bce2-b450-4010-9ba8-519f3dbf6236`. The existing SQLite namespace remains
`ffe237d4fde14ba99780aa4f28eb4bec`. Export reconciliation created, changed and
deleted no namespaces. Origin, rate bindings, observability and route settings
remain unchanged.

The downloaded production module matched the frozen local bundle: 412,359
bytes, SHA-256
`440e3a32897ff79782e6955f71d035f341f0d979853834cd230c33cc7bd5c539`.
Before release, 14 workerd tests, strict typechecking, the production build and
deployment dry-run passed, including maximum-length snapshots and v2 project
migration. The coordinated frontend checkpoint passed 126 unit tests and 46
browser tests. Independent Chrome and WebKit audio checks each passed 11
render cases and live stop, stopped-control update and restart checks.

A canonical-origin backend smoke created one room at 11:30:39.005 UTC and ended
and revoked it at 11:30:42.327 UTC. It verified v2 host/guest roles, ordered
concurrent edits, a 240-cell bass pattern, sparse edits to Pad automation cells
478–479, transport requests and fractional tick clocks. Guest clock/end requests,
invalid tokens and disallowed origins were denied. A v1 host upgrade received
`reload-required` and close 4010 while the current v2 host retained its role and
state. Host replacement used close 4009. End revocation was confirmed by a failed
reconnect; all test sockets closed. The Pages release proceeds only after this
backend verification and separately tests frontend host-only audio.

## Original production release evidence

Released 7 November 2026 at 08:01:57 UTC from commit `1ccce3c`, using the
authenticated Cloudflare API and the frozen cf production build. The script's
workers.dev route is enabled; preview routes are disabled. No other Worker,
namespace or account-wide subdomain was changed.

- Worker version: `f7fda390-2c45-4b3f-a122-8c33c5b1a238`, deployed at 100%.
- Deployment: `96929806-3141-4982-a893-e12a5549a1c2`.
- SQLite namespace: `ffe237d4fde14ba99780aa4f28eb4bec` (`grain-sessions_SessionRoom`).
- Downloaded production module: 395,669 bytes, SHA-256
  `3a9eb8a0060424a92bd82585e6444bf7f3865f6e0f9c1025f0773e8d0ee7396b`,
  matching the verified local bundle byte-for-byte.

Read-back confirmed the expected origin, localhost disabled, all three rate
bindings, SQLite storage, 10% logs and 1% traces. `/health` returned 200. Other,
missing and localhost Origins returned 403.

A backend-only Chrome check from the canonical Pages origin created one room
at 08:03:12.698 UTC and ended it at 08:03:14.888 UTC. It verified separate
credentials and roles, invalid-token denial, guest clock/end denial, ordered
concurrent BPM/arp-automation edits, transport routing, host clocks, ping/pong,
host replacement with close code 4009 and credential revocation after ending.
All test sockets closed, and the namespace's subsequent object listing was
empty. Final full-interface testing belongs to the coordinated Pages release.

Before publication, 12 workerd tests, strict backend typechecking, the production
build and deployment dry-run passed against the final instrument schemas. The
application release also passed 107 unit tests and 34 preview browser tests.

The coordinated Pages release is deployment
`81e5ee0f-aaa0-46f6-8f71-360e90fa707d`, built from the same `1ccce3c` commit.
All 34 browser tests passed on the canonical public origin with normal CSP,
including simultaneous edits, guest silence, host replacement and reconnection.
An additional live disconnect check confirmed that host audio stops when the
connection drops. Every test room was ended.

Release verification also passed 20 public route checks and 26 asset hash
comparisons across canonical and immutable origins. At 320, 375 and 1440 pixels,
the app had no horizontal overflow or browser errors; IBM Plex Mono loaded and
all ten examples appeared above the instruments. Native analytics remained
enabled with one beacon per page and successful GET/POST responses. The existing
NFS Home Grain link still points to the canonical Pages address.
