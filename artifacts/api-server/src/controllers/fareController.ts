import type { Request, Response } from "express";
import { calculateRouteFare, getRouteStops, parseRouteStopCodes } from "../utils/fare";
import { store } from "../store/memoryStore";

export function listFareStops(_request: Request, response: Response): void {
  const routeId = typeof _request.query.route_id === "string"
    ? _request.query.route_id
    : "pyatak";
  response.json({
    route_id: routeId,
    currency: "KZT",
    price_per_stop: store.getRoute(routeId)?.pricePerStopKzt,
    stops: getRouteStops(routeId),
  });
}

export function estimateFare(request: Request, response: Response): void {
  const stopCodes = parseRouteStopCodes(request.body?.route_stops);
  response.json({
    route_id: request.body?.route_id ?? "pyatak",
    fare: calculateRouteFare({
      routeId: request.body?.route_id,
      pickupStop: request.body?.pickup_stop,
      destinationStop: request.body?.destination_stop,
      routeStops: stopCodes.length > 0 ? stopCodes : undefined,
    }),
  });
}