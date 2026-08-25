# LRT Panchayat — Sahayak Form Portal
## Requirements & Implementation Plan (v3)

**Date:** 2026-08-25
**Stack:** React (Vite) + Node/Express + MySQL 8, Dockerised, self-hosted on your cPanel server
**UI language:** English only
**Design target:** Mobile-first responsive (360px baseline → desktop)

> **v2 changes:** five roles collapsed to two — **Supervisor** and **MLA**. All accounts
> and all master data are seeded directly in the database. No user-management screen,
> no master-data screen, no signup.
>
> **v3 changes:** both logins now share the same two-tile dashboard from the original
> spec. Added a requirements traceability matrix (§12) mapping every line of the
> written spec to where it is handled.

---

## 1. What the system does

Supervisors record support requests (Sahayak applications) from residents of two
blocks. Each application captures the beneficiary's identity, the type and reason of
support sought, and the recorded recommendations of three officials. The MLA reviews
each submission and marks it Accepted or Rejected with a reason. Every application
carries a permanent unique reference number.

---

## 2. Decisions locked in

| Question | Decision |
|---|---|
| Stack | React + Node/Express + MySQL, Docker Compose, own server |
| Logins | **Two roles only: Supervisor and MLA.** Rows seeded in DB, no signup, no admin UI |
| Supervisor count | Several (one per area/panchayat as needed) |
| MLA count | One |
| Who submits | Supervisor |
| Who approves | **MLA only.** Submit → Pending. MLA sets Accepted / Rejected + reason |
| Three officials' comments | Typed on the single form by the submitting Supervisor — they are *form fields*, not logins |
| Uploads | One applicant photo **plus** multiple supporting documents |
| Repeat applicants | One Aadhaar may have **many** applications. Identity fields autofill from DB; only support type / reason / comments / attachments differ per application |
| Master data | Panchayats and Support Reasons seeded via SQL migration. Changes are made by SQL on the server |
| Not needed | Post Office, District |

---

## 3. Roles and permissions

| | **Supervisor** | **MLA** |
|---|---|---|
| Submit Sahayak Form | ✅ | ❌ |
| See own uploaded forms | ✅ | — |
| See all forms (every supervisor) | ❌ | ✅ |
| Search / filter forms | ✅ (own) | ✅ (all) |
| Accept / Reject + reason | ❌ | ✅ |
| View rejection reason | ✅ (on own forms) | ✅ |
| Export CSV | ❌ | ✅ |
| Edit master data | ❌ (SQL only) | ❌ (SQL only) |

### Seeding accounts

Accounts are inserted by a seed migration, not through the app. Passwords are argon2id
hashes — plaintext never touches the database. A helper script generates them:

```bash
npm run hash-password -- "SomeStrongPassword"
# → $argon2id$v=19$m=65536,t=3,p=4$...
```

Then in `migrations/002_seed_users.sql`:

```sql
INSERT INTO users (full_name, username, role, block_id, password_hash, is_active) VALUES
  ('MLA Office',            'mla',        'mla',        NULL, '$argon2id$...', 1),
  ('Supervisor Dharmasala', 'sup.dharma', 'supervisor', 1,    '$argon2id$...', 1),
  ('Supervisor Rasulpur',   'sup.rasul',  'supervisor', 2,    '$argon2id$...', 1);
```

Adding a supervisor later = one INSERT. Password reset = one UPDATE with a new hash.

---

## 4. Data model (MySQL 8)

The critical structural choice: **beneficiary and application are separate tables.**
This is what makes "one Aadhaar, many applications with autofill" work cleanly.

