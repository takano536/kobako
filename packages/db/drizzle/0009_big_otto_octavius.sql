ALTER TABLE "households" ADD COLUMN "ledger_initialized" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "households" SET "ledger_initialized" = true;