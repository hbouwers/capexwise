CREATE TYPE "public"."building_status" AS ENUM('active', 'sold', 'archived');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('occupied', 'vacant', 'retired');--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"region" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"timezone" text NOT NULL,
	"build_year" integer,
	"status" "building_status" DEFAULT 'active' NOT NULL,
	"acquired_on" date,
	"in_service_on" date,
	"purchase_price_cents" bigint,
	"closing_costs_cents" bigint,
	"land_basis_cents" bigint,
	"building_basis_cents" bigint,
	"basis_split_method" text,
	"basis_split_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildings_org_and_id" UNIQUE("org_id","id"),
	CONSTRAINT "buildings_build_year_plausible" CHECK ("buildings"."build_year" BETWEEN 1600 AND 2200),
	CONSTRAINT "buildings_money_not_negative" CHECK ("buildings"."purchase_price_cents" >= 0 AND "buildings"."closing_costs_cents" >= 0
        AND "buildings"."land_basis_cents" >= 0 AND "buildings"."building_basis_cents" >= 0),
	CONSTRAINT "buildings_basis_split_method_known" CHECK ("buildings"."basis_split_method" IN ('assessment_ratio', 'appraisal', 'manual')),
	CONSTRAINT "buildings_basis_complete" CHECK (("buildings"."purchase_price_cents" IS NULL AND "buildings"."land_basis_cents" IS NULL
          AND "buildings"."building_basis_cents" IS NULL)
        OR ("buildings"."purchase_price_cents" IS NOT NULL AND "buildings"."land_basis_cents" IS NOT NULL
          AND "buildings"."building_basis_cents" IS NOT NULL
          AND "buildings"."land_basis_cents" + "buildings"."building_basis_cents"
            = "buildings"."purchase_price_cents" + coalesce("buildings"."closing_costs_cents", 0)))
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"label" text NOT NULL,
	"status" "unit_status" DEFAULT 'vacant' NOT NULL,
	"rent_cents" bigint,
	"lease_end" date,
	"bedrooms" numeric(3, 1),
	"bathrooms" numeric(3, 1),
	"square_feet" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_org_building_label" UNIQUE("org_id","building_id","label"),
	CONSTRAINT "units_rent_not_negative" CHECK ("units"."rent_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buildings_org_status" ON "buildings" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "units_org_lease_end" ON "units" USING btree ("org_id","lease_end") WHERE status = 'occupied';