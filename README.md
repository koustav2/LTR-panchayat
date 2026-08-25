# LRT Panchayat — Sahayak Form Portal

Mobile-first web application for recording and reviewing Sahayak support
applications across Dharmasala and Rasulpur Dharasamal blocks.

Two roles, both seeded directly in the database — there is no signup and no
user-management screen:

| Role | What they do |
|---|---|
| **Supervisor** | Fills the Sahayak Form; sees their own submissions and statuses |
| **MLA** | Sees every submission; accepts or rejects with a reason; exports CSV |

**Stack:** React 18 + Vite · Node 20 + Express · MySQL 8 · Docker Compose
**Bundle:** 63 KB gzipped · **Tests:** 110 API + 51 journey + 37 responsive + 42 detail/amount checks, all passing

---

## Quick start (Docker)

```bash
cp .env.example .env
nano .env                 # set the passwords and the two secrets

# Generate each secret with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up -d --build
docker compose logs -f api      # wait for "[api] listening on :4000"
```

Open **http://localhost:8080** (or your server's address on `HTTP_PORT`).

### Default accounts — change these before going live

| Username | Password | Role |
|---|---|---|
| `mla` | `Mla@2026#LRT` | MLA |
| `sup.dharma` | `Sup@2026#DHM` | Supervisor — Dharmasala |
| `sup.rasul` | `Sup@2026#RSD` | Supervisor — Rasulpur Dharasamal |

```bash
cd api && npm run hash-password -- "YourNewStrongPassword"
# then, on the server:
docker compose exec db mysql -u root -p lrt_panchayat \
  -e "UPDATE users SET password_hash='<paste>' WHERE username='mla';"
```

---

## Deploying on shared cPanel (no Docker)

Shared cPanel hosting cannot run Docker. The same code deploys without it:

1. **Database** — in cPanel → *MySQL Databases*, create a database and user.
   Then in *phpMyAdmin*, import `db/init/001_schema.sql`, `002_seed_master.sql`
   and `003_seed_users.sql`, in that order.

2. **API** — in cPanel → *Setup Node.js App*:
   - Application root: `api`
   - Application startup file: `src/server.js`
   - Node version: 18 or newer
   - Add the environment variables from `.env.example` (`DB_HOST` is usually
     `localhost`), plus `SERVE_WEB_DIR=/home/<user>/lrt/web/dist` so the one
     Node process serves the frontend as well.
   - Click *Run NPM Install*, then *Restart*.

3. **Frontend** — build it locally and upload the result:
   ```bash
   cd web && npm ci && npm run build      # produces web/dist
   ```
   Upload `web/dist` to the path you set in `SERVE_WEB_DIR`.

4. **Uploads** — set `UPLOAD_DIR` to a folder **outside** `public_html`, for
   example `/home/<user>/lrt-uploads`. Files are streamed through an
   authenticated route; they must never be directly reachable over the web.

No password hashing library needs compiling — hashing uses Node's built-in
scrypt, so there is no native build step anywhere in the stack.

---

## Local development

```bash
# terminal 1 — API on :4000
cd api && npm install && cp ../.env.example .env && npm run dev

# terminal 2 — Vite dev server on :5173, proxying /api to :4000
cd web && npm install && npm run dev
```

## Tests

```bash
# API — 68 checks against a running server
cd api && BASE=http://localhost:4000 npm run smoke

# Browser — 50 checks on a 390px viewport, screenshots into web/screens/
cd web && npm install playwright && node e2e.mjs

# Responsive — 37 checks at 390px, 768px and 1440px, both roles.
# Run e2e first: this one needs applications to exist.
cd web && node responsive.mjs
```

Both browser suites need `CHROME_PATH` set if Playwright's own Chromium is not
installed, and the app served at `BASE` (default `http://localhost:4000`).

---

## Changing the lists (panchayats, support reasons)

All master data lives in the database. Nothing is hardcoded, so no redeploy is
needed:

```sql
-- rename a placeholder
UPDATE panchayats SET name = 'Bhagabanpur' WHERE block_id = 1 AND name = 'Panchayat 1';

-- add one
INSERT INTO panchayats (block_id, name, sort_order) VALUES (1, 'New Panchayat', 13);

-- retire one — never DELETE, existing applications reference it
UPDATE panchayats SET is_active = 0 WHERE id = 7;

-- add a reason under Health (support_type_id = 3)
INSERT INTO support_reasons (support_type_id, name, sort_order) VALUES (3, 'Eye Surgery', 9);
```

`db/init/002_seed_master.sql` is the reference copy of these lists.

---

## How it works

### Applying a schema change to a running instance

`db/init/` runs **only** against an empty database. An existing deployment needs
migrations applied by hand:

```bash
cd /opt/sahayak
git pull

PW=$(grep '^MYSQL_ROOT_PASSWORD=' .env | cut -d= -f2)
for m in db/migrations/*.sql; do
  echo "applying $m"
  docker compose exec -T db mysql -u root -p"$PW" lrt_panchayat < "$m"
done

docker compose up -d --build
```

Every file in `db/migrations/` is safe to run more than once.

### Amount totals

