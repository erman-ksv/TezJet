import type { Server } from "socket.io";
import type { Order, QueueEntry } from "../types/domain";
import { store } from "../store/memoryStore";
import {
  ORDER_OFFER_TIMEOUT_MS,
  SMART_POOLING_MAX_LOCATION_AGE_MS,
  SMART_POOLING_MAX_PICKUP_DISTANCE_METERS,
} from "../utils/config";
import { distanceMeters } from "../utils/geo";
import { emitIncomingOrder, emitOrderUpdate } from "../utils/realtime";

export interface OrderOffer {
  driverId: string;
  queuePosition: number | null;
  smartPooling: boolean;
}

const offerTimers = new Map<string, ReturnType<typeof setTimeout>>();
const offerTimeoutMs =
  Number.isFinite(ORDER_OFFER_TIMEOUT_MS) && ORDER_OFFER_TIMEOUT_MS > 0
    ? ORDER_OFFER_TIMEOUT_MS
    : 15_000;
const maxPickupDistanceMeters =
  Number.isFinite(SMART_POOLING_MAX_PICKUP_DISTANCE_METERS) &&
  SMART_POOLING_MAX_PICKUP_DISTANCE_METERS >= 0
    ? SMART_POOLING_MAX_PICKUP_DISTANCE_METERS
    : 1_500;
const maxLocationAgeMs =
  Number.isFinite(SMART_POOLING_MAX_LOCATION_AGE_MS) &&
  SMART_POOLING_MAX_LOCATION_AGE_MS > 0
    ? SMART_POOLING_MAX_LOCATION_AGE_MS
    : 2 * 60 * 1000;

function clearOfferTimer(orderId: string): void {
  const timer = offerTimers.get(orderId);
  if (timer) {
    clearTimeout(timer);
    offerTimers.delete(orderId);
  }
}

function getOfferFromOrder(order: Order): OrderOffer | null {
  if (!order.offeredDriverId) {
    return null;
  }
  const entry = store.getQueueEntry(order.offeredDriverId);
  return {
    driverId: order.offeredDriverId,
    queuePosition: store.getQueuePosition(order.offeredDriverId),
    smartPooling: entry?.status === "in_transit" && entry.inFifo === false,
  };
}

function routeContainsOrder(activeOrder: Order, candidate: Order): boolean {
  if (
    activeOrder.fare.routeId !== candidate.fare.routeId ||
    !Number.isFinite(activeOrder.fare.pickupPosition) ||
    !Number.isFinite(activeOrder.fare.destinationPosition) ||
    !Number.isFinite(candidate.fare.pickupPosition) ||
    !Number.isFinite(candidate.fare.destinationPosition)
  ) {
    return false;
  }

  const start = activeOrder.fare.pickupPosition;
  const end = activeOrder.fare.destinationPosition;
  const pickup = candidate.fare.pickupPosition;
  const destination = candidate.fare.destinationPosition;
  const direction = Math.sign(end - start);

  if (direction === 0) {
    return pickup === start && destination === start;
  }
  if (direction > 0) {
    return (
      pickup >= start &&
      pickup <= end &&
      destination >= pickup &&
      destination <= end
    );
  }
  return (
    pickup <= start &&
    pickup >= end &&
    destination <= pickup &&
    destination >= end
  );
}

function getActiveTripOrders(entry: QueueEntry): Order[] | null {
  const orderIds = [
    ...new Set(
      entry.activeOrderIds ??
        (entry.currentOrderId ? [entry.currentOrderId] : []),
    ),
  ];
  if (orderIds.length === 0) {
    return null;
  }

  const orders = orderIds.map((orderId) => store.getOrder(orderId));
  if (
    orders.some(
      (order) =>
        !order ||
        order.driverId !== entry.driverId ||
        order.status !== "in_transit",
    )
  ) {
    return null;
  }
  return orders as Order[];
}

function getSmartPoolingCandidates(order: Order): QueueEntry[] {
  if (order.pickupPoint !== "D") {
    return [];
  }
  const now = Date.now();
  return store
    .listQueueEntries()
    .filter((entry) => {
      if (
        entry.status !== "in_transit" ||
        entry.inFifo !== false ||
        entry.availableSeats < order.seats ||
        now - entry.lastLocation.timestamp > maxLocationAgeMs ||
        entry.lastLocation.timestamp > now + 30_000 ||
        distanceMeters(entry.lastLocation, order.pickupLocation) >
          maxPickupDistanceMeters ||
        store.hasActiveOfferForDriver(entry.driverId, order.id)
      ) {
        return false;
      }

      const activeOrders = getActiveTripOrders(entry);
      return Boolean(
        activeOrders?.every((activeOrder) =>
          routeContainsOrder(activeOrder, order),
        ),
      );
    })
    .sort((a, b) => {
      const distance =
        distanceMeters(a.lastLocation, order.pickupLocation) -
        distanceMeters(b.lastLocation, order.pickupLocation);
      return distance || a.joinedAt - b.joinedAt;
    });
}

