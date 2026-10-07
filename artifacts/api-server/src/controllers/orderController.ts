import type { Request, Response } from "express";
import type { Server } from "socket.io";
import { store } from "../store/memoryStore";
import type { Coordinates, Order, OrderStatus, PickupPoint } from "../types/domain";
import { getDriverOfferTtlMs, SEAT_LOCK_TTL_MS } from "../utils/config";
import { AppError } from "../utils/errors";
import { translate } from "../utils/i18n";
import { emitIncomingOrder, emitOrderUpdate, emitQueueUpdate } from "../utils/realtime";
import { serializeOrder } from "../utils/serialize";
import { calculateRouteFare, parseRouteStopCodes } from "../utils/fare";
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

function offerNextDriver(io: Server | undefined, order: Order, excludedDriverId?: string): Order {
  const nextDriver = store.getEligibleDriverForPickup(
    order.seats,
    order.pickupLocation,
    excludedDriverId ?? order.offeredDriverId,
    150,
    order.pickupPoint === "D",
  );
  if (!nextDriver) {
    const updated = store.updateOrder(order.id, {
      offeredDriverId: undefined,
      offerExpiresAt: undefined,
    }) as Order;
    emitOrderUpdate(io, updated);
    return updated;
  }

  const offerExpiresAt = Date.now() + getDriverOfferTtlMs();
  const updated = store.updateOrder(order.id, {
    offeredDriverId: nextDriver.driverId,
    offerExpiresAt,
  }) as Order;
  sendOrderToDriver(io, updated, nextDriver.driverId);
  emitOrderUpdate(io, updated);
  emitQueueUpdate(io, {
    type: "order_offered",
    driverId: nextDriver.driverId,
  });

  setTimeout(() => {
    const current = store.getOrder(order.id);
    if (
      !current ||
      current.status !== "searching" ||
      current.offeredDriverId !== nextDriver.driverId ||
      !current.offerExpiresAt ||
      current.offerExpiresAt > Date.now()
    ) {
      return;
    }
    offerNextDriver(io, current, nextDriver.driverId);
  }, getDriverOfferTtlMs() + 10);

  return updated;
}


export function getOrderAvailability(request: Request, response: Response): void {
  const pickupPoint = pickEnum(
    request.query.pickup_point ?? "C",
    "pickup_point",
    ["C", "D"] as const,
  ) as PickupPoint;
  const pickupLocation = {
    lat: Number(request.query.lat),
    lng: Number(request.query.lng),
    timestamp: Date.now(),
  };
  if (!Number.isFinite(pickupLocation.lat) || !Number.isFinite(pickupLocation.lng)) {
    throw new AppError(400, "pickup location is required", "VALIDATION_ERROR");
  }
  const seats = boundedInteger(request.query.seats ?? 1, "seats", 1, 8);
  const driver = store.getEligibleDriverForPickup(seats, pickupLocation);
  response.json({
    available: Boolean(driver),
    message: driver
      ? "A driver is available"
      : translate(request.auth?.locale ?? "ru", "driversUnavailable"),
    pickup_point: pickupPoint,
    driver_id: driver?.driverId ?? null,
  });
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
  const pickupLocation = getPickupLocation(request);
  const seats = boundedInteger(request.body?.seats ?? 1, "seats", 1, 8);
  const availableDriver = store.getEligibleDriverForPickup(
    seats,
    pickupLocation,
    undefined,
    150,
    pickupPoint === "D",
  );
  if (!availableDriver) {
    throw new AppError(
      409,
      translate(request.auth?.locale ?? "ru", "driversUnavailable"),
      "DRIVERS_UNAVAILABLE",
    );
  }

  const requestedStops = parseRouteStopCodes(request.body?.route_stops);
  const fare = calculateRouteFare({
    routeId: request.body?.route_id,
    pickupStop: request.body?.pickup_stop ?? pickupPoint,
    destinationStop: request.body?.destination_stop,
    routeStops: requestedStops.length > 0 ? requestedStops : undefined,
  });
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
    pickupLocation,
    pickupAddress,
    routeStops: fare.stops,
    fare,
    destination: requiredString(request.body?.destination, "destination", 240),
    seats,
    status: "searching",
  });

  const firstDriver = availableDriver;
  if (firstDriver) {
    const offered = store.updateOrder(order.id, {
      offeredDriverId: firstDriver.driverId,
      offerExpiresAt: Date.now() + getDriverOfferTtlMs(),
    }) as Order;
    Object.assign(order, offered);
    sendOrderToDriver(getSocket(request), order, firstDriver.driverId);
    setTimeout(() => {
      const current = store.getOrder(order.id);
      if (
        !current ||
        current.status !== "searching" ||
        current.offeredDriverId !== firstDriver.driverId ||
        !current.offerExpiresAt ||
        current.offerExpiresAt > Date.now()
      ) {
        return;
      }
      offerNextDriver(getSocket(request), current, firstDriver.driverId);
    }, getDriverOfferTtlMs() + 10);
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
  const isActivePoolOffer =
    order.pickupPoint === "D" &&
    order.offeredDriverId === driverId &&
    queueEntry?.inFifo === false &&
    queueEntry.status === "in_transit";
  if (!queueEntry || (!isActivePoolOffer && position !== 1 && order.offeredDriverId !== driverId)) {
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
    offerExpiresAt: undefined,
    status,
    seatLockExpiresAt,
  }) as Order;

  const activeOrderIds = [
    ...(queueEntry.activeOrderIds ??
      (queueEntry.currentOrderId ? [queueEntry.currentOrderId] : [])),
    order.id,
  ];
  const remainingSeats = queueEntry.availableSeats - order.seats;
  const staysInFifo =
    queueEntry.inFifo !== false &&
    status !== "in_transit" &&
    remainingSeats > 0;
  store.updateQueueEntry(driverId, {
    status: order.pickupPoint === "C" ? "en_route_to_c" : "in_transit",
    priorityLock: true,
    currentOrderId: order.id,
    activeOrderIds: [...new Set(activeOrderIds)],
    inFifo: staysInFifo,
    availableSeats: remainingSeats,
    seatLockExpiresAt,
  });
  if (seatLockExpiresAt) {
    setTimeout(() => {
      store.clearExpiredSeatLocks();
      emitQueueUpdate(getSocket(request), {
        type: "seat_lock_expired",
        driverId,
      });
    }, SEAT_LOCK_TTL_MS + 100);
  }

  emitOrderUpdate(getSocket(request), updated);
  emitQueueUpdate(getSocket(request), {
    type: "order_assigned",
    driverId,
  });
  response.json({
    message: translate(request.auth?.locale ?? "ru", "seatLocked"),
    order: serializeOrder(updated, true),
    seat_lock_minutes: order.pickupPoint === "C" ? 7 : null,
  });
}

