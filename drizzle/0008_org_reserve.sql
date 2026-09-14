ALTER TABLE "organizations" ADD COLUMN "reserve_balance_cents" bigint;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reserve_as_of" date;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reserve_monthly_contribution_cents" bigint;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_reserve_all_or_none" CHECK (num_nulls("organizations"."reserve_balance_cents", "organizations"."reserve_as_of", "organizations"."reserve_monthly_contribution_cents") IN (0, 3));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_reserve_not_negative" CHECK ("organizations"."reserve_balance_cents" >= 0 AND "organizations"."reserve_monthly_contribution_cents" >= 0);