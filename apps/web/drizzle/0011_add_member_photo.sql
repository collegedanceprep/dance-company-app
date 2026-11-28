-- Dancer profile photos, keyed by the Airtable member record. Stored in Postgres (not a
-- public bucket) so the API can restrict viewing to admins, PrepMasters and the owner.
CREATE TABLE IF NOT EXISTS "member_photo" (
  "recordId" text PRIMARY KEY,
  "mime" text NOT NULL,
  "data" text NOT NULL,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
