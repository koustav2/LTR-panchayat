# Project Checkpoint — Sahayak Form Portal

**Date:** 25 August 2026
**Repo:** `github.com/koustav2/LTR-panchayat` (private)
**Latest commit:** `a1f02a1` — Fix upload permissions on bind mount; plain amount field

A snapshot of where this project stands, so anyone picking it up — including
future me — can resume without re-reading the whole history.

---

## 1. What it is

A mobile-first web application for recording and reviewing Sahayak support
applications across two blocks, **Dharmasala** and **Rasulpur Dharasamal**.

Two roles, both seeded in SQL. No signup, no user-management screen.

| Role | What they do |
|---|---|
| **Supervisor** (many) | Fills the Sahayak Form; sees only their own submissions |
| **MLA** (one) | Sees every submission; accepts/rejects with a comment; amount rollups; CSV export |

---

## 2. Where it runs

| | |
|---|---|
| Server | `root@66.116.242.17` — Ubuntu 22.04, 4 GB RAM, 98 GB disk |
| Path | `/opt/sahayak` |
| URL | **https://lrt.truehr.co.in** |
| Stack | React 18 + Vite · Node 20 + Express · MySQL 8 · Docker Compose |
| Internal port | `127.0.0.1:8080` — host nginx reverse-proxies to it |
| nginx block | `/etc/nginx/sites-available/sahayak` |

> **This VPS also runs a live production app** (`truehr.co.in`, `api.truehr.co.in`,
> `truekind`) with its own nginx blocks and its own host MySQL on `127.0.0.1:3306`.
> Our MySQL runs inside Docker and is never published to the host, so the two
> cannot collide. Always run `nginx -t` before reloading nginx.

### Container resource caps

Set deliberately — uncapped MySQL 8 sizes its buffer pool against total host RAM
and would eventually get something OOM-killed on a shared box.

| Container | Limit |
|---|---|
| `db` (MySQL 8) | 576 MB, `innodb-buffer-pool-size=192M` |
| `api` (Node) | 320 MB |
| `web` (nginx) | 64 MB |

---

## 3. Accounts

| Username | Role | Default password |
|---|---|---|
| `mla` | MLA | `Mla@2026#LRT` |
| `sup.dharma` | Supervisor — Dharmasala | `Sup@2026#DHM` |
| `sup.rasul` | Supervisor — Rasulpur Dharasamal | `Sup@2026#RSD` |

**⚠️ These are still the defaults and the site is publicly reachable.** Changing
them is the top open item — see §7.

```bash
cd /opt/sahayak
docker compose run --rm api node scripts/hash-password.js "NewPassword"
docker compose exec db mysql -u root -p lrt_panchayat
# UPDATE users SET password_hash = '<paste>' WHERE username = 'mla';
```

Adding a supervisor is one INSERT; disabling one is `is_active = 0` (never
DELETE — their submissions reference the row).

---

## 4. Features built

**Sahayak Form** (supervisor)
- Server date shown at the top — not the device clock, so it cannot be backdated
- Aadhaar (12 digits) → debounced lookup → autofills Name, Father/Husband Name,
  Phone, Block, Panchayat, PIN for a returning applicant, with a "N previous
  applications" banner and an Edit toggle
- Block → Panchayat and Type of Support → Reason of Support dependent dropdowns
- **Amount Requested** — plain number field, echoes back as `12,500`
- Three Yes/No + comment blocks: Panchayat Prabhari, Mandal Sabhapati, Mandal Prabhari.
  A comment is mandatory when the answer is No
- Applicant photo (camera capture, compressed in-browser to ~200 KB) with a full
  preview card, plus up to 5 supporting documents (JPG/PNG/PDF)
- Draft autosaves to localStorage and survives a reload
- Duplicate guard: same Aadhaar + same support type already pending → confirm dialog

**List of Form Uploaded** (both roles)
- Search by reference number, name, phone or last 4 of Aadhaar
- Status filter chips with counts; rejection reason shown inline
- Cards on mobile, data table on desktop — same data, CSS picks one

**Detail page** (both roles)
- Support Requested callout: Type, Reason, Amount
- Applicant photo and every document, with a fallback to the beneficiary's
  stored photo when a repeat application did not re-upload one
- All three recommendations; MLA comment; rejection reason
- Aadhaar masked by default, revealable on demand (the reveal is audit-logged)

**MLA dashboard**
- Amount Summary rolled up by block, expandable to panchayat, with a grand total
- `requested = accepted + pending`; **rejected is excluded from requested** and
  reported in its own column
- CSV export

---

## 5. Design decisions worth remembering

**Beneficiary and application are separate tables.** One Aadhaar → one
`beneficiaries` row forever; many `applications` rows. This is what makes
autofill work.

**Applications snapshot identity.** `applicant_name`, `guardian_name`, `phone`,
block, panchayat and PIN are copied onto each application at submission. The
beneficiary row holds *current* values and drives autofill; the snapshot means a
decided application still shows what it was decided on.

**Reference numbers** — `LRT/DHM/2026/000123`. Generated server-side inside a
transaction against `reference_counters` with `SELECT … FOR UPDATE`, plus a
UNIQUE index as backstop. Verified with 8 concurrent submissions.

