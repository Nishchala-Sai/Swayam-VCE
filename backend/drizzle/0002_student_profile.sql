ALTER TABLE "users" ADD COLUMN "phone" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "roll_number" varchar(30);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch" varchar(60);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_year_range" CHECK ("users"."year" is null or "users"."year" between 1 and 4);