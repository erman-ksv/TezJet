import type { Request, Response } from "express";
import { normalizeNaturalLanguageAddress } from "../services/geminiAddressService";
import { requiredString } from "../utils/validation";

export async function normalizeAddress(
  request: Request,
  response: Response,
): Promise<void> {
  const address = requiredString(request.body?.address, "address", 500);
  const locale = request.auth?.locale ?? "ru";
  const normalized = await normalizeNaturalLanguageAddress(address, locale);
  response.json({ address: normalized });
}