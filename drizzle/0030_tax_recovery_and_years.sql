CREATE TABLE "tax_years" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"blended_rate_bps" integer,
	"de_minimis_elected" boolean DEFAULT true NOT NULL,
	"de_minimis_threshold_cents" bigint DEFAULT 250000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_years_org_year" UNIQUE("org_id","year"),
	CONSTRAINT "tax_years_year_plausible" CHECK ("tax_years"."year" BETWEEN 2000 AND 2200),
	CONSTRAINT "tax_years_rate_valid" CHECK ("tax_years"."blended_rate_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "tax_years_threshold_not_negative" CHECK ("tax_years"."de_minimis_threshold_cents" >= 0)
);
--> statement-breakpoint
-- Hand-edited from the generated `ADD COLUMN ... NOT NULL`, which would fail on
-- `0020`'s twenty-seven rows: the column is added empty, every type is given
-- its class, and only then is it required. The snapshot describes the end
-- state, which is all the drift check compares.
--
-- **Which types are five-year property** (#144, decision 1): appliances and
-- carpet, IRS Publication 527's Table 1-1 examples of property used in a
-- rental activity. Everything else is a structural component of the building
-- and recovers with it over 27.5 years: the kitchen cabinets, the heating and
-- cooling, the water heater, the flooring that is glued or nailed down, the
-- wiring, the detectors. The disposal and the over-the-range microwave are
-- appliances; the range hood that shares their row is taken with them.
ALTER TABLE "capital_item_types" ADD COLUMN "recovery_class" text;--> statement-breakpoint
UPDATE "capital_item_types" SET "recovery_class" = CASE
  WHEN "slug" IN ('refrigerator', 'range', 'dishwasher', 'microwave-hood',
    'garbage-disposal', 'washer', 'dryer', 'carpet') THEN 'five_year'
  ELSE 'residential'
END;--> statement-breakpoint
ALTER TABLE "capital_item_types" ALTER COLUMN "recovery_class" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "planned_work" ADD COLUMN "planned_month" integer;--> statement-breakpoint
ALTER TABLE "tax_years" ADD CONSTRAINT "tax_years_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_item_types" ADD CONSTRAINT "capital_item_types_recovery_class_known" CHECK ("capital_item_types"."recovery_class" IN ('residential', 'five_year'));--> statement-breakpoint
ALTER TABLE "planned_work" ADD CONSTRAINT "planned_work_month_valid" CHECK ("planned_work"."planned_month" BETWEEN 1 AND 12);