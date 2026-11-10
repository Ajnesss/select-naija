#!/bin/bash
# Select Naija on its own Oracle "Micro" server (VM.Standard.E2.1.Micro, 1 GB, Ubuntu).
# Paste this whole file into "Cloud-init script" (Show advanced options → Management) when creating
# the Select Naija server. It installs everything on first boot and touches nothing else.
# It is NOT for the German server and must never be run there.
# Progress log on the server: /var/log/select-naija-setup.log
exec > /var/log/select-naija-setup.log 2>&1
set -euxo pipefail

REPO=https://github.com/Ajnesss/select-naija   # public repo; for a private repo see README "Private repo"
APP_DIR=/opt/select-naija
ENV_FILE=/etc/select-naija.env
PORT=8100

# 0. swap, so 1 GB of memory is enough for updates and tests
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 1. Oracle's Ubuntu image blocks every port except SSH: open web ports 80 + 443 on this server only
iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl xz-utils iptables-persistent debian-keyring debian-archive-keyring apt-transport-https gnupg
netfilter-persistent save

# 2. Node.js 22 (official build, checksum verified)
cd /tmp
NODE_FILE=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz$/ {print $2}')
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/${NODE_FILE}"
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep " ${NODE_FILE}\$" | sha256sum -c -
tar -xJf "${NODE_FILE}" -C /usr/local --strip-components=1
node --version

# 3. Caddy (https with a free certificate), from Caddy's official package repository
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

# 4. the code, run by its own unprivileged user
id snaija >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin snaija
[ -d "$APP_DIR/.git" ] || git clone --depth 1 "$REPO" "$APP_DIR"
chown -R snaija:snaija "$APP_DIR"

# 5. settings. Public address = this server's IP as an sslip.io name (free, no account, gets https)
IP=$(curl -fsS -m 20 https://api.ipify.org || curl -fsS -m 20 https://ifconfig.me)
HOST="select-naija.$(echo "$IP" | tr . -).sslip.io"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
PORT=$PORT
HOST=127.0.0.1
PUBLIC_URL=https://$HOST
# Optional: a free TMDB API key adds "where to watch in the UK" links (powered by JustWatch)
TMDB_API_KEY=
SHOW_DIAGNOSTICS=1
ENV
  chmod 640 "$ENV_FILE"
  chgrp snaija "$ENV_FILE"
fi
echo "https://$HOST/manifest.json" > /opt/select-naija-address.txt

# 6. the service: restarts itself after crashes and reboots, capped so it can't starve the server
cat > /etc/systemd/system/select-naija.service <<UNIT
[Unit]
Description=Select Naija addon
After=network-online.target
Wants=network-online.target

[Service]
User=snaija
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/local/bin/node src/server.js
Restart=always
RestartSec=5
MemoryMax=400M
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now select-naija

# 7. https in front of it
cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
    encode gzip
    reverse_proxy 127.0.0.1:$PORT
}
CADDY
systemctl reload caddy || systemctl restart caddy

# 8. updates: every 15 minutes pick up new commits. Code changes must pass the tests first,
#    otherwise the previous version is kept. Data-only changes (nightly verification) need no restart:
#    the addon reloads its data files every 10 minutes.
cat > /usr/local/bin/select-naija-deploy <<'DEPLOY'
#!/bin/bash
set -uo pipefail
cd /opt/select-naija || exit 1
OLD=$(git rev-parse HEAD)
git fetch -q --depth 1 origin main || exit 0
NEW=$(git rev-parse FETCH_HEAD)
[ "$OLD" = "$NEW" ] && exit 0
git reset -q --hard "$NEW"
CHANGED=$(git diff --name-only "$OLD" "$NEW" 2>/dev/null | grep -v -E '^(data|reports)/' || echo "unknown")
if [ -n "$CHANGED" ]; then
  if node --test test/*.test.js >/tmp/select-naija-tests.log 2>&1; then
    systemctl restart select-naija
    echo "$(date -Is) deployed $NEW"
  else
    git reset -q --hard "$OLD"
    echo "$(date -Is) tests FAILED for $NEW, kept $OLD (see /tmp/select-naija-tests.log)"
  fi
else
  echo "$(date -Is) data update $NEW (no restart)"
fi
chown -R snaija:snaija /opt/select-naija
DEPLOY
chmod +x /usr/local/bin/select-naija-deploy
echo '*/15 * * * * root /usr/local/bin/select-naija-deploy >> /var/log/select-naija-deploy.log 2>&1' > /etc/cron.d/select-naija-deploy

sleep 5
curl -fsS "http://127.0.0.1:$PORT/health" || true
echo "DONE. Select Naija address: https://$HOST/manifest.json"
