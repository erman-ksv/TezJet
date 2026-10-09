import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDriverEligibleForPickup,
  PICKUP_MATCH_RADIUS_METERS,
} from "../dist/services/pickupProximity.mjs";

const pickup = {
  lat: 41.3111,
  lng: 69.2797,
  timestamp: 3_000,
};

function entry(overrides = {}) {
  return {
    driverId: "driver",
    joinedAt: 1,
    status: "searching",
    availableSeats: 3,
    lastLocation: pickup,
    priorityLock: false,
    inFifo: true,
    ...overrides,
  };
}

test("driver already at pickup is eligible even without movement history", () => {
  const result = isDriverEligibleForPickup(
    entry({
      lastLocation: {
        ...pickup,
        lat: pickup.lat + 0.0001,
      },
    }),
    pickup,
    1,
  );

  assert.equal(result, true);
  assert.ok(PICKUP_MATCH_RADIUS_METERS > 0);
});

test("driver approaching pickup is eligible", () => {
  const previous = {
    lat: pickup.lat,
    lng: pickup.lng - 0.02,
    timestamp: 1_000,
  };
  const current = {
    lat: pickup.lat,
    lng: pickup.lng - 0.01,
    timestamp: 2_000,
  };

  assert.equal(
    isDriverEligibleForPickup(
      entry({ previousLocation: previous, lastLocation: current }),
      pickup,
      1,
    ),
    true,
  );
});

test("driver moving away from pickup is not eligible", () => {
  const previous = {
    lat: pickup.lat,
    lng: pickup.lng - 0.01,
    timestamp: 1_000,
  };
  const current = {
    lat: pickup.lat,
    lng: pickup.lng - 0.02,
    timestamp: 2_000,
  };

  assert.equal(
    isDriverEligibleForPickup(
      entry({ previousLocation: previous, lastLocation: current }),
      pickup,
      1,
    ),
    false,
  );
});

test("driver at another point without movement toward pickup is not eligible", () => {
  const current = {
    lat: pickup.lat,
    lng: pickup.lng + 0.01,
    timestamp: 2_000,
  };

  assert.equal(
    isDriverEligibleForPickup(
      entry({ lastLocation: current }),
      pickup,
      1,
    ),
    false,
  );
});

test("driver approaching pickup with insufficient seats is not eligible", () => {
  const previous = {
    lat: pickup.lat,
    lng: pickup.lng - 0.02,
    timestamp: 1_000,
  };
  const current = {
    lat: pickup.lat,
    lng: pickup.lng - 0.01,
    timestamp: 2_000,
  };

  assert.equal(
    isDriverEligibleForPickup(
      entry({
        previousLocation: previous,
        lastLocation: current,
        availableSeats: 1,
      }),
      pickup,
      2,
    ),
    false,
  );
});
