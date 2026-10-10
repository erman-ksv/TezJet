-- Market-neutral route pricing. Existing values are preserved numerically and remain tagged KZT
-- until the operator explicitly sets the approved market currency and tariff.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tezjet_routes' AND column_name = 'price_per_stop_kzt'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tezjet_routes' AND column_name = 'price_per_stop'
  ) THEN
    ALTER TABLE "tezjet_routes" RENAME COLUMN "price_per_stop_kzt" TO "price_per_stop";
  END IF;
END $$;

ALTER TABLE "tezjet_routes"
  ADD COLUMN IF NOT EXISTS "currency" text NOT NULL DEFAULT 'KZT';
