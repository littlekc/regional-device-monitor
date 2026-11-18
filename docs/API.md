# Monitor API

The service uses Node 24 and SQLite. Requests use JSON except for logout, which sends an empty POST. Every API response sends `Cache-Control: no-store, max-age=0`. HTTP timestamps are Unix milliseconds. Zabbix sampling clocks and persisted offline-evidence clocks use Unix seconds internally.

## Public routes

| Method | Path | Response |
| --- | --- | --- |
| GET | `/api/health` | `{ ok: true }` after SQLite is ready. No Zabbix call. |
| GET | `/api/snapshot` | `MonitorSnapshot` |
| GET | `/api/history?projectId=<id>&range=1h\|24h\|7d` | `DeviceHistory` |

`MonitorSnapshot` contains `version`, `regions`, `settings`, `devices`, `source` and `serverTime`. The public device list excludes hidden projects and source bindings. `source` has a `status` of `empty`, `not_configured`, `ok` or `unavailable`, an optional `checkedAt` timestamp and an optional categorized `code`. The API endpoint URL, token and raw upstream errors stay out of public responses.

Use `serverTime` as the baseline for durations. `sourceClock` is the newest associated source sample clock. `statusClock` and `valueClock` identify the scalar samples independently, including aged-out samples still returned by Zabbix.

- `statusAvailable: false` displays yellow unknown. With reliable connectivity evidence, `reachable` shows online or offline. `statusReason` is a machine-readable code defined in [the TypeScript contracts](../lib/contracts.ts).
- A current explicitly bound fault displays red. Otherwise, confirmed offline displays gray for `allowOffline: true` and red for `allowOffline: false`. Reliable online with available fault evidence displays green. An unverifiable bound trigger prevents green. Confirmed offline still displays its offline classification.
- An absent `metricValue` means the reading is unavailable. Its sample can become stale independently of status. Offline and unknown projects withhold current readings. A 100% reading alone never changes the status.
- `offlineSince` comes from a bounded, contiguous history transition or a verified checkpoint. An absent timestamp means unknown duration. `alarmSince` is Zabbix's change timestamp for the selected current problem trigger.
- Freshness normally uses two effective intervals. A dependent item uses its polling master's interval plus any discard-unchanged heartbeat in the dependency chain. Custom schedules, macros and discard-unchanged without a heartbeat can require an override. `staleAfterSeconds` overrides status freshness and serves as a fallback for numeric and trigger-evidence items with unresolved intervals.

Traffic projects have `metricKind: "traffic"` and `metricUnit: "bps"`. `uploadValue` and `downloadValue` are rates in bits per second; `uploadMax` and `downloadMax` are distinct optional, operator configured gauge scales in the same unit. `connections` is an optional nonnegative integer; `connectionsScope` is `"port"` or `"host"` when configured. Each channel has its own optional sample clock in milliseconds: `uploadClock`, `downloadClock`, `connectionsClock`. A clock may remain available with a stale value. Missing, invalid or stale data omits only that numeric field, and an actual zero is returned as `0`. Offline or unknown status suppresses all live numeric readings. An unbound count is absent, with no substitution. The configured scales affect the gauge arcs; they do not cap the measured rates or limit network traffic.

Resource projects have `metricKind: "resources"`. The optional `cpuValue` and `memoryValue` are percentages from 0 to 100; `cpuClock` and `memoryClock` are optional Unix milliseconds. Each value is available only when its own sample is valid and fresh and current readings are allowed by the device status. As with traffic, a clock may remain when its reading is absent. A missing channel does not change the other reading or device status.

## History

Only `projectId` and `range` are accepted; each is required exactly once. A missing, deleted or hidden project returns `404 not_found` even when the client has an admin session. The public response has no source item IDs, host IDs, endpoint, token or raw upstream errors. Current dashboard connectivity, alarms and data freshness do not gate history.

[`DeviceHistory`](../lib/contracts.ts) has `projectId`, current configuration `version`, `range`, `metricKind`, window `from` and `to`, `bucketMs`, shared `timestamps`, `series`, `connectivity` and `source`. All timestamps are Unix milliseconds. `timestamps[i]` is the start of bucket `i`: use `[timestamps[i], timestamps[i] + bucketMs)`, with the upper endpoint also accepted in the final bucket. `1h` uses 60 one-minute buckets, `24h` 288 five-minute buckets and `7d` 336 thirty-minute buckets.

