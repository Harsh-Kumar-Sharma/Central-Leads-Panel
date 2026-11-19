# Central Leads Panel: Phase 2 Specification (Notifications)

This is an add-on to the Phase 1 app (`CENTRAL_LEADS_PANEL_SPEC.md`). Phase 1 is already built: Node.js + Express + MySQL backend, Vue 3 dashboard, JWT auth, roles (`super_admin`, `manager`, `viewer`), site-scoped access via `user_sites`, and the ingest API `POST /api/v1/leads`.

Read the existing code first and follow its conventions (folder structure, validation with zod, auth middleware, `getAllowedSiteIds(user)` helper, Pinia stores, Axios client). Do not rewrite Phase 1; extend it.

## 1. Goal

When a new lead arrives, notify people in two ways:
1. **In-app:** a bell icon in the dashboard with an unread count, a live popup (toast) when a new lead arrives, and a notification list.
2. **Email:** send an email via SMTP. SMTP can be configured **globally** (one SMTP for all companies) and/or **per company**. Recipients can be configured per company, plus a global recipient list that gets a copy of every company's leads.

Expected volume is very low (a few emails a month). Keep the design simple: **no Redis, no job queue, no separate worker**.

## 2. Tech

- Email: `nodemailer`.
- Real-time in-app: **Server-Sent Events (SSE)** (simpler than WebSocket; one-way server to browser is all that is needed). Fall back to polling `GET /api/notifications/unread-count` every 60 seconds if the SSE connection drops and cannot reconnect.
- Encryption of SMTP passwords: Node `crypto`, AES-256-GCM, key from a new env var `SECRET_ENCRYPTION_KEY` (32 bytes, hex or base64).
- New env var to add to `.env.example`: `SECRET_ENCRYPTION_KEY`, `APP_BASE_URL` (used to build "View lead" links in emails, e.g. `https://panel.example.com`).

## 3. Notification flow

After a lead is successfully saved in the ingest API (and only if `status != 'spam'`), call `notifyNewLead(lead)`. This must **not block or fail** the API response. Wrap it so any error is caught and logged, and the ingest API still returns 201.

`notifyNewLead(lead)` does:

1. **In-app:** create one row in `notifications` for each user who is allowed to see that lead's site (all active `super_admin` users, plus users linked in `user_sites` to `lead.site_id`), respecting each user's notification preferences (section 6). Push a real-time SSE event to those users who are currently connected.
2. **Email:** resolve the SMTP config and recipients (section 5), build the email, send it with Nodemailer, and write the result to `email_logs`. On failure, retry up to 3 times total with delays of 1 minute and 5 minutes (use `setTimeout` or a small interval check over `email_logs` rows with status `retrying`; it must also survive a server restart by picking up `retrying` rows on startup). No external queue.

Spam leads (honeypot) never trigger notifications.

## 4. Database changes (new migration `002_notifications.sql`)

```sql
-- Global key/value settings (SMTP global config, global recipients, etc.)
CREATE TABLE settings (
  `key` VARCHAR(100) PRIMARY KEY,
  value JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
-- Stored keys: 'smtp_global' (see section 5), 'global_recipients' (array of {email, mode})

-- Per-company SMTP override (one row per site, optional)
CREATE TABLE site_smtp (
  site_id INT PRIMARY KEY,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,       -- 0 = use global SMTP
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL,
  secure TINYINT(1) NOT NULL DEFAULT 0,           -- 1 for port 465
  username VARCHAR(255) NOT NULL,
  password_enc TEXT NOT NULL,                     -- AES-256-GCM encrypted
  from_name VARCHAR(150) NOT NULL,
  from_email VARCHAR(200) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- Per-company recipient list (multiple per company)
CREATE TABLE site_recipients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_id INT NOT NULL,
  email VARCHAR(200) NOT NULL,
  mode ENUM('to','cc','bcc') NOT NULL DEFAULT 'to',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_site_email (site_id, email),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- In-app notifications
CREATE TABLE notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  lead_id BIGINT NOT NULL,
  site_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  body VARCHAR(500) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_read (user_id, is_read, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- Per-user preferences
CREATE TABLE user_notification_prefs (
  user_id INT PRIMARY KEY,
  bell_enabled TINYINT(1) NOT NULL DEFAULT 1,
  site_ids JSON NULL,            -- NULL = all of the user's allowed sites; otherwise array of site ids to notify for
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Email delivery log
CREATE TABLE email_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NULL,
  site_id INT NULL,
  smtp_source ENUM('global','site') NOT NULL,
  to_addresses JSON NOT NULL,
  cc_addresses JSON NULL,
  bcc_addresses JSON NULL,
  subject VARCHAR(300) NOT NULL,
  status ENUM('pending','sent','retrying','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NULL,
  error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL,
  INDEX idx_status_next (status, next_attempt_at)
);
```

