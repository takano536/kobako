CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_household_name_unique" UNIQUE("household_id","name"),
	CONSTRAINT "accounts_id_household_unique" UNIQUE("id","household_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"source" varchar(80) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"transaction_count" integer NOT NULL,
	"income_count" integer DEFAULT 0 NOT NULL,
	"expense_count" integer DEFAULT 0 NOT NULL,
	"transfer_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_imports_household_source_sha256_unique" UNIQUE("household_id","source","sha256"),
	CONSTRAINT "transaction_imports_transaction_count_check" CHECK ("transaction_imports"."transaction_count" >= 0),
	CONSTRAINT "transaction_imports_income_count_check" CHECK ("transaction_imports"."income_count" >= 0),
	CONSTRAINT "transaction_imports_expense_count_check" CHECK ("transaction_imports"."expense_count" >= 0),
	CONSTRAINT "transaction_imports_transfer_count_check" CHECK ("transaction_imports"."transfer_count" >= 0),
	CONSTRAINT "transaction_imports_sha256_check" CHECK ("transaction_imports"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"from_account_id" integer NOT NULL,
	"to_account_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"memo" varchar(200) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_distinct_accounts_check" CHECK ("transfers"."from_account_id" <> "transfers"."to_account_id"),
	CONSTRAINT "transfers_amount_positive_limit_check" CHECK ("transfers"."amount" > 0 AND "transfers"."amount" <= 999999999)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "account_id" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_household_fk" FOREIGN KEY ("from_account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_household_fk" FOREIGN KEY ("to_account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_imports_household_created_at_idx" ON "transaction_imports" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "transfers_household_occurred_on_idx" ON "transfers" USING btree ("household_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transfers_household_from_account_idx" ON "transfers" USING btree ("household_id","from_account_id");--> statement-breakpoint
CREATE INDEX "transfers_household_to_account_idx" ON "transfers" USING btree ("household_id","to_account_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_household_fk" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_household_account_idx" ON "transactions" USING btree ("household_id","account_id");