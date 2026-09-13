import type { FareQuote, RouteStop } from "../types/domain";
import { AppError } from "./errors";

const DEFAULT_ROUTE_STOPS: RouteStop[] = [
  { code: "C", name: "Point C", priceKzt: 500 },
  { code: "D", name: "Point D", priceKzt: 700 },
];

function readConfiguredStops(): RouteStop[] {
  const raw = process.env.PYATAK_ROUTE_STOP_PRICES;
  if (!raw) {
    return DEFAULT_ROUTE_STOPS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("PYATAK_ROUTE_STOP_PRICES must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("PYATAK_ROUTE_STOP_PRICES must be a non-empty JSON array");
  }

  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`Invalid Pyatak route stop at index ${index}`);
    }
    const stop = value as Record<string, unknown>;
    const code = typeof stop["code"] === "string" ? stop["code"].trim().toUpperCase() : "";
    const name = typeof stop["name"] === "string" ? stop["name"].trim() : "";
    const priceKzt = Number(stop["priceKzt"]);
    if (!code || !name || !Number.isInteger(priceKzt) || priceKzt < 0) {
      throw new Error(`Invalid Pyatak route stop at index ${index}`);
    }
    return { code, name, priceKzt };
  });
}

export const PYATAK_ROUTE_STOPS = readConfiguredStops();

export function getRouteStops(): RouteStop[] {
  return PYATAK_ROUTE_STOPS.map((stop) => ({ ...stop }));
}

export function parseRouteStopCodes(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((code) => typeof code !== "string" || !code.trim())
  ) {
    throw new AppError(
      400,
      "route_stops must be a non-empty array of stop codes",
      "INVALID_ROUTE_STOPS",
    );
  }
  return value.map((code) => code.trim().toUpperCase());
}

export function calculateFixedFare(stopCodes: string[]): FareQuote {
  const codes = stopCodes.length > 0 ? stopCodes : ["C"];
  const stops = codes.map((code) => {
    const stop = PYATAK_ROUTE_STOPS.find((candidate) => candidate.code === code);
    if (!stop) {
      throw new AppError(
        400,
        `Unknown Pyatak route stop: ${code}`,
        "UNKNOWN_ROUTE_STOP",
      );
    }
    return { ...stop };
  });

  return {
    currency: "KZT",
    stops,
    totalKzt: stops.reduce((total, stop) => total + stop.priceKzt, 0),
    calculatedAt: new Date().toISOString(),
  };
}