**Aadhaar** — stored twice: AES-256-GCM ciphertext, and a peppered SHA-256 hash
for lookup. Plaintext is never indexed. Lists, search and CSV show only the last
four digits.

**Money is DECIMAL(12,2), never FLOAT.** These totals get reported upward.

**Role scoping is server-side on every endpoint.** Hidden buttons are a
convenience, not a control.

**Uploads run as the `node` user.** The container entrypoint starts as root,
chowns the bind-mounted `/data/uploads`, then drops privileges via `su-exec`.
The API logs `[uploads] … is writable` at boot.

---

## 6. Deploying a change

```bash
# Mac
cd ~/dev/Freelencing-june-kp/LRT_PANCHAYAT
git add -A && git commit -m "…" && git push

# server
cd /opt/sahayak
git pull

# migrations are NOT automatic — db/init only runs on an empty database
PW=$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2)
for m in db/migrations/*.sql; do
  echo "applying $m"
  docker compose exec -T db mysql -u root -p"$PW" lrt_panchayat < "$m"
done

docker compose up -d --build
docker compose logs api | grep -E "uploads|listening"
```

Migrations applied so far — both idempotent:

| File | Adds |
|---|---|
| `001_add_mla_comment.sql` | `applications.mla_comment` |
| `002_add_amount.sql` | `applications.amount`, index `ix_app_rollup` |

### Tests — 240 checks, all passing

```bash
cd api && BASE=http://localhost:4000 npm run smoke     # 110 API
cd web && node e2e.mjs                                  # 51  mobile journey
cd web && node responsive.mjs                           # 37  390 / 768 / 1440 px
cd web && node attachments.mjs                          # 42  photos, amounts, rollups
```

The browser suites need `CHROME_PATH` if Playwright's own Chromium is absent.
`e2e.mjs` and `attachments.mjs` **require a clean database**; `responsive.mjs`
needs data to exist, so run it after `e2e.mjs`.

---

## 7. Open items

**Blocking a real go-live**

1. **Change the three default passwords.** The site is public with documented
   credentials.
2. **Back up `AADHAAR_ENC_KEY`** off the server. It lives only in
   `/opt/sahayak/.env`, which is gitignored. Lose it and every stored Aadhaar
   number is permanently undecryptable while the app carries on as if fine.
3. **Cron the backups** — `15 2 * * * /opt/sahayak/scripts/backup.sh >> /var/log/lrt-backup.log 2>&1`

**Content still to come from the client**

4. **Real panchayat names** per block — currently `Panchayat 1…12`. Swap via SQL,
   no redeploy: `UPDATE panchayats SET name = '…' WHERE id = …;`
5. **Real Reason-of-Support options** per support type — current list is a
   working default.
6. **Real supervisor accounts** — how many, names, which block each covers.

**Decisions not yet made**

7. `VALIDATE_AADHAAR_CHECKSUM` is `false`. Turning it on catches typos but
   rejects invented test numbers — switch at go-live, after demo data is done.
8. Can the MLA change a decision after accepting/rejecting? Currently final.
9. Can a supervisor edit or delete their own pending form? Currently no.
10. Odia interface? Cheap to wire i18n now, expensive to retrofit later.

---

## 8. Known quirks

**`demo.lrtechnology.in` does not resolve.** The BigRock domain panel shows
records that the authoritative nameservers do not serve — the apex reads
`108.167.146.84` in the panel but `119.18.54.24` in reality, and the panel's
wildcard does not answer. The live zone is managed somewhere else, most likely
the cPanel Zone Editor on the hosting order. `lrt.truehr.co.in` was used instead.
To add the second domain later, once its DNS is fixed:

```bash
certbot --nginx -d lrt.truehr.co.in -d demo.lrtechnology.in
```

**Rate limits are tuneable, and matter here.** A whole panchayat office behind
one public IP counts as a single client. `LOGIN_RATE_MAX` (default 20 / 15 min)
and `API_RATE_MAX` (default 600 / min) are both in `.env`.

**No CSP header on the HTML page** — that is correct. nginx serves the frontend
and Helmet only sets headers on `/api` responses.

**`docker builder prune -f`** reclaimed ~6.4 GB of stale build cache and is safe
to re-run periodically.

---

## 9. Repo layout

```
docker-compose.yml        nginx + api + mysql, with memory caps
.env.example              config template
deploy/                   nginx server block for the host
db/init/                  schema + seed — runs only on an empty database
db/migrations/            applied by hand to a running instance
api/src/routes/           auth, master, beneficiaries, applications, files
api/src/lib/crypto.js     scrypt passwords, AES + SHA-256 Aadhaar
api/src/lib/reference.js  transactional reference numbers
api/docker-entrypoint.sh  fixes upload permissions, drops to `node`
web/src/pages/            Login, Dashboard, SahayakForm, FormList, FormDetail
web/src/components/       ui, Uploader, AmountSummary
scripts/backup.sh         nightly dump + uploads tarball, 14-day retention
docs/PLAN.md              requirements and traceability matrix
docs/DEPLOY.md            first-time deployment runbook
docs/CHECKPOINT.md        this file
```