| Numeric series key | Role | Unit |
| --- | --- | --- |
| `upload`, `download` | `rate`, traffic | `bps` |
| `connections` | `count`, traffic with a binding | `个`; also includes `connectionsScope` |
| `cpu`, `memory` | `value`, resource usage | `%` |
| `value` | `value`, scalar metrics | Same as the live display; percentage capacity conversion applies |

Each numeric series has a display `label`. Status-only projects have no numeric series. Every numeric series and connectivity has `values`, `sampleClocks`, and `breaks` arrays aligned with the shared buckets. Numeric bucket values are arithmetic means of the actual valid samples, including zero. A connection bucket mean can be fractional. Empty buckets are `null` and `sampleClocks[i]` is the latest contributing source sample clock or `null`. When `breaks[i] === true`, start a new segment at bucket `i`. Empty buckets, invalid or unmapped evidence, unresolved sampling intervals and gaps beyond the freshness interval can break a segment. A gap within bucket `i` also breaks its connection to the preceding point.

A present numeric `summary` contains `min`, `max`, `average`, `sampleCount`, `firstClock`, `lastClock` and `peakClock`. These use individual valid samples in the returned window, not equally weighted bucket means, zero fills or interpolated points. `peakClock` is the earliest sample time for the observed maximum. Summary values describe the available samples even when coverage is partial.

`connectivity` is separate from numeric series and has `role: "connectivity"`. Its values are `"online"`, `"offline"`, `"mixed"` (both mapped values were observed in one bucket), or `null` (no mapped observation). These are observations of the configured status monitor only. They do not represent historical triggers, alarms, time spent online or calculated service availability.

All channels expose `coverage`: `complete` means every bucket has valid evidence, with no detected gap, invalid sample or result cap; `partial` indicates incomplete evidence; `empty` means the source returned no rows; `unavailable` means the binding or source read couldn't supply data. Each has `truncated: boolean`. `source.status` is `ok`, `partial`, `empty`, `unavailable` or `not_configured`; `checkedAt` is when the read finished. Its `notes` codes map to display messages: `gaps` (some samples are missing), `truncated` (only the newest bounded raw samples were available to the chart), `unavailable` (at least one bound channel couldn't be read), `connections_unbound` (no count item configured).

History reads raw Zabbix `history.get` in the requested window. Coverage depends on Zabbix's raw history retention. Each bound channel requests at most 12,001 newest samples and keeps up to 12,000, using one extra row to detect truncation. The source's 4 MiB RPC body cap still applies. The shared server cache merges matching requests for ten seconds and rechecks source revisions and current visibility before returning. Each load attempt has a 9-second upstream deadline, with a 2.5-second timeout for each RPC. A configuration change can cause another attempt, up to four attempts per request. At most 12 distinct histories are in flight per process. A saturated or repeatedly superseded read returns `503 history_busy` and can be retried.

## Selected iKuai direct source

For explicitly bound native projects, `liveSource: "ikuai"` and `clockBasis: "received"` identify live values from the router API. Their clocks are HTTP receipt times, not claimed device sample timestamps. Optional `source.ikuai` reports this source independently from Zabbix. Native reads have a five-second shared cache and a 2.5-second deadline. A slow Zabbix refresh runs independently; Zabbix cached values still undergo TTL validation.

CPU/memory history for these bindings has `source.provider: "ikuai"` and timestamped minute samples. No connectivity history is synthesized. WAN history remains explicitly marked `source.provider: "zabbix"`, with `ikuai_live_only` explaining that the graph is not the native five-second feed. Unsupported historical per-WAN connection counts remain absent.

SQLite's additive `ikuai_connection` table stores the single native connection and exact project bindings. Public snapshots/history never contain its address or token. Authenticated configuration reads include only its public connection summary and `tokenConfigured`, never the token. Provisioning is via the server-side stdin script; no new unauthenticated administration endpoint exists.

## Administrator session

| Method | Path | Request body | Success response |
| --- | --- | --- | --- |
| POST | `/api/admin/login` | `{ password }` | `{ authenticated: true, expiresAt }` and session cookie |
| GET | `/api/admin/session` | | `{ authenticated: true, expiresAt }` |
| POST | `/api/admin/logout` | | `{ authenticated: false }` and cleared cookie |
| PUT | `/api/admin/password` | `{ currentPassword, newPassword }` | `{ authenticated: false }` and cleared cookie |

