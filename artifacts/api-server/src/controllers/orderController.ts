import type { Request, Response } from "express";
import type { Server } from "socket.io";
import { store } from "../store/memoryStore";
import type { Coordinates, Order, OrderStatus, PickupPoint } from "../types/domain";
import { SEAT_LOCK_TTL_MS } from "../utils/config";
import { AppError } from "../utils/errors";
import { translate } from "../utils/i18n";
import { emitIncomingOrder, emitOrderUpdate, emitQueueUpdate } from "../utils/realtime";
import { serializeOrder } from "../utils/serialize";
import { boundedInteger, optionalString, pickEnum, requiredString } from "../utils/validation";
import { normalizeNaturalLanguageAddress } from "../services/geminiAddressService";

const statusTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  searching: ["en_route_to_c", "cancelled"],
  en_route_to_c: ["arrived_at_c", "cancelled"],
  arrived_at_c: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function getSocket(request: Request): Server | undefined {
  return request.app.locals.io as Server | undefined;
}

function getPickupLocation(request: Request): Coordinates {
  const raw = request.body?.pickup_location;
  if (!raw || typeof raw !== "object") {
    throw new AppError(400, "pickup_location is required", "VALIDATION_ERROR");
  }
  const input = raw as Record<string, unknown>;
  return {
    lat: Number(input["lat"]),
    lng: Number(input["lng"]),
    timestamp: input["timestamp"] ? Number(input["timestamp"]) : Date.now(),
    isMocked: input["isMocked"] === true,
  };
}

