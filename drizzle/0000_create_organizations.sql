CREATE TYPE "public"."org_plan" AS ENUM('free', 'paid', 'premium');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" "org_plan" DEFAULT 'free' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_one_demo" ON "organizations" USING btree ("is_demo") WHERE is_demo;