```
users
  id, full_name, username UNIQUE, password_hash,
  role ENUM('supervisor','mla'),
  block_id NULL FK, is_active, last_login_at, created_at

blocks
  id, name, code       -- Dharmasala/DHM, Rasulpur Dharasamal/RSD

panchayats
  id, block_id FK, name, sort_order, is_active
  UNIQUE (block_id, name)

support_types
  id, name, sort_order, is_active     -- Education, Marriage, Health, Death Support

support_reasons
  id, support_type_id FK, name, sort_order, is_active
  UNIQUE (support_type_id, name)

beneficiaries                          -- one row per Aadhaar, ever
  id
  aadhaar_hash   CHAR(64) UNIQUE       -- SHA-256, used for lookup
  aadhaar_enc    VARBINARY(255)        -- AES-encrypted actual number
  aadhaar_last4  CHAR(4)               -- for masked display
  full_name, guardian_name             -- Father / Husband name
  phone          CHAR(10)
  block_id FK, panchayat_id FK, pin_code CHAR(6)
  photo_file_id  FK NULL
  created_by FK users, created_at, updated_at

applications                           -- many per beneficiary
  id
  reference_no   VARCHAR(32) UNIQUE
  beneficiary_id FK
  -- snapshot of address at submission time, so history never rewrites itself
  block_id, panchayat_id, pin_code
  support_type_id FK, support_reason_id FK
  pp_recommend ENUM('yes','no'), pp_comment TEXT   -- Panchayat Prabhari
  ms_recommend ENUM('yes','no'), ms_comment TEXT   -- Mandal Sabhapati
  mp_recommend ENUM('yes','no'), mp_comment TEXT   -- Mandal Prabhari
  status ENUM('pending','accepted','rejected') DEFAULT 'pending'
  rejection_reason TEXT NULL
  reviewed_by FK users NULL, reviewed_at NULL
  submitted_by FK users, submitted_at, updated_at
  INDEX (submitted_by, status), INDEX (status), INDEX (reference_no)

application_files
  id, application_id FK,
  kind ENUM('applicant_photo','document'),
  original_name, stored_path, mime_type, size_bytes, created_at

reference_counters                     -- collision-safe sequence
  block_code, year, last_seq
  PRIMARY KEY (block_code, year)

audit_log
  id, user_id, entity, entity_id, action, payload_json, ip_address, created_at
```

### Reference number

Format: `LRT/<BLOCK>/<YEAR>/<6-digit sequence>` — e.g. `LRT/DHM/2026/000123`

Generated **server-side inside a transaction** against `reference_counters`
(`SELECT ... FOR UPDATE`, increment, insert). Never generated in the browser, never
derived from a timestamp. Uniqueness is additionally guaranteed by the `UNIQUE`
index on `applications.reference_no` — so even a race cannot produce a duplicate.

---

## 5. Screens

### 5.1 Login
Username + password, one shared screen. The role on the account decides which
dashboard loads. Session as JWT in an httpOnly cookie. Rate-limited.

### 5.2 Dashboard (both logins — same two tiles)

Exactly two large tap targets, as specified:

- **Sahayak Form** → opens the entry form
- **List of Form Uploaded** → the submissions list

What sits behind each tile depends on the role:

| Tile | Supervisor | MLA |
|---|---|---|
| **Sahayak Form** | Opens the entry form | Hidden — the MLA does not submit forms |
| **List of Form Uploaded** | Their own submissions | Every submission, from every supervisor, with a "Submitted by" column and an Accept/Reject action on each row |

Below the tiles, a counter strip shows Pending / Accepted / Rejected — scoped to that
supervisor's own forms, or across all supervisors for the MLA. For the MLA the
Pending count is the review queue, so no separate queue screen is needed.

The MLA also gets an Export CSV action on the list screen.

### 5.3 Sahayak Form (Supervisor only)

Today's date is displayed at the top of the form (server date, read-only), beside
a "Reference No. will be generated on submit" note.

Grouped into four collapsible sections so a phone screen stays manageable:

**A. Applicant**
| Field | Type | Validation |
|---|---|---|
| Aadhaar Card | numeric, 12 digits | exactly 12 digits; triggers lookup |
| Name | text | required, 2–100 chars |
| Father / Husband Name | text | required |
| Phone Number | numeric, 10 digits | exactly 10, starts 6–9 |
| Block | dropdown | Dharmasala / Rasulpur Dharasamal |
| Panchayat | dependent dropdown | filtered by Block |
| PIN Number | free entry | 6 digits |

**Aadhaar autofill behaviour:** when 12 digits are entered, the app looks the number
up (debounced, 400ms). If the beneficiary already exists, Name, Father/Husband Name,
Phone, Block, Panchayat and PIN are filled in automatically and a banner appears —
*"Existing beneficiary. 2 previous applications."* — with a link to view them. The
fields stay editable behind an "Edit details" toggle; editing them updates the
beneficiary master record and is written to the audit log.

**B. Support**
| Field | Type |
|---|---|
| Type of Support | dropdown — Education, Marriage, Health, Death Support |
| Reason of Support | dependent dropdown, filtered by Type of Support |

**C. Recommendations** (three identical blocks, typed by the Supervisor)
| Field | Type |
|---|---|
| Comments of Panchayat Prabhari | Yes / No dropdown + comment box |
| Comments of Mandal Sabhapati | Yes / No dropdown + comment box |
| Comments of Mandal Prabhari | Yes / No dropdown + comment box |

**D. Attachments**
- Applicant photo — single image, camera capture enabled on mobile, client-side
  compressed to ≈300KB before upload
- Supporting documents — up to 5 files, JPG/PNG/PDF, 5MB each

**Submit** → success screen showing the reference number large, with Copy and
"Start new form" buttons.

