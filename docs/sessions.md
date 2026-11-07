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

## Data and authentication

- `POST /sessions` accepts `{project}` validated by the shared musical schema.
  It returns a random 128-bit room ID, distinct 256-bit host and guest tokens,
  and `expiresAt`. Creation also normalizes scale-locked pitches.
- `GET /sessions/:roomId?clientId=<id>` upgrades to a WebSocket. The browser sends
  protocols `["grain-session-v2", token]`. The response selects only
  `grain-session-v2`; credentials are never put in an API URL or echoed as the
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

The host sends `clock` messages containing `playing` and `absoluteTick`, in
24 ticks per quarter note. Steady playback clocks are capped at 20 per second;
Play, Stop and Restart transitions send immediately. Each client resolves its
per-instrument pages from that shared clock, timing metadata and swing.
Guests cannot send authoritative clocks or end the room. Guest transport
requests are routed to the host; they do not claim playback has started.
Guest patches are rejected while the host is disconnected. Presence and clock
state are stored in hibernating WebSocket attachments, not SQLite. Plaintext
`ping` / `pong` is reserved for the hibernation auto-response heartbeat.

## Timing migration and coordinated rollout

Project version 3 adds independent instrument timing and centered global FX.
Older projects retain their one-bar, 16-step sequencers. Pad progression lengths
move from `pad.bars` to `pad.timing.bars`; the old 16 automation knots expand by
cyclic interpolation across the existing progression. Musical controls and
scale remain intact. Maximum lengths are 240 cells for each sequencer and 480
for Pads, with all non-null automation lanes matching their instrument length.

The Worker accepts old project snapshots through the same validated migration
used by local imports. Existing room credentials, expiry, revision and client
sequence acknowledgements remain intact. A migrated snapshot is written on the
next accepted edit; migration itself does not add a storage write.

Deploy the v2 Worker before the matching Pages client. Existing v1 sockets and
authenticated v1 upgrade attempts receive `reload-required` and nonretryable
close code `4010`, with no welcome or project data. A legacy host reconnect
cannot displace a v2 host. Old Pages tabs must reload after the Pages deployment.
This avoids interpreting old sixteenth-step clocks as the new tick clock. No
Durable Object namespace migration or deletion is required.

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
72-lane project with sparse edits to cells 478–479. Disposable room storage also verifies query plans
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
client batches continuous gestures to at most 20 messages/second. Full-project
replacement can be a larger message, but remains one bounded snapshot write.
The maximum-length randomized 72-lane fixture exceeds 380 kB and stays below
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
more expensive than the example; eight clients at 20 edits/second would write
576,000 rows/hour. See the [Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Logs are sampled at 10% and traces at 1%; application code emits no project or
token logs. Workers Logs currently includes 200,000 events/day on Free and
20 million/month on Paid, then $0.60/million. Recheck observability pricing for
releases after 1 December 2026, when the published pricing changes. Inspect DO
request/duration, SQLite rows, stored bytes and sampled errors after launch.
See [Workers Logs pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing).

## Release

Production publication is a coordinated release, not part of `npm run build`.
The application's existing public access policy is explicit: no sign-in. The
Worker's high-entropy session credentials authorize room access. Durable Object
bindings require this separate Worker; no Pages migration or account-wide
Workers-subdomain change is needed.

1. Finish the shared model changes, regenerate types, typecheck and run both
   protocol and Worker runtime tests plus the frontend multi-browser tests.
2. Build production output and inspect `.cloudflare/output/v0/workers/default/worker.config.json`:
   localhost must be disabled, the canonical Pages origin unchanged, and the
   only database binding must be the SQLite `SessionRoom` namespace.
3. Run `npm exec -- cf deploy --dry-run --prebuilt`. After the coordinated GO,
   publish with `npm exec -- cf deploy --prebuilt` using the verified account.
   The cf config provisions this Worker's SQLite Durable Object export.
   If the CLI has no login, the authenticated Cloudflare connector can upload
   the same built module with the production config's bindings and declarative
   `exports` metadata, then enable this script's workers.dev route. Do not use
   a temporary account or change the account-wide subdomain.
4. Read back the deployed Worker settings and namespace. Verify `/health`, a
   real canonical-origin creation, host and guest joins, ordered edits, host
   replacement, denied credentials/origins, and end/revocation. Delete test
   rooms by ending them. Confirm a localhost Origin is denied in production.
5. Set the static app's `VITE_SESSION_API` to the verified production origin and
   use the existing Pages release process. Verify the complete host/guest flow
   on the canonical Pages origin, including guest silence and host disconnect.

The public launcher continues to point to the app's existing Pages URL. The
backend API is not a separate launcher application.

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
