#!/usr/bin/env bash
# =============================================================================
# Central Leads Panel - VPS deploy script (PM2 + Nginx)
#
#   Project      : /app/Central-Leads-Panel
#   API          : PM2 process "central-leads-api" (backend/ecosystem.config.js)
#   Domain       : https://clp.cpaleasing.com
#   Dashboard    : built to /var/www/clp.cpaleasing.com (served by Nginx)
#   Nginx site   : /etc/nginx/sites-available/clp.cpaleasing.com
#
# Usage (on the VPS):
#   cd /app/Central-Leads-Panel && bash deploy/deploy.sh            # normal deploy
#   bash deploy/deploy.sh --no-pull                                 # deploy what is on disk
#   bash deploy/deploy.sh --nginx                                   # first time: also install the Nginx site
#   bash deploy/deploy.sh --rollback                                # put back the previous dashboard build
#
# Everything is configurable with environment variables (defaults below).
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app/Central-Leads-Panel}"
DOMAIN="${DOMAIN:-clp.cpaleasing.com}"
WEB_ROOT="${WEB_ROOT:-/var/www/$DOMAIN}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-central-leads-api}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-$DOMAIN}"
NGINX_AVAILABLE="${NGINX_AVAILABLE:-/etc/nginx/sites-available}"
NGINX_ENABLED="${NGINX_ENABLED:-/etc/nginx/sites-enabled}"
API_PORT="${API_PORT:-4000}"

DO_PULL=1
DO_NGINX=0
DO_ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --nginx) DO_NGINX=1 ;;
    --rollback) DO_ROLLBACK=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------- helpers
c_green=$'\e[32m'; c_red=$'\e[31m'; c_yellow=$'\e[33m'; c_bold=$'\e[1m'; c_off=$'\e[0m'
step() { echo; echo "${c_bold}==> $*${c_off}"; }
ok()   { echo "${c_green}✔ $*${c_off}"; }
warn() { echo "${c_yellow}! $*${c_off}"; }
die()  { echo "${c_red}✘ $*${c_off}" >&2; exit 1; }
trap 'die "Deploy failed at line $LINENO (command: $BASH_COMMAND)"' ERR

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

# One deploy at a time.
exec 9>"/tmp/central-leads-panel.deploy.lock"
flock -n 9 || die "Another deploy is already running."

# ---------------------------------------------------------------- rollback
if [ "$DO_ROLLBACK" -eq 1 ]; then
  step "Rolling back dashboard to the previous build"
  [ -d "${WEB_ROOT}.prev" ] || die "No previous build found at ${WEB_ROOT}.prev"
  $SUDO rm -rf "${WEB_ROOT}.failed"
  $SUDO mv "$WEB_ROOT" "${WEB_ROOT}.failed"
  $SUDO mv "${WEB_ROOT}.prev" "$WEB_ROOT"
  ok "Dashboard rolled back. (API code: run 'git checkout <previous commit>' then this script with --no-pull)"
  exit 0
fi

# ---------------------------------------------------------------- pre-flight
step "Pre-flight checks"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout"
cd "$APP_DIR"
command -v node >/dev/null || die "Node.js is not installed (need 20+)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ required (found $(node -v))"
command -v npm >/dev/null || die "npm is not installed"
if ! command -v pm2 >/dev/null; then
  warn "PM2 not found - installing it globally"
  $SUDO npm install -g pm2
fi

ENV_FILE="$APP_DIR/backend/.env"
[ -f "$ENV_FILE" ] || die "Missing $ENV_FILE (copy backend/.env.example and fill it in)"
# Never fails (a missing key just returns ""), so it is safe under `set -Eeuo pipefail` + ERR trap.
env_get() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e 's/\r$//'; }
! grep -q "CHANGE_ME" "$ENV_FILE" || die "backend/.env still contains CHANGE_ME values - fill them in first"
[ "$(env_get NODE_ENV)" = "production" ] || die "backend/.env must have NODE_ENV=production"
[ "$(env_get JWT_SECRET | wc -c)" -gt 32 ] || die "backend/.env JWT_SECRET must be at least 32 characters"
[ "$(env_get SECRET_ENCRYPTION_KEY | wc -c)" -gt 32 ] || die "backend/.env SECRET_ENCRYPTION_KEY is missing"
[ "$(env_get TRUST_PROXY)" != "0" ] || warn "TRUST_PROXY=0: behind Nginx set TRUST_PROXY=1 (rate limits need the real client IP)"
API_PORT="$(env_get PORT)"; API_PORT="${API_PORT:-4000}"
case ",$(env_get CORS_PANEL_ORIGIN)," in
  *",https://$DOMAIN,"*) ;;
  *) warn "CORS_PANEL_ORIGIN should include https://$DOMAIN (dashboard API calls are refused otherwise)";;
