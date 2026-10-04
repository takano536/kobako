ALTER TYPE "public"."account_kind" ADD VALUE IF NOT EXISTS 'debit_card';--> statement-breakpoint
INSERT INTO "account_groups" ("household_id", "name", "default_kind", "sort_order")
SELECT h."id", 'デビットカード', NULL, 40
FROM "households" h
ON CONFLICT ("household_id", "name") DO NOTHING;--> statement-breakpoint
UPDATE "account_groups"
SET "default_kind" = NULL, "sort_order" = CASE
  WHEN "name" = '電子マネー' THEN 50
  WHEN "name" = 'その他' THEN 60
  ELSE "sort_order"
END
WHERE ("name" = '電子マネー' AND "default_kind" = 'electronic_money'::"account_kind")
   OR ("name" = 'その他' AND "default_kind" = 'other'::"account_kind");