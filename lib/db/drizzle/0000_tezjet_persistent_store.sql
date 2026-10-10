CREATE TABLE IF NOT EXISTS "tezjet_users" (
  "id" text PRIMARY KEY NOT NULL,
  "role" text NOT NULL,
  "full_name" text NOT NULL,
  "phone_number" text NOT NULL,
  "locale" text NOT NULL,
  "profile_locked" boolean DEFAULT true NOT NULL,
  "session_version" integer DEFAULT 0 NOT NULL,
  "driver_approval_status" text,
  "last_location" jsonb,
  "created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tezjet_users_phone_number_uq" ON "tezjet_users" USING btree ("phone_number");
CREATE INDEX IF NOT EXISTS "tezjet_users_role_idx" ON "tezjet_users" USING btree ("role");

CREATE TABLE IF NOT EXISTS "tezjet_otp_challenges" (
  "phone_number" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "role" text NOT NULL,
  "locale" text NOT NULL,
  "full_name" text,
  "expires_at" bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS "tezjet_driver_queue" (
  "driver_id" text PRIMARY KEY NOT NULL,
  "joined_at" bigint NOT NULL,
  "status" text NOT NULL,
  "available_seats" integer NOT NULL,
  "last_location" jsonb NOT NULL,
  "priority_lock" boolean DEFAULT false NOT NULL,
  "in_fifo" boolean DEFAULT true NOT NULL,
  "active_order_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "current_order_id" text,
  "seat_lock_expires_at" bigint
);
CREATE INDEX IF NOT EXISTS "tezjet_driver_queue_fifo_idx" ON "tezjet_driver_queue" USING btree ("in_fifo", "priority_lock", "joined_at");
CREATE INDEX IF NOT EXISTS "tezjet_driver_queue_status_idx" ON "tezjet_driver_queue" USING btree ("status");

CREATE TABLE IF NOT EXISTS "tezjet_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "passenger_id" text NOT NULL,
  "driver_id" text,
  "offered_driver_id" text,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "payload" jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS "tezjet_orders_passenger_created_idx" ON "tezjet_orders" USING btree ("passenger_id", "created_at");
CREATE INDEX IF NOT EXISTS "tezjet_orders_driver_created_idx" ON "tezjet_orders" USING btree ("driver_id", "created_at");
CREATE INDEX IF NOT EXISTS "tezjet_orders_status_created_idx" ON "tezjet_orders" USING btree ("status", "created_at");

CREATE TABLE IF NOT EXISTS "tezjet_device_registrations" (
  "user_id" text NOT NULL,
  "device_token" text NOT NULL,
  "platform" text NOT NULL,
  "created_at" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tezjet_device_user_token_uq" ON "tezjet_device_registrations" USING btree ("user_id", "device_token");
CREATE INDEX IF NOT EXISTS "tezjet_device_token_idx" ON "tezjet_device_registrations" USING btree ("device_token");

CREATE TABLE IF NOT EXISTS "tezjet_routes" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "price_per_stop_kzt" integer NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "payload" jsonb NOT NULL
);
