# Central Leads Panel: Build Specification

Build a complete, working app as described below. Read the whole spec first, then build it in the order given in section 14.

## 1. Goal

The owner has 12 company websites. Each has a Contact/Inquiry form and/or a "Get a Quote" form. Instead of configuring SMTP on every site, every website will POST its form data to ONE central API. The central panel stores all leads and shows them in a dashboard, labelled by which website (company) each lead came from.

Two parts:
1. **Backend**: Node.js (Express) + MySQL. Public ingest API for websites + authenticated REST API for the dashboard.
2. **Frontend**: Vue 3 (Vite) admin dashboard.

## 2. Tech stack

- Backend: Node.js 20+, Express, `mysql2` (promise), `jsonwebtoken`, `bcrypt`, `zod` (validation), `helmet`, `cors`, `express-rate-limit`, `dotenv`, `exceljs` or `csv-stringify` for export.
- Database: MySQL 8 (JSON column support required).
- Frontend: Vue 3 + Vite + Vue Router + Pinia + Axios. UI: Tailwind CSS (or PrimeVue). Charts: Chart.js (vue-chartjs).
- Everything configured via `.env` (see section 13).

## 3. Standard lead payload (common for all websites)

The forms on the websites differ (some have First/Last name, some have Mobile, some have Subject, one has Company, one has "Project location and scope"). All sites must map their form to this one format:

```json
{
  "type": "inquiry",
  "name": "Rahul Sharma",
  "email": "rahul@example.com",
  "phone": "9876543210",
  "subject": "Operating lease enquiry",
  "company": "ABC Airlines",
  "message": "Full message text",
  "extra": {
    "project_location_and_scope": "Delhi, 5 acre"
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `inquiry` or `quote` |
| `name` | yes | If the site has First/Last, the site joins them before sending. Trim, max 200 chars |
| `email` | conditional | Valid email if present |
| `phone` | conditional | Digits, spaces, `+`, `-`, `()` allowed, max 30 chars |
| `subject` | no | max 255 |
| `company` | no | The *visitor's* company (not our site). max 200 |
| `message` | no | max 5000 chars |
| `extra` | no | Object of any additional key/value pairs (flat strings/numbers/booleans). Max 20 keys, each value max 2000 chars |
| `website` | honeypot | Hidden field. If non-empty, treat as spam (see section 9) |

**Validation rule:** `name` is required AND at least one of `email` or `phone` must be present. Unknown top-level fields must not cause an error: move them into `extra`.

**Always store `raw_payload`:** the full original request body, untouched, in a JSON column, so nothing is ever lost even if mapping is imperfect.

### Example forms this must support (from the owner's screenshots)

1. Contact Us: First/Last name, Mobile No., Email, Comment or Message
2. Get a free Quote: First/Last, Mobile No., Email, Subject, Comment or Message
3. Name, Email, Mobile, Message
4. Name, Email, Message ("Send enquiry")
5. Full Name, Company (optional), Business Email, Subject, Message (aircraft leasing site)
6. Name, Email, "Project location and scope" (goes into `extra.project_location_and_scope`)

## 4. Public ingest API

```
POST /api/v1/leads
Headers:
  Content-Type: application/json
  X-Site-Key: <the site's own API key>
Body: standard payload (section 3)

