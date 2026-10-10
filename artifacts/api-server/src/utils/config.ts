import type { Coordinates } from "../types/domain";

const configuredSessionSecret = process.env.SESSION_SECRET;

if (
  process.env.NODE_ENV === "production" &&
  (!configuredSessionSecret || configuredSessionSecret.length < 32)
) {
  throw new Error(
    "SESSION_SECRET must be configured with at least 32 characters in production",
  );
}

export const JWT_SECRET =
  configuredSessionSecret ?? "tezjet-development-secret";

/** Default market is Uzbekistan. A UZS tariff is never guessed or converted from KZT. */
export const MARKET_COUNTRY = (process.env.MARKET_COUNTRY ?? "UZ").toUpperCase();
export const MARKET_CURRENCY = (process.env.MARKET_CURRENCY ?? "UZS").toUpperCase();
if (!/^[A-Z]{2}$/.test(MARKET_COUNTRY)) {
  throw new Error("MARKET_COUNTRY must be a two-letter ISO country code");
}
if (!/^[A-Z]{3}$/.test(MARKET_CURRENCY)) {
  throw new Error("MARKET_CURRENCY must be a three-letter ISO 4217 currency code");
}
const configuredMarketPrice = process.env.MARKET_PRICE_PER_STOP;
if (
  configuredMarketPrice !== undefined &&
  (!/^\\d+$/.test(configuredMarketPrice) ||
    !Number.isSafeInteger(Number(configuredMarketPrice)) ||
    Number(configuredMarketPrice) <= 0)
) {
  throw new Error("MARKET_PRICE_PER_STOP must be a positive safe integer");
}
// Keep the old demo fare only when KZT is explicitly selected; never assume a UZS fare.
export const MARKET_PRICE_PER_STOP: number | undefined =
  configuredMarketPrice !== undefined
    ? Number(configuredMarketPrice)
    : MARKET_CURRENCY === "KZT"
      ? 500
      : undefined;
export const JWT_EXPIRES_IN = "7d" as const;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const QUEUE_GEOFENCE_METERS = Number(
  process.env.PYATAK_GEOFENCE_METERS ?? 150,
);
export const MAX_SPEED_KMH = 180;
export const SEAT_LOCK_TTL_MS = 7 * 60 * 1000;
export const ADMIN_PHONE = process.env.ADMIN_PHONE
  ? process.env.ADMIN_PHONE.replace(/[^\d+]/g, "")
  : undefined;
export const REQUIRE_DRIVER_APPROVAL =
  process.env.REQUIRE_DRIVER_APPROVAL !== "false";
export const PYATAK_ZONE: {
  id: string;
  name: string;
  radiusMeters: number;
  center: Coordinates;
} = {
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
  },
};

export function updatePyatakCenter(center: Coordinates): Coordinates {
  PYATAK_ZONE.center = {
    ...center,
    timestamp: Date.now(),
  };
  return { ...PYATAK_ZONE.center };
}

export const DEFAULT_QUEUE_POINT: Coordinates = {
  ...PYATAK_ZONE.center,
  timestamp: Date.now(),
};