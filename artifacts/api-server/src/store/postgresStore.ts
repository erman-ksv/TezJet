import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Store } from "./storeContract";
import type {
  Coordinates,
  DeviceRegistration,
  DriverApprovalStatus,
  Locale,
  Order,
  OtpChallenge,
  QueueEntry,
  RouteDefinition,
  RouteStop,
  User,
  UserRole,
} from "../types/domain";
import { REQUIRE_DRIVER_APPROVAL } from "../utils/config";

type DbModule = typeof import("@workspace/db");

function asUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    role: row.role as UserRole,
    fullName: String(row.fullName),
    phoneNumber: String(row.phoneNumber),
    locale: row.locale as Locale,
    profileLocked: Boolean(row.profileLocked),
    sessionVersion: Number(row.sessionVersion),
    driverApprovalStatus: row.driverApprovalStatus as DriverApprovalStatus | undefined,
    lastLocation: (row.lastLocation ?? undefined) as Coordinates | undefined,
    createdAt: String(row.createdAt),
  };
}

function asQueueEntry(row: Record<string, unknown>): QueueEntry {
  return {
    driverId: String(row.driverId),
    joinedAt: Number(row.joinedAt),
    status: row.status as QueueEntry["status"],
    availableSeats: Number(row.availableSeats),
    lastLocation: row.lastLocation as Coordinates,
    priorityLock: Boolean(row.priorityLock),
    inFifo: row.inFifo === undefined ? true : Boolean(row.inFifo),
    activeOrderIds: (row.activeOrderIds ?? []) as string[],
    currentOrderId: (row.currentOrderId ?? undefined) as string | undefined,
    seatLockExpiresAt: (row.seatLockExpiresAt ?? undefined) as number | undefined,
  };
}

