CREATE TYPE "public"."transaction_classification" AS ENUM('repair', 'improvement', 'unclassified');--> statement-breakpoint
CREATE TABLE "schedule_e_categories" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"line" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_e_categories_line" UNIQUE("line"),
	CONSTRAINT "schedule_e_categories_slug_format" CHECK ("schedule_e_categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "schedule_e_categories_line_is_an_expense" CHECK ("schedule_e_categories"."line" BETWEEN 5 AND 19 AND "schedule_e_categories"."line" <> 18)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"building_id" uuid NOT NULL,
	"unit_id" uuid,
	"capital_item_id" uuid,
	"task_id" uuid,
	"contact_id" uuid,
	"occurred_on" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"description" text,
	"schedule_e_category" text NOT NULL,
	"classification" "transaction_classification",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_not_zero" CHECK ("transactions"."amount_cents" <> 0)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_schedule_e_category_schedule_e_categories_slug_fk" FOREIGN KEY ("schedule_e_category") REFERENCES "public"."schedule_e_categories"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_building" FOREIGN KEY ("org_id","building_id") REFERENCES "public"."buildings"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_unit" FOREIGN KEY ("org_id","building_id","unit_id") REFERENCES "public"."units"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_capital_item" FOREIGN KEY ("org_id","building_id","capital_item_id") REFERENCES "public"."capital_items"("org_id","building_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_org_building_date" ON "transactions" USING btree ("org_id","building_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_org_date_category" ON "transactions" USING btree ("org_id","occurred_on","schedule_e_category");--> statement-breakpoint
CREATE INDEX "transactions_org_task" ON "transactions" USING btree ("org_id","task_id") WHERE task_id IS NOT NULL;