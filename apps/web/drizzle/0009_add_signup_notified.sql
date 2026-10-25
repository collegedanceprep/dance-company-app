CREATE TABLE IF NOT EXISTS "signup_notified" (
	"userId" text PRIMARY KEY NOT NULL,
	"sentAt" timestamp DEFAULT now() NOT NULL
);
