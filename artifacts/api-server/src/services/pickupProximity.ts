import type { Coordinates, QueueEntry } from "../types/domain";
import { distanceMeters } from "../utils/geo";

export const PICKUP_MATCH_RADIUS_METERS = 150;
export const MAX_APPROACHING_PICKUP_RADIUS_METERS = 3_000;
export const APPROACHING_HEADING_TOLERANCE_DEGREES = 45;

function normalizeBearing(degrees: number): number {
  return (degrees + 360) % 360;
}

function bearingDegrees(from: Coordinates, to: Coordinates): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

function angularDifference(a: number, b: number): number {
  const difference = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return Math.min(difference, 360 - difference);
}

function isMovingTowardsPickup(
  previous: Coordinates | undefined,
  current: Coordinates,
  pickup: Coordinates,
): boolean {
  if (!previous || current.timestamp <= previous.timestamp) return false;
  const previousDistance = distanceMeters(previous, pickup);
  const currentDistance = distanceMeters(current, pickup);
  if (currentDistance >= previousDistance) return false;
  if (distanceMeters(previous, current) < 5) return false;
  return angularDifference(
    bearingDegrees(previous, current),
    bearingDegrees(current, pickup),
  ) <= APPROACHING_HEADING_TOLERANCE_DEGREES;
}

/** Eligible only at the pickup or when recent movement shows the driver is approaching it. */
export function isDriverEligibleForPickup(
  entry: QueueEntry,
  pickup: Coordinates,
  seats: number,
): boolean {
  if (entry.availableSeats < seats) return false;
  const distanceToPickup = distanceMeters(entry.lastLocation, pickup);
  if (distanceToPickup <= PICKUP_MATCH_RADIUS_METERS) return true;
  if (distanceToPickup > MAX_APPROACHING_PICKUP_RADIUS_METERS) return false;
  return isMovingTowardsPickup(entry.previousLocation, entry.lastLocation, pickup);
}
