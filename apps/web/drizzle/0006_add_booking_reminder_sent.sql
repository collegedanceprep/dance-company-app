CREATE TABLE IF NOT EXISTS "booking_reminder_sent" (
	"bookingId" text PRIMARY KEY NOT NULL,
	"sentAt" timestamp DEFAULT now() NOT NULL
);
