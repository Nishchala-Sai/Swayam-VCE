CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'VERIFIED', 'REJECTED', 'REFUND_REQUIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('STUDENT', 'ADMIN', 'EVENT_HEAD');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"location" varchar(255) NOT NULL,
	"capacity" integer NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"group_size" integer,
	"group_price" integer,
	"max_team_size" integer,
	"upi_qr_url" varchar(2048),
	"upi_id" varchar(100),
	"upi_payee_name" varchar(100),
	"payment_instructions" text,
	"banner_url" varchar(2048),
	"schedule" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" > 0),
	CONSTRAINT "events_price_non_negative" CHECK ("events"."price" >= 0),
	CONSTRAINT "events_group_offer" CHECK (("events"."group_size" is null) = ("events"."group_price" is null))
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" "registration_status" DEFAULT 'CONFIRMED' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"utr_number" varchar(32),
	"payment_screenshot_url" varchar(2048),
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"team_id" uuid,
	"team_name" varchar(100),
	"is_group_leader" boolean DEFAULT false NOT NULL,
	"teammate_emails" text,
	"total_amount_paid" integer,
	"refunded_by" uuid,
	"refunded_at" timestamp with time zone,
	"attended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_utr_number_unique" UNIQUE("utr_number"),
	CONSTRAINT "registrations_user_event_unique" UNIQUE("user_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "sub_event_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"registration_id" uuid,
	"sub_event_id" uuid NOT NULL,
	"status" "registration_status" DEFAULT 'CONFIRMED' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"is_pass_holder" boolean DEFAULT false NOT NULL,
	"utr_number" varchar(32),
	"payment_screenshot_url" varchar(2048),
	"total_amount_paid" integer,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"refunded_by" uuid,
	"refunded_at" timestamp with time zone,
	"team_id" uuid,
	"team_name" varchar(100),
	"is_group_leader" boolean DEFAULT false NOT NULL,
	"teammate_emails" text,
	"group_id" uuid,
	"group_name" varchar(150),
	"grouped_at" timestamp with time zone,
	"attended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_event_bookings_utr_number_unique" UNIQUE("utr_number"),
	CONSTRAINT "sub_event_bookings_user_sub_event_unique" UNIQUE("user_id","sub_event_id")
);
--> statement-breakpoint
CREATE TABLE "sub_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"capacity" integer NOT NULL,
	"price_for_pass_holders" integer DEFAULT 0 NOT NULL,
	"price_for_standalone" integer DEFAULT 0 NOT NULL,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"venue" varchar(255),
	"team_size" integer DEFAULT 1,
	"pass_holders_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_events_team_size_positive" CHECK ("sub_events"."team_size" is null or "sub_events"."team_size" >= 1),
	CONSTRAINT "sub_events_capacity_positive" CHECK ("sub_events"."capacity" > 0),
	CONSTRAINT "sub_events_prices_non_negative" CHECK ("sub_events"."price_for_pass_holders" >= 0 and "sub_events"."price_for_standalone" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(100),
	"password_hash" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'STUDENT' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_refunded_by_users_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_event_bookings" ADD CONSTRAINT "sub_event_bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_event_bookings" ADD CONSTRAINT "sub_event_bookings_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_event_bookings" ADD CONSTRAINT "sub_event_bookings_sub_event_id_sub_events_id_fk" FOREIGN KEY ("sub_event_id") REFERENCES "public"."sub_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_event_bookings" ADD CONSTRAINT "sub_event_bookings_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_event_bookings" ADD CONSTRAINT "sub_event_bookings_refunded_by_users_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_events" ADD CONSTRAINT "sub_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "events" USING btree ("date");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registrations_event_status_idx" ON "registrations" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "registrations_team_idx" ON "registrations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "sub_event_bookings_group_idx" ON "sub_event_bookings" USING btree ("sub_event_id","group_id");--> statement-breakpoint
CREATE INDEX "sub_event_bookings_sub_event_status_idx" ON "sub_event_bookings" USING btree ("sub_event_id","status");--> statement-breakpoint
CREATE INDEX "sub_event_bookings_team_idx" ON "sub_event_bookings" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "sub_event_bookings_registration_idx" ON "sub_event_bookings" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "sub_events_event_idx" ON "sub_events" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_name_lower_unique" ON "venues" USING btree (lower("name"));