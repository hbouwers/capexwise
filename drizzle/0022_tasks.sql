CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('unscheduled', 'scheduled', 'done', 'canceled');--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"capital_item_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"trade_tag" text,
	"status" "task_status" DEFAULT 'unscheduled' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"due_date" date,
	"completed_on" date,
	"confirmed_on" date,
	"assignee_contact_id" uuid,
	"assignee_user_id" uuid,
	"est_cost_cents" bigint,
	"actual_cost_cents" bigint,
	"recurrence_months" integer,
	"recurrence_parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_org_building_and_id" UNIQUE("org_id","building_id","id"),
	CONSTRAINT "tasks_money_not_negative" CHECK ("tasks"."est_cost_cents" >= 0 AND "tasks"."actual_cost_cents" >= 0),
	CONSTRAINT "tasks_recurrence_positive" CHECK ("tasks"."recurrence_months" > 0),
	CONSTRAINT "tasks_scheduled_has_date" CHECK ("tasks"."status" <> 'scheduled' OR "tasks"."due_date" IS NOT NULL),
	CONSTRAINT "tasks_done_has_date" CHECK ("tasks"."status" <> 'done' OR "tasks"."completed_on" IS NOT NULL),
	CONSTRAINT "tasks_one_assignee" CHECK ("tasks"."assignee_contact_id" IS NULL OR "tasks"."assignee_user_id" IS NULL),
	CONSTRAINT "tasks_confirmed_is_booked" CHECK ("tasks"."confirmed_on" IS NULL OR (
        "tasks"."status" IN ('scheduled', 'done')
        AND ("tasks"."assignee_contact_id" IS NOT NULL OR "tasks"."assignee_user_id" IS NOT NULL)
      )),
	CONSTRAINT "tasks_not_its_own_parent" CHECK ("tasks"."recurrence_parent_id" <> "tasks"."id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_trade_tag_trade_tags_slug_fk" FOREIGN KEY ("trade_tag") REFERENCES "public"."trade_tags"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_unit" FOREIGN KEY ("org_id","building_id","unit_id") REFERENCES "public"."units"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_status_due" ON "tasks" USING btree ("org_id","status","due_date");--> statement-breakpoint
CREATE INDEX "tasks_org_building_unit" ON "tasks" USING btree ("org_id","building_id","unit_id");--> statement-breakpoint
CREATE INDEX "tasks_org_assignee" ON "tasks" USING btree ("org_id","assignee_contact_id") WHERE assignee_contact_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_org_assignee_user" ON "tasks" USING btree ("org_id","assignee_user_id") WHERE assignee_user_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_org_recurrence_parent" ON "tasks" USING btree ("org_id","recurrence_parent_id") WHERE recurrence_parent_id IS NOT NULL;