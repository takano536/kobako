CREATE TABLE IF NOT EXISTS "account_card_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" integer NOT NULL,
	"closing_day" varchar(5),
	"payment_day" varchar(5),
	"payment_month_offset" "card_payment_month_offset",
	"debit_account_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_card_settings_account_unique" UNIQUE("account_id","household_id"),
	CONSTRAINT "account_card_settings_closing_day_check" CHECK ("account_card_settings"."closing_day" is null or "account_card_settings"."closing_day" ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$'),
	CONSTRAINT "account_card_settings_payment_day_check" CHECK ("account_card_settings"."payment_day" is null or "account_card_settings"."payment_day" ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$')
);--> statement-breakpoint
ALTER TABLE "transaction_imports" DROP CONSTRAINT IF EXISTS "transaction_imports_household_source_sha256_unique";--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD COLUMN IF NOT EXISTS "operation_key" varchar(120);--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "group_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "accounts_household_group_sort_order_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_household_kind_sort_order_idx" ON "accounts" USING btree ("household_id","kind","sort_order","id");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_card_settings_household_id_households_id_fk'
      AND conrelid = 'account_card_settings'::regclass
  ) THEN
    ALTER TABLE "account_card_settings"
      ADD CONSTRAINT "account_card_settings_household_id_households_id_fk"
      FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_card_settings_account_household_fk'
      AND conrelid = 'account_card_settings'::regclass
  ) THEN
    ALTER TABLE "account_card_settings"
      ADD CONSTRAINT "account_card_settings_account_household_fk"
      FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_card_settings_debit_account_household_fk'
      AND conrelid = 'account_card_settings'::regclass
  ) THEN
    ALTER TABLE "account_card_settings"
      ADD CONSTRAINT "account_card_settings_debit_account_household_fk"
      FOREIGN KEY ("debit_account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
WITH eligible AS (
  SELECT DISTINCT ON (c."household_id", c."account_id")
    c."household_id",
    c."account_id",
    c."closing_day",
    c."payment_day",
    c."payment_month_offset",
    c."debit_account_id"
  FROM "account_card_conditions" c
  WHERE c."effective_from" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date
     OR c."effective_from" IS NULL
  ORDER BY
    c."household_id",
    c."account_id",
    CASE WHEN c."effective_from" IS NULL THEN 1 ELSE 0 END,
    c."effective_from" DESC NULLS LAST,
    c."id" DESC
)
INSERT INTO "account_card_settings" (
  "household_id", "account_id", "closing_day", "payment_day",
  "payment_month_offset", "debit_account_id"
)
SELECT "household_id", "account_id", "closing_day", "payment_day",
       "payment_month_offset", "debit_account_id"
FROM eligible
ON CONFLICT ("account_id", "household_id") DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_imports_household_source_operation_unique" ON "transaction_imports" USING btree ("household_id","source","operation_key") WHERE "transaction_imports"."operation_key" is not null;