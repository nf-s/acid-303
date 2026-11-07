# Shared sessions

The static application stays at https://acid-303.pages.dev/. The separate
`grain-sessions` Worker coordinates shared musical projects. The intended API
origin is https://grain-sessions.nf-s.workers.dev; check the release verification
before treating that origin as deployed.

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
  protocols `["grain-session-v1", token]`. The response selects only
  `grain-session-v1`; credentials are never put in an API URL or echoed as the
  selected protocol. The server derives the role from the token.
- Only token SHA-256 hashes are stored. Comparison uses the Workers
  constant-time comparison API. Guest links contain only the guest token in the
  URL fragment. Possession of that link grants editing access, not host access.
- The production Origin allowlist contains only `https://acid-303.pages.dev`.
  The development config additionally accepts HTTP/HTTPS `localhost` and
  `127.0.0.1`, including ports 4317 and 4319. Missing and other origins fail.
  Origin checks complement token authentication; they are not authentication.
- HTTP bodies and incoming WebSocket messages are limited to 128 KiB. Patches
  contain at most 2,048 changes, eight path segments, and bounded JSON values.
  Prototype keys, unknown paths and invalid resulting projects are rejected.
- One room retains at most 16 writer identities until expiry for reconnect
  deduplication. Up to eight connections are active at once; a host slot is
  reserved. A guest cannot reuse an active host's identity to replace it.

`src/session-protocol.ts` defines the complete Zod-validated wire contract and
shared `diffProject` / `applyProjectChanges` functions. Equal-length arrays merge
per index. Variable-length collections, such as selected arp notes, replace
atomically. Accepted changes are applied to the current authoritative project,
normalized through the musical schema and broadcast in server revision order.
The server's canonical diff includes any additional scale corrections.

Each accepted patch contains a client ID and increasing sequence number. The
server persists the project, revision and that client's last sequence in one
SQLite row before broadcasting. Retried sequences receive an acknowledgement
without a second write. A reconnecting client's welcome includes the current
project and its acknowledged sequence. The browser rebases pending changes on
that authoritative state. Concurrent changes to different fields survive;
concurrent changes to the same field follow server order.

The host sends `clock` messages containing `playing` and `absoluteStep`.
Guests cannot send authoritative clocks or end the room. Guest transport
requests are routed to the host; they do not claim playback has started.
Guest patches are rejected while the host is disconnected. Presence and clock
state are stored in hibernating WebSocket attachments, not SQLite. Plaintext
`ping` / `pong` is reserved for the hibernation auto-response heartbeat.

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
restored curve cell. Disposable room storage also verifies query plans
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

For a one-hour room with three people, 128 BPM, one accepted edit/second total
and a heartbeat every 15 seconds per device: approximately 30,720 clocks +
3,600 edits + 720 heartbeats = 35,040 incoming messages, or about 1,752 billed
DO request units before upgrades/creation/expiry. There are 3,600 edit-row writes
plus creation and deletion overhead, and 3,600 UPSERT row reads plus cold loads.
Outgoing fan-out adds no request fee. At an explicitly assumed average 5 ms of
active handler time per non-heartbeat message, duration is approximately
22 GB-s; actual duration must be checked in account metrics. Charging the whole
hour at the allocated 128 MB would be a conservative 460.8 GB-s upper bound,
not the expected hibernation behavior. This example is not a guarantee of
available free quota or a bill estimate for other account applications.

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
