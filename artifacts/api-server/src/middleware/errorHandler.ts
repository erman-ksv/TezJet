import type { ErrorRequestHandler } from "express";
import { logger } from "../lib/logger";
import { AppError, errorMessage } from "../utils/errors";

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  _next,
) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(500, "Internal server error", "INTERNAL_SERVER_ERROR");

  if (appError.statusCode >= 500) {
    logger.error({ err: error, method: request.method, url: request.url }, errorMessage(error));
  }

  response.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
    },
  });
};