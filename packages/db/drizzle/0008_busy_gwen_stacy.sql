CREATE TYPE "public"."card_auto_payment_status" AS ENUM('completed', 'settled', 'blocked');--> statement-breakpoint
CREATE TABLE "card_auto_payment_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"card_account_id" integer NOT NULL,
	"due_on" date NOT NULL,
	"status" "card_auto_payment_status" NOT NULL,
	"transfer_id" integer,
	"reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_auto_payment_runs_household_card_due_unique" UNIQUE("household_id","card_account_id","due_on")
);
--> statement-breakpoint
ALTER TABLE "account_card_settings" ADD COLUMN "auto_payment_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_card_settings" ADD COLUMN "auto_payment_enabled_on" date;--> statement-breakpoint
ALTER TABLE "card_auto_payment_runs" ADD CONSTRAINT "card_auto_payment_runs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_auto_payment_runs" ADD CONSTRAINT "card_auto_payment_runs_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_auto_payment_runs" ADD CONSTRAINT "card_auto_payment_runs_card_account_household_fk" FOREIGN KEY ("card_account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_auto_payment_runs_household_card_due_idx" ON "card_auto_payment_runs" USING btree ("household_id","card_account_id","due_on");--> statement-breakpoint
ALTER TABLE "account_card_settings" ADD CONSTRAINT "account_card_settings_auto_payment_pair_check" CHECK (("account_card_settings"."auto_payment_enabled" and "account_card_settings"."auto_payment_enabled_on" is not null) or
        (not "account_card_settings"."auto_payment_enabled" and "account_card_settings"."auto_payment_enabled_on" is null));