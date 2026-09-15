-- `units_org_and_id` first: the unit references below point at it, and
-- drizzle-kit writes it last, after the keys that need it exist.
ALTER TABLE "units" ADD CONSTRAINT "units_org_and_id" UNIQUE("org_id","id");--> statement-breakpoint
CREATE TYPE "public"."access_code_kind" AS ENUM('smart_lock', 'door', 'lockbox', 'garage', 'gate', 'other');--> statement-breakpoint
CREATE TYPE "public"."utility_kind" AS ENUM('gas', 'electric', 'water_sewer', 'internet', 'trash', 'lawn', 'snow', 'other');--> statement-breakpoint
CREATE TABLE "building_access_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"kind" "access_code_kind" NOT NULL,
	"label" text,
	"secret" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"last_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_access_codes_secret_is_sealed" CHECK (octet_length("building_access_codes"."secret") = 92),
	CONSTRAINT "building_access_codes_key_version_positive" CHECK ("building_access_codes"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "building_facts" (
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"trash_day" text,
	"recycling_day" text,
	"recycling_note" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_facts_pkey" PRIMARY KEY("org_id","building_id"),
	CONSTRAINT "building_facts_trash_day_known" CHECK ("building_facts"."trash_day" IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
	CONSTRAINT "building_facts_recycling_day_known" CHECK ("building_facts"."recycling_day" IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'))
);
--> statement-breakpoint
CREATE TABLE "building_utilities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"kind" "utility_kind" NOT NULL,
	"provider_name" text,
	"account_ref" text,
	"paid_by" text DEFAULT 'owner' NOT NULL,
	"avg_monthly_cents" bigint,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "building_utilities_account_ref_is_a_stub" CHECK (char_length("building_utilities"."account_ref") <= 4),
	CONSTRAINT "building_utilities_paid_by_known" CHECK ("building_utilities"."paid_by" IN ('owner', 'tenant')),
	CONSTRAINT "building_utilities_avg_not_negative" CHECK ("building_utilities"."avg_monthly_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "building_access_codes" ADD CONSTRAINT "building_access_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_access_codes" ADD CONSTRAINT "building_access_codes_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_access_codes" ADD CONSTRAINT "building_access_codes_unit" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_facts" ADD CONSTRAINT "building_facts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_facts" ADD CONSTRAINT "building_facts_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_utilities" ADD CONSTRAINT "building_utilities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_utilities" ADD CONSTRAINT "building_utilities_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_utilities" ADD CONSTRAINT "building_utilities_unit" FOREIGN KEY ("org_id","unit_id") REFERENCES "public"."units"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_utilities" ADD CONSTRAINT "building_utilities_contact" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "building_access_codes_org_building" ON "building_access_codes" USING btree ("org_id","building_id");--> statement-breakpoint
CREATE INDEX "building_utilities_org_building" ON "building_utilities" USING btree ("org_id","building_id");