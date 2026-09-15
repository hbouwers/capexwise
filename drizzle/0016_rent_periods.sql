-- `units_org_building_and_id` first: `rent_periods_unit` below points at it,
-- and drizzle-kit writes it last, after the key that needs it exists.
ALTER TABLE "units" ADD CONSTRAINT "units_org_building_and_id" UNIQUE("org_id","building_id","id");--> statement-breakpoint
CREATE TABLE "rent_periods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"amount_expected_cents" bigint NOT NULL,
	"amount_received_cents" bigint,
	"received_on" date,
	"vacant" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_periods_org_unit_month" UNIQUE("org_id","unit_id","period_month"),
	CONSTRAINT "rent_periods_month_is_first" CHECK (extract(day from "rent_periods"."period_month") = 1),
	CONSTRAINT "rent_periods_money_not_negative" CHECK ("rent_periods"."amount_expected_cents" >= 0 AND "rent_periods"."amount_received_cents" >= 0),
	CONSTRAINT "rent_periods_received_pair" CHECK (("rent_periods"."amount_received_cents" IS NULL) = ("rent_periods"."received_on" IS NULL)),
	CONSTRAINT "rent_periods_vacant_received_nothing" CHECK (NOT "rent_periods"."vacant" OR "rent_periods"."amount_received_cents" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "rent_periods" ADD CONSTRAINT "rent_periods_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_periods" ADD CONSTRAINT "rent_periods_unit" FOREIGN KEY ("org_id","building_id","unit_id") REFERENCES "public"."units"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rent_periods_org_building_month" ON "rent_periods" USING btree ("org_id","building_id","period_month");--> statement-breakpoint
CREATE INDEX "rent_periods_org_unmarked" ON "rent_periods" USING btree ("org_id","period_month") WHERE amount_received_cents IS NULL AND NOT vacant;