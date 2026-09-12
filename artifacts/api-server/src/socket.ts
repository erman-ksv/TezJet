import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { store } from "./store/memoryStore";
import { readSocketToken } from "./middleware/auth";
import { verifyAccessToken } from "./utils/token";
import { logger } from "./lib/logger";

export function createRealtimeServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/api/socket.io",
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()) ?? "*",
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  io.use((socket, next) => {
    const token = readSocketToken(socket.handshake.auth?.token);
    const claims = token ? verifyAccessToken(token) : null;
    const user = claims?.sub ? store.getUser(claims.sub) : undefined;
    if (
      !claims ||
      !user ||
      user.sessionVersion !== claims.sessionVersion ||
      user.role !== claims.role
    ) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.userId = user.id;
    socket.data.role = user.role;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    socket.emit("connected", {
      user_id: userId,
      events: ["incoming_order", "order:status", "queue:update", "push_alert"],
    });
    logger.info({ userId, socketId: socket.id }, "Socket client connected");

    socket.on("driver:location", (location: unknown) => {
      if (socket.data.role !== "driver") {
        return;
      }
      socket.broadcast.emit("driver:location", {
        driver_id: userId,
        location,
      });
    });

    socket.on("disconnect", (reason) => {
      logger.info({ userId, socketId: socket.id, reason }, "Socket client disconnected");
    });
  });

  return io;
}