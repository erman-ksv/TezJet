import type { Order, User } from "../types/domain";
import { maskPhone } from "./phone";

export function serializeUser(user: User) {
  return {
    id: user.id,
    role: user.role,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    locale: user.locale,
    profile_locked: user.profileLocked,
    created_at: user.createdAt,
  };
}

export function serializeOrder(order: Order, maskPassenger = false) {
  return {
    id: order.id,
    passenger_id: order.passengerId,
    passenger_phone: maskPassenger
      ? maskPhone(order.passengerPhone)
      : order.passengerPhone,
    driver_id: order.driverId,
    offered_driver_id: order.offeredDriverId,
    pickup_point: order.pickupPoint,
    pickup_location: order.pickupLocation,
    destination: order.destination,
    seats: order.seats,
    status: order.status,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    seat_lock_expires_at: order.seatLockExpiresAt,
  };
}