import type { Coordinates } from "../types/domain";

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const deltaLat = ((b.lat - a.lat) * Math.PI) / 180;
  const deltaLng = ((b.lng - a.lng) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function speedKmh(
  previous: Coordinates,
  current: Coordinates,
): number {
  const elapsedHours = (current.timestamp - previous.timestamp) / 3_600_000;
  if (elapsedHours <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return distanceMeters(previous, current) / 1000 / elapsedHours;
}

export function isValidCoordinates(location: Coordinates): boolean {
  return (
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180
  );
}