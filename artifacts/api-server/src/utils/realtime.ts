import type { Server } from "socket.io";
import type { Order } from "../types/domain";
import { store } from "../store/memoryStore";
import { serializeOrder } from "./serialize";

export function emitQueueUpdate(io?: Server): void {
  io?.emit("queue:update", {
    queue: store.queueSnapshot(),
    updated_at: new Date().toISOString(),
  });
}

export function emitOrderUpdate(io: Server | undefined, order: Order): void {
  if (!io) {
    return;
  }
  const payload = {
    order: serializeOrder(order),
    updated_at: new Date().toISOString(),
  };
  io.to(`user:${order.passengerId}`).emit("order:status", payload);
  if (order.driverId) {
    io.to(`user:${order.driverId}`).emit("order:status", payload);
  }
}

export function emitIncomingOrder(
  io: Server | undefined,
  driverId: string,
  order: Order,
): void {
  io?.to(`user:${driverId}`).emit("incoming_order", {
    priority: "high",
    sound: "incoming_order.mp3",
    order: serializeOrder(order, true),
    received_at: new Date().toISOString(),
  });
}