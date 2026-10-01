import { Resend } from "resend"
import nodemailer from "nodemailer"

const REPLY_TO = "collegedanceprep@gmail.com"
const FROM_RESEND = "College Dance Prep <noreply@collegedanceprep.com>"
const FROM_GMAIL = process.env.GMAIL_FROM ?? ""
const YEAR = new Date().getFullYear()
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.collegedanceprep.com"

// Use Resend when the domain is verified; fall back to Gmail SMTP in the meantime.
// Flip RESEND_DOMAIN_VERIFIED=true in Vercel once resend.com shows the domain as Active.
const USE_RESEND = process.env.RESEND_DOMAIN_VERIFIED === "true"

function getResend() {
  return new Resend(process.env.Resend_Key)
}

function getGmailTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_FROM, pass: process.env.GMAIL_APP_PASSWORD },
  })
}

export async function sendEmail({
  to,
  subject,
  html,
  cc,
}: {
  to: string | string[]
  subject: string
  html: string
  cc?: string | string[]
}) {
  if (USE_RESEND) {
    if (!process.env.Resend_Key) return
    const resend = getResend()
    await resend.emails.send({
      from: FROM_RESEND,
      replyTo: REPLY_TO,
      to: Array.isArray(to) ? to : [to],
      ...(cc ? { cc: Array.isArray(cc) ? cc : [cc] } : {}),
      subject,
      html,
    })
  } else {
    if (!process.env.GMAIL_FROM || !process.env.GMAIL_APP_PASSWORD) return
    const transport = getGmailTransport()
    await transport.sendMail({
      from: FROM_GMAIL,
      replyTo: REPLY_TO,
      to: Array.isArray(to) ? to.join(", ") : to,
      ...(cc ? { cc: Array.isArray(cc) ? cc.join(", ") : cc } : {}),
      subject,
      html,
    })
  }
}

function emailBase(subtitle: string, bodyHtml: string) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7;">
      <!-- header -->
      <tr><td style="background:#e91e8c;padding:28px 32px 24px;text-align:center;">
        <div style="color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.3px;margin-bottom:2px">College Dance Prep</div>
        <div style="color:rgba(255,255,255,0.8);font-size:13px">${subtitle}</div>
      </td></tr>
      <!-- body -->
      <tr><td style="padding:28px 32px">${bodyHtml}</td></tr>
      <!-- footer -->
      <tr><td style="padding:16px 32px 24px;text-align:center;font-size:12px;color:#9ca3af">
        &copy; ${YEAR} College Dance Prep &middot; ${REPLY_TO}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

/** Returns the first name from a full name, or the local part of an email. */
function firstName(nameOrEmail: string): string {
  if (!nameOrEmail) return "there"
  if (nameOrEmail.includes("@")) return nameOrEmail.split("@")[0]
  return nameOrEmail.split(" ")[0]
}

function sessionTable(rows: { label: string; value: string }[]) {
  const rowHtml = rows.map(({ label, value }, i) => {
    const last = i === rows.length - 1
    return `<tr>
      <td style="padding:8px 0;color:#6b7280;font-size:14px;${last ? "" : "border-bottom:1px solid #f3f4f6"}">${label}</td>
      <td style="padding:8px 0;color:#111827;font-weight:600;font-size:14px;text-align:right;${last ? "" : "border-bottom:1px solid #f3f4f6"}">${value}</td>
    </tr>`
  }).join("")
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:4px 16px;margin:20px 0">
      ${rowHtml}
    </table>`
}

export function newMemberPendingEmail({
  memberName,
  memberEmail,
  reviewUrl,
}: {
  memberName: string
  memberEmail: string
  reviewUrl: string
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">A new member has signed up and is waiting for your approval.</p>
    ${sessionTable([
      { label: "Name", value: memberName },
      { label: "Email", value: memberEmail },
    ])}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
      <tr><td>
        <a href="${reviewUrl}" style="display:block;text-align:center;background:#e91e8c;color:#ffffff;font-size:14px;font-weight:600;padding:12px 0;border-radius:8px;text-decoration:none">
          Review in Admin Panel
        </a>
      </td></tr>
    </table>`
  return {
    subject: `New member pending approval — ${memberName}`,
    html: emailBase("New member request", body),
  }
}

