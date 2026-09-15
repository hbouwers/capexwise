CREATE TYPE "public"."allocation_method" AS ENUM('building_only', 'by_unit_count', 'explicit');--> statement-breakpoint
CREATE TYPE "public"."item_confidence" AS ENUM('estimated', 'audited');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('active', 'replaced', 'removed');--> statement-breakpoint
CREATE TABLE "capital_item_allocations" (
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"capital_item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"share_bps" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capital_item_allocations_pkey" PRIMARY KEY("org_id","capital_item_id","unit_id"),
	CONSTRAINT "capital_item_allocations_share_in_range" CHECK ("capital_item_allocations"."share_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "capital_item_types" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"item_group" text NOT NULL,
	"default_scope" text NOT NULL,
	"default_life_years" integer NOT NULL,
	"default_cost_cents" bigint NOT NULL,
	"defaults_updated_at" date NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capital_item_types_slug_format" CHECK ("capital_item_types"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "capital_item_types_group_known" CHECK ("capital_item_types"."item_group" IN ('kitchen', 'laundry', 'hvac_water', 'envelope', 'interior_systems')),
	CONSTRAINT "capital_item_types_scope_known" CHECK ("capital_item_types"."default_scope" IN ('building', 'unit')),
	CONSTRAINT "capital_item_types_life_positive" CHECK ("capital_item_types"."default_life_years" > 0),
	CONSTRAINT "capital_item_types_cost_not_negative" CHECK ("capital_item_types"."default_cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "capital_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"type_slug" text,
	"label" text NOT NULL,
	"install_year" integer NOT NULL,
	"install_date" date,
	"confidence" "item_confidence" DEFAULT 'estimated' NOT NULL,
	"expected_life_years" integer NOT NULL,
	"replacement_cost_cents" bigint NOT NULL,
	"actual_cost_cents" bigint,
	"status" "item_status" DEFAULT 'active' NOT NULL,
	"allocation" "allocation_method" DEFAULT 'by_unit_count' NOT NULL,
	"replaced_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capital_items_org_building_and_id" UNIQUE("org_id","building_id","id"),
	CONSTRAINT "capital_items_install_year_plausible" CHECK ("capital_items"."install_year" BETWEEN 1600 AND 2200),
	CONSTRAINT "capital_items_audited_has_date" CHECK ("capital_items"."confidence" = 'estimated' OR "capital_items"."install_date" IS NOT NULL),
	CONSTRAINT "capital_items_install_date_in_year" CHECK ("capital_items"."install_date" IS NULL
        OR extract(year FROM "capital_items"."install_date") = "capital_items"."install_year"),
	CONSTRAINT "capital_items_life_positive" CHECK ("capital_items"."expected_life_years" > 0),
	CONSTRAINT "capital_items_money_not_negative" CHECK ("capital_items"."replacement_cost_cents" >= 0 AND "capital_items"."actual_cost_cents" >= 0),
	CONSTRAINT "capital_items_allocation_scope" CHECK ("capital_items"."unit_id" IS NULL OR "capital_items"."allocation" = 'building_only'),
	CONSTRAINT "capital_items_replaced_by_set" CHECK (("capital_items"."status" = 'replaced') = ("capital_items"."replaced_by_id" IS NOT NULL)),
	CONSTRAINT "capital_items_not_its_own_replacement" CHECK ("capital_items"."replaced_by_id" <> "capital_items"."id")
);
--> statement-breakpoint
ALTER TABLE "capital_item_allocations" ADD CONSTRAINT "capital_item_allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_item_allocations" ADD CONSTRAINT "capital_item_allocations_item" FOREIGN KEY ("org_id","building_id","capital_item_id") REFERENCES "public"."capital_items"("org_id","building_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_item_allocations" ADD CONSTRAINT "capital_item_allocations_unit" FOREIGN KEY ("org_id","building_id","unit_id") REFERENCES "public"."units"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_items" ADD CONSTRAINT "capital_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_items" ADD CONSTRAINT "capital_items_type_slug_capital_item_types_slug_fk" FOREIGN KEY ("type_slug") REFERENCES "public"."capital_item_types"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_items" ADD CONSTRAINT "capital_items_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_items" ADD CONSTRAINT "capital_items_unit" FOREIGN KEY ("org_id","building_id","unit_id") REFERENCES "public"."units"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_items" ADD CONSTRAINT "capital_items_replaced_by" FOREIGN KEY ("org_id","building_id","replaced_by_id") REFERENCES "public"."capital_items"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capital_items_org_building_unit" ON "capital_items" USING btree ("org_id","building_id","unit_id");--> statement-breakpoint
CREATE INDEX "capital_items_org_status_year" ON "capital_items" USING btree ("org_id","status","install_year");