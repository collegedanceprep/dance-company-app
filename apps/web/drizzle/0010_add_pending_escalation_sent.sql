CREATE TABLE IF NOT EXISTS "pending_escalation_sent" (
	"id" text PRIMARY KEY NOT NULL,
	"bookingId" text NOT NULL,
	"stage" text NOT NULL,
	"sentAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pending_escalation_sent_booking_stage" UNIQUE("bookingId","stage")
);