export function rejectOrder(request: Request, response: Response): void {
  const driverId = assertDriver(request);
  const order = store.getOrder(String(request.params["orderId"]));
  if (!order) {
    throw new AppError(
      404,
      translate(request.auth?.locale ?? "ru", "orderNotFound"),
      "ORDER_NOT_FOUND",
    );
  }
  if (
    order.status !== "searching" ||
    order.offeredDriverId !== driverId
  ) {
    throw new AppError(409, "Order is not currently offered to this driver", "ORDER_NOT_OFFERED");
  }

  const updated = offerNextDriver(getSocket(request), order, driverId);
  response.json({
    order: serializeOrder(updated, true),
    offered_driver_id: updated.offeredDriverId ?? null,
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
      inFifo: false,
      seatLockExpiresAt: undefined,
    });
  } else if (nextStatus === "completed" || nextStatus === "cancelled") {
    const entry = store.getQueueEntry(driverId);
    if (entry) {
      const activeOrderIds = (
        entry.activeOrderIds ??
        (entry.currentOrderId ? [entry.currentOrderId] : [])
      ).filter((orderId) => orderId !== order.id);
      const availableSeats = entry.availableSeats + order.seats;
      store.updateQueueEntry(
        driverId,
        activeOrderIds.length > 0
          ? {
              status: "in_transit",
              priorityLock: true,
              inFifo: false,
              activeOrderIds,
              currentOrderId: activeOrderIds[0],
              seatLockExpiresAt: undefined,
              availableSeats,
            }
          : {
              status: "searching",
              priorityLock: false,
              inFifo: true,
              activeOrderIds: [],
              currentOrderId: undefined,
              seatLockExpiresAt: undefined,
              availableSeats,
            },
      );
    }
  }

  emitOrderUpdate(getSocket(request), updated);
  emitQueueUpdate(getSocket(request), {
    type: "order_released",
    driverId,
  });
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
    if (entry) {
      const activeOrderIds = (
        entry.activeOrderIds ??
        (entry.currentOrderId ? [entry.currentOrderId] : [])
      ).filter((orderId) => orderId !== order.id);
      const availableSeats = entry.availableSeats + order.seats;
      store.updateQueueEntry(
        order.driverId,
        activeOrderIds.length > 0
          ? {
              status: "in_transit",
              priorityLock: true,
              inFifo: false,
              activeOrderIds,
              currentOrderId: activeOrderIds[0],
              seatLockExpiresAt: undefined,
              availableSeats,
            }
          : {
              status: "searching",
              priorityLock: false,
              inFifo: true,
              activeOrderIds: [],
              currentOrderId: undefined,
              seatLockExpiresAt: undefined,
              availableSeats,
            },
      );
    }
  }
  emitOrderUpdate(getSocket(request), updated);
  emitQueueUpdate(getSocket(request), {
    type: "order_released",
    driverId: order.driverId,
  });
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