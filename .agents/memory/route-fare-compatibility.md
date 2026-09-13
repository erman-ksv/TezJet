---
name: Route fare compatibility
description: The compatibility boundary between legacy stop-array requests and the route catalog fare model.
---

Legacy clients may still send `route_stops` as an ordered array. The API maps the
first and last entries to pickup and destination positions, while new clients
can send explicit stop identifiers or numeric positions. Fare calculation uses
the route catalog's `price_per_stop` and charges at least one full stop.

**Why:** Existing clients already use the stop-array shape, but admin-managed
routes need a single, predictable formula that supports intermediate boarding.

**How to apply:** Extend the route catalog and fare calculation together; do not
remove legacy parsing unless the API version changes explicitly.