### 5.4 List of Form Uploaded
- Search field: matches reference number, name, phone, or Aadhaar last-4
- Status filter chips: All / Pending / Accepted / Rejected
- Card list on mobile, table on desktop
- Rejected rows show the rejection reason inline, in red
- Tap a row → read-only application detail with attachments
- Scope: Supervisor sees only their own rows; MLA sees all, with an extra
  "Submitted by" column and a supervisor filter

### 5.5 Review (MLA only)
Reached by tapping any row in the MLA's List of Form Uploaded. Opens the
application read-only, with two actions at the bottom:
**Accept** and **Reject**. Reject opens a required reason box. The decision, the
reason and the timestamp are stored and written to the audit log. Decisions are
final — reopening a decided application is not in scope for v1 (see open question 8).

---

## 6. Mobile-responsive rules

- Mobile-first CSS, breakpoints at 640 / 1024px
- 16px minimum input font size (stops iOS auto-zoom on focus)
- 44px minimum tap target height
- `inputMode="numeric"` on Aadhaar, Phone, PIN — brings up the number pad
- Sticky bottom bar holding the Submit button
- Single-column form throughout; two-column only above 1024px
- Bottom tab bar on mobile, sidebar on desktop
- **Draft autosave to localStorage** — field connectivity is unreliable; a half-typed
  form must survive a dropped connection or an accidental back-swipe
- Skeleton loaders instead of spinners on the list screen

---

## 7. Security (Aadhaar is sensitive personal data)

- Aadhaar stored **encrypted at rest** (AES-256, key in env), with a separate
  SHA-256 hash column used for lookups — the plaintext number is never indexed
- Lists and exports show masked form `XXXX XXXX 1234`; full number visible only on
  the detail screen, and the view is audit-logged
- Passwords hashed with argon2id, seeded as hashes only
- JWT in httpOnly + Secure + SameSite cookie; short access token + refresh
- Rate limiting on login and on the Aadhaar lookup endpoint (prevents enumeration)
- Uploads stored **outside the web root**, served only through an authenticated
  route with role checks; MIME sniffing on upload, not just extension trust
- Full audit log of create / update / status change / Aadhaar reveal
- HTTPS enforced; HSTS

---

## 8. API surface (REST)

```
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/master/blocks
GET    /api/master/panchayats?blockId=
GET    /api/master/support-types
GET    /api/master/support-reasons?typeId=

GET    /api/beneficiaries/lookup?aadhaar=      -> 200 with data | 404 if new

POST   /api/applications                       -> supervisor; returns reference_no
GET    /api/applications?q=&status=&page=      -> supervisor: own only | mla: all
GET    /api/applications/:id
POST   /api/applications/:id/files
PATCH  /api/applications/:id/status            -> MLA only
GET    /api/applications/export.csv            -> MLA only
```

Role scoping is enforced **server-side on every endpoint**, not by hiding buttons in
the UI.

---

## 9. Deployment (Docker on your server)

```
docker-compose.yml
  nginx      : serves the built React bundle, reverse-proxies /api, TLS
  api        : Node 20 / Express
  db         : MySQL 8   -> volume ./data/mysql
  (uploads)  : bind mount ./data/uploads
```

- All secrets in `.env` (never committed): DB password, JWT secret, AES key
- Migrations + seed run on container start
- Nightly cron: `mysqldump` + `tar` of uploads → `./backups`, 14-day retention

> ⚠️ **Blocker to confirm:** Docker requires a **VPS or dedicated server with root
> access**. Standard *shared* cPanel hosting cannot run Docker. If your server is
> shared cPanel, we deploy instead as: static React build in `public_html`, Node API
> via cPanel's "Setup Node.js App", MySQL from cPanel's database manager. Same code,
> different packaging — but I need to know which before Phase 0.

---

## 10. Build phases

| Phase | Content | Est. |
|---|---|---|
| 0 | Repo scaffold, Docker Compose, migrations, seed users + master data | 1 day |
| 1 | Auth, two-role routing, both dashboards, responsive layout system | 1.5 days |
| 2 | Sahayak Form: all fields, dependent dropdowns, Aadhaar lookup/autofill, reference number, uploads | 3–4 days |
| 3 | List of Forms: search, status filters, detail view, rejection reasons, MLA scoping | 2 days |
| 4 | MLA review queue: accept / reject + reason, CSV export | 1 day |
| 5 | Hardening: encryption, rate limits, audit log, backups, deploy, UAT fixes | 2 days |

**Total ≈ 10–12 working days.** (Down from 12–14 — dropping user management and the
master-data admin UI saved about two days.)

---

## 11. Open questions — please answer before Phase 0

1. **Is your cPanel server a VPS/dedicated with root + Docker, or shared hosting?**
   (Deployment blocker.)