function asOrder(row: Record<string, unknown>): Order {
  return {
    ...(row.payload as Order),
    id: String(row.id),
    passengerId: String(row.passengerId),
    driverId: (row.driverId ?? undefined) as string | undefined,
    offeredDriverId: (row.offeredDriverId ?? undefined) as string | undefined,
    status: row.status as Order["status"],
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function asRoute(row: Record<string, unknown>): RouteDefinition {
  return row.payload as RouteDefinition;
}

const defaultRoute: RouteDefinition = {
  id: "pyatak",
  name: "Pyatak",
  currency: "KZT",
  pricePerStopKzt: 500,
  active: true,
  stops: [
    { id: "pyatak-stop-c", code: "C", name: "Point C", sequence: 1, position: 1 },
    { id: "pyatak-stop-d", code: "D", name: "Point D", sequence: 2, position: 2 },
  ],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

/**
 * PostgreSQL-backed implementation of the Store contract.
 *
 * DATABASE_URL is required. Importing the DB package is delayed until the
 * first operation so test environments can explicitly use MemoryStore.
 */
export class PostgresStore implements Store {
  private modulePromise?: Promise<DbModule>;

  private async database(): Promise<DbModule> {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required to use PostgresStore");
    }
    if (!this.modulePromise) {
      this.modulePromise = (async () => {
        const mod = await import("@workspace/db");
        const now = new Date().toISOString();
        const seededRoute = { ...defaultRoute, createdAt: now, updatedAt: now };
        await mod.db
          .insert(mod.routesTable)
          .values({
            id: seededRoute.id,
            name: seededRoute.name,
            active: seededRoute.active,
            pricePerStopKzt: seededRoute.pricePerStopKzt,
            createdAt: seededRoute.createdAt,
            updatedAt: seededRoute.updatedAt,
            payload: seededRoute as unknown as Record<string, unknown>,
          })
          .onConflictDoNothing();
        return mod;
      })();
    }
    return this.modulePromise;
  }

  async createUser(input: {
    role: UserRole;
    fullName: string;
    phoneNumber: string;
    locale: Locale;
  }): Promise<User> {
    const { db, usersTable } = await this.database();
    const user: User = {
      id: randomUUID(),
      role: input.role,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      locale: input.locale,
      profileLocked: true,
      sessionVersion: 0,
      driverApprovalStatus:
        input.role === "driver" && REQUIRE_DRIVER_APPROVAL
          ? "pending"
          : input.role === "driver"
            ? "approved"
            : undefined,
      createdAt: new Date().toISOString(),
    };
    const [row] = await db.insert(usersTable).values({
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      locale: user.locale,
      profileLocked: user.profileLocked,
      sessionVersion: user.sessionVersion,
      driverApprovalStatus: user.driverApprovalStatus ?? null,
      lastLocation: user.lastLocation ?? null,
      createdAt: user.createdAt,
    }).returning();
    return asUser(row as unknown as Record<string, unknown>);
  }

  async getUser(userId: string): Promise<User | undefined> {
    const { db, usersTable } = await this.database();
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return row ? asUser(row as unknown as Record<string, unknown>) : undefined;
  }

  async getUserByPhone(phoneNumber: string): Promise<User | undefined> {
    const { db, usersTable } = await this.database();
    const [row] = await db.select().from(usersTable).where(eq(usersTable.phoneNumber, phoneNumber)).limit(1);
    return row ? asUser(row as unknown as Record<string, unknown>) : undefined;
  }

  async updateUser(
    userId: string,
    patch: Partial<Pick<User, "locale" | "lastLocation">>,
  ): Promise<User> {
    const { db, usersTable } = await this.database();
    const values: { locale?: Locale; lastLocation?: Record<string, unknown> | null } = {};
    if (patch.locale !== undefined) values.locale = patch.locale;
    if (patch.lastLocation !== undefined) values.lastLocation = patch.lastLocation as unknown as Record<string, unknown>;
    const [row] = await db.update(usersTable).set(values).where(eq(usersTable.id, userId)).returning();
    if (!row) throw new Error(`User ${userId} not found`);
    return asUser(row as unknown as Record<string, unknown>);
  }

  async invalidateSessions(userId: string): Promise<User> {
    const { db, usersTable } = await this.database();
    const [row] = await db.update(usersTable)
      .set({ sessionVersion: sql`${usersTable.sessionVersion} + 1` })
      .where(eq(usersTable.id, userId))
      .returning();
    if (!row) throw new Error(`User ${userId} not found`);
    return asUser(row as unknown as Record<string, unknown>);
  }

  async saveOtp(challenge: OtpChallenge): Promise<void> {
    const { db, otpChallengesTable } = await this.database();
    await db.insert(otpChallengesTable).values({
      phoneNumber: challenge.phoneNumber,
      code: challenge.code,
      role: challenge.role,
      locale: challenge.locale,
      fullName: challenge.fullName ?? null,
      expiresAt: challenge.expiresAt,
    }).onConflictDoUpdate({
      target: otpChallengesTable.phoneNumber,
      set: {
        code: challenge.code,
        role: challenge.role,
        locale: challenge.locale,
        fullName: challenge.fullName ?? null,
        expiresAt: challenge.expiresAt,
      },
    });
  }

  async consumeOtp(phoneNumber: string, code: string): Promise<OtpChallenge | undefined> {
    const { db, otpChallengesTable } = await this.database();
    const [row] = await db.delete(otpChallengesTable).where(and(
      eq(otpChallengesTable.phoneNumber, phoneNumber),
      eq(otpChallengesTable.code, code),
      gt(otpChallengesTable.expiresAt, Date.now()),
    )).returning();
    return row ? {
      phoneNumber: row.phoneNumber,
      code: row.code,
      role: row.role as UserRole,
      locale: row.locale as Locale,
      fullName: row.fullName ?? undefined,
      expiresAt: Number(row.expiresAt),
    } : undefined;
  }

  async getQueueEntry(driverId: string): Promise<QueueEntry | undefined> {
    const { db, driverQueueTable } = await this.database();
    const [row] = await db.select().from(driverQueueTable).where(eq(driverQueueTable.driverId, driverId)).limit(1);
    return row ? asQueueEntry(row as unknown as Record<string, unknown>) : undefined;
  }

  async removeDriverFromFifo(driverId: string): Promise<QueueEntry | undefined> {
    return this.updateQueueEntry(driverId, { inFifo: false });
  }

  async returnDriverToFifo(driverId: string): Promise<QueueEntry | undefined> {
    return this.updateQueueEntry(driverId, { inFifo: true });
  }

  async joinQueue(entry: QueueEntry): Promise<QueueEntry> {
    const { db, driverQueueTable } = await this.database();
    const [row] = await db.insert(driverQueueTable).values({
      driverId: entry.driverId,
      joinedAt: entry.joinedAt,
      status: entry.status,
      availableSeats: entry.availableSeats,
      lastLocation: entry.lastLocation as unknown as Record<string, unknown>,
      priorityLock: entry.priorityLock,
      inFifo: entry.inFifo !== false,
      activeOrderIds: entry.activeOrderIds ?? [],
      currentOrderId: entry.currentOrderId ?? null,
      seatLockExpiresAt: entry.seatLockExpiresAt ?? null,
    }).onConflictDoUpdate({
      target: driverQueueTable.driverId,
      set: {
        joinedAt: entry.joinedAt,
        status: entry.status,
        availableSeats: entry.availableSeats,
        lastLocation: entry.lastLocation as unknown as Record<string, unknown>,
        priorityLock: entry.priorityLock,
        inFifo: entry.inFifo !== false,
        activeOrderIds: entry.activeOrderIds ?? [],
        currentOrderId: entry.currentOrderId ?? null,
        seatLockExpiresAt: entry.seatLockExpiresAt ?? null,
      },
    }).returning();
    return asQueueEntry(row as unknown as Record<string, unknown>);
  }

  async updateQueueEntry(driverId: string, patch: Partial<QueueEntry>): Promise<QueueEntry | undefined> {
    const { db, driverQueueTable } = await this.database();
    const values: {
      joinedAt?: number;
      status?: QueueEntry["status"];
      availableSeats?: number;
      lastLocation?: Record<string, unknown>;
      priorityLock?: boolean;
      inFifo?: boolean;
      activeOrderIds?: string[];
      currentOrderId?: string | null;
      seatLockExpiresAt?: number | null;
    } = {};
    if (patch.joinedAt !== undefined) values.joinedAt = patch.joinedAt;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.availableSeats !== undefined) values.availableSeats = patch.availableSeats;
    if (patch.lastLocation !== undefined) values.lastLocation = patch.lastLocation as unknown as Record<string, unknown>;
    if (patch.priorityLock !== undefined) values.priorityLock = patch.priorityLock;
    if (patch.inFifo !== undefined) values.inFifo = patch.inFifo;
    if (patch.activeOrderIds !== undefined) values.activeOrderIds = patch.activeOrderIds;
    if ("currentOrderId" in patch) values.currentOrderId = patch.currentOrderId ?? null;
    if ("seatLockExpiresAt" in patch) values.seatLockExpiresAt = patch.seatLockExpiresAt ?? null;
    const [row] = await db.update(driverQueueTable).set(values)
      .where(eq(driverQueueTable.driverId, driverId)).returning();
    return row ? asQueueEntry(row as unknown as Record<string, unknown>) : undefined;
  }

  async leaveQueue(driverId: string): Promise<void> {
    const { db, driverQueueTable } = await this.database();
    await db.delete(driverQueueTable).where(eq(driverQueueTable.driverId, driverId));
  }

  async getQueue(): Promise<QueueEntry[]> {
    const { db, driverQueueTable } = await this.database();
    const rows = await db.select().from(driverQueueTable).where(and(
      eq(driverQueueTable.inFifo, true),
      or(isNull(driverQueueTable.seatLockExpiresAt), gt(driverQueueTable.seatLockExpiresAt, Date.now())),
    )).orderBy(desc(driverQueueTable.priorityLock), asc(driverQueueTable.joinedAt));
    return rows.map((row) => asQueueEntry(row as unknown as Record<string, unknown>));
  }

  async getQueuePosition(driverId: string): Promise<number | null> {
    const queue = await this.getQueue();
    const index = queue.findIndex((entry) => entry.driverId === driverId);
    return index < 0 ? null : index + 1;
  }

  async getFirstEligibleDriver(seats: number): Promise<QueueEntry | undefined> {
    const { db, driverQueueTable } = await this.database();
    const rows = await db.select().from(driverQueueTable).where(eq(driverQueueTable.status, "in_transit"));
    const entry = rows.map((row) => asQueueEntry(row as unknown as Record<string, unknown>)).find((candidate) =>
      candidate.availableSeats >= seats &&
      Boolean(candidate.currentOrderId || (candidate.activeOrderIds && candidate.activeOrderIds.length > 0)),
    );
    return entry;
  }

  async createOrder(input: Omit<Order, "id" | "createdAt" | "updatedAt">): Promise<Order> {
    const { db, ordersTable } = await this.database();
    const now = new Date().toISOString();
    const order: Order = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    const [row] = await db.insert(ordersTable).values({
      id: order.id,
      passengerId: order.passengerId,
      driverId: order.driverId ?? null,
      offeredDriverId: order.offeredDriverId ?? null,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      payload: order as unknown as Record<string, unknown>,
    }).returning();
    return asOrder(row as unknown as Record<string, unknown>);
  }

  async getOrder(orderId: string): Promise<Order | undefined> {
    const { db, ordersTable } = await this.database();
    const [row] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    return row ? asOrder(row as unknown as Record<string, unknown>) : undefined;
  }

  async updateOrder(orderId: string, patch: Partial<Order>): Promise<Order | undefined> {
    const { db, ordersTable } = await this.database();
    const current = await this.getOrder(orderId);
    if (!current) return undefined;
    const updated: Order = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const [row] = await db.update(ordersTable).set({
      driverId: updated.driverId ?? null,
      offeredDriverId: updated.offeredDriverId ?? null,
      status: updated.status,
      updatedAt: updated.updatedAt,
      payload: updated as unknown as Record<string, unknown>,
    }).where(eq(ordersTable.id, orderId)).returning();
    return row ? asOrder(row as unknown as Record<string, unknown>) : undefined;
  }

  async listOrdersForUser(userId: string): Promise<Order[]> {
    const { db, ordersTable } = await this.database();
    const rows = await db.select().from(ordersTable).where(or(
      eq(ordersTable.passengerId, userId),
      eq(ordersTable.driverId, userId),
    )).orderBy(desc(ordersTable.createdAt));
    return rows.map((row) => asOrder(row as unknown as Record<string, unknown>));
  }

  async listOrders(): Promise<Order[]> {
    const { db, ordersTable } = await this.database();
    const rows = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
    return rows.map((row) => asOrder(row as unknown as Record<string, unknown>));
  }

  async listUsers(role?: User["role"]): Promise<User[]> {
    const { db, usersTable } = await this.database();
    const rows = role
      ? await db.select().from(usersTable).where(eq(usersTable.role, role))
      : await db.select().from(usersTable);
    return rows.map((row) => asUser(row as unknown as Record<string, unknown>));
  }

  async setDriverApproval(userId: string, status: DriverApprovalStatus): Promise<User | undefined> {
    const { db, usersTable } = await this.database();
    const [row] = await db.update(usersTable).set({ driverApprovalStatus: status })
      .where(and(eq(usersTable.id, userId), eq(usersTable.role, "driver"))).returning();
    return row ? asUser(row as unknown as Record<string, unknown>) : undefined;
  }

  async listRoutes(): Promise<RouteDefinition[]> {
    const { db, routesTable } = await this.database();
    const rows = await db.select().from(routesTable).orderBy(asc(routesTable.name));
    return rows.map((row) => asRoute(row as unknown as Record<string, unknown>));
  }

  async getRoute(routeId: string): Promise<RouteDefinition | undefined> {
    const { db, routesTable } = await this.database();
    const [row] = await db.select().from(routesTable).where(eq(routesTable.id, routeId)).limit(1);
    return row ? asRoute(row as unknown as Record<string, unknown>) : undefined;
  }

  async createRoute(input: { id: string; name: string; pricePerStopKzt: number; active: boolean }): Promise<RouteDefinition> {
    const { db, routesTable } = await this.database();
    const now = new Date().toISOString();
    const route: RouteDefinition = {
      ...input,
      currency: "KZT",
      stops: [],
      createdAt: now,
      updatedAt: now,
    };
    const [row] = await db.insert(routesTable).values({
      id: route.id,
      name: route.name,
      active: route.active,
      pricePerStopKzt: route.pricePerStopKzt,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt,
      payload: route as unknown as Record<string, unknown>,
    }).onConflictDoNothing().returning();
    if (!row) throw new Error(`Route ${route.id} already exists`);
    return asRoute(row as unknown as Record<string, unknown>);
  }

  async updateRoute(routeId: string, patch: Partial<Pick<RouteDefinition, "name" | "pricePerStopKzt" | "active">>): Promise<RouteDefinition | undefined> {
    const { db, routesTable } = await this.database();
    const current = await this.getRoute(routeId);
    if (!current) return undefined;
    const route: RouteDefinition = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const [row] = await db.update(routesTable).set({
      name: route.name,
      active: route.active,
      pricePerStopKzt: route.pricePerStopKzt,
      updatedAt: route.updatedAt,
      payload: route as unknown as Record<string, unknown>,
    }).where(eq(routesTable.id, routeId)).returning();
    return row ? asRoute(row as unknown as Record<string, unknown>) : undefined;
  }

  async deleteRoute(routeId: string): Promise<boolean> {
    const { db, routesTable } = await this.database();
    const rows = await db.delete(routesTable).where(eq(routesTable.id, routeId)).returning({ id: routesTable.id });
    return rows.length > 0;
  }

  async addRouteStop(routeId: string, input: { code: string; name: string; sequence?: number; position?: number }): Promise<RouteStop | undefined> {
    const route = await this.getRoute(routeId);
    if (!route) return undefined;
    const sequence = input.sequence ?? route.stops.length + 1;
    const stop: RouteStop = {
      id: randomUUID(),
      code: input.code,
      name: input.name,
      sequence,
      position: input.position ?? sequence,
    };
    const stops = [...route.stops, stop].sort((a, b) => a.sequence - b.sequence);
    await this.updateRoutePayload(routeId, { ...route, stops, updatedAt: new Date().toISOString() });
    return stop;
  }

  async updateRouteStop(routeId: string, stopId: string, patch: Partial<Pick<RouteStop, "code" | "name" | "sequence" | "position">>): Promise<RouteStop | undefined> {
    const route = await this.getRoute(routeId);
    const stop = route?.stops.find((candidate) => candidate.id === stopId);
    if (!route || !stop) return undefined;
    const updatedStop = { ...stop, ...patch };
    const stops = route.stops.map((candidate) => candidate.id === stopId ? updatedStop : candidate)
      .sort((a, b) => a.sequence - b.sequence);
    await this.updateRoutePayload(routeId, { ...route, stops, updatedAt: new Date().toISOString() });
    return updatedStop;
  }

  async deleteRouteStop(routeId: string, stopId: string): Promise<boolean> {
    const route = await this.getRoute(routeId);
    if (!route) return false;
    const stops = route.stops.filter((stop) => stop.id !== stopId);
    if (stops.length === route.stops.length) return false;
    await this.updateRoutePayload(routeId, { ...route, stops, updatedAt: new Date().toISOString() });
    return true;
  }

  private async updateRoutePayload(routeId: string, route: RouteDefinition): Promise<void> {
    const { db, routesTable } = await this.database();
    await db.update(routesTable).set({
      name: route.name,
      active: route.active,
      pricePerStopKzt: route.pricePerStopKzt,
      updatedAt: route.updatedAt,
      payload: route as unknown as Record<string, unknown>,
    }).where(eq(routesTable.id, routeId));
  }

  async saveDeviceRegistration(userId: string, deviceToken: string, platform: DeviceRegistration["platform"]): Promise<DeviceRegistration> {
    const { db, deviceRegistrationsTable } = await this.database();
    const registration: DeviceRegistration = { userId, deviceToken, platform, createdAt: new Date().toISOString() };
    const [row] = await db.insert(deviceRegistrationsTable).values(registration)
      .onConflictDoUpdate({
        target: [deviceRegistrationsTable.userId, deviceRegistrationsTable.deviceToken],
        set: { platform, createdAt: registration.createdAt },
      }).returning();
    return row as DeviceRegistration;
  }

  async getDeviceRegistrations(userId: string): Promise<DeviceRegistration[]> {
    const { db, deviceRegistrationsTable } = await this.database();
    return await db.select().from(deviceRegistrationsTable).where(eq(deviceRegistrationsTable.userId, userId)) as DeviceRegistration[];
  }

  async clearExpiredSeatLocks(): Promise<void> {
    const { db, ordersTable, driverQueueTable } = await this.database();
    const now = Date.now();
    const rows = await db.select().from(ordersTable).where(eq(ordersTable.status, "en_route_to_c"));
    for (const row of rows) {
      const order = asOrder(row as unknown as Record<string, unknown>);
      if (!order.seatLockExpiresAt || order.seatLockExpiresAt > now) continue;
      if (order.driverId) {
        const [queueRow] = await db.select().from(driverQueueTable)
          .where(eq(driverQueueTable.driverId, order.driverId)).limit(1);
        if (queueRow) {
          const entry = asQueueEntry(queueRow as unknown as Record<string, unknown>);
          const activeOrderIds = (entry.activeOrderIds ?? (entry.currentOrderId ? [entry.currentOrderId] : []))
            .filter((id) => id !== order.id);
          await this.updateQueueEntry(order.driverId, activeOrderIds.length > 0 ? {
            status: "in_transit",
            priorityLock: true,
            inFifo: false,
            activeOrderIds,
            currentOrderId: activeOrderIds[0],
            seatLockExpiresAt: undefined,
            availableSeats: entry.availableSeats + order.seats,
          } : {
            status: "searching",
            priorityLock: false,
            inFifo: true,
            activeOrderIds: [],
            currentOrderId: undefined,
            seatLockExpiresAt: undefined,
            availableSeats: entry.availableSeats + order.seats,
          });
        }
      }
      await this.updateOrder(order.id, {
        seatLockExpiresAt: undefined,
        driverId: undefined,
        offeredDriverId: undefined,
        status: "searching",
      });
    }
    await db.update(driverQueueTable).set({ seatLockExpiresAt: null })
      .where(lte(driverQueueTable.seatLockExpiresAt, now));
  }

  async queueSnapshot(): Promise<Array<QueueEntry & { position: number }>> {
    return (await this.getQueue()).map((entry, index) => ({ ...entry, position: index + 1 }));
  }
}
