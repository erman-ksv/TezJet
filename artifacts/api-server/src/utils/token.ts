import * as jwt from "jsonwebtoken";
import { JWT_EXPIRES_IN, JWT_SECRET } from "./config";
import type { UserRole } from "../types/domain";

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  locale: string;
  sessionVersion: number;
  sessionId: string;
}

export function createAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof decoded.sub !== "string" ||
      typeof decoded.role !== "string" ||
      typeof decoded.locale !== "string" ||
      typeof decoded.sessionVersion !== "number" ||
      typeof decoded.sessionId !== "string"
    ) {
      return null;
    }
    return decoded as AccessTokenClaims;
  } catch {
    return null;
  }
}