`smtp_global` value shape (stored in `settings`):
```json
{
  "enabled": true,
  "host": "smtp.example.com",
  "port": 587,
  "secure": false,
  "username": "alerts@example.com",
  "password_enc": "<encrypted>",
  "from_name": "Central Leads Panel",
  "from_email": "alerts@example.com"
}
```

`global_recipients` value shape: `[{ "email": "owner@example.com", "mode": "to" }]`.

## 5. SMTP and recipient resolution (the dynamic part)

For a lead belonging to site S:

**SMTP selection**
- If `site_smtp` for S exists and `is_enabled = 1` → use S's own SMTP (`smtp_source = 'site'`).
- Else use `smtp_global` (`smtp_source = 'global'`).
- If neither is available/enabled → skip the email, log it in `email_logs` as `failed` with error "No SMTP configured", and still do the in-app notification.

**Recipients**
- Collect active rows from `site_recipients` for S (with their To/CC/BCC mode).
- Add everything from `global_recipients` (with their mode).
- De-duplicate by email address (if the same address appears twice, prefer `to` over `cc` over `bcc`).
- If the final list has no `to` recipients, promote the first CC/BCC entry to `to`. If the list is empty, skip the email and log it.
- Send **one email per lead** with the full recipient set (not one per recipient).

**Email content**
- Subject: `[<Company name>] New <Inquiry|Quote>: <lead name>`
- Body (HTML + plain-text alternative): company name, type, name, phone, email, subject, visitor's company, full message, every key/value from `extra` (humanized labels), received time in Asia/Kolkata, source URL, and a button/link "View lead" → `${APP_BASE_URL}/leads?open=<lead_id>`.
- Escape all user-submitted values (never inject raw HTML).
- Set `replyTo` to the lead's email when present, so replying goes to the visitor.

**Security**
- SMTP passwords encrypted with AES-256-GCM before storing; decrypt only at send time. The API never returns a stored password. On read it returns `has_password: true` instead, and on update an empty/omitted password means "keep existing".
- Only `super_admin` can read or change SMTP settings and recipient lists.

## 6. Backend API

All routes require JWT.

**Notifications (any logged-in user, scoped to themselves)**
```
GET    /api/notifications?limit=20&unread_only=0   → { data: [...], unread_count }
GET    /api/notifications/unread-count             → { unread_count }
POST   /api/notifications/:id/read
POST   /api/notifications/read-all
GET    /api/notifications/stream                   → SSE stream (auth via JWT; since EventSource cannot send headers, accept the token as a query param `?token=` or use a fetch-based SSE client)
GET    /api/notifications/prefs                    → { bell_enabled, site_ids }
PUT    /api/notifications/prefs                    → update own prefs
```
- SSE: send a heartbeat comment every 25 seconds. Event name `new_lead` with data `{ notification_id, lead_id, site_id, site_name, site_color, type, name, title, body, created_at }`. Keep a map of `user_id → connections` in memory. Clean up on disconnect.
- A user must only ever receive notifications for sites they are allowed to see (re-check at creation time using the same site-scoping logic as Phase 1).

**Settings (super_admin only)**
```
GET    /api/admin/settings/smtp-global             → config without password (has_password flag)
PUT    /api/admin/settings/smtp-global
POST   /api/admin/settings/smtp-global/test        → { to } sends a test mail using the saved (or posted) config; returns success or the SMTP error message

GET    /api/admin/settings/global-recipients
PUT    /api/admin/settings/global-recipients       → array of { email, mode }

GET    /api/admin/sites/:id/smtp
PUT    /api/admin/sites/:id/smtp                   → includes is_enabled
POST   /api/admin/sites/:id/smtp/test              → { to }

GET    /api/admin/sites/:id/recipients
PUT    /api/admin/sites/:id/recipients             → replace list: array of { email, mode, is_active }

GET    /api/admin/email-logs?site_id=&status=&page=&page_size=   → paginated log
POST   /api/admin/email-logs/:id/retry             → manual retry of a failed email
```
Validate emails and ports with zod. Nodemailer transport options: `{ host, port, secure, auth: { user, pass }, connectionTimeout: 10000, socketTimeout: 15000 }`. Cache transporters in memory keyed by a hash of the config, and invalidate when settings change.

## 7. Frontend

