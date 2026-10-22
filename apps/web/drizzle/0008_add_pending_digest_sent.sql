CREATE TABLE IF NOT EXISTS "pending_digest_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"workerUserId" text NOT NULL,
	"forDate" text NOT NULL,
	"sentAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pending_digest_sent_worker_date" UNIQUE("workerUserId","forDate")
);