function assertPassenger(request: Request): string {
  if (!request.auth || request.auth.role !== "passenger") {
    throw new AppError(
      403,
      translate(request.auth?.locale ?? "ru", "passengerOnly"),
      "PASSENGER_ONLY",
    );
  }
  return request.auth.userId;
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

function getOrderForActor(request: Request, orderId: string): Order {
  const order = store.getOrder(orderId);
  if (!order) {
    throw new AppError(
      404,
      translate(request.auth?.locale ?? "ru", "orderNotFound"),
      "ORDER_NOT_FOUND",
    );
  }
  const userId = request.auth?.userId;
  if (
    userId !== order.passengerId &&
    userId !== order.driverId &&
    userId !== order.offeredDriverId
  ) {
    throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
  }
  return order;
}

function sendOrderToDriver(io: Server | undefined, order: Order, driverId: string): void {
  emitIncomingOrder(io, driverId, order);
}

export async function createOrder(
  request: Request,
  response: Response,
): Promise<void> {
  const passengerId = assertPassenger(request);
  const pickupPoint = pickEnum(request.body?.pickup_point ?? "C", "pickup_point", [
    "C",
    "D",
  ] as const) as PickupPoint;
  const pickupAddressText = optionalString(
    request.body?.pickup_address,
    "pickup_address",
    500,
  );
  const pickupAddress = pickupAddressText
    ? await normalizeNaturalLanguageAddress(
        pickupAddressText,
        request.auth?.locale ?? "ru",
      )
    : undefined;
  const order = store.createOrder({
    passengerId,
    passengerPhone: request.auth?.user.phoneNumber ?? "",
    pickupPoint,
    pickupLocation: getPickupLocation(request),
    pickupAddress,
    destination: requiredString(request.body?.destination, "destination", 240),
    seats: boundedInteger(request.body?.seats ?? 1, "seats", 1, 8),
    status: "searching",
  });

  const firstDriver =
    pickupPoint === "D"
      ? store.getFirstEligibleDriver(order.seats)
      : store.getQueue()[0];
  if (firstDriver) {
    store.updateOrder(order.id, { offeredDriverId: firstDriver.driverId });
    order.offeredDriverId = firstDriver.driverId;
    sendOrderToDriver(getSocket(request), order, firstDriver.driverId);
  }

  response.status(201).json({
    order: serializeOrder(order),
    offer: firstDriver
      ? {
          driver_id: firstDriver.driverId,
          queue_position: store.getQueuePosition(firstDriver.driverId),
          smart_pooling: pickupPoint === "D",
        }
      : null,
  });
}

export function listOrders(request: Request, response: Response): void {
  const orders = store.listOrdersForUser(request.auth?.userId ?? "").map((order) =>
    serializeOrder(order, request.auth?.role === "driver"),
  );
  response.json({ orders });
}

export function getOrder(request: Request, response: Response): void {
  const order = getOrderForActor(request, String(request.params["orderId"]));
  response.json({
    order: serializeOrder(order, request.auth?.role === "driver"),
  });
}

export function acceptOrder(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  const order = store.getOrder(String(request.params["orderId"]));
  if (!order) {
    throw new AppError(
      404,
      translate(request.auth?.locale ?? "ru", "orderNotFound"),
      "ORDER_NOT_FOUND",
    );
  }
  if (order.status !== "searching" || (order.driverId && order.driverId !== driverId)) {
    throw new AppError(409, "Order is no longer available", "ORDER_UNAVAILABLE");
  }
  if (order.offeredDriverId && order.offeredDriverId !== driverId) {
    throw new AppError(409, "Order is reserved for another driver", "ORDER_RESERVED");
  }

  const queueEntry = store.getQueueEntry(driverId);
  const position = store.getQueuePosition(driverId);
  if (!queueEntry || position !== 1) {
    throw new AppError(409, "Only the first driver in the queue can accept this order", "FIFO_REQUIRED");
  }
  if (queueEntry.availableSeats < order.seats) {
    throw new AppError(409, "Not enough available seats", "SEATS_UNAVAILABLE");
  }

  const seatLockExpiresAt =
    order.pickupPoint === "C" ? Date.now() + SEAT_LOCK_TTL_MS : undefined;
  const status: OrderStatus = order.pickupPoint === "C" ? "en_route_to_c" : "in_transit";
  const updated = store.updateOrder(order.id, {
    driverId,
    offeredDriverId: driverId,
    status,
    seatLockExpiresAt,
  }) as Order;

  store.updateQueueEntry(driverId, {
    status: order.pickupPoint === "C" ? "en_route_to_c" : "in_transit",
    priorityLock: true,
    currentOrderId: order.id,
    availableSeats: queueEntry.availableSeats - order.seats,
    seatLockExpiresAt,
  });
  if (seatLockExpiresAt) {
    setTimeout(() => {
      store.clearExpiredSeatLocks();
      emitQueueUpdate(getSocket(request));
    }, SEAT_LOCK_TTL_MS + 100);
  }

  emitOrderUpdate(getSocket(request), updated);
  emitQueueUpdate(getSocket(request));
  response.json({
    message: translate(request.auth?.locale ?? "ru", "seatLocked"),
    order: serializeOrder(updated, true),
    seat_lock_minutes: order.pickupPoint === "C" ? 7 : null,
  });
}

export function updateOrderStatus(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  const order = getOrderForActor(request, String(request.params["orderId"]));
  if (order.driverId !== driverId) {
    throw new AppError(403, "Only the assigned driver can update this order", "NOT_ASSIGNED");
  }
  const nextStatus = pickEnum(
    request.body?.status,
    "status",
    ["en_route_to_c", "arrived_at_c", "in_transit", "completed", "cancelled"] as const,
  ) as OrderStatus;
  if (!statusTransitions[order.status].includes(nextStatus)) {
    throw new AppError(
      409,
      translate(request.auth?.locale ?? "ru", "invalidStatus"),
      "INVALID_STATUS_TRANSITION",
    );
  }

  const updated = store.updateOrder(order.id, {
    status: nextStatus,
    seatLockExpiresAt: nextStatus === "in_transit" ? undefined : order.seatLockExpiresAt,
  }) as Order;
  if (nextStatus === "arrived_at_c" || nextStatus === "en_route_to_c") {
    store.updateQueueEntry(driverId, {
      status: nextStatus,
      priorityLock: true,
    });
  } else if (nextStatus === "in_transit") {
    store.updateQueueEntry(driverId, {
      status: "in_transit",
      priorityLock: true,
      seatLockExpiresAt: undefined,
    });
  } else if (nextStatus === "completed" || nextStatus === "cancelled") {
    const entry = store.getQueueEntry(driverId);
    store.updateQueueEntry(driverId, {
      status: "searching",
      priorityLock: false,
      currentOrderId: undefined,
      seatLockExpiresAt: undefined,
      availableSeats: entry
        ? entry.availableSeats + (nextStatus === "completed" ? order.seats : 0)
        : undefined,
    });
  }

  emitOrderUpdate(getSocket(request), updated);
  emitQueueUpdate(getSocket(request));
  response.json({ order: serializeOrder(updated, true) });
}

export function cancelOrder(request: Request, response: Response): void {
  const order = getOrderForActor(request, String(request.params["orderId"]));
  if (order.status === "completed" || order.status === "cancelled") {
    throw new AppError(409, "Order is already closed", "ORDER_CLOSED");
  }
  const updated = store.updateOrder(order.id, {
    status: "cancelled",
    cancelledBy: request.auth?.userId,
    driverId: order.driverId,
    seatLockExpiresAt: undefined,
  }) as Order;
  if (order.driverId) {
    const entry = store.getQueueEntry(order.driverId);
    store.updateQueueEntry(order.driverId, {
      status: "searching",
      priorityLock: false,
      currentOrderId: undefined,
      seatLockExpiresAt: undefined,
      availableSeats: entry ? entry.availableSeats + order.seats : undefined,
    });
  }
  emitOrderUpdate(getSocket(request), updated);
  emitQueueUpdate(getSocket(request));
  response.json({ order: serializeOrder(updated, request.auth?.role === "driver") });
}

export function offerToFirstDriver(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  const order = getOrderForActor(request, String(request.params["orderId"]));
  if (order.pickupPoint !== "D" || order.status !== "searching") {
    throw new AppError(409, "Only searching Point D orders can be pooled", "NOT_POOLING_ORDER");
  }
  const firstDriver = store.getFirstEligibleDriver(order.seats);
  if (!firstDriver || firstDriver.driverId !== driverId) {
    throw new AppError(409, "You are not the eligible first driver", "FIFO_REQUIRED");
  }
  store.updateOrder(order.id, { offeredDriverId: driverId });
  order.offeredDriverId = driverId;
  sendOrderToDriver(getSocket(request), order, driverId);
  response.json({ order: serializeOrder(order, true), smart_pooling: true });
}