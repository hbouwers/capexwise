CREATE TYPE "public"."planned_work_status" AS ENUM('planned', 'done', 'dropped');--> statement-breakpoint
CREATE TABLE "planned_work" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"capital_item_id" uuid,
	"title" text,
	"est_cost_cents" bigint,
	"planned_year" integer NOT NULL,
	"classification" "transaction_classification" DEFAULT 'unclassified' NOT NULL,
	"status" "planned_work_status" DEFAULT 'planned' NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_work_year_plausible" CHECK ("planned_work"."planned_year" BETWEEN 2000 AND 2200),
	CONSTRAINT "planned_work_item_or_project" CHECK (("planned_work"."capital_item_id" IS NOT NULL
          AND "planned_work"."title" IS NULL
          AND "planned_work"."est_cost_cents" IS NULL
          AND "planned_work"."unit_id" IS NULL)
        OR ("planned_work"."capital_item_id" IS NULL
          AND "planned_work"."title" IS NOT NULL
          AND "planned_work"."est_cost_cents" IS NOT NULL)),
	CONSTRAINT "planned_work_cost_not_negative" CHECK ("planned_work"."est_cost_cents" >= 0),
	CONSTRAINT "planned_work_transaction_when_done" CHECK ("planned_work"."status" = 'done' OR "planned_work"."transaction_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "planned_work" ADD CONSTRAINT "planned_work_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_work" ADD CONSTRAINT "planned_work_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_work" ADD CONSTRAINT "planned_work_unit" FOREIGN KEY ("org_id","building_id","unit_id") REFERENCES "public"."units"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_work" ADD CONSTRAINT "planned_work_capital_item" FOREIGN KEY ("org_id","building_id","capital_item_id") REFERENCES "public"."capital_items"("org_id","building_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "planned_work_one_live_plan" ON "planned_work" USING btree ("org_id","capital_item_id") WHERE status = 'planned' AND capital_item_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "planned_work_org_building_year" ON "planned_work" USING btree ("org_id","building_id","planned_year") WHERE status = 'planned';--> statement-breakpoint
CREATE INDEX "planned_work_org_transaction" ON "planned_work" USING btree ("org_id","transaction_id") WHERE transaction_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_org_and_id" UNIQUE("org_id","id");