201 → { "success": true, "id": 123 }
400 → { "success": false, "errors": { "field": "message" } }
401 → invalid or missing key
403 → site inactive, or Origin not allowed
429 → rate limited
```

Behaviour:
- Look up the site by `X-Site-Key`. Reject if not found or `is_active = 0`.
- **Origin check:** if the request has an `Origin` header and the site has `allowed_origins` configured, it must match one of them. (Server-to-server calls without Origin are allowed.)
- **CORS:** respond with `Access-Control-Allow-Origin` set to the matching allowed origin only (handle `OPTIONS` preflight). Not `*`.
- Validate with zod, store the lead, save server-side data: `source_url` (from `Referer` or an optional `source_url` field), `ip`, `user_agent`.
- Rate limit: 10 requests/minute per IP per site key; also a global limit.
- Honeypot: if `website` field is non-empty, save the lead with `status = 'spam'` and still return 201 (so bots don't learn).
- Response must be fast and never leak internal errors.

## 5. Database schema (MySQL 8)

```sql
CREATE TABLE sites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',      -- badge colour in UI
  api_key VARCHAR(80) NOT NULL UNIQUE,
  allowed_origins JSON NULL,                         -- e.g. ["https://example.com","https://www.example.com"]
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('super_admin','manager','viewer') NOT NULL DEFAULT 'viewer',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- many-to-many: which sites a user can see. Super admin ignores this table.
CREATE TABLE user_sites (
  user_id INT NOT NULL,
  site_id INT NOT NULL,
  PRIMARY KEY (user_id, site_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE leads (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  site_id INT NOT NULL,
  type ENUM('inquiry','quote') NOT NULL,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) NULL,
  phone VARCHAR(30) NULL,
  subject VARCHAR(255) NULL,
  company VARCHAR(200) NULL,
  message TEXT NULL,
  extra JSON NULL,
  raw_payload JSON NOT NULL,
  source_url VARCHAR(500) NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(300) NULL,
  status ENUM('new','contacted','followup','closed','spam') NOT NULL DEFAULT 'new',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id),
  INDEX idx_site_created (site_id, created_at),
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_created (created_at),
  FULLTEXT INDEX ft_search (name, email, phone, message)
);

CREATE TABLE lead_notes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

Provide a migration script (`npm run migrate`) and a seed script (`npm run seed`) that creates the first super admin from `.env` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`) and a couple of demo sites.

API keys: generate with `crypto.randomBytes(32).toString('hex')`, prefix `sk_`. Show the full key to the super admin (with a copy button); allow "Regenerate key".

## 6. Roles and access control

| Role | Can do |
|---|---|
| `super_admin` | Everything: all sites, manage sites and API keys, manage users and their site assignments, view/edit all leads |
| `manager` | See leads of assigned sites only. Change status, add notes, export |
| `viewer` | See leads of assigned sites only. Read-only (no status change, no notes). Export allowed |

Rules:
- A user can be assigned to **one or many** sites (via `user_sites`). Super admin sees all.
- **Enforce site scoping in the backend on every query** (lists, detail, stats, export, status update, notes). Never rely on the frontend to hide data. Requesting a lead from a non-assigned site returns 404.
- A `manager`/`viewer` with zero assigned sites sees an empty state, not an error.
- Implement as reusable middleware/helper: `getAllowedSiteIds(user)` returns `null` for super admin (no restriction) or an array of ids.

## 7. Authentication

- `POST /api/auth/login` (email + password) → JWT access token (e.g. 12h) returned in response; frontend stores it and sends `Authorization: Bearer`.
- Passwords hashed with bcrypt (cost 12). Minimum password length 8.
- Rate limit login (5 attempts / 15 min / IP+email).
- `GET /api/auth/me`, `POST /api/auth/change-password`.
- Inactive users cannot log in.

## 8. Dashboard REST API (all require JWT, all site-scoped)

```
GET    /api/stats/overview            → { today, this_week, this_month, new_unread, by_type }
GET    /api/stats/daily?days=30       → [{ date, count }]
GET    /api/stats/by-site?range=month → [{ site_id, site_name, color, count }]

GET    /api/leads                     → paginated list (filters below)
GET    /api/leads/:id                 → full lead incl. extra, raw_payload, notes[]; marks is_read = 1
PATCH  /api/leads/:id                 → { status }   (manager, super_admin)
POST   /api/leads/:id/notes           → { note }     (manager, super_admin)
GET    /api/leads/export              → CSV/XLSX of current filters (?format=csv|xlsx)

GET    /api/sites                     → sites visible to this user (id, name, color, domain)

# super_admin only
POST   /api/admin/sites               PUT /api/admin/sites/:id
POST   /api/admin/sites/:id/regenerate-key
GET    /api/admin/users               POST /api/admin/users
PUT    /api/admin/users/:id           (name, role, is_active, site_ids[], optional new password)
```

### `GET /api/leads` query params

- `site_ids` (comma separated; intersected with user's allowed sites)
- `type` (`inquiry|quote`)
- `status` (comma separated)
- `from`, `to` (ISO dates, inclusive)
- `q` (search across name, email, phone, message, subject, company, using LIKE or FULLTEXT)
- `sort` (`created_at|name|status|site`), `order` (`asc|desc`), default `created_at desc`
- `page`, `page_size` (default 25, max 100)
- Response: `{ data: [...], total, page, page_size }`
- By default exclude `status = 'spam'` unless the status filter explicitly includes it.

## 9. Spam protection (v1)

- Honeypot field `website` (see section 4).
- Per-IP+key rate limiting.
- Max body size 100 KB.
- Spam leads stored with `status = 'spam'`, hidden by default, never deleted automatically.

## 10. Frontend pages (Vue 3)

Layout: left sidebar (Dashboard, Leads, Admin section visible only to super admin), top bar with user name + logout. Responsive; works on mobile.

### 10.1 Login
Email + password. Redirect to Dashboard.

### 10.2 Dashboard (home)
- Stat cards: **Today**, **This week**, **This month**, **New (unread / status new)**.
- Chart 1: line/bar, leads per day for last 30 days.
- Chart 2: leads per company (site), using each site's colour.
- Optional small split: inquiry vs quote.
- All numbers limited to the user's assigned sites.

### 10.3 Leads list (main page)
Table columns:
- **Company badge** (site name, coloured with the site's `color`)
- Type (Inquiry / Quote chip)
- Name
- Phone (blank if none)
- Email
- Message preview (first ~80 chars)
- Date/time (relative + tooltip with exact, shown in Asia/Kolkata)
- Status chip

Behaviour:
- Unread (`is_read = 0`) rows shown in **bold** with a dot.
- Click row → opens detail side drawer.
- Sorting on column headers, server-side pagination.

Filters (above the table, persisted in URL query so they survive refresh):
- Company: **multi-select**
- Type
- Status (multi-select)
- Date range: Today, Yesterday, This week, This month, Custom range
- Search box (name, phone, email, message), debounced 400 ms
- "Clear filters" button
- Export button (CSV and Excel) exporting the currently filtered result

### 10.4 Lead detail drawer
- Header: company badge, type, status, received time, source URL (link).
- Standard fields: name, phone, email, subject, visitor's company, message (full).
- **Extra data section:** render every key/value in `extra` automatically as a labelled list (humanize keys, e.g. `project_location_and_scope` → "Project Location And Scope"). No code change needed when new fields appear.
- Quick actions: call (`tel:`), WhatsApp (`https://wa.me/<digits>`; if no country code and 10 digits, assume `91`), email (`mailto:`).
- Status dropdown (New, Contacted, Follow up, Closed, Spam), hidden/disabled for viewers.
- Notes: list (author, time) + add-note box, hidden for viewers.
- Collapsible "Raw payload" (JSON view) at the bottom.

### 10.5 Admin (super admin only)
- **Sites:** table + add/edit form (name, domain, colour picker, allowed origins, active toggle). Show API key with copy button, "Regenerate key" with confirmation. Show a ready-to-copy integration snippet for the selected site (section 12).
- **Users:** table + add/edit form: name, email, password, role, active toggle, **multi-select of assigned sites** (hidden/ignored for super_admin).

## 11. Status values

`new` (New), `contacted` (Contacted), `followup` (Follow up), `closed` (Closed), `spam` (Spam).

## 12. Integration snippets (shown in Admin > Sites, and in README)

**Plain HTML / JavaScript (browser):**
```html
<script>
document.querySelector('#contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = {
    type: 'inquiry',
    name: (f.get('first_name') + ' ' + (f.get('last_name') || '')).trim(),
    email: f.get('email'),
    phone: f.get('mobile'),
    message: f.get('message'),
    website: f.get('website') || ''   // honeypot (hidden input)
  };
  const res = await fetch('https://YOUR-PANEL-DOMAIN/api/v1/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Site-Key': 'SITE_KEY_HERE' },
    body: JSON.stringify(body)
  });
  // show success / error message to visitor
});
</script>
```

**PHP / WordPress (server to server, preferred because the key stays private):**
```php
$resp = wp_remote_post('https://YOUR-PANEL-DOMAIN/api/v1/leads', [
  'headers' => ['Content-Type' => 'application/json', 'X-Site-Key' => 'SITE_KEY_HERE'],
  'body'    => wp_json_encode([
    'type' => 'inquiry', 'name' => $name, 'email' => $email,
    'phone' => $phone, 'message' => $message
  ]),
  'timeout' => 10,
]);
```

**Node / Next.js server:** same request using `fetch` from the server route.

Note for README: a key used directly in browser JavaScript is visible to visitors, so it is protected only by the Origin check and rate limits. Server-side sending is more secure where possible.

## 13. Project structure and config

```
central-leads-panel/
  backend/
    src/
      app.js, server.js
      config/db.js, config/env.js
      middleware/auth.js, siteKey.js, rateLimit.js, errorHandler.js
      routes/ingest.js, auth.js, leads.js, stats.js, sites.js, admin.js
      services/leadService.js, statsService.js, exportService.js
      validators/leadSchema.js
    migrations/001_init.sql
    scripts/migrate.js, seed.js
    package.json, .env.example
  frontend/
    src/ (views, components, stores, router, api)
    package.json, vite.config.js
  README.md
```

`.env.example`:
```
PORT=4000
DB_HOST=localhost
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=central_leads
JWT_SECRET=change-me
JWT_EXPIRES_IN=12h
CORS_PANEL_ORIGIN=http://localhost:5173
SEED_ADMIN_NAME=Super Admin
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=ChangeMe123!
TZ=Asia/Kolkata
```

Use parameterized queries everywhere (no string-built SQL). Never return `password_hash` or other users' data. Sanitize/escape output in the UI (render messages as plain text, never raw HTML).

## 14. Build order

1. Backend skeleton, env, DB connection, migration + seed.
2. Auth (login, JWT middleware, role + site-scope helper).
3. Ingest API with validation, site key, origin check, rate limit, honeypot, raw_payload.
4. Leads API (list with all filters, detail, status, notes, export).
5. Stats API.
6. Admin API (sites, users, key regeneration).
7. Frontend: login, layout, router guards.
8. Frontend: leads list + filters + drawer.
9. Frontend: dashboard cards and charts.
10. Frontend: admin pages (sites with snippet, users with site assignment).
11. README with setup, deployment (PM2 + Nginx notes), and integration guide.
12. Test with curl/Postman: ingest from at least 3 differently shaped payloads, check site scoping with two users who have different assigned sites.

## 15. Acceptance criteria

- A POST with a valid key and a minimal payload (`type`, `name`, `phone`) creates a lead visible in the panel under the right company.
- A payload with unknown extra fields saves successfully; those fields appear in the drawer's Extra section, and the original body is in `raw_payload`.
- A user assigned only to Company A can never see, fetch by id, count, or export leads from Company B.
- A user assigned to several companies sees only those, and the company filter lists only those.
- Viewer cannot change status or add notes (blocked in the API, not just hidden in the UI).
- Regenerating a site's key immediately invalidates the old one.
- Filters (company multi-select, type, status, date range, search) work together and are reflected in the exported file.
- Honeypot-filled and rate-limited submissions behave as described.

## 16. Out of scope for v1 (phase 2)

Email/WhatsApp notifications on new leads, in-app notification bell, audit log, lead assignment to individual staff, follow-up reminders/dates, 2FA. Keep the code structured so these can be added later (for example a `notify(lead)` hook called after a lead is saved, currently a no-op).
