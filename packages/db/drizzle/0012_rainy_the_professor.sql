DO $$
BEGIN
  CREATE TYPE "public"."fixed_cost_interval_unit" AS ENUM('month', 'year');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_cost_occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"fixed_cost_id" integer NOT NULL,
	"transaction_id" integer,
	"occurred_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_cost_occurrences_cost_date_unique" UNIQUE("fixed_cost_id","occurred_on"),
	CONSTRAINT "fixed_cost_occurrences_transaction_unique" UNIQUE("transaction_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"amount" integer NOT NULL,
	"category_id" integer NOT NULL,
	"category_type" "transaction_type" DEFAULT 'expense' NOT NULL,
	"account_id" integer NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"interval_unit" "fixed_cost_interval_unit" DEFAULT 'month' NOT NULL,
	"start_month" date NOT NULL,
	"day" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_costs_amount_positive_check" CHECK ("fixed_costs"."amount" > 0),
	CONSTRAINT "fixed_costs_interval_count_check" CHECK ("fixed_costs"."interval_count" > 0),
	CONSTRAINT "fixed_costs_day_check" CHECK ("fixed_costs"."day" between 1 and 31)
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_cost_occurrences_household_id_households_id_fk'
  ) THEN
    ALTER TABLE "fixed_cost_occurrences" ADD CONSTRAINT "fixed_cost_occurrences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_cost_occurrences_fixed_cost_id_fixed_costs_id_fk'
  ) THEN
    ALTER TABLE "fixed_cost_occurrences" ADD CONSTRAINT "fixed_cost_occurrences_fixed_cost_id_fixed_costs_id_fk" FOREIGN KEY ("fixed_cost_id") REFERENCES "public"."fixed_costs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_cost_occurrences_transaction_id_transactions_id_fk'
  ) THEN
    ALTER TABLE "fixed_cost_occurrences" ADD CONSTRAINT "fixed_cost_occurrences_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_costs_household_id_households_id_fk'
  ) THEN
    ALTER TABLE "fixed_costs" ADD CONSTRAINT "fixed_costs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_costs_category_household_type_fk'
  ) THEN
    ALTER TABLE "fixed_costs" ADD CONSTRAINT "fixed_costs_category_household_type_fk" FOREIGN KEY ("category_id","household_id","category_type") REFERENCES "public"."categories"("id","household_id","type") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fixed_costs_account_household_fk'
  ) THEN
    ALTER TABLE "fixed_costs" ADD CONSTRAINT "fixed_costs_account_household_fk" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_cost_occurrences_household_date_idx" ON "fixed_cost_occurrences" USING btree ("household_id","occurred_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_costs_household_idx" ON "fixed_costs" USING btree ("household_id");