import { randomUUID } from "node:crypto";
import type {
  Coordinates,
  DeviceRegistration,
  DriverQueueStatus,
  Locale,
  Order,
  OrderStatus,
  OtpChallenge,
  QueueEntry,
  User,
  UserRole,
} from "../types/domain";

class MemoryStore {
  private readonly users = new Map<string, User>();
  private readonly usersByPhone = new Map<string, string>();
  private readonly otpChallenges = new Map<string, OtpChallenge>();
  private readonly queueEntries = new Map<string, QueueEntry>();
  private readonly orders = new Map<string, Order>();
  private readonly deviceRegistrations = new Map<string, DeviceRegistration>();

  createUser(input: {
    role: UserRole;
    fullName: string;
    phoneNumber: string;
    locale: Locale;
  }): User {
    const user: User = {
      id: randomUUID(),
      role: input.role,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      locale: input.locale,
      profileLocked: true,
      sessionVersion: 0,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.usersByPhone.set(user.phoneNumber, user.id);
    return user;
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  getUserByPhone(phoneNumber: string): User | undefined {
    const userId = this.usersByPhone.get(phoneNumber);
    return userId ? this.users.get(userId) : undefined;
  }

  updateUser(userId: string, patch: Partial<Pick<User, "locale" | "lastLocation">>): User {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    Object.assign(user, patch);
    return user;
  }

  invalidateSessions(userId: string): User {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    user.sessionVersion += 1;
    return user;
  }

  saveOtp(challenge: OtpChallenge): void {
    this.otpChallenges.set(challenge.phoneNumber, challenge);
  }

  consumeOtp(phoneNumber: string, code: string): OtpChallenge | undefined {
    const challenge = this.otpChallenges.get(phoneNumber);
    if (!challenge || challenge.code !== code || challenge.expiresAt < Date.now()) {
      return undefined;
    }
    this.otpChallenges.delete(phoneNumber);
    return challenge;
  }

  getQueueEntry(driverId: string): QueueEntry | undefined {
    return this.queueEntries.get(driverId);
  }

  joinQueue(entry: QueueEntry): QueueEntry {
    this.queueEntries.set(entry.driverId, entry);
    return entry;
  }

  updateQueueEntry(
    driverId: string,
    patch: Partial<QueueEntry>,
  ): QueueEntry | undefined {
    const entry = this.queueEntries.get(driverId);
    if (!entry) {
      return undefined;
    }
    Object.assign(entry, patch);
    return entry;
  }

  leaveQueue(driverId: string): void {
    this.queueEntries.delete(driverId);
  }

  getQueue(): QueueEntry[] {
    return [...this.queueEntries.values()]
      .filter((entry) => !entry.seatLockExpiresAt || entry.seatLockExpiresAt > Date.now())
      .sort((a, b) => {
        if (a.priorityLock !== b.priorityLock) {
          return a.priorityLock ? -1 : 1;
        }
        return a.joinedAt - b.joinedAt;
      });
  }

  getQueuePosition(driverId: string): number | null {
    const index = this.getQueue().findIndex((entry) => entry.driverId === driverId);
    return index === -1 ? null : index + 1;
  }

  getFirstEligibleDriver(seats: number): QueueEntry | undefined {
    return this.getQueue().find(
      (entry) =>
        entry.status === "in_transit" &&
        entry.availableSeats >= seats &&
        Boolean(entry.currentOrderId),
    );
  }

  createOrder(input: Omit<Order, "id" | "createdAt" | "updatedAt">): Order {
    const now = new Date().toISOString();
    const order: Order = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    return order;
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  updateOrder(orderId: string, patch: Partial<Order>): Order | undefined {
    const order = this.orders.get(orderId);
    if (!order) {
      return undefined;
    }
    Object.assign(order, patch, { updatedAt: new Date().toISOString() });
    return order;
  }

  listOrdersForUser(userId: string): Order[] {
    return [...this.orders.values()]
      .filter((order) => order.passengerId === userId || order.driverId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listOrders(): Order[] {
    return [...this.orders.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  saveDeviceRegistration(
    userId: string,
    deviceToken: string,
    platform: DeviceRegistration["platform"],
  ): DeviceRegistration {
    const registration: DeviceRegistration = {
      userId,
      deviceToken,
      platform,
      createdAt: new Date().toISOString(),
    };
    this.deviceRegistrations.set(`${userId}:${deviceToken}`, registration);
    return registration;
  }

  getDeviceRegistrations(userId: string): DeviceRegistration[] {
    return [...this.deviceRegistrations.values()].filter(
      (registration) => registration.userId === userId,
    );
  }

  clearExpiredSeatLocks(): void {
    const now = Date.now();
    for (const order of this.orders.values()) {
      if (
        order.seatLockExpiresAt &&
        order.seatLockExpiresAt <= now &&
        order.status === "en_route_to_c"
      ) {
        const driverId = order.driverId;
        if (driverId) {
          const entry = this.queueEntries.get(driverId);
          if (entry) {
            Object.assign(entry, {
              status: "searching",
              priorityLock: false,
              currentOrderId: undefined,
              seatLockExpiresAt: undefined,
              availableSeats: entry.availableSeats + order.seats,
            });
          }
        }
        order.seatLockExpiresAt = undefined;
        order.driverId = undefined;
        order.offeredDriverId = undefined;
        order.status = "searching";
        order.updatedAt = new Date().toISOString();
      }
    }
    for (const entry of this.queueEntries.values()) {
      if (entry.seatLockExpiresAt && entry.seatLockExpiresAt <= now) {
        entry.seatLockExpiresAt = undefined;
      }
    }
  }

  queueSnapshot(): Array<QueueEntry & { position: number }> {
    return this.getQueue().map((entry, index) => ({
      ...entry,
      position: index + 1,
    }));
  }

  static isDriverQueueStatus(status: string): status is DriverQueueStatus {
    return [
      "searching",
      "picking_up",
      "en_route_to_c",
      "arrived_at_c",
      "in_transit",
    ].includes(status);
  }

  static isOrderStatus(status: string): status is OrderStatus {
    return [
      "searching",
      "en_route_to_c",
      "arrived_at_c",
      "in_transit",
      "completed",
      "cancelled",
    ].includes(status);
  }
}

export const store = new MemoryStore();
export { MemoryStore };