export function bookingConfirmationEmail({
  dancerName,
  prepMasterName,
  date,
  time,
}: {
  dancerName: string
  prepMasterName: string
  date: string
  time: string
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(dancerName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px">Your booking request has been submitted! Here are the details:</p>
    ${sessionTable([
      { label: "PrepMaster", value: prepMasterName },
      { label: "Date", value: date },
      { label: "Time", value: time },
    ])}
    <div style="font-size:13px;color:#6b7280;background:#f9fafb;border-left:3px solid #e91e8c;border-radius:0 6px 6px 0;padding:10px 14px;line-height:1.5">
      Your booking is pending confirmation from your PrepMaster. You will receive an email notification once they have confirmed your booking request.
    </div>`
  return {
    subject: `Booking request received — ${date} at ${time}`,
    html: emailBase("Booking request received", body),
  }
}

export function prepMasterBookingRequestEmail({
  prepMasterName,
  dancerName,
  dancerEmail,
  date,
  time,
  notes,
  approveUrl,
  denyUrl,
}: {
  prepMasterName: string
  dancerName: string
  dancerEmail: string
  date: string
  time: string
  notes?: string
  approveUrl: string
  denyUrl: string
}) {
  const rows = [
    { label: "Member", value: `${dancerName} (${dancerEmail})` },
    { label: "Date", value: date },
    { label: "Time", value: time },
    ...(notes ? [{ label: "Notes", value: notes }] : []),
  ]
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(prepMasterName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px">You have a new session request from <strong>${dancerName}</strong>.</p>
    ${sessionTable(rows)}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
      <tr>
        <td style="padding-right:8px">
          <a href="${approveUrl}" style="display:block;text-align:center;background:#e91e8c;color:#ffffff;font-size:14px;font-weight:600;padding:12px 0;border-radius:8px;text-decoration:none">
            Approve
          </a>
        </td>
        <td style="padding-left:8px">
          <a href="${denyUrl}" style="display:block;text-align:center;background:#f3f4f6;color:#374151;font-size:14px;font-weight:600;padding:12px 0;border-radius:8px;text-decoration:none">
            Deny
          </a>
        </td>
      </tr>
    </table>
    <div style="font-size:13px;color:#6b7280;background:#f9fafb;border-left:3px solid #e91e8c;border-radius:0 6px 6px 0;padding:10px 14px;line-height:1.5">
      Approving will confirm the booking and notify the member. Denying will cancel it and refund their credit.
    </div>`
  return {
    subject: `New booking request — ${dancerName} on ${date} at ${time}`,
    html: emailBase("New booking request", body),
  }
}

export function bookingCancelledEmail({
  dancerName,
  prepMasterName,
  date,
  time,
  creditRefunded,
}: {
  dancerName: string
  prepMasterName: string
  date: string
  time: string
  creditRefunded: boolean
}) {
  const creditBlock = creditRefunded
    ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 14px;font-size:13px;color:#15803d;font-weight:500;margin-top:16px">
        ✓ Your credit has been returned to your account.
       </div>`
    : `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:10px 14px;font-size:13px;color:#92400e;font-weight:500;margin-top:16px">
        ⚠ Cancelled within 24 hours — no credit was refunded per our cancellation policy.
       </div>`
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(dancerName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px">Your session has been cancelled. Here's a summary:</p>
    ${sessionTable([
      { label: "PrepMaster", value: prepMasterName },
      { label: "Date", value: date },
      { label: "Time", value: time },
    ])}
    ${creditBlock}`
  return {
    subject: `Session cancelled — ${date} at ${time}`,
    html: emailBase("Session cancelled", body),
  }
}

export function bookingUpdatedEmail({
  recipientName,
  updatedByName,
  updatedByRole,
  date,
  time,
  notes,
}: {
  recipientName: string
  updatedByName: string
  updatedByRole: "member" | "PrepMaster"
  date: string
  time: string
  notes?: string
}) {
  const counterpartLabel = updatedByRole === "PrepMaster" ? "PrepMaster" : "Member"
  const rows = [
    { label: counterpartLabel, value: updatedByName },
    { label: "Date", value: date },
    { label: "Time", value: time },
    ...(notes ? [{ label: "Notes", value: notes }] : []),
  ]
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(recipientName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px">Your session has been rescheduled by <strong>${updatedByName}</strong>. Here are the updated details:</p>
    ${sessionTable(rows)}
    <div style="font-size:13px;color:#6b7280;background:#f9fafb;border-left:3px solid #e91e8c;border-radius:0 6px 6px 0;padding:10px 14px;line-height:1.5">
      If you have any questions about this change, reply to this email.
    </div>`
  return {
    subject: `Session rescheduled — ${date} at ${time}`,
    html: emailBase("Session rescheduled", body),
  }
}

export async function sendPasswordResetEmail({ name, email, url }: { name: string; email: string; url: string }) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(name ?? email)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 24px">We received a request to reset your password. Click the button below — this link expires in 4 hours.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${url}" style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-weight:600;font-size:15px">
        Reset password
      </a>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">If you didn't request this, you can safely ignore this email.</p>`
  await sendEmail({
    to: email,
    subject: "Reset your password",
    html: emailBase("Password reset", body),
  })
}

export function parentInviteEmail({ childName, parentEmail }: { childName: string; parentEmail: string }) {
  const joinUrl = `${APP_URL}/join?email=${encodeURIComponent(parentEmail)}&child=${encodeURIComponent(childName)}`
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi there,</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      You've been added as a parent or guardian for <strong>${childName}</strong> on College Dance Prep.
      Click the button below to create your account — your email is already pre-filled and linked to ${childName}'s profile.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${joinUrl}" style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-weight:600;font-size:15px">
        Create your account
      </a>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      Just set a password and you&apos;re in. Reply to this email if you have any questions.
    </p>`
  return {
    subject: `You've been added as a parent on College Dance Prep`,
    html: emailBase("Parent access", body),
  }
}

export function accountApprovedEmail({
  memberName,
  dashboardUrl,
}: {
  memberName: string
  dashboardUrl: string
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(memberName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      Great news — your College Dance Prep account has been approved! You can now log in and book private sessions with our PrepMasters.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dashboardUrl}" style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-weight:600;font-size:15px">
        Go to your dashboard
      </a>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      Questions? Reply to this email and we'll be happy to help.
    </p>`
  return {
    subject: "Your College Dance Prep account has been approved!",
    html: emailBase("Account approved", body),
  }
}

export function parentAccountApprovedEmail({
  childName,
  parentEmail,
  dashboardUrl,
}: {
  childName: string
  parentEmail: string
  dashboardUrl: string
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi there,</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      <strong>${childName}</strong>'s College Dance Prep account has been approved. As their parent or guardian, you can log in with your email (<strong>${parentEmail}</strong>) to view bookings and session history.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${dashboardUrl}" style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-weight:600;font-size:15px">
        View ${childName}'s account
      </a>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      Questions? Reply to this email and we'll be happy to help.
    </p>`
  return {
    subject: `${childName}'s College Dance Prep account has been approved`,
    html: emailBase("Account approved", body),
  }
}

export function accountDeniedEmail({ memberName }: { memberName: string }) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(memberName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      Thank you for your interest in College Dance Prep. Unfortunately, we were unable to approve your account request at this time.
    </p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0">
      If you believe this is a mistake or have questions, please reach out to us at <a href="mailto:collegedanceprep@gmail.com" style="color:#e91e8c;text-decoration:none">collegedanceprep@gmail.com</a> and we'll be happy to help.
    </p>`
  return {
    subject: "Update on your College Dance Prep account request",
    html: emailBase("Account request update", body),
  }
}

export function signupReceivedEmail({ memberName }: { memberName: string }) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(memberName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      Thanks for signing up for College Dance Prep! We've received your account request and our team will review it shortly.
    </p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      You'll receive another email as soon as your account is approved — usually within 24 hours.
    </p>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      Questions in the meantime? Reply to this email and we'll be happy to help.
    </p>`
  return {
    subject: "We received your College Dance Prep sign-up",
    html: emailBase("Sign-up received", body),
  }
}

export function duplicateAccountWarningEmail({
  memberName,
  existingEmail,
  mergeUrl,
}: {
  memberName: string
  existingEmail: string
  mergeUrl: string
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(memberName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      We noticed that an account with the name <strong>${memberName}</strong> already exists at
      <strong>${existingEmail}</strong>.
    </p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      If that's you, you may have accidentally created a duplicate account by signing in with Apple.
      Click below to link your accounts — you'll sign in with your original password, and Apple Sign-In
      will be added to that account so you can use either going forward.
    </p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      <a href="${mergeUrl}" style="display:inline-block;background:#111827;color:#fff;font-size:14px;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none">
        Link my accounts
      </a>
    </p>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      If you don't recognize this or it doesn't apply to you, you can safely ignore this email.
      Questions? Reply and we'll sort it out.
    </p>`
  return {
    subject: "Heads up — a duplicate account may have been created",
    html: emailBase("Duplicate account detected", body),
  }
}

export function prepMasterApprovedEmail({
  prepMasterName,
  portalUrl,
}: {
  prepMasterName: string
  portalUrl: string
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(prepMasterName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      Your College Dance Prep PrepMaster account has been approved! You can now access the PrepMaster portal to manage your availability and sessions.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${portalUrl}" style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-weight:600;font-size:15px">
        Go to your portal
      </a>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      Questions? Reply to this email and we'll be happy to help.
    </p>`
  return {
    subject: "Your College Dance Prep PrepMaster account is approved!",
    html: emailBase("PrepMaster account approved", body),
  }
}

export function purchaseReceiptEmail({
  memberName,
  planName,
  creditAmount,
  pricePaid,
  newBalance,
}: {
  memberName: string
  planName: string
  creditAmount: number
  pricePaid: number
  newBalance: number
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(memberName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px">Thank you for your purchase! Here's your receipt:</p>
    ${sessionTable([
      { label: "Plan", value: planName },
      { label: "Credits added", value: String(creditAmount) },
      { label: "Amount paid", value: `$${pricePaid.toFixed(2)}` },
      { label: "New credit balance", value: String(newBalance) },
    ])}
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      Your credits are now available — head to the app to book your sessions. Reply to this email if you have any questions about your purchase.
    </p>`
  return {
    subject: `Purchase confirmed — ${planName}`,
    html: emailBase("Purchase confirmed", body),
  }
}

export function bookingConfirmedByPmEmail({
  dancerName,
  prepMasterName,
  date,
  time,
}: {
  dancerName: string
  prepMasterName: string
  date: string
  time: string
}) {
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(dancerName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px">Great news — <strong>${prepMasterName}</strong> has confirmed your session!</p>
    ${sessionTable([
      { label: "PrepMaster", value: prepMasterName },
      { label: "Date", value: date },
      { label: "Time", value: time },
    ])}
    <div style="font-size:13px;color:#6b7280;background:#f9fafb;border-left:3px solid #e91e8c;border-radius:0 6px 6px 0;padding:10px 14px;line-height:1.5">
      See you there! Need to cancel? Please do so at least 24 hours in advance to get your credit back.
    </div>`
  return {
    subject: `Session confirmed — ${date} at ${time}`,
    html: emailBase("Session confirmed", body),
  }
}

export function bookingDeclinedByPmEmail({
  dancerName,
  prepMasterName,
  date,
  time,
  customNote,
}: {
  dancerName: string
  prepMasterName: string
  date: string
  time: string
  customNote?: string
}) {
  const note = customNote ?? `<strong>${prepMasterName}</strong> was unable to accommodate your booking request. Your credit has been refunded.`
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(dancerName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px">${note}</p>
    ${sessionTable([
      { label: "PrepMaster", value: prepMasterName },
      { label: "Date", value: date },
      { label: "Time", value: time },
    ])}
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      You can book another session at any time through the app. Reply to this email if you have questions.
    </p>`
  return {
    subject: `Booking declined — ${date} at ${time}`,
    html: emailBase("Booking declined", body),
  }
}

export function portalBookedEmail({
  dancerName,
  prepMasterName,
  date,
  time,
  sessionType,
}: {
  dancerName: string
  prepMasterName: string
  date: string
  time: string
  sessionType?: string
}) {
  const rows = [
    { label: "PrepMaster", value: prepMasterName },
    { label: "Date", value: date },
    { label: "Time", value: time },
    ...(sessionType ? [{ label: "Session type", value: sessionType }] : []),
  ]
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${firstName(dancerName)},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px"><strong>${prepMasterName}</strong> has scheduled a session for you. Here are the details:</p>
    ${sessionTable(rows)}
    <div style="font-size:13px;color:#6b7280;background:#f9fafb;border-left:3px solid #e91e8c;border-radius:0 6px 6px 0;padding:10px 14px;line-height:1.5">
      This session is already confirmed. Need to cancel? Please do so at least 24 hours in advance to get your credit back.
    </div>`
  return {
    subject: `Session scheduled — ${date} at ${time}`,
    html: emailBase("Session scheduled", body),
  }
}

export function prepMasterInviteEmail({ name, email }: { name: string; email: string }) {
  const joinUrl = `${APP_URL}/prep?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`
  const body = `
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${name},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px">
      You've been invited to join College Dance Prep as a PrepMaster.
      Click the button below to create your account — your email and name are already pre-filled.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${joinUrl}" style="display:inline-block;background:#e91e8c;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:6px;font-weight:600;font-size:15px">
        Set up your account
      </a>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:0">
      Just set a password and you&apos;re in. Reply to this email if you have any questions.
    </p>`
  return {
    subject: `You're invited to join College Dance Prep as a PrepMaster`,
    html: emailBase("PrepMaster invite", body),
  }
}
