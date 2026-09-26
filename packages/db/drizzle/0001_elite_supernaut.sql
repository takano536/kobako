CREATE TYPE "public"."transaction_type" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"name" varchar(80) NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "categories_household_type_name_unique" UNIQUE("household_id","type","name"),
	CONSTRAINT "categories_id_household_type_unique" UNIQUE("id","household_id","type")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"category_id" integer NOT NULL,
	"memo" varchar(200) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive_limit_check" CHECK ("transactions"."amount" > 0 AND "transactions"."amount" <= 999999999)
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_household_type_fk" FOREIGN KEY ("category_id","household_id","type") REFERENCES "public"."categories"("id","household_id","type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_household_type_sort_order_idx" ON "categories" USING btree ("household_id","type","sort_order");--> statement-breakpoint
CREATE INDEX "transactions_household_occurred_on_idx" ON "transactions" USING btree ("household_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_household_type_occurred_on_idx" ON "transactions" USING btree ("household_id","type","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_household_category_idx" ON "transactions" USING btree ("household_id","category_id");