DROP TABLE "password_reset_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
-- Sign-in is Google-only from here: remove every stored password hash
UPDATE "users" SET "password_hash" = NULL;