Each application carries an `amount` (DECIMAL, never FLOAT — money summed as
binary floating point drifts, and these totals get reported upward).

`GET /api/applications/summary` rolls them up by block, then by panchayat:

```
requested = accepted + pending
```

A **rejected** application is deliberately excluded from *requested* — once the
MLA has turned it down it is no longer money being asked for. It is reported in
its own column so the figure stays visible rather than vanishing. The dashboard
states the rule on screen so nobody has to guess.

The endpoint is MLA-only, enforced server-side.

### One Aadhaar, many applications

`beneficiaries` holds one row per Aadhaar, ever. `applications` holds many rows
per beneficiary. When a supervisor types a 12-digit Aadhaar the app looks it up
and fills in Name, Father/Husband Name, Phone, Block, Panchayat and PIN
automatically; only the support type, reason, recommendations and attachments
are entered fresh.

Each application also **snapshots** the applicant's name, guardian name, phone,
block, panchayat and PIN at submission time. The beneficiary row holds the
current values and drives autofill; the snapshot means a form that was already
decided still shows the details it was decided on, even after the person later
corrects a spelling or changes their number.

### Reference numbers

Format `LRT/DHM/2026/000123` — prefix, block code, year, six-digit sequence.

Generated server-side inside a transaction against `reference_counters`, locked
with `SELECT ... FOR UPDATE`, with a `UNIQUE` index on `applications.reference_no`
as a second line of defence. Two supervisors submitting at the same instant
serialise on the counter row rather than both reading the same value. Verified
by an eight-way concurrent submission in the smoke test.

### Aadhaar protection

Stored twice: AES-256-GCM ciphertext (reversible, revealed only on the detail
screen, and every reveal is written to the audit log) and a peppered SHA-256
hash used for lookups. The plaintext number is never indexed. Lists, search
results and CSV exports only ever show `XXXX XXXX 1234`.

> Keep `AADHAAR_ENC_KEY` backed up somewhere safe. Lose it and stored Aadhaar
> numbers cannot be decrypted. Change `AADHAAR_HASH_PEPPER` and existing records
> stop being findable by Aadhaar.

### Role scoping

Enforced on the server for every endpoint. A supervisor cannot widen their view
by editing a URL or a request body — hiding buttons in the UI is a convenience,
not the control.

### Two layouts, one codebase

Below 1024px the app is a phone: a green top bar, stacked cards, and an action
bar pinned to the bottom of the screen. From 1024px up it becomes a desktop
console — a persistent sidebar with navigation and a pending-count badge, the
form list as a sortable-width data table instead of cards, and the application
detail split into the record plus a sticky decision panel beside it.

The switch is CSS, not a second app: the list renders the same data as both
cards and a table and the media query shows one or the other, so there is no
duplicated logic to drift apart. Verified at 390px, 768px and 1440px for both
roles — sidebar visibility, card-versus-table, column counts, 16px inputs, and
zero horizontal overflow at every width.

### Built for patchy connections

- Photos are resized and re-encoded in the browser before upload — a 5 MB camera
  photo goes up as roughly 200 KB
- The form autosaves a draft to `localStorage`, so a dropped connection or an
  accidental back-swipe does not lose a half-typed application
- 62 KB gzipped bundle, no icon fonts, no external requests

---

## Project layout

```
docker-compose.yml       Full stack: nginx + api + mysql
.env.example             Configuration template
db/init/                 Schema and seed data, applied in filename order
  001_schema.sql
  002_seed_master.sql    Blocks, panchayats, support types and reasons
  003_seed_users.sql     The two roles' accounts
api/
  src/routes/            auth, master, beneficiaries, applications, files
  src/lib/crypto.js      scrypt passwords, AES + SHA-256 Aadhaar
  src/lib/reference.js   Transactional reference numbers
  scripts/hash-password.js
  scripts/smoke-test.js  68 API checks
web/
  src/pages/             Login, Dashboard, SahayakForm, FormList, FormDetail
  e2e.mjs                50 browser checks on a phone viewport
scripts/backup.sh        Nightly dump + uploads tarball, 14-day retention
docs/PLAN.md             Requirements, data model and traceability matrix
```

## Backups

```bash
crontab -e
15 2 * * *  /path/to/LRT_PANCHAYAT/scripts/backup.sh >> /var/log/lrt-backup.log 2>&1
```

Writes a gzipped database dump and a tarball of the uploads into `backups/`,
pruning anything older than 14 days.

## Configuration worth knowing

| Variable | Default | Effect |
|---|---|---|
| `VALIDATE_AADHAAR_CHECKSUM` | `false` | Enforces the Verhoeff check digit. Catches typos, rejects invented test numbers. Turn on at go-live. |
| `DUPLICATE_PENDING_POLICY` | `warn` | Same Aadhaar with a pending application of the same type: `block`, `warn` (confirm dialog), or `off`. |
| `MAX_DOCUMENTS` | `5` | Supporting documents per application. |
| `MAX_UPLOAD_BYTES` | `5242880` | Per-file upload limit. |
| `JWT_TTL_SECONDS` | `43200` | Session length (12 hours). |
