# TezJet API

TezJet is a rural taxi hailing backend with OTP registration, single-session JWT
authentication, an anti-fraud location gate, FIFO driver queuing, Point C seat
locks, Point D route pooling, and Socket.io realtime events.

## Natural-language addresses

TezJet can use the Google Gemini API to turn a phrase such as
`Корасув, рядом со школой` into a structured address:

- `POST /api/addresses/normalize`
  - Body: `{ "address": "..." }`
  - Requires a TezJet bearer token.
  - Returns normalized locality, street, house number, landmarks, optional
    coordinates, confidence, and uncertainty notes.

Passenger orders may also include `pickup_address`. The normalized result is
stored in the order as `pickup_address`, while `pickup_location` remains the
authoritative GPS coordinate and still passes the anti-fake GPS middleware.

Set `GEMINI_API_KEY` as a Replit Secret. The optional `GEMINI_MODEL` environment
variable overrides the default `gemini-3.6-flash` model. API keys are never
returned in responses or written to source files.

## Run

```bash
pnpm --filter @workspace/api-server run dev
```

The managed workflow supplies `PORT`. Set `SESSION_SECRET` for production. The
in-memory adapter is intentional for a runnable API scaffold; replace
`src/store/memoryStore.ts` with a PostgreSQL/Redis adapter when deploying
multi-instance workers.

## Release scenario checks

Run the API regression scenarios from the workspace root:

```bash
pnpm test
```

The check builds the API, starts an isolated test server, and verifies OTP
registration and login session invalidation, FIFO driver queue behavior, Point
C seat locks and status transitions, Point D pooling, and Socket.io realtime
events. It uses development OTP responses and does not require external
services.

## Authentication

1. `POST /api/auth/request-otp`
   - Body: `{ "phone_number": "+7 777 123 45 67", "full_name": "...", "role": "passenger|driver", "locale": "kk|uz|ru" }`
   - Development responses include `demo_code`; production responses never expose the OTP.
2. `POST /api/auth/login` or `POST /api/auth/verify-otp`
   - Body: `{ "phone_number": "...", "code": "123456" }`
   - Every successful login increments the session version and invalidates all earlier JWTs.
3. Send `Authorization: Bearer <access_token>` to protected routes.

`PATCH /api/auth/profile` only accepts locale changes. `full_name` and
`phone_number` are locked after the first successful OTP registration.

## Queue and orders

- `GET /api/queue` — current FIFO queue, Pyatak zone and your position.
- `POST /api/queue/join` — driver joins within the configured Pyatak geofence.
- `PATCH /api/queue/location` — location update checked by anti-fake GPS middleware.
- `PATCH /api/queue/status` — `searching`, `picking_up`, `en_route_to_c`, `arrived_at_c`, `in_transit`.
- `GET /api/fares/stops?route_id=pyatak` — route-stop catalog and `price_per_stop`.
- `POST /api/fares/estimate` — calculate
  `ceil(abs(destination_position - pickup_position)) * price_per_stop`.
  It accepts `{ "route_id": "pyatak", "pickup_stop": "C",
  "destination_stop": "D" }` or the legacy `{ "route_stops": ["C", "D"] }`.
- `POST /api/orders` — passenger creates a Point C or Point D order. Optional
  `route_stops` uses the same route catalog; when omitted, the pickup point is
  used as the pickup and destination stop, with a minimum one-stop fare.
- `POST /api/orders/:orderId/accept` — only the current offer recipient can accept; Point C gets a 7-minute seat lock.
- `POST /api/orders/:orderId/decline` — the current offer recipient declines and the same order is offered to the next eligible driver.
- `POST /api/orders/:orderId/offer-first-driver` — retained for older Point D clients; reports the current offer recipient without sending a duplicate offer.
- `PATCH /api/orders/:orderId/status` — driver advances `en_route_to_c` → `arrived_at_c` → `in_transit` → `completed`.
- `POST /api/orders/:orderId/cancel` — passenger or assigned driver cancels.

Orders are offered one driver at a time in FIFO queue order. The current
recipient is the only driver who can accept; a decline or the 15-second offer
timeout advances the same order to the next available driver. Drivers without
enough seats or with an active order are skipped without changing queue order.
Point D orders fall back to smart-pooling only after no eligible FIFO driver
remains. A pooled driver must be in transit, have enough free seats, have a
fresh location within 1,500 meters of pickup, and be able to serve the new
pickup and destination within every active order's remaining route segment.
If there is no match, the order stays `searching`. The timeout, pickup radius,
and maximum location age can be configured with `ORDER_OFFER_TIMEOUT_MS`,
`SMART_POOLING_MAX_PICKUP_DISTANCE_METERS`, and
`SMART_POOLING_MAX_LOCATION_AGE_MS`. Driver-facing order responses mask
passenger phone numbers.

The default route has two stops, Point C and Point D, and a price of 500 KZT
per stop. Admins can change the price and stops at runtime through `/api/admin`.
Set `REQUIRE_DRIVER_APPROVAL=true` to block unapproved drivers from joining
the queue. Admin OTP registration is enabled only when `ADMIN_PHONE` is set.

### Admin API

Admin JWTs can manage the route catalog:

- `GET|POST /api/admin/routes`
- `PATCH|DELETE /api/admin/routes/:routeId`
- `POST /api/admin/routes/:routeId/stops`
- `PATCH|DELETE /api/admin/routes/:routeId/stops/:stopId`
- `GET /api/admin/drivers`
- `PATCH /api/admin/drivers/:driverId/approval` with
  `{ "status": "pending|approved|rejected" }`
- `GET /api/admin/queue-point` — read the current Pyatak center and 150-meter geofence.
- `PATCH /api/admin/queue-point` — update the center from the admin panel with
  `{ "lat": 41.3111, "lng": 69.2797 }` or `{ "center": { "lat": 41.3111, "lng": 69.2797 } }`.

The queue point update requires an admin JWT. Coordinates are validated before
being applied, and the new center is used immediately by driver queue joins,
location updates, queue status responses, and realtime queue events. The current
in-memory adapter keeps this setting until the API process restarts.

## FIFO queue and active-trip pooling

When a driver accepts an order that uses all remaining seats, the driver is
removed from the FIFO queue immediately. When the driver changes the order
status to `in_transit` (the "Go" action), the driver is removed from FIFO even
if seats remain available. The active-trip record keeps the remaining seats and
active order IDs, so Point D pooling can offer new passengers to that driver
without changing the FIFO order of drivers who are still waiting. New Point D
orders still go through all available FIFO drivers first; pooling is only the
fallback after those offers are declined or expire.

The current runnable adapter models the Redis design with an `inFifo` flag on
the queue entry. A Redis-backed adapter should map FIFO membership to a sorted
set and keep active-trip entries in a separate collection.

## Realtime and push-ready events

Socket.io connects to the same server with:

```js
io({ path: "/api/socket.io", auth: { token: accessToken } });
```

The server emits:

- `incoming_order` — `{ priority: "high", sound: "incoming_order.mp3", order }`
- `order:status`
- `queue:snapshot` — initial queue state on connection
- `queue:update`
- `queue:joined`, `queue:left`, `queue:status`, `queue:location`
- `queue:position` — private position update for each driver
- `queue:reordered` — emitted when FIFO ordering may have changed

Use `GET /api/notifications/config` for client notification settings,
`POST /api/notifications/devices` to register a push token, and
`POST /api/notifications/test-alert` to verify the high-priority client path.