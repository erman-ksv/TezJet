export type UserRole = "passenger" | "driver";
export type Locale = "kk" | "uz" | "ru";
export type PickupPoint = "C" | "D";
export type OrderStatus =
  | "searching"
  | "en_route_to_c"
  | "arrived_at_c"
  | "in_transit"
  | "completed"
  | "cancelled";
export type DriverQueueStatus =
  | "searching"
  | "picking_up"
  | "en_route_to_c"
  | "arrived_at_c"
  | "in_transit";

export interface Coordinates {
  lat: number;
  lng: number;
  timestamp: number;
  isMocked?: boolean;
}

export interface NormalizedAddress {
  original: string;
  normalized: string;
  country: string | null;
  region: string | null;
  city: string | null;
  district: string | null;
  street: string | null;
  houseNumber: string | null;
  postalCode: string | null;
  landmarks: string[];
  latitude: number | null;
  longitude: number | null;
  confidence: "low" | "medium" | "high";
  notes: string[];
}

export interface RouteStop {
  code: string;
  name: string;
  priceKzt: number;
}

export interface FareQuote {
  currency: "KZT";
  stops: RouteStop[];
  totalKzt: number;
  calculatedAt: string;
}

export interface User {
  id: string;
  role: UserRole;
  fullName: string;
  phoneNumber: string;
  locale: Locale;
  profileLocked: boolean;
  sessionVersion: number;
  lastLocation?: Coordinates;
  createdAt: string;
}

export interface OtpChallenge {
  phoneNumber: string;
  code: string;
  role: UserRole;
  locale: Locale;
  fullName?: string;
  expiresAt: number;
}

export interface QueueEntry {
  driverId: string;
  joinedAt: number;
  status: DriverQueueStatus;
  availableSeats: number;
  lastLocation: Coordinates;
  priorityLock: boolean;
  currentOrderId?: string;
  seatLockExpiresAt?: number;
}

export interface Order {
  id: string;
  passengerId: string;
  passengerPhone: string;
  driverId?: string;
  offeredDriverId?: string;
  pickupPoint: PickupPoint;
  pickupLocation: Coordinates;
  pickupAddress?: NormalizedAddress;
  routeStops: RouteStop[];
  fare: FareQuote;
  destination: string;
  seats: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  seatLockExpiresAt?: number;
  cancelledBy?: string;
}

export interface DeviceRegistration {
  userId: string;
  deviceToken: string;
  platform: "android" | "ios" | "web";
  createdAt: string;
}