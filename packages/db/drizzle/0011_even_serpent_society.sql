CREATE TYPE "public"."transaction_origin" AS ENUM('manual', 'file', 'api');--> statement-breakpoint
CREATE TABLE "api_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"label" varchar(120) DEFAULT '' NOT NULL,
	"idempotency_key" varchar(200),
	"created_transaction_count" integer DEFAULT 0 NOT NULL,
	"skipped_transaction_count" integer DEFAULT 0 NOT NULL,
	"created_transfer_count" integer DEFAULT 0 NOT NULL,
	"skipped_transfer_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_batches_counts_check" CHECK ("api_batches"."created_transaction_count" >= 0 AND "api_batches"."skipped_transaction_count" >= 0 AND "api_batches"."created_transfer_count" >= 0 AND "api_batches"."skipped_transfer_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "origin" "transaction_origin" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "external_id" varchar(200);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "api_batch_id" integer;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "origin" "transaction_origin" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "external_id" varchar(200);--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "api_batch_id" integer;--> statement-breakpoint
ALTER TABLE "api_batches" ADD CONSTRAINT "api_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_batches_household_idempotency_unique" ON "api_batches" USING btree ("household_id","idempotency_key") WHERE "api_batches"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "api_batches_household_created_at_idx" ON "api_batches" USING btree ("household_id","created_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_api_batch_id_api_batches_id_fk" FOREIGN KEY ("api_batch_id") REFERENCES "public"."api_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_api_batch_id_api_batches_id_fk" FOREIGN KEY ("api_batch_id") REFERENCES "public"."api_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_household_external_id_unique" ON "transactions" USING btree ("household_id","external_id") WHERE "transactions"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_household_origin_occurred_on_idx" ON "transactions" USING btree ("household_id","origin","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_household_external_id_unique" ON "transfers" USING btree ("household_id","external_id") WHERE "transfers"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "transfers_household_origin_occurred_on_idx" ON "transfers" USING btree ("household_id","origin","occurred_on");