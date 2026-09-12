import type { Request, Response } from "express";
import { randomInt, randomUUID } from "node:crypto";
import { store } from "../store/memoryStore";
import type { Locale, UserRole } from "../types/domain";
import { createAccessToken } from "../utils/token";
import { normalizePhone } from "../utils/phone";
import { serializeUser } from "../utils/serialize";
import { translate } from "../utils/i18n";
import { AppError } from "../utils/errors";
import { OTP_TTL_MS } from "../utils/config";
import { optionalString, pickEnum, requiredString } from "../utils/validation";

const roles = ["passenger", "driver"] as const;
const locales = ["kk", "uz", "ru"] as const;

function getLocale(request: Request, value: unknown): Locale {
  return pickEnum(value ?? request.auth?.locale ?? "ru", "locale", locales);
}

function issueToken(userId: string): string {
  const user = store.invalidateSessions(userId);
  return createAccessToken({
    sub: user.id,
    role: user.role,
    locale: user.locale,
    sessionVersion: user.sessionVersion,
    sessionId: randomUUID(),
  });
}

export function requestOtp(request: Request, response: Response): void {
  const phoneNumber = normalizePhone(requiredString(request.body?.phone_number, "phone_number", 32));
  const role = pickEnum(request.body?.role ?? "passenger", "role", roles);
  const locale = getLocale(request, request.body?.locale);
  const fullName = optionalString(request.body?.full_name, "full_name", 120);
  const code = String(randomInt(100000, 1_000_000));

  store.saveOtp({
    phoneNumber,
    code,
    role,
    locale,
    fullName,
    expiresAt: Date.now() + OTP_TTL_MS,
  });

  response.status(202).json({
    message: translate(locale, "otpSent"),
    expires_in_seconds: OTP_TTL_MS / 1000,
    ...(process.env.NODE_ENV !== "production" ? { demo_code: code } : {}),
  });
}

export function verifyOtp(request: Request, response: Response): void {
  const phoneNumber = normalizePhone(requiredString(request.body?.phone_number, "phone_number", 32));
  const code = requiredString(request.body?.code, "code", 12);
  const challenge = store.consumeOtp(phoneNumber, code);
  if (!challenge) {
    throw new AppError(401, translate("ru", "invalidOtp"), "INVALID_OTP");
  }

  let user = store.getUserByPhone(phoneNumber);
  if (!user) {
    const fullName = requiredString(challenge.fullName ?? request.body?.full_name, "full_name", 120);
    user = store.createUser({
      role: challenge.role,
      fullName,
      phoneNumber,
      locale: challenge.locale,
    });
  }

  const token = issueToken(user.id);
  response.json({
    access_token: token,
    token_type: "Bearer",
    user: serializeUser(user),
    session_policy: "previous_tokens_invalidated",
  });
}

export function getCurrentUser(request: Request, response: Response): void {
  if (!request.auth) {
    throw new AppError(401, translate("ru", "unauthorized"), "UNAUTHORIZED");
  }
  response.json({ user: serializeUser(request.auth.user) });
}

export function updateProfile(request: Request, response: Response): void {
  if (!request.auth) {
    throw new AppError(401, translate("ru", "unauthorized"), "UNAUTHORIZED");
  }
  const incomingName = request.body?.full_name;
  const incomingPhone = request.body?.phone_number;
  if (
    (incomingName !== undefined && incomingName !== request.auth.user.fullName) ||
    (incomingPhone !== undefined &&
      normalizePhone(String(incomingPhone)) !== request.auth.user.phoneNumber)
  ) {
    throw new AppError(
      409,
      translate(request.auth.user.locale, "profileLocked"),
      "PROFILE_LOCKED",
    );
  }

  const locale = request.body?.locale
    ? getLocale(request, request.body.locale)
    : request.auth.user.locale;
  const user = store.updateUser(request.auth.userId, { locale });
  response.json({ user: serializeUser(user) });
}

export function logout(request: Request, response: Response): void {
  if (request.auth) {
    store.invalidateSessions(request.auth.userId);
  }
  response.status(204).send();
}