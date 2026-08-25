# Deploying to the truehr VPS

Target: Ubuntu 22.04 at `66.116.242.17`, which already runs truehr / truekind
behind nginx. Nothing in this runbook restarts or reconfigures those sites.

Before you start, decide the subdomain — e.g. `lrt.truehr.co.in` — and create
an **A record** pointing it at `66.116.242.17`. DNS takes a few minutes to
propagate and step 7 will fail without it. Substitute your real domain wherever
`lrt.truehr.co.in` appears below.

---

## Step 0 — Reclaim disk (server)

You have 6.4 GB of stale Docker build cache. Clearing it first gives the build
room and touches nothing that is running.

```bash
docker builder prune -f
df -h /
```

**Checkpoint:** `Avail` should now be around 73 G.

---

## Step 1 — Push the code (your Mac)

```bash
cd ~/dev/Freelencing-june-kp/LRT_PANCHAYAT

# .env, data/ and node_modules must be ignored — confirm before pushing
cat .gitignore

git add -A
git commit -m "Sahayak Form Portal"

# first time only — keep it PRIVATE, the README lists default passwords
gh repo create lrt-panchayat --private --source=. --push

# or if the repo already exists on github.com
# git remote add origin git@github.com:<you>/lrt-panchayat.git
# git push -u origin main
```

**Checkpoint:** the repo is visible on GitHub and marked Private.

---

## Step 2 — Deploy key (server)

A read-only key so the VPS can pull without holding your GitHub account.

```bash
ssh-keygen -t ed25519 -C "truehr-vps-sahayak" -f ~/.ssh/sahayak_deploy -N ""
cat ~/.ssh/sahayak_deploy.pub
```

Copy that line into GitHub → your repo → **Settings → Deploy keys → Add deploy
key**. Leave *Allow write access* unchecked.

```bash
cat >> ~/.ssh/config << 'SSHEOF'
Host github-sahayak
  HostName github.com
  User git
  IdentityFile ~/.ssh/sahayak_deploy
  IdentitiesOnly yes
SSHEOF

ssh -T github-sahayak       # expect: "Hi <you>/lrt-panchayat! You've successfully authenticated"
```

---

## Step 3 — Clone (server)

```bash
ls /opt                                    # see what already lives there
git clone github-sahayak:<you>/lrt-panchayat.git /opt/sahayak
cd /opt/sahayak && ls
```

**Checkpoint:** you can see `docker-compose.yml`, `api/`, `web/`, `db/`.

---

## Step 4 — Configure (server)

```bash
cd /opt/sahayak
cp .env.example .env

openssl rand -hex 32        # -> AADHAAR_ENC_KEY
openssl rand -hex 32        # -> AADHAAR_HASH_PEPPER
openssl rand -hex 32        # -> JWT_SECRET

nano .env
```

Set these in `.env`:

| Key | Value |
|---|---|
| `AADHAAR_ENC_KEY` | first random string (must be 64 hex chars) |
| `AADHAAR_HASH_PEPPER` | second random string |
| `JWT_SECRET` | third random string |
| `DB_PASSWORD` | a strong password |
| `MYSQL_ROOT_PASSWORD` | a different strong password |
| `HTTP_PORT` | `8080` |
| `COOKIE_SECURE` | `true` |

> **Back up `AADHAAR_ENC_KEY` somewhere off this server, now.** It exists in one
> place. Lose it and every stored Aadhaar number becomes undecryptable.

---

## Step 5 — Build and start (server)

```bash
cd /opt/sahayak
docker compose up -d --build        # 3-5 minutes the first time
docker compose ps                   # all three should be Up; db shows (healthy)
docker compose logs api | tail -20  # expect "[api] listening on :4000"
```

If the build is killed partway, memory ran out. Add swap and retry:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
docker compose up -d --build
```

---

## Step 6 — Verify before exposing it

```bash
curl -s localhost:8080/api/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/
```

**Checkpoint:** `{"ok":true,...}` and `200`. If health fails, the API cannot
reach MySQL — check `docker compose logs db`.

Confirm nothing else broke:

```bash
ss -tlnp | grep -E ':(80|443|8080) '
curl -s -o /dev/null -w 'truehr: %{http_code}\n' https://truehr.co.in
free -h
```

---

## Step 7 — nginx (server)

```bash
cp /opt/sahayak/deploy/nginx-sahayak.conf.example /etc/nginx/sites-available/sahayak
nano /etc/nginx/sites-available/sahayak      # set server_name to your subdomain
ln -s /etc/nginx/sites-available/sahayak /etc/nginx/sites-enabled/

nginx -t                                     # MUST say "syntax is ok" / "test is successful"
systemctl reload nginx
```

`nginx -t` is what protects the live sites — if the new block is malformed,
nginx refuses to reload rather than dropping truehr.

Check DNS has arrived before the next step:

```bash
dig +short lrt.truehr.co.in               # must print 66.116.242.17
curl -s -o /dev/null -w '%{http_code}\n' http://lrt.truehr.co.in
```

---

## Step 8 — HTTPS (server)

```bash
which certbot || apt install -y certbot python3-certbot-nginx
certbot --nginx -d lrt.truehr.co.in
```

Choose redirect-to-HTTPS when prompted. Certbot edits only the `sahayak` server
block and installs its own renewal timer.

```bash
systemctl status certbot.timer --no-pager | head -4
curl -s -o /dev/null -w '%{http_code}\n' https://lrt.truehr.co.in
```

---

## Step 9 — Change the default passwords

The site is now public. Do this before anyone logs in.

```bash
cd /opt/sahayak/api
docker compose run --rm api node scripts/hash-password.js "YourNewMlaPassword"
```

Copy the `scrypt$...` output, then:

```bash
cd /opt/sahayak
docker compose exec db mysql -u root -p lrt_panchayat
```

```sql
UPDATE users SET password_hash = '<paste>' WHERE username = 'mla';
-- repeat for sup.dharma and sup.rasul with their own hashes
SELECT username, role, is_active FROM users;
```

---

## Step 10 — Backups

```bash
crontab -e
```

Add:

```
15 2 * * *  /opt/sahayak/scripts/backup.sh >> /var/log/lrt-backup.log 2>&1
```

Test it once by hand:

```bash
/opt/sahayak/scripts/backup.sh
ls -lh /opt/sahayak/backups
```

---

## Deploying changes later

```bash
cd /opt/sahayak
git pull
docker compose up -d --build
docker compose ps
```

Schema changes are **not** applied automatically — `db/init/` only runs on an
empty database. Apply them by hand:

```bash
docker compose exec -T db mysql -u root -p"$MYSQL_ROOT_PASSWORD" lrt_panchayat < migration.sql
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build killed at `npm ci` | Out of memory | Add swap (step 5) |
| `/api/health` returns 503 | API cannot reach MySQL | `docker compose logs db`; wait for the healthcheck |
| 502 from nginx | Container down, or wrong port | `docker compose ps`; confirm `HTTP_PORT=8080` |
| Certbot fails | DNS not propagated | `dig +short <domain>` must return the server IP |
| Login says "Too many attempts" | Rate limiter | Wait 15 min, or raise `LOGIN_RATE_MAX` in `.env` |
| Photos vanish after restart | `data/uploads` not mounted | Check the `web`/`api` volumes in docker-compose.yml |

## Rollback

```bash
cd /opt/sahayak
docker compose down                 # stops only our three containers
rm /etc/nginx/sites-enabled/sahayak
nginx -t && systemctl reload nginx
```

truehr is untouched throughout — different containers, different nginx block,
different database.
