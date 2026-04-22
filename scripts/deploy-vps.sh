#!/usr/bin/env bash
# Stockholms Puls — one-shot VPS installer.
#
# On a fresh Ubuntu 24.04 box (Vultr, Hetzner, Contabo, …) as root:
#   curl -sSL https://raw.githubusercontent.com/fltman/stockholms-puls/main/scripts/deploy-vps.sh | bash
#
# Prompts for: domain name, admin email (for TLS certs), and the three API
# keys the app needs. Writes them to /home/sl/stockholms-puls/server/.env,
# installs Node + nginx + certbot + PM2, builds the client, configures nginx
# with a Let's Encrypt TLS cert and starts the server under PM2.
#
# Safe to re-run: skips work that's already done, pulls the latest code.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Kör som root eller via sudo." >&2
  exit 1
fi

REPO_URL="${REPO_URL:-https://github.com/fltman/stockholms-puls.git}"
APP_USER="${APP_USER:-sl}"
APP_DIR="/home/${APP_USER}/stockholms-puls"

say() { printf "\n\033[1;36m== %s ==\033[0m\n" "$1"; }
ask() {
  local prompt="$1" default="${2:-}" var
  if [[ -n "$default" ]]; then
    read -rp "$prompt [$default]: " var
    echo "${var:-$default}"
  else
    read -rp "$prompt: " var
    echo "$var"
  fi
}

# -------- 1. Samla konfiguration ---------------------------------------------
say "Konfiguration"
DOMAIN=$(ask "Domän (t.ex. puls.dinsida.se)")
EMAIL=$(ask "Mejl för Let's Encrypt")
TRAFIKLAB_KEY=$(ask "TRAFIKLAB_KEY (GTFS-RT)")
OPENROUTER_KEY=$(ask "OPENROUTER_KEY (AI-analys, lämna tom för att hoppa över)" "")
TRAFIKLAB_REALTIME_KEY=$(ask "TRAFIKLAB_REALTIME_KEY (timetables-API, valfritt)" "")

# -------- 2. Grundpaket ------------------------------------------------------
say "Uppdaterar systemet + installerar paket"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y git nginx certbot python3-certbot-nginx ufw

# -------- 3. Swapfil (trygg för 1 GB-instanser) ------------------------------
if [[ ! -f /swapfile ]]; then
  say "Skapar 2 GB swap-fil"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# -------- 4. Brandvägg -------------------------------------------------------
say "Brandvägg"
ufw allow OpenSSH >/dev/null || true
ufw allow 'Nginx Full' >/dev/null || true
ufw --force enable

# -------- 5. App-user --------------------------------------------------------
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  say "Skapar användare $APP_USER"
  adduser --disabled-password --gecos "" "$APP_USER"
fi
# Ubuntu creates /home/<user> with mode 750 so nginx (www-data) can't cd in to
# serve client/dist. Open the traversal bit — doesn't leak file contents,
# since inner dirs still gate listing.
chmod o+x "/home/$APP_USER"

# -------- 6. Hämta koden -----------------------------------------------------
say "Hämtar koden"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
else
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi

# -------- 7. .env ------------------------------------------------------------
say "Skriver server/.env"
ENV_FILE="$APP_DIR/server/.env"
umask 0077
cat > "$ENV_FILE" <<EOF
TRAFIKLAB_KEY=$TRAFIKLAB_KEY
TRAFIKLAB_API_KEY=$TRAFIKLAB_KEY
EOF
[[ -n "$OPENROUTER_KEY" ]] && {
  echo "OPENROUTER_KEY=$OPENROUTER_KEY" >> "$ENV_FILE"
  echo "OPENROUTER_API_KEY=$OPENROUTER_KEY" >> "$ENV_FILE"
}
[[ -n "$TRAFIKLAB_REALTIME_KEY" ]] && \
  echo "TRAFIKLAB_REALTIME_KEY=$TRAFIKLAB_REALTIME_KEY" >> "$ENV_FILE"
chown "$APP_USER":"$APP_USER" "$ENV_FILE"
umask 0022

# -------- 8. Beroenden + klient-build ----------------------------------------
say "Installerar npm-paket"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm --prefix server install --omit=dev"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm --prefix client install"

say "Bygger klienten"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR/client' && npm run build"

# -------- 9. PM2 -------------------------------------------------------------
say "Startar servern under PM2"
sudo -u "$APP_USER" bash -c "
  npm install -g pm2 2>/dev/null || true
  export PATH=\$PATH:/usr/bin
  cd '$APP_DIR'
  pm2 delete sl 2>/dev/null || true
  pm2 start server/src/index.js --name sl --node-args='--env-file=server/.env' --update-env
  pm2 save
" || true
# Some npm installs refuse without -g as user; fall back to root global install.
if ! sudo -u "$APP_USER" bash -c "command -v pm2" >/dev/null; then
  npm install -g pm2
  sudo -u "$APP_USER" bash -c "
    cd '$APP_DIR'
    pm2 delete sl 2>/dev/null || true
    pm2 start server/src/index.js --name sl --node-args='--env-file=server/.env' --update-env
    pm2 save
  "
fi
# Hook into systemd so PM2 comes up on reboot.
env PATH="$PATH":/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" | \
  tail -n 1 | bash || true

# -------- 10. nginx-config ---------------------------------------------------
say "Konfigurerar nginx"
NGINX_CONF="/etc/nginx/sites-available/sl"
cat > "$NGINX_CONF" <<NGINX
server {
    listen 80;
    server_name $DOMAIN;

    root $APP_DIR/client/dist;
    index index.html;

    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1024;

    # Static SPA — fallback to index.html so client-side routes work
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Long cache for hashed asset files
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
    }

    location /stream {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }
}
NGINX
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/sl
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# -------- 11. TLS via Let's Encrypt ------------------------------------------
say "Skaffar TLS-certifikat"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

# -------- Klart --------------------------------------------------------------
cat <<DONE

================================================================
  Klart!  Besök: https://$DOMAIN
  Följ loggar:    sudo -u $APP_USER pm2 logs sl
  Starta om:      sudo -u $APP_USER pm2 restart sl
  Uppdatera:      kör detta script igen (hämtar nytt från git)
================================================================
DONE
