# Central Leads Panel

One central API and dashboard for the contact / quote forms of all company websites.
Every website POSTs its form data to this panel. Leads are stored in MySQL and shown in a dashboard, labelled by the website (company) they came from.

- **Backend:** Node.js 20+, Express, MySQL 8 (`backend/`)
- **Frontend:** Vue 3 + Vite + Tailwind + Chart.js (`frontend/`)
- **Production:** PM2 (API) + Nginx (static dashboard + reverse proxy)

Full specification: [docs/CENTRAL_LEADS_PANEL_SPEC.md](docs/CENTRAL_LEADS_PANEL_SPEC.md)

---

## 1. Local development

Requirements: Node.js 20+, a MySQL 8 database (local or remote).

```bash
# Backend
cd backend
cp .env.example .env          # fill DB_*, JWT_SECRET, SEED_ADMIN_*
npm install
npm run migrate               # creates tables (safe to re-run)
npm run seed                  # creates the super admin from .env + 3 demo sites
npm run seed:demo             # OPTIONAL: 120 fake leads for the charts (refuses to run in production)
npm run dev                   # http://localhost:4000 (auto-restarts on change)

# Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5180  (proxies /api to :4000)
```

Log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, then change the password under **My account**.

### Environment variables (`backend/.env`)

| Variable | Notes |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | API port (default `4000`) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL 8 connection. Use a dedicated user with rights on this database only (not `root`). |
| `JWT_SECRET` | ≥ 32 random chars. The server refuses to start in production with a weak secret. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Session length, e.g. `12h` |
| `CORS_PANEL_ORIGIN` | Dashboard origin(s), comma separated, e.g. `https://leads.example.com` |
| `TRUST_PROXY` | `1` behind Nginx (so rate limits see the real client IP), `0` otherwise. The server warns at start-up if it is `0` in production. |
| `HOST` | Interface the API listens on. Default `127.0.0.1`, so only Nginx on the same server can reach port 4000. |
| `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Used only by `npm run seed` |
| `TZ` | `Asia/Kolkata` |
| `SECRET_ENCRYPTION_KEY` | 32 bytes (64 hex chars) that encrypt stored SMTP passwords. **Required in production.** Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. If it changes, re-enter the SMTP passwords. |
| `APP_BASE_URL` | Public dashboard URL used in "View lead" email links, e.g. `https://leads.example.com` |

Recommended least-privilege MySQL user:

```sql
CREATE USER 'clp_app'@'%' IDENTIFIED BY '<strong-password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON CLP.* TO 'clp_app'@'%';
```

---

## 2. Production deployment (PM2 + Nginx)

Example: dashboard and API on one domain, `https://leads.example.com`.

### 2.1 API with PM2

```bash
npm install -g pm2
cd /var/www/central-leads-panel/backend
npm ci --omit=dev
cp .env.example .env    # NODE_ENV=production, strong JWT_SECRET, TRUST_PROXY=1,
                        # CORS_PANEL_ORIGIN=https://leads.example.com
npm run migrate
npm run seed            # first deploy only
pm2 start ecosystem.config.js
pm2 save
pm2 startup             # run the printed command so PM2 starts on boot
```

Useful: `pm2 logs central-leads-api`, `pm2 restart central-leads-api`, `pm2 status`.

> Keep **1 instance** (as in `ecosystem.config.js`): rate-limit counters are in memory. Scaling to several instances needs a shared store (e.g. Redis) for `express-rate-limit` first.

### 2.2 Dashboard build

```bash
cd /var/www/central-leads-panel/frontend
npm ci
npm run build           # output: frontend/dist
```

If the API is on a different domain than the dashboard, build with `VITE_API_BASE=https://api.example.com/api` (and set `VITE_PUBLIC_API_URL=https://api.example.com` so the integration snippets show the right URL).

### 2.3 Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name leads.example.com;

    ssl_certificate     /etc/letsencrypt/live/leads.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/leads.example.com/privkey.pem;

    client_max_body_size 100k;
    server_tokens off;

    # API (public ingest + dashboard API)
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;   # overwrite, do not append client-supplied values
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Live notifications (Server-Sent Events): must not be buffered or cut after 60s
    location = /api/notifications/stream {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        chunked_transfer_encoding on;
    }

    # Dashboard (Vue SPA)
    root /var/www/central-leads-panel/frontend/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
}

server {
    listen 80;
    server_name leads.example.com;
    return 301 https://$host$request_uri;
}
```

Get a certificate with `certbot --nginx -d leads.example.com`. Do **not** expose port 4000 or MySQL 3306 publicly; firewall them (`ufw allow 80,443/tcp`, allow 3306 only from the app server).

### 2.4 Updating

```bash
git pull
cd backend && npm ci --omit=dev && npm run migrate && pm2 restart central-leads-api   # always migrate BEFORE restarting
cd ../frontend && npm ci && npm run build
```

---

## 3. Website integration guide

1. In the panel go to **Admin → Sites → Add site** (name, domain, colour, allowed origins).
2. Open the site with **Manage** and copy its **API key** and the ready-made snippet.
3. Map the website's form fields to the standard payload and POST it.

### Endpoint

```
POST https://YOUR-PANEL-DOMAIN/api/v1/leads
Content-Type: application/json
X-Site-Key: sk_...
```

### Payload

```json
{
  "type": "inquiry",
  "name": "Rahul Sharma",
  "email": "rahul@example.com",
  "phone": "9876543210",
  "subject": "Operating lease enquiry",
  "company": "ABC Airlines",
  "message": "Full message text",
  "extra": { "project_location_and_scope": "Delhi, 5 acre" },
  "website": ""
}
```

| Field | Rule |
|---|---|
| `type` | required, `inquiry` or `quote` |
| `name` | required, max 200. Join First + Last name before sending |
| `email` / `phone` | at least one required. Phone: digits, spaces, `+ - ( )`, max 30 |
| `subject` (255), `company` (200, the visitor's company), `message` (5000) | optional |
| `extra` | optional flat object, max 20 keys, values max 2000 chars |
| `website` | **honeypot**: a hidden input that must stay empty. If filled, the lead is stored as spam (still returns 201) |
| `source_url` | optional; otherwise the `Referer` header is used |

Unknown top-level fields never cause an error: they are moved into `extra` automatically and shown in the lead drawer. The full original body is always stored as `raw_payload`.

### Responses

| Code | Meaning |
|---|---|
| `201` | `{ "success": true, "id": 123 }` |
| `400` | `{ "success": false, "errors": { "field": "message" } }` |
| `401` | missing / invalid site key |
| `403` | site inactive, or `Origin` not in the site's allowed origins |
| `413` | body larger than 100 KB |
| `415` | Content-Type is not `application/json` |
| `429` | rate limited (10 / minute per IP per key) |

### Plain HTML / JavaScript (browser)

```html
<input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
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
    website: f.get('website') || ''   // honeypot
  };
  const res = await fetch('https://YOUR-PANEL-DOMAIN/api/v1/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Site-Key': 'SITE_KEY_HERE' },
    body: JSON.stringify(body)
  });
  // show success / error message to the visitor
});
</script>
```

### PHP / WordPress (server to server, preferred)

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

### Node / Next.js (server route)

```js
const res = await fetch('https://YOUR-PANEL-DOMAIN/api/v1/leads', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Site-Key': process.env.LEADS_SITE_KEY },
  body: JSON.stringify({ type: 'quote', name, email, phone, message })
});
```

> **Security note:** a key used directly in browser JavaScript is visible to visitors. It is then protected only by the site's allowed origins and rate limits. Sending from the website's server (PHP, Node) keeps the key private and is preferred wherever possible. If a key leaks, use **Regenerate key**: the old key stops working immediately.

---

## 4. Roles

| Role | Access |
|---|---|
| `super_admin` | Everything: all sites, sites & API keys, users and their site assignments |
| `manager` | Leads of assigned sites only. Change status, add notes, export |
| `viewer` | Leads of assigned sites only. Read-only, export allowed |

Site scoping is enforced in the backend on every query (lists, detail, stats, export, status, notes). A lead from a non-assigned site returns 404.

---

## 5. Security summary

- Passwords: bcrypt cost 12, minimum 8 chars. Login limited to 5 failed attempts / 15 min per IP+email, plus a per-IP ceiling. Constant-time response for unknown emails.
- JWT (HS256, pinned algorithm, issuer/audience, unique id). The user is re-checked in the DB on every request, so deactivation, role changes and password changes apply immediately (password change signs out other sessions). **Sign out revokes that token on the server**, so a copied token stops working. Live notification streams of a deactivated/reset user or a signed-out token are closed immediately.
- Change password: max 5 wrong current-password attempts per 15 min per user.
- Ingest: per-site keys, Origin allow-list with exact CORS (never `*`), 100 KB body limit, honeypot, zod validation, control-character stripping. Rate limits: 200/min per IP before the key lookup, then 10/min per IP+key and 300/min per site, so junk traffic with bad keys can never block real websites. Unknown form fields never cause an error: they go into `extra` (names sanitised, max 20, values cut to 2000 chars) and the full body is kept in `raw_payload`.
- SMTP: the saved password is only ever reused for the same host/port/username (changing the server requires re-entering it); cloud-metadata/link-local hosts are refused, and loopback is refused in production.
- Dashboard API: CORS locked to `CORS_PANEL_ORIGIN`, Helmet security headers, `Cache-Control: no-store`; repeated/array query params are rejected by the validators.
- SQL: parameterized queries everywhere; sort columns and pagination are whitelisted / validated.
- Errors never leak internals (generic 500, details only in server logs).
- UI renders all lead data as plain text (no `v-html`); only `http(s)` source URLs become links; CSV/Excel export is protected against formula injection.
- Admin safety: a super admin cannot demote or deactivate themselves, and the last active super admin cannot be removed.

## 6. API reference (dashboard, JWT required)

```
POST   /api/auth/login                 GET  /api/auth/me          POST /api/auth/change-password
GET    /api/stats/overview             GET  /api/stats/daily?days=30
GET    /api/stats/by-site?range=today|week|month|all
GET    /api/leads?site_ids=&type=&status=&from=&to=&q=&sort=&order=&page=&page_size=
GET    /api/leads/:id                  PATCH /api/leads/:id {status}     POST /api/leads/:id/notes {note}
GET    /api/leads/export?format=csv|xlsx  (same filters as the list)
GET    /api/sites
# super_admin only
GET/POST /api/admin/sites    PUT /api/admin/sites/:id    POST /api/admin/sites/:id/regenerate-key
GET/POST /api/admin/users    PUT /api/admin/users/:id
```

## 7. Email notifications (Phase 2)

Spec: [docs/PHASE2_NOTIFICATIONS_SPEC.md](docs/PHASE2_NOTIFICATIONS_SPEC.md)

Every new (non-spam) lead sends **one email** to the company's recipients plus the global recipients (de-duplicated; `to` beats `cc` beats `bcc`; if there is no `to`, the first cc/bcc is promoted). `Reply-To` is the visitor's email, so replying goes straight to them. The ingest API never waits for SMTP.

**SMTP selection:** the company's own SMTP if it is enabled, otherwise the global SMTP. If neither is set, the lead is still saved and the email log shows `No SMTP configured`.

**Retries:** attempt 1 immediately, attempt 2 after 1 minute, attempt 3 after 5 minutes, then `failed`. The queue lives in the `email_logs` table, so pending retries survive a restart (picked up on startup and checked every minute). Failed emails can be retried by hand.

### Setting it up (Admin → Notifications)

1. **Global SMTP** tab: fill host, port, SSL/TLS, username, password, from name/email (or use a *Quick fill* preset), turn on **Send emails with this global SMTP**, press **Send test email** to check it, then **Save**. The password field then shows "Saved and encrypted"; leave it blank on later edits to keep it.
2. **Global recipients** tab: people who get a copy of every company's leads (To / CC / BCC).
3. **Companies** tab: pick a company, add its recipients (each can be paused), and optionally switch on **Use a separate SMTP for this company**. The top card previews exactly which SMTP and which final recipient list a new lead from that company will use.
4. **Email log** tab: every email with company, recipients, SMTP used, status, attempts and the SMTP error; failed emails have a **Retry** button.

Each user sets their own bell preferences under **My account → Notifications** (bell on/off, all or selected companies, optional sound).

### SMTP settings

| Provider | Host | Port / Secure |
|---|---|---|
| Gmail / Google Workspace | `smtp.gmail.com` | `587` + secure **off** (STARTTLS) or `465` + secure **on** |
| Microsoft 365 | `smtp.office365.com` | `587` + secure off |
| Zoho | `smtp.zoho.in` | `465` + secure on |

- **587 vs 465:** port 587 starts plain and upgrades with STARTTLS (set *secure* off). Port 465 is TLS from the first byte (set *secure* on). The panel always requires TLS before sending a password to a non-local server.
- **Gmail / Workspace:** turn on 2-Step Verification and create an **App password** (Google Account → Security → App passwords). Use the 16-character app password, not the normal account password. The *from email* should be the same mailbox (or a verified alias).
- Passwords are stored encrypted (AES-256-GCM) and are never returned by the API (`has_password: true` instead). Leaving the password blank on update keeps the saved one.

### Admin API (super admin only)

```
GET/PUT  /api/admin/settings/smtp-global          POST /api/admin/settings/smtp-global/test  { to, config? }
GET/PUT  /api/admin/settings/global-recipients    [{ email, mode: to|cc|bcc }]
GET/PUT  /api/admin/sites/:id/smtp                 POST /api/admin/sites/:id/smtp/test         { to, config? }
GET/PUT  /api/admin/sites/:id/recipients           [{ email, mode, is_active }]
GET      /api/admin/sites/:id/notification-preview → which SMTP + final recipient list
GET      /api/admin/email-logs?site_id=&status=&page=&page_size=
POST     /api/admin/email-logs/:id/retry
```

### Testing locally without a real mailbox

Run any local test SMTP server on `127.0.0.1` (for example the `smtp-server` dev dependency), save it as the global SMTP with secure off, then submit a lead and check **email-logs**. "Send test email" returns the exact SMTP error (wrong password, refused connection, TLS problems, …).

## 8. In-app notifications (bell + live updates)

When a non-spam lead arrives, one notification row is created for every **active super admin** and every **active user assigned to that company**, respecting each user's preferences (bell on/off, and "notify me for these companies"). Users who are online receive it instantly over **Server-Sent Events**.

- Access is re-checked everywhere: a user only ever receives, lists, counts or marks notifications for companies they can currently see. If access to a company is removed, its old notifications disappear from that user's list.
- The stream authenticates with the normal `Authorization: Bearer` header (a fetch-based SSE client), so the token never appears in URLs or proxy logs. Tokens in the query string are rejected.
- Every 25 seconds the server sends a heartbeat and re-validates each open stream: a deactivated user, a changed password or an expired token closes the stream (`event: session_ended`).
- Limits: 5 open streams per user (the oldest is dropped), 500 in total. Streams are kept in memory, so the API must run as **one** PM2 instance.
- Notifications older than 90 days are deleted by a daily cleanup.

```
GET  /api/notifications?limit=20&unread_only=0   → { data: [...], unread_count }
GET  /api/notifications/unread-count             → { unread_count }
POST /api/notifications/:id/read                 POST /api/notifications/read-all
GET  /api/notifications/prefs                    PUT /api/notifications/prefs { bell_enabled, site_ids: null | [ids] }
GET  /api/notifications/stream                   → SSE: event "ready" { unread_count }, "new_lead" {...}, "session_ended"
```

`new_lead` data: `{ notification_id, lead_id, site_id, site_name, site_color, type, name, title, body, created_at }`.

## 9. Roadmap

Audit log, assigning leads to staff, follow-up reminders, 2FA.
