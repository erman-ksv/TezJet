import type { FareQuote, RouteDefinition, RouteStop } from "../types/domain";
import { store } from "../store/memoryStore";
import { AppError } from "./errors";

export interface FareRequest {
  routeId?: unknown;
  pickupStop?: unknown;
  destinationStop?: unknown;
  routeStops?: unknown;
}

function getRoute(routeId: unknown): RouteDefinition {
  const id = typeof routeId === "string" && routeId.trim() ? routeId.trim() : "pyatak";
  const route = store.getRoute(id);
  if (!route || !route.active) {
    throw new AppError(404, `Route not found: ${id}`, "ROUTE_NOT_FOUND");
  }
  if (route.stops.length === 0) {
    throw new AppError(409, "Route has no stops", "ROUTE_HAS_NO_STOPS");
  }
  return route;
}

function nearestStop(route: RouteDefinition, position: number): RouteStop {
  return route.stops.reduce((nearest, stop) =>
    Math.abs(stop.position - position) < Math.abs(nearest.position - position)
      ? stop
      : nearest,
  );
}

function resolveStopPosition(
  route: RouteDefinition,
  value: unknown,
  fallback: RouteStop,
  field: string,
): number {
  if (value === undefined || value === null) {
    return fallback.position;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < route.stops[0].position || value > route.stops[route.stops.length - 1].position) {
      throw new AppError(400, `${field} is outside the route`, "INVALID_STOP_POSITION");
    }
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const stop = route.stops.find(
      (candidate) => candidate.code === value.trim().toUpperCase() || candidate.id === value.trim(),
    );
    if (stop) {
      return stop.position;
    }
  }
  if (typeof value === "object" && value !== null) {
    const input = value as Record<string, unknown>;
    return resolveStopPosition(route, input["code"] ?? input["position"], fallback, field);
  }
  throw new AppError(400, `${field} is invalid`, "INVALID_STOP");
}

function legacyStops(value: unknown): { pickup?: unknown; destination?: unknown } {
  if (value === undefined) {
    return {};
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
  return {
    pickup: value[0],
    destination: value[value.length - 1],
  };
}

export function calculateRouteFare(input: FareRequest = {}): FareQuote {
  const route = getRoute(input.routeId);
  const legacy = legacyStops(input.routeStops);
  const firstStop = route.stops[0];
  const pickupPosition = resolveStopPosition(
    route,
    input.pickupStop ?? legacy.pickup,
    firstStop,
    "pickup_stop",
  );
  const destinationPosition = resolveStopPosition(
    route,
    input.destinationStop ?? legacy.destination ?? input.pickupStop ?? legacy.pickup,
    firstStop,
    "destination_stop",
  );
  const rawDistance = Math.abs(destinationPosition - pickupPosition);
  const distanceStops = Math.max(1, Math.ceil(rawDistance));
  const pickupStop = nearestStop(route, pickupPosition);
  const destinationStop = nearestStop(route, destinationPosition);

  return {
    currency: route.currency,
    routeId: route.id,
    pickupStop,
    destinationStop,
    pickupPosition,
    destinationPosition,
    distanceStops,
    pricePerStopKzt: route.pricePerStopKzt,
    minimumFareApplied: rawDistance < 1,
    stops: pickupStop.id === destinationStop.id
      ? [pickupStop]
      : [pickupStop, destinationStop],
    totalKzt: distanceStops * route.pricePerStopKzt,
    calculatedAt: new Date().toISOString(),
  };
}

export function getRouteStops(routeId = "pyatak"): RouteStop[] {
  const route = getRoute(routeId);
  return route.stops;
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

/** Backwards-compatible helper for notification/test code. */
export function calculateFixedFare(stopCodes: string[]): FareQuote {
  return calculateRouteFare({ routeStops: stopCodes });
}