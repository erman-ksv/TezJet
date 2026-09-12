import type { Request, Response } from "express";
import { store } from "../store/memoryStore";
import type { Coordinates, DriverQueueStatus } from "../types/domain";
import { DEFAULT_QUEUE_POINT, QUEUE_GEOFENCE_METERS } from "../utils/config";
import { distanceMeters } from "../utils/geo";
import { AppError } from "../utils/errors";
import { translate } from "../utils/i18n";
import { emitQueueUpdate } from "../utils/realtime";
import { boundedInteger, pickEnum } from "../utils/validation";

function getLocation(request: Request): Coordinates {
  const raw = request.body?.location;
  if (!raw || typeof raw !== "object") {
    throw new AppError(400, "location is required", "VALIDATION_ERROR");
  }
  const input = raw as Record<string, unknown>;
  return {
    lat: Number(input["lat"]),
    lng: Number(input["lng"]),
    timestamp: input["timestamp"] ? Number(input["timestamp"]) : Date.now(),
    isMocked: input["isMocked"] === true,
  };
}

function assertDriver(request: Request): string {
  if (!request.auth || request.auth.role !== "driver") {
    throw new AppError(
      403,
      translate(request.auth?.locale ?? "ru", "driverOnly"),
      "DRIVER_ONLY",
    );
  }
  return request.auth.userId;
}

export function getQueueStatus(request: Request, response: Response): void {
  response.json({
    queue_point: DEFAULT_QUEUE_POINT,
    geofence_meters: QUEUE_GEOFENCE_METERS,
    queue: store.queueSnapshot(),
    your_position: request.auth
      ? store.getQueuePosition(request.auth.userId)
      : null,
  });
}

export function joinQueue(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  const location = getLocation(request);
  const distance = distanceMeters(DEFAULT_QUEUE_POINT, location);
  if (distance > QUEUE_GEOFENCE_METERS) {
    throw new AppError(
      422,
      translate(request.auth?.locale ?? "ru", "outsideGeofence"),
      "OUTSIDE_QUEUE_GEOFENCE",
    );
  }

  const availableSeats = boundedInteger(
    request.body?.available_seats ?? 3,
    "available_seats",
    1,
    8,
  );
  const existing = store.getQueueEntry(driverId);
  const entry = store.joinQueue({
    driverId,
    joinedAt: existing?.joinedAt ?? Date.now(),
    status: existing?.status ?? "searching",
    availableSeats,
    lastLocation: location,
    priorityLock: existing?.priorityLock ?? false,
    currentOrderId: existing?.currentOrderId,
    seatLockExpiresAt: existing?.seatLockExpiresAt,
  });
  emitQueueUpdate(request.app.locals.io);
  response.status(201).json({
    message: translate(request.auth?.locale ?? "ru", "queueJoined"),
    entry,
    position: store.getQueuePosition(driverId),
  });
}

export function leaveQueue(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  store.leaveQueue(driverId);
  emitQueueUpdate(request.app.locals.io);
  response.status(204).send();
}

export function updateQueueLocation(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  const location = getLocation(request);
  const entry = store.updateQueueEntry(driverId, { lastLocation: location });
  if (!entry) {
    throw new AppError(404, "Driver is not in the queue", "NOT_IN_QUEUE");
  }
  response.json({ entry, position: store.getQueuePosition(driverId) });
}

export function updateQueueStatus(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  const status = pickEnum(
    request.body?.status,
    "status",
    ["searching", "picking_up", "en_route_to_c", "arrived_at_c", "in_transit"] as const,
  ) as DriverQueueStatus;
  const entry = store.updateQueueEntry(driverId, {
    status,
    priorityLock:
      status === "picking_up" ||
      status === "en_route_to_c" ||
      status === "arrived_at_c" ||
      status === "in_transit",
  });
  if (!entry) {
    throw new AppError(404, "Driver is not in the queue", "NOT_IN_QUEUE");
  }
  emitQueueUpdate(request.app.locals.io);
  response.json({ entry, position: store.getQueuePosition(driverId) });
}