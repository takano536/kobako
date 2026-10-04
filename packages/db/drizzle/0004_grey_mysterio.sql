CREATE TYPE "public"."account_kind" AS ENUM('cash', 'bank', 'credit_card', 'electronic_money', 'other');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."card_payment_month_offset" AS ENUM('same_month', 'next_month', 'two_months_later');--> statement-breakpoint
CREATE TABLE "account_card_conditions" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" integer NOT NULL,
	"effective_from" date,
	"closing_day" varchar(5),
	"payment_day" varchar(5),
	"payment_month_offset" "card_payment_month_offset",
	"debit_account_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_card_conditions_closing_day_check" CHECK ("account_card_conditions"."closing_day" is null or "account_card_conditions"."closing_day" ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$'),
	CONSTRAINT "account_card_conditions_payment_day_check" CHECK ("account_card_conditions"."payment_day" is null or "account_card_conditions"."payment_day" ~ '^(?:[1-9]|[12][0-9]|3[01]|last)$')
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"default_kind" "account_kind",
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_household_name_unique" UNIQUE("household_id","name"),
	CONSTRAINT "account_groups_id_household_unique" UNIQUE("id","household_id"),
	CONSTRAINT "account_groups_sort_order_check" CHECK ("account_groups"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account_import_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"source" varchar(80) NOT NULL,
	"source_account_id" varchar(255),
	"source_account_name" varchar(120) NOT NULL,
	"account_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_import_mappings_identity_check" CHECK ("account_import_mappings"."source_account_id" is not null or length(btrim("account_import_mappings"."source_account_name")) > 0),
	CONSTRAINT "account_import_mappings_source_id_check" CHECK ("account_import_mappings"."source_account_id" is null or length(btrim("account_import_mappings"."source_account_id")) > 0)
);
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_household_name_unique";--> statement-breakpoint
INSERT INTO "account_import_mappings"
  ("household_id", "source", "source_account_id", "source_account_name", "account_id")
SELECT "household_id", 'realbyte-money-manager', NULL, "name", "id"
FROM "accounts"
WHERE "name" ~ '[^[:space:]]'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "accounts"
SET "name" = '口座（移行）' || "id"::text
WHERE "name" !~ '[^[:space:]]';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "kind" "account_kind" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "group_id" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "status" "account_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT INTO "account_groups" ("household_id", "name", "default_kind", "sort_order")
SELECT h."id", seed."name", seed."default_kind", seed."sort_order"
FROM "households" h
CROSS JOIN (VALUES
  ('現金', 'cash'::"account_kind", 10),
  ('銀行', 'bank'::"account_kind", 20),
  ('クレジットカード', 'credit_card'::"account_kind", 30),
  ('電子マネー', 'electronic_money'::"account_kind", 40),
  ('その他', 'other'::"account_kind", 50)
) AS seed("name", "default_kind", "sort_order")
ON CONFLICT ("household_id", "name") DO UPDATE
SET "default_kind" = EXCLUDED."default_kind";--> statement-breakpoint
WITH ranked AS (
  SELECT
    a."id",
    g."id" AS "group_id",
    row_number() OVER (PARTITION BY a."household_id" ORDER BY a."id") * 10 AS "sort_order"
  FROM "accounts" a
  INNER JOIN "account_groups" g
    ON g."household_id" = a."household_id" AND g."name" = 'その他'
)
UPDATE "accounts" a
SET "group_id" = ranked."group_id", "sort_order" = ranked."sort_order"
FROM ranked
WHERE a."id" = ranked."id";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "account_card_conditions" ADD CONSTRAINT "account_card_conditions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_card_conditions" ADD CONSTRAINT "account_card_conditions_account_household_fk" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_card_conditions" ADD CONSTRAINT "account_card_conditions_debit_account_household_fk" FOREIGN KEY ("debit_account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_import_mappings" ADD CONSTRAINT "account_import_mappings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_import_mappings" ADD CONSTRAINT "account_import_mappings_account_household_fk" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_card_conditions_account_effective_from_unique" ON "account_card_conditions" USING btree ("account_id","effective_from") WHERE "account_card_conditions"."effective_from" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "account_card_conditions_account_unset_unique" ON "account_card_conditions" USING btree ("account_id") WHERE "account_card_conditions"."effective_from" is null;--> statement-breakpoint
CREATE INDEX "account_card_conditions_household_account_effective_idx" ON "account_card_conditions" USING btree ("household_id","account_id","effective_from");--> statement-breakpoint
CREATE INDEX "account_groups_household_sort_order_idx" ON "account_groups" USING btree ("household_id","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_household_default_kind_unique" ON "account_groups" USING btree ("household_id","default_kind") WHERE "account_groups"."default_kind" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "account_import_mappings_source_id_unique" ON "account_import_mappings" USING btree ("household_id","source","source_account_id") WHERE "account_import_mappings"."source_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "account_import_mappings_source_name_unique" ON "account_import_mappings" USING btree ("household_id","source","source_account_name") WHERE "account_import_mappings"."source_account_id" is null;--> statement-breakpoint
CREATE INDEX "account_import_mappings_household_source_name_idx" ON "account_import_mappings" USING btree ("household_id","source","source_account_name");--> statement-breakpoint
CREATE INDEX "account_import_mappings_household_account_idx" ON "account_import_mappings" USING btree ("household_id","account_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_group_household_fk" FOREIGN KEY ("group_id","household_id") REFERENCES "public"."account_groups"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_household_name_idx" ON "accounts" USING btree ("household_id","name");--> statement-breakpoint
CREATE INDEX "accounts_household_group_sort_order_idx" ON "accounts" USING btree ("household_id","group_id","sort_order","id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_sort_order_check" CHECK ("accounts"."sort_order" >= 0);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_name_not_blank_check" CHECK (length(regexp_replace("accounts"."name", '[[:space:]]', '', 'g')) > 0);