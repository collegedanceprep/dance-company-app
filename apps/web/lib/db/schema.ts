import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  doublePrecision,
  unique,
  index,
} from "drizzle-orm/pg-core"


// --- Better Auth required tables -------------------------------------------
// Column names are camelCase to match Better Auth's defaults. Do not rename.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  // "active" | "pending" | "denied" — new dancer signups start as "pending"
  status: text("status").notNull().default("pending"),
  // IANA timezone string e.g. "America/Denver". Updated on each app launch.
  timezone: text("timezone"),
  // true when the user self-identified as a parent/guardian at signup.
  // Prevents a dancer Airtable record from ever being created for them.
  isParentAccount: boolean("isParentAccount").notNull().default(false),
  // Audit trail for manual status changes (pending → active/denied).
  approvedBy: text("approvedBy"),   // email of the admin who changed the status
  approvedAt: timestamp("approvedAt"),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
})

// --- App data ---------------------------------------------------------------
// PrepMasters (staff), Clients, and Bookings are stored in Airtable, which
// acts as the backend of record. See lib/airtable.ts for those operations.

// Tracks which emails have been invited to join as PrepMasters (staff).
// Anyone who signs in with an email present here is treated as a PrepMaster.
export const prepMasterInvite = pgTable("prep_master_invite", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  invitedBy: text("invitedBy").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  acceptedAt: timestamp("acceptedAt"),
})

// In-app notifications. Written by server actions on booking events.
// Displayed in the bell dropdown on web; will also trigger push/email/SMS later.
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),          // recipient's auth user ID
    type: text("type").notNull(),              // "booking_confirmed" | "booking_cancelled" | "booking_updated"
    title: text("title").notNull(),
    body: text("body").notNull(),
    read: boolean("read").notNull().default(false),
    bookingId: text("bookingId"),              // optional link back to the booking
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("notification_user_idx").on(t.userId),
  }),
)

// Stores Google Calendar OAuth tokens per PrepMaster so we can create
// calendar events on their behalf when a dancer books a session.
export const googleCalendarToken = pgTable("google_calendar_token", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// Tracks which child a parent has currently selected when they have multiple linked children.
// Keyed by the parent's auth user ID; childUserId is the Airtable User ID of the selected child.
export const parentActiveChild = pgTable("parent_active_child", {
  parentUserId: text("parentUserId").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  childUserId: text("childUserId").notNull(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
})

// Expo push tokens — one row per user device. A user can have multiple devices.
export const pushToken = pgTable(
  "push_token",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("push_token_user_idx").on(t.userId),
    tokenUnique: unique("push_token_unique").on(t.token),
  }),
)

// Maps an Airtable booking record ID + user ID to a Google Calendar event ID.
// One row per (bookingId, userId) — used to update or delete calendar events
// when a booking is rescheduled or cancelled.
export const calendarEventLink = pgTable(
  "calendar_event_link",
  {
    id: text("id").primaryKey(),
    bookingId: text("bookingId").notNull(),  // Airtable record ID
    userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
    gcalEventId: text("gcalEventId").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    bookingUserUnique: unique("cal_event_link_booking_user").on(t.bookingId, t.userId),
    bookingIdx: index("cal_event_link_booking_idx").on(t.bookingId),
  }),
)

// Idempotency guard for Stripe webhooks — prevents double-credit on duplicate deliveries.
// Row is inserted atomically before touching Airtable; duplicate stripeSessionId is rejected.
export const stripeWebhookProcessed = pgTable("stripe_webhook_processed", {
  stripeSessionId: text("stripeSessionId").primaryKey(),
  userId: text("userId").notNull(),
  processedAt: timestamp("processedAt").notNull().defaultNow(),
})

// Idempotency guard for the 24-hour booking-reminder cron — the insert is
// attempted before sending; a duplicate bookingId (Airtable record ID)
// means a previous cron tick already handled it, so the conflict is the
// dedupe signal itself.
export const bookingReminderSent = pgTable("booking_reminder_sent", {
  bookingId: text("bookingId").primaryKey(),
  sentAt: timestamp("sentAt").notNull().defaultNow(),
})

// Booking attempt lock — prevents double-deduction when two requests race for the same slot.
// A row is inserted before credits are deducted; duplicate (userId, date, time) is rejected.
// Row is deleted after the booking is fully committed (or on rollback).
export const bookingAttemptLock = pgTable(
  "booking_attempt_lock",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    date: text("date").notNull(),
    time: text("time").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    userDateTimeUnique: unique("booking_attempt_lock_user_date_time").on(t.userId, t.date, t.time),
  }),
)

// A PrepMaster's weekly recurring availability. One row per (email, weekday).
// Keyed by the PrepMaster's email, which is both their login email and their
// Workers-table email, so dancers can look up availability when booking.
export const prepMasterAvailability = pgTable(
  "prep_master_availability",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    dayOfWeek: integer("dayOfWeek").notNull(), // 0 = Sunday … 6 = Saturday
    startTime: text("startTime").notNull(), // "HH:MM" 24h
    endTime: text("endTime").notNull(), // "HH:MM" 24h
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (t) => ({
    emailDayUnique: unique("prep_master_availability_email_day_unique").on(
      t.email,
      t.dayOfWeek,
    ),
  }),
)

// Audit trail for every admin-driven change to a member's Credits Remaining
// (increases AND decreases) — the "Set pack credit balance" admin tool.
// Airtable only stores the live number, so this is the only record of who
// changed it, when, and what it was before/after.
export const creditAdjustment = pgTable(
  "credit_adjustment",
  {
    id: text("id").primaryKey(),
    memberRecordId: text("memberRecordId").notNull(), // Airtable Members record id
    userId: text("userId"),
    memberEmail: text("memberEmail"),
    adminEmail: text("adminEmail").notNull(),
    previousCredits: doublePrecision("previousCredits").notNull(),
    newCredits: doublePrecision("newCredits").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    memberIdx: index("credit_adjustment_member_idx").on(t.memberRecordId),
  }),
)
