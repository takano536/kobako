CREATE TABLE "asset_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"system_key" varchar(80),
	"name" varchar(120) NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_categories_household_name_unique" UNIQUE("household_id","name"),
	CONSTRAINT "asset_categories_id_household_unique" UNIQUE("id","household_id"),
	CONSTRAINT "asset_categories_sort_order_check" CHECK ("asset_categories"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_household_system_key_unique" ON "asset_categories" USING btree ("household_id","system_key") WHERE "asset_categories"."system_key" is not null;
--> statement-breakpoint
CREATE INDEX "asset_categories_household_sort_order_idx" ON "asset_categories" USING btree ("household_id","sort_order","id");
--> statement-breakpoint
INSERT INTO "asset_categories" ("household_id", "system_key", "name", "sort_order")
SELECT h.id, defaults.system_key, defaults.name, defaults.sort_order
FROM "households" h
CROSS JOIN (VALUES
  ('cash', '現金', 10),
  ('bank', '銀行', 20),
  ('credit_card', 'クレジットカード', 30),
  ('debit_card', 'デビットカード', 40),
  ('electronic_money', '電子マネー', 50),
  ('other', 'その他', 60)
) AS defaults(system_key, name, sort_order)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "asset_category_id" integer;
--> statement-breakpoint
UPDATE "accounts" a
SET "asset_category_id" = c.id
FROM "asset_categories" c
WHERE c."household_id" = a."household_id"
  AND c."system_key" = a."kind"::text;
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "asset_category_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_asset_category_household_fk" FOREIGN KEY ("asset_category_id","household_id") REFERENCES "public"."asset_categories"("id","household_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "accounts_household_asset_category_sort_order_idx" ON "accounts" USING btree ("household_id","asset_category_id","sort_order","id");