2. **Real Panchayat names per block**, and **real Reason-of-Support options per
   support type.** These now go straight into the seed SQL, so they are needed
   earlier than before. Placeholders (1, 2, 3…) work for development only.
3. **How many supervisor accounts**, and their names/usernames/blocks? Needed for the
   seed migration.
4. Reference number format — is `LRT/DHM/2026/000123` acceptable, or is there an
   existing convention to match?
5. If the same Aadhaar already has a **pending** application of the same support
   type, should the system **block** the new one, **warn and allow**, or say nothing?
6. When an official's dropdown says **No**, is the comment box mandatory?
7. Should we validate the Aadhaar checksum (Verhoeff), or accept any 12 digits?
   Checksum catches typos but rejects test/dummy numbers.
8. Can the MLA **change a decision** after accepting/rejecting, or is it final?
9. Can a Supervisor **edit or delete** their own form while it is still Pending?
10. Is a **support amount** field needed anywhere? Not in the current spec, but most
    scheme forms have one.
11. Odia interface later? If yes I will wire i18n scaffolding in Phase 1 (cheap now,
    expensive to retrofit).

---

## 12. Requirements traceability

Every line of the written spec, and where it is handled. Nothing below is unresolved
unless the Notes column says so.

| # | Requirement as written | Where handled | Notes |
|---|---|---|---|
| 1 | Adhar Card — 12 digit free | §5.3 A, `beneficiaries.aadhaar_*` | Free numeric entry, exactly 12 digits. Stored encrypted, masked in lists. Checksum validation is open question 7 |
| 2 | Phone Number — 10 digit integer | §5.3 A, `beneficiaries.phone` | Stored as CHAR(10), not INT — an integer column would eat a leading digit and break sorting. Validated 10 digits starting 6–9 |
| 3 | Name | §5.3 A, `beneficiaries.full_name` | Required, 2–100 chars |
| 4 | Father / Husband Name | §5.3 A, `beneficiaries.guardian_name` | Required |
| 5 | Block — Dharmasala or Rasulpur Dharasamal | §5.3 A, `blocks` table | Two rows, seeded. Codes DHM / RSD feed the reference number |
| 6 | Panchayat — dependency dropdown, for now 1, 2, 3 etc | §5.3 A, `panchayats` table | Filtered by selected Block. Seeded as 1, 2, 3… placeholders; real names swap in via SQL with no code change |
| 7 | Post Office not needed, District not needed | — | Deliberately absent from schema and form |
| 8 | Pin number — free entry | §5.3 A, `pin_code` | Free text field, validated as 6 digits |
| 9 | Type of Support — dropdown: Education, Marriage, Health, Death Support | §5.3 B, `support_types` | Four rows, seeded |
| 10 | Reason of Support — dependency dropdown with Type of Support | §5.3 B, `support_reasons` | Filtered by selected Type of Support. Placeholders until you send the real lists |
| 11 | Comments of Panchayat Prabhari — Yes/No dropdown with comments | §5.3 C, `pp_recommend` + `pp_comment` | Typed by the Supervisor on the form |
| 12 | Comments of Mandal Sabhapati — Yes/No dropdown with comments | §5.3 C, `ms_recommend` + `ms_comment` | Same |
| 13 | Comments of Mandal Prabhari — Yes/No dropdown with comments | §5.3 C, `mp_recommend` + `mp_comment` | Same |
| 14 | Photo upload | §5.3 D, `application_files` | One applicant photo (camera capture on mobile) **plus** up to 5 supporting documents, per your confirmation |
| 15 | Show today's date at top of the form | §5.3 header | Server date, read-only, not user-editable — so it cannot be backdated |
| 16 | Keep every form reference number, unique combination | §4 "Reference number", `reference_counters` | `LRT/DHM/2026/000123`. Generated server-side in a transaction; UNIQUE index as backstop. Never reused, never deleted |
| 17 | If Aadhaar already registered, auto-fill Name, Father/Husband Name, Phone, Block, Panchayat, PIN from DB | §5.3 "Aadhaar autofill behaviour" | Debounced lookup on the 12th digit. This is why `beneficiaries` and `applications` are separate tables — one Aadhaar, many applications |
| 18 | After login, dashboard shows two options: Sahayak Form, List of Form Uploaded | §5.2 | Same two tiles for both logins |
| 19 | List of Form Uploaded → forms uploaded by the login person, with status pending / accepted / rejected | §5.4 | Supervisor sees own only; MLA sees all. Scoping enforced server-side |
| 20 | If rejected, show reason | §5.4, `rejection_reason` | Shown inline on the list row in red, and in full on the detail screen |
| 21 | Search field in list of forms | §5.4 | Matches reference number, name, phone, or Aadhaar last-4 |
| 22 | Click Sahayak Form → open the form | §5.2 → §5.3 | Supervisor only |
