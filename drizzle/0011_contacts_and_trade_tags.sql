CREATE TABLE "contact_tags" (
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_tags_pkey" PRIMARY KEY("org_id","contact_id","tag")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"email" text,
	"rate_note" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_org_and_id" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "trade_tags" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_tags_slug_format" CHECK ("trade_tags"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_trade_tags_slug_fk" FOREIGN KEY ("tag") REFERENCES "public"."trade_tags"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact" FOREIGN KEY ("org_id","contact_id") REFERENCES "public"."contacts"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_tags_org_tag" ON "contact_tags" USING btree ("org_id","tag");--> statement-breakpoint
CREATE INDEX "contacts_org_name" ON "contacts" USING btree ("org_id","name") WHERE archived_at IS NULL;