There is one administrator. Login takes the password only. The cookie is HttpOnly and SameSite=Strict, with Secure set for HTTPS origins. Sessions expire after 12 hours. Password changes revoke all sessions. New passwords have 12–256 characters. Login and password checks share a single-instance ten-attempt limit per minute.

Every admin route except login needs a session. Every mutation including login requires an allowed `Origin`, which same-origin browser fetch supplies automatically. JSON requests require `Content-Type: application/json`.

## Versioned configuration

| Method | Path | Request body | Success response |
| --- | --- | --- | --- |
| GET | `/api/admin/config` | | `200 MonitorConfig` |
| GET | `/api/admin/snapshot` | | `200 MonitorSnapshot` including hidden projects |
| POST | `/api/admin/regions` | `{ version, region }` | `201 MonitorConfig` |
| PUT | `/api/admin/regions/:id` | `{ version, region }` | `200 MonitorConfig` |
| DELETE | `/api/admin/regions/:id` | `{ version }` | `200 MonitorConfig` |
| POST | `/api/admin/projects` | `{ version, project }` | `201 MonitorConfig` |
| PUT | `/api/admin/projects/:id` | `{ version, project }` | `200 MonitorConfig` |
| DELETE | `/api/admin/projects/:id` | `{ version }` | `200 MonitorConfig` |
| PUT | `/api/admin/settings` | `{ version, settings, connection? }` | `200 MonitorConfig` |

`MonitorConfig` contains `version`, `regions`, `projects`, `settings` and `connection: { url, tokenConfigured }`. Every successful configuration write increments the version within its transaction and returns the complete resulting configuration. A stale write returns `409 version_conflict`. Refetch the configuration before applying a draft to an updated version.

A region contains `id`, `name` and `order`. A region can be deleted when it contains zero projects, including hidden projects. Order is an integer from 0 through 1,000,000, with ID as tie-breaker. IDs have 1–64 ASCII letters, digits, underscores or hyphens. Names have 1–64 characters. A PUT body uses the same ID as the path.

| Project fields | Values |
| --- | --- |
| `id`, `name`, `regionId`, `order` | Same formats as regions. Supply an existing region ID. |
| `type` | `server`, `line`, `router`, `power` or `terminal` |
| `hidden`, `allowOffline` | Booleans |
| `hostId`, `statusItemId`, optional `valueItemId`, `triggerIds` | Zabbix IDs are positive decimal strings. Supply up to 20 trigger IDs. Use `[]` for no triggers. |
| `statusMapping` | `{ online: string[], offline: string[] }`. Include at least one online value. An empty offline set supports items such as Agent ping that record only successful responses. The sets must be disjoint. Numeric spellings compare as numbers without rounding integer counters. Trimmed text values are case-sensitive. |
| `metric` | Display mode below |
| `staleAfterSeconds` | Optional integer from 5 through 604,800 |

Item and trigger bindings must belong to the selected host. A trigger can use an independent item on that host. Multiple projects may share a host. The API re-verifies source ownership when adding or changing bindings. Display-only edits to existing bindings can succeed during a source outage.

| Mode | Metric object | Numeric item |
| --- | --- | --- |
| Status only | `{ kind: "none" }` | Omit `valueItemId`. |
| Percentage | `{ kind: "percent", label?, capacity? }` | Required. Use the source's `%` unit or supply positive capacity in the same unit as the raw sample. With capacity the service computes raw value divided by capacity times 100. |
| Power | `{ kind: "power", label?, unit?, max }` | Required. Supply a positive full scale. |
| Raw or rate | `{ kind: "raw", label?, unit?, max? }` or `{ kind: "rate", label?, unit?, max? }` | Required. Optional `max` controls ring progress. The reading uses the unconverted value. |
| CPU and memory | `{ kind: "resources", cpuItemId, memoryItemId }` | Omit `valueItemId`. Select distinct usage items on the same host with numeric values and a `%` unit. Neither item may reuse `statusItemId`. |
| Traffic | `{ kind: "traffic", uploadItemId, downloadItemId, connectionsItemId?, connectionsScope?, uploadMax?, downloadMax? }` | Omit `valueItemId`. Supply distinct numeric rate items for upload and download. Optional gauge scales are positive numbers in bps and are never inferred. |

Traffic rate items must be on the selected host and declare a bits-per-second or bytes-per-second unit (such as `bps`, `bit/s`, `Bps`, or `B/s`, including SI prefixes). Zabbix values already reflect the item's preprocessing; the application converts only the declared unit to bps. Recognized interface rate keys must match the direction and, when identifiable from the status binding, the interface index. An optional count is bound by `connectionsItemId` together with explicit `connectionsScope`. The item must be numeric on the selected host and represent a count; the operator chooses its true scope. The known whole-router item `ikuai.metric[connections]` cannot be assigned port scope. Current WAN cards leave the count unbound until a real per-port measurement is available.

`settings` contains `columns` (integer 1–16), `gaugeSize` (integer percentage 50–160), `palette` (`harbor`, `titanium` or `jade`) and `refreshSeconds` (integer 5–3600). Defaults are 8 columns, 100% gauge size, harbor and 5 seconds. The client can use the columns setting as its responsive upper limit.

The optional `connection` object accepts `url?`, `token?` and `clearToken?`. The URL must be a complete HTTP(S) Zabbix endpoint ending in `/api_jsonrpc.php`. An empty URL removes the endpoint. An empty or omitted token retains the stored token. Send `clearToken: true` with an empty or omitted token to clear it. The browser receives only `tokenConfigured`.

## Zabbix tools

| Method | Path | Inputs | Success response |
| --- | --- | --- | --- |
| POST | `/api/admin/zabbix/test` | JSON `{ url?, token?, clearToken? }` | `{ status, message, version? }` |
| GET | `/api/admin/zabbix/hosts` | Query `q?`, `limit?` | `CatalogPage<CatalogHost>` |
| GET | `/api/admin/zabbix/items` | Query `hostId`, `q?`, `limit?` | `CatalogPage<CatalogItem>` |
| GET | `/api/admin/zabbix/triggers` | Query `hostId`, `q?`, `limit?` | `CatalogPage<CatalogTrigger>` |

A catalog page is `{ results, hasMore }` with a default limit of 50 and a maximum of 100. Use `q` to narrow the search by name or item key. When `q` is a positive decimal ID, the results match that exact ID. Item results expose the key, latest sample, preprocessing, value maps, effective interval when resolvable and suggested status mappings for known keys. The saved mapping is authoritative. Host and item `status` define whether they are enabled in Zabbix.

Testing leaves the configuration untouched. Send `{}` to use the stored source. `status` can be `success`, `connection`, `auth`, `permission` or `no_items`. After reading the version without credentials, the test uses the bearer token for a bounded host and monitored-item search. A successful item is enabled, supported and has a sample. Empty results indicate no usable visible data. Possible causes include absent data and restricted visibility. Catalog failures return a sanitized `502` with a `zabbix_` error code.

## Errors

Errors use `{ error: { code, message, field? } }`. Common cases include `400 invalid_input`, `401 unauthorized`, `401 invalid_credentials`, `403 origin_forbidden`, `404 not_found`, `409 version_conflict`, `409 region_not_empty` and `429 rate_limited`. Unexpected internal errors return `500 internal_error` with a fixed message.

## Operation

- `MONITOR_DB_PATH` selects the database. Linux defaults to `/var/lib/regional-device-monitor/monitor.db`. Use an explicit persistent path on Windows. The service migrates the database in place.
- `MONITOR_ALLOWED_ORIGINS` specifies the comma-separated list of allowed HTTP(S) origins. Include the public deployment origin and any needed loopback origins. When omitted, the server uses the built-in port 3000 loopback origins for local development.
- Run `node scripts/bootstrap.mjs` under the same database path and user the service uses. Supply the initial administrator password via stdin or `MONITOR_ADMIN_PASSWORD`.
- Run `node scripts/backup.mjs /path/to/new-backup.db` for a consistent online SQLite backup. The backup includes the token and administrator hash. Store it with the same access controls as the live database.

The protocol and source fields follow [Zabbix API authentication](https://www.zabbix.com/documentation/7.0/en/manual/api), [item.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/item/get), [trigger.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/trigger/get) and [history.get](https://www.zabbix.com/documentation/7.0/en/manual/api/reference/history/get).
