import type { Request, Response } from "express";
import { calculateFixedFare, getRouteStops, parseRouteStopCodes } from "../utils/fare";

export function listFareStops(_request: Request, response: Response): void {
  response.json({
    zone: "pyatak",
    currency: "KZT",
    stops: getRouteStops(),
  });
}

export function estimateFare(request: Request, response: Response): void {
  const stopCodes = parseRouteStopCodes(request.body?.route_stops);
  response.json({
    zone: "pyatak",
    fare: calculateFixedFare(stopCodes),
  });
}