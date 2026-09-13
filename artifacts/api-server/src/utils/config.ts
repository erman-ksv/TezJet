import type { Coordinates } from "../types/domain";

export const JWT_SECRET =
  process.env.SESSION_SECRET ?? "tezjet-development-secret";
export const JWT_EXPIRES_IN = "7d" as const;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const QUEUE_GEOFENCE_METERS = Number(
  process.env.PYATAK_GEOFENCE_METERS ?? 150,
);
export const MAX_SPEED_KMH = 180;
export const SEAT_LOCK_TTL_MS = 7 * 60 * 1000;
export const PYATAK_ZONE = {
  id: "pyatak",
  name: "Pyatak",
  radiusMeters: QUEUE_GEOFENCE_METERS,
  center: {
    lat: Number(
      process.env.PYATAK_CENTER_LAT ?? process.env.QUEUE_CENTER_LAT ?? 41.3111,
    ),
    lng: Number(
      process.env.PYATAK_CENTER_LNG ?? process.env.QUEUE_CENTER_LNG ?? 69.2797,
    ),
    timestamp: Date.now(),
  } satisfies Coordinates,
} as const;
export const DEFAULT_QUEUE_POINT: Coordinates = {
  ...PYATAK_ZONE.center,
  timestamp: Date.now(),
};