### 7.1 Bell icon (top bar, all roles)
- Bell with red badge showing unread count (cap display at `99+`).
- Click opens a dropdown panel: latest 20 notifications, newest first. Each item shows the company badge (site colour), title (e.g. "New inquiry from Rahul Sharma"), short body, relative time. Unread items are bold with a dot.
- Clicking an item marks it read and navigates to `/leads?open=<lead_id>` (the Leads page should open the detail drawer for that id; add this query handling if it does not exist yet).
- "Mark all as read" button. Empty state: "No notifications".

### 7.2 Live popup (toast)
- On the SSE `new_lead` event: show a toast at the top-right ("New Inquiry · <Company> · <name>") that auto-dismisses after about 8 seconds, has a "View" action opening the lead, and increments the bell count immediately.
- Optional subtle notification sound, off by default (a toggle in the preferences).
- Connect SSE after login, reconnect with backoff, close on logout. If SSE fails repeatedly, fall back to polling the unread count every 60 seconds.

### 7.3 My notification settings (all roles)
A small settings page or modal from the user menu:
- Toggle: "Show bell notifications".
- Multi-select: "Notify me for these companies" (limited to the user's allowed companies; "All" by default).

### 7.4 Admin > Notification settings (super_admin only)
A new admin page with tabs:
1. **Global SMTP:** host, port, secure toggle, username, password (masked, shows "saved" state, blank = keep), from name, from email, enabled toggle. Buttons: **Save**, **Send test email** (asks for a recipient address and shows the result or the exact error).
2. **Global recipients:** list editor, add/remove emails, each with To/CC/BCC selector. Help text: "These people receive a copy of every company's leads."
3. **Companies:** for each company (accordion or a company dropdown):
   - Recipients list editor (email, To/CC/BCC, active toggle).
   - Switch "Use a separate SMTP for this company". When ON, show the same SMTP fields as global plus a **Send test email** button. When OFF, show a note "Using global SMTP".
   - A small status line: which SMTP will be used (Global / Company) and the final resolved recipient list (company + global, de-duplicated) as a preview.
4. **Email log:** table of recent emails (time, company, subject, recipients, SMTP source, status, attempts, error) with filters for company and status, and a "Retry" button for failed rows.

## 8. Behaviour details and edge cases

- Ingest API response time must not depend on SMTP. Trigger `notifyNewLead` after the DB insert, not awaited, with a catch-all error handler.
- On server start, find `email_logs` rows with status `pending` or `retrying` and `next_attempt_at <= now` (or null) and process them. Also run a light check every minute for due `retrying` rows.
- Retry schedule: attempt 1 immediately, attempt 2 after 1 minute, attempt 3 after 5 minutes. After that, status `failed`.
- If a user is deactivated or loses access to a site, they stop receiving notifications for it; old notifications for sites they can no longer access must not be returned by the API.
- Notifications older than 90 days may be cleaned up by a simple daily job (optional).
- All times shown in Asia/Kolkata.
- Do not include SMTP passwords or `raw_payload` in any email or log.

## 9. Build order

1. Migration `002_notifications.sql`, encryption helper, env additions.
2. Settings and SMTP APIs (global, per-site, recipients) with test-mail endpoints.
3. Email service: transporter cache, SMTP and recipient resolution, HTML/plain template, `email_logs` writing, retry logic and startup recovery.
4. `notifyNewLead` hook wired into the ingest API (non-blocking).
5. In-app notifications: table writes, REST endpoints, SSE stream, user prefs.
6. Frontend: bell, dropdown, toast, SSE client with polling fallback, `?open=` handling on the Leads page.
7. Frontend: user notification settings.
8. Frontend: Admin > Notification settings (all four tabs).
9. README update: how to configure SMTP (Gmail/Workspace app password notes, port 587 vs 465), env variables, and how to test.

## 10. Acceptance criteria

- Submitting a lead from a site creates in-app notifications only for users allowed to see that site (super admins plus assigned users), and the bell count updates live for connected users without a refresh.
- A user assigned only to Company A never receives or can fetch notifications for Company B.
- With only the global SMTP configured, a lead from any company sends one email to that company's recipients plus the global recipients, de-duplicated.
- With a company-specific SMTP enabled for Company A, Company A's leads use that SMTP, while other companies still use the global one.
- With no SMTP configured, the lead is still saved, the in-app notification still works, and the email log shows a clear failure.
- If the SMTP server is down, the ingest API still responds 201 quickly, the email is retried up to the limit, and the final state is visible in the email log; failed mails can be retried manually.
- "Send test email" works for global and per-company SMTP and shows the real error message on failure.
- SMTP passwords are never returned by any API and are stored encrypted.
- A viewer or manager cannot access any `/api/admin/*` settings endpoint.
- A user can turn off bell notifications or limit them to chosen companies, and this takes effect for new leads.
