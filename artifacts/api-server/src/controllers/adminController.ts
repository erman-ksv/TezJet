import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { store } from "../store/memoryStore";
import type { DriverApprovalStatus } from "../types/domain";
import { AppError } from "../utils/errors";
import { serializeUser } from "../utils/serialize";
import { boundedInteger, optionalString, pickEnum, requiredString } from "../utils/validation";

function routeId(value: unknown): string {
  const raw = value === undefined ? randomUUID() : requiredString(value, "route_id", 80);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(raw)) {
    throw new AppError(400, "route_id contains invalid characters", "VALIDATION_ERROR");
  }
  return raw.toLowerCase();
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new AppError(400, `${field} must be a boolean`, "VALIDATION_ERROR");
  }
  return value;
}

export function listRoutes(_request: Request, response: Response): void {
  response.json({ routes: store.listRoutes() });
}

export function createRoute(request: Request, response: Response): void {
  let route;
  try {
    route = store.createRoute({
      id: routeId(request.body?.route_id),
      name: requiredString(request.body?.name, "name", 120),
      pricePerStopKzt: boundedInteger(
        request.body?.price_per_stop ?? 500,
        "price_per_stop",
        0,
        1_000_000_000,
      ),
      active: optionalBoolean(request.body?.active, "active", true),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      throw new AppError(409, "Route already exists", "ROUTE_EXISTS");
    }
    throw error;
  }
  response.status(201).json({ route });
}

export function updateRoute(request: Request, response: Response): void {
  const routeIdParam = requiredString(request.params["routeId"], "route_id", 80);
  const patch: {
    name?: string;
    pricePerStopKzt?: number;
    active?: boolean;
  } = {};
  if (request.body?.name !== undefined) {
    patch.name = requiredString(request.body.name, "name", 120);
  }
  if (request.body?.price_per_stop !== undefined) {
    patch.pricePerStopKzt = boundedInteger(
      request.body.price_per_stop,
      "price_per_stop",
      0,
      1_000_000_000,
    );
  }
  if (request.body?.active !== undefined) {
    patch.active = optionalBoolean(request.body.active, "active", true);
  }
  const route = store.updateRoute(routeIdParam, patch);
  if (!route) {
    throw new AppError(404, "Route not found", "ROUTE_NOT_FOUND");
  }
  response.json({ route });
}

export function deleteRoute(request: Request, response: Response): void {
  const routeIdParam = requiredString(request.params["routeId"], "route_id", 80);
  if (!store.deleteRoute(routeIdParam)) {
    throw new AppError(404, "Route not found", "ROUTE_NOT_FOUND");
  }
  response.status(204).send();
}

export function addStop(request: Request, response: Response): void {
  const route = store.getRoute(requiredString(request.params["routeId"], "route_id", 80));
  if (!route) {
    throw new AppError(404, "Route not found", "ROUTE_NOT_FOUND");
  }
  const stop = store.addRouteStop(route.id, {
    code: requiredString(request.body?.code, "code", 40).toUpperCase(),
    name: requiredString(request.body?.name, "name", 120),
    sequence:
      request.body?.sequence === undefined
        ? undefined
        : boundedInteger(request.body.sequence, "sequence", 1, 100_000),
    position:
      request.body?.position === undefined
        ? undefined
        : boundedInteger(request.body.position, "position", 1, 100_000),
  });
  response.status(201).json({ stop });
}

export function updateStop(request: Request, response: Response): void {
  const routeIdParam = requiredString(request.params["routeId"], "route_id", 80);
  const stopId = requiredString(request.params["stopId"], "stop_id", 80);
  const patch: {
    code?: string;
    name?: string;
    sequence?: number;
    position?: number;
  } = {};
  if (request.body?.code !== undefined) {
    patch.code = requiredString(request.body.code, "code", 40).toUpperCase();
  }
  if (request.body?.name !== undefined) {
    patch.name = requiredString(request.body.name, "name", 120);
  }
  if (request.body?.sequence !== undefined) {
    patch.sequence = boundedInteger(request.body.sequence, "sequence", 1, 100_000);
  }
  if (request.body?.position !== undefined) {
    patch.position = boundedInteger(request.body.position, "position", 1, 100_000);
  }
  const stop = store.updateRouteStop(routeIdParam, stopId, patch);
  if (!stop) {
    throw new AppError(404, "Route stop not found", "STOP_NOT_FOUND");
  }
  response.json({ stop });
}

export function deleteStop(request: Request, response: Response): void {
  const routeIdParam = requiredString(request.params["routeId"], "route_id", 80);
  const stopId = requiredString(request.params["stopId"], "stop_id", 80);
  if (!store.deleteRouteStop(routeIdParam, stopId)) {
    throw new AppError(404, "Route stop not found", "STOP_NOT_FOUND");
  }
  response.status(204).send();
}

export function listDrivers(_request: Request, response: Response): void {
  response.json({
    drivers: store.listUsers("driver").map((user) => serializeUser(user)),
  });
}

export function updateDriverApproval(request: Request, response: Response): void {
  const status = pickEnum(
    request.body?.status,
    "status",
    ["pending", "approved", "rejected"] as const,
  ) as DriverApprovalStatus;
  const user = store.setDriverApproval(
    requiredString(request.params["driverId"], "driver_id", 80),
    status,
  );
  if (!user) {
    throw new AppError(404, "Driver not found", "DRIVER_NOT_FOUND");
  }
  response.json({ driver: serializeUser(user) });
}