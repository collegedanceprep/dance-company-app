CREATE TABLE IF NOT EXISTS "credit_adjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"memberRecordId" text NOT NULL,
	"userId" text,
	"memberEmail" text,
	"adminEmail" text NOT NULL,
	"previousCredits" double precision NOT NULL,
	"newCredits" double precision NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_adjustment_member_idx" ON "credit_adjustment" USING btree ("memberRecordId");