function createOffer(
  order: Order,
  driver: QueueEntry,
  smartPooling: boolean,
  io: Server | undefined,
  notifyPassenger: boolean,
): OrderOffer {
  clearOfferTimer(order.id);
  const expiresAt = Date.now() + offerTimeoutMs;
  const offeredDriverIds = [
    ...new Set([...(order.offeredDriverIds ?? []), driver.driverId]),
  ];
  const updated = store.updateOrder(order.id, {
    offeredDriverId: driver.driverId,
    offerExpiresAt: expiresAt,
    offeredDriverIds,
  }) as Order;

  emitIncomingOrder(io, driver.driverId, updated);
  if (notifyPassenger) {
    emitOrderUpdate(io, updated);
  }

  const timer = setTimeout(() => {
    expireOrderOffer(order.id, driver.driverId, expiresAt, io);
  }, offerTimeoutMs);
  offerTimers.set(order.id, timer);

  return {
    driverId: driver.driverId,
    queuePosition: smartPooling
      ? null
      : store.getQueuePosition(driver.driverId),
    smartPooling,
  };
}

export function clearOrderOffer(orderId: string): void {
  clearOfferTimer(orderId);
}

export function dispatchNextOrderOffer(
  orderId: string,
  io: Server | undefined,
  notifyPassenger = true,
  notifyWhenUnmatched = false,
): OrderOffer | null {
  const order = store.getOrder(orderId);
  if (!order || order.status !== "searching") {
    return null;
  }

  const currentExpiry = order.offerExpiresAt;
  if (
    order.offeredDriverId &&
    (currentExpiry === undefined || currentExpiry > Date.now())
  ) {
    return getOfferFromOrder(order);
  }

  const hadOffer = Boolean(order.offeredDriverId);
  if (hadOffer) {
    clearOfferTimer(orderId);
    store.updateOrder(orderId, {
      offeredDriverId: undefined,
      offerExpiresAt: undefined,
    });
  }

  const currentOrder = store.getOrder(orderId) as Order;
  const attempted = currentOrder.offeredDriverIds ?? [];
  const fifoDriver = store.getAvailableFifoDrivers(
    currentOrder.seats,
    attempted,
    currentOrder.id,
  )[0];
  if (fifoDriver) {
    return createOffer(currentOrder, fifoDriver, false, io, notifyPassenger);
  }

  const poolDriver = getSmartPoolingCandidates(currentOrder).find(
    (entry) => !attempted.includes(entry.driverId),
  );
  if (poolDriver) {
    return createOffer(currentOrder, poolDriver, true, io, notifyPassenger);
  }

  if (notifyPassenger && (hadOffer || notifyWhenUnmatched)) {
    emitOrderUpdate(io, store.getOrder(orderId) as Order);
  }
  return null;
}

export function expireOrderOffer(
  orderId: string,
  driverId: string,
  expiresAt: number,
  io: Server | undefined,
): OrderOffer | null {
  const order = store.getOrder(orderId);
  if (
    !order ||
    order.status !== "searching" ||
    order.offeredDriverId !== driverId ||
    order.offerExpiresAt !== expiresAt
  ) {
    return null;
  }

  if (Date.now() < expiresAt) {
    const timer = setTimeout(() => {
      expireOrderOffer(orderId, driverId, expiresAt, io);
    }, expiresAt - Date.now());
    offerTimers.set(orderId, timer);
    return null;
  }

  clearOfferTimer(orderId);
  store.updateOrder(orderId, {
    offeredDriverId: undefined,
    offerExpiresAt: undefined,
  });
  return dispatchNextOrderOffer(orderId, io, true, true);
}

export function declineOrderOffer(
  orderId: string,
  driverId: string,
  io: Server | undefined,
): { order: Order; offer: OrderOffer | null } | null {
  const order = store.getOrder(orderId);
  if (
    !order ||
    order.status !== "searching" ||
    order.offeredDriverId !== driverId
  ) {
    return null;
  }

  clearOfferTimer(orderId);
  store.updateOrder(orderId, {
    offeredDriverId: undefined,
    offerExpiresAt: undefined,
  });
  const offer = dispatchNextOrderOffer(orderId, io, true, true);
  return { order: store.getOrder(orderId) as Order, offer };
}

export function dispatchWaitingOrders(io: Server | undefined): void {
  for (const order of store.listOrders()) {
    if (
      order.status === "searching" &&
      !order.offeredDriverId
    ) {
      dispatchNextOrderOffer(order.id, io);
    }
  }
}
