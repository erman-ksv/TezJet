import { AppError } from "./errors";

export function requiredString(
  value: unknown,
  field: string,
  maxLength = 255,
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new AppError(400, `${field} is required`, "VALIDATION_ERROR");
  }
  return value.trim();
}

export function optionalString(
  value: unknown,
  field: string,
  maxLength = 255,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, field, maxLength);
}

export function boundedInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(numberValue) ||
    numberValue < min ||
    numberValue > max
  ) {
    throw new AppError(400, `${field} must be between ${min} and ${max}`, "VALIDATION_ERROR");
  }
  return numberValue;
}

export function pickEnum<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new AppError(400, `${field} is invalid`, "VALIDATION_ERROR");
  }
  return value as T;
}