esac
[ "$(env_get APP_BASE_URL)" = "https://$DOMAIN" ] || warn "APP_BASE_URL should be https://$DOMAIN (used for 'View lead' links in emails)"
ok "Node $(node -v), PM2 $(pm2 -v), .env looks good"

# ---------------------------------------------------------------- code
if [ "$DO_PULL" -eq 1 ]; then
  step "Updating code from origin/$BRANCH"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    die "There are local changes in $APP_DIR. Commit/stash them, or deploy with --no-pull."
  fi
  git fetch --prune origin "$BRANCH"
  git checkout -q "$BRANCH"
  git reset --hard -q "origin/$BRANCH"
fi
ok "At commit $(git rev-parse --short HEAD): $(git log -1 --pretty=%s)"

# ---------------------------------------------------------------- backend
step "Backend: installing production dependencies"
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund
mkdir -p logs

step "Backend: running database migrations (before restarting the API)"
npm run migrate

step "Backend: (re)starting PM2 process $PM2_APP"
pm2 startOrReload ecosystem.config.js --env production --update-env
pm2 save >/dev/null

step "Backend: health check"
healthy=0
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  pm2 logs "$PM2_APP" --lines 40 --nostream || true
  die "API did not become healthy on port $API_PORT (see logs above)"
fi
ok "API is up on 127.0.0.1:${API_PORT}"

# ---------------------------------------------------------------- frontend
step "Dashboard: building"
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
npm run build
[ -f dist/index.html ] || die "Build did not produce dist/index.html"

step "Dashboard: publishing to $WEB_ROOT"
STAGE="${WEB_ROOT}.new"
$SUDO rm -rf "$STAGE"
$SUDO mkdir -p "$STAGE"
$SUDO cp -a dist/. "$STAGE/"
# Swap in the new build; keep the previous one for --rollback.
if [ -d "$WEB_ROOT" ]; then
  $SUDO rm -rf "${WEB_ROOT}.prev"
  $SUDO mv "$WEB_ROOT" "${WEB_ROOT}.prev"
fi
$SUDO mv "$STAGE" "$WEB_ROOT"
if id www-data >/dev/null 2>&1; then $SUDO chown -R www-data:www-data "$WEB_ROOT"; fi
$SUDO find "$WEB_ROOT" -type d -exec chmod 755 {} +
$SUDO find "$WEB_ROOT" -type f -exec chmod 644 {} +
ok "Dashboard published ($(du -sh "$WEB_ROOT" | cut -f1))"

# ---------------------------------------------------------------- nginx
SITE_FILE="$NGINX_AVAILABLE/$NGINX_SITE_NAME"
if [ "$DO_NGINX" -eq 1 ]; then
  step "Nginx: installing site $SITE_FILE"
  if [ -f "$SITE_FILE" ]; then
    warn "$SITE_FILE already exists - not overwriting it (delete it first to re-install the template)"
  else
    sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s#__WEB_ROOT__#${WEB_ROOT}#g" -e "s/__API_PORT__/${API_PORT}/g" \
      "$APP_DIR/deploy/nginx/central-leads-panel.conf" | $SUDO tee "$SITE_FILE" >/dev/null
    $SUDO ln -sf "$SITE_FILE" "$NGINX_ENABLED/$NGINX_SITE_NAME"
    ok "Installed. For HTTPS run: sudo certbot --nginx -d $DOMAIN"
  fi
fi
if command -v nginx >/dev/null; then
  step "Nginx: test and reload"
  $SUDO nginx -t
  $SUDO systemctl reload nginx
  ok "Nginx reloaded"
else
  warn "nginx not found on PATH - skipped reload"
fi

# ---------------------------------------------------------------- done
step "Deploy finished"
pm2 describe "$PM2_APP" | grep -E "status|restarts|uptime" || true
echo
ok "Commit $(cd "$APP_DIR" && git rev-parse --short HEAD) is live."
echo "   Logs:     cd $APP_DIR/backend && npm run pm2:logs"
echo "   Rollback: bash $APP_DIR/deploy/deploy.sh --rollback   (dashboard build)"
