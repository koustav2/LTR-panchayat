-- LRT Panchayat — Sahayak Form Portal
-- 001_schema.sql — core schema
-- MySQL 8 / MariaDB 10.11 compatible

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blocks (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  code        VARCHAR(8)   NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_blocks_name (name),
  UNIQUE KEY uq_blocks_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Zones sit between a block and its panchayats. The form loads them as a
-- dependent dropdown: pick a block, the zones load; pick a zone, the panchayats
-- load.
CREATE TABLE IF NOT EXISTS zones (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  block_id    INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_zone_block_name (block_id, name),
  KEY ix_zone_block (block_id),
  CONSTRAINT fk_zone_block FOREIGN KEY (block_id) REFERENCES blocks (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- `block_id` is derivable through zone_id and is kept anyway: nearly every
-- query wants the block, and carrying it here avoids a three-table join on the
-- hot list and rollup paths. The seed keeps the two consistent, and the create
-- handler validates zone.block_id and panchayat.zone_id on every submission, so
-- a drifted row cannot be referenced by a new application.
CREATE TABLE IF NOT EXISTS panchayats (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  block_id    INT UNSIGNED NOT NULL,
  zone_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_panchayat_zone_name (zone_id, name),
  KEY ix_panchayat_block (block_id),
  KEY ix_panchayat_zone (zone_id),
  CONSTRAINT fk_panchayat_block FOREIGN KEY (block_id) REFERENCES blocks (id),
  CONSTRAINT fk_panchayat_zone  FOREIGN KEY (zone_id)  REFERENCES zones (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS support_types (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_support_type_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS support_reasons (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  support_type_id INT UNSIGNED NOT NULL,
  name            VARCHAR(160) NOT NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reason_type_name (support_type_id, name),
  KEY ix_reason_type (support_type_id),
  CONSTRAINT fk_reason_type FOREIGN KEY (support_type_id) REFERENCES support_types (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Users — seeded by SQL only. No signup, no in-app user management.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name      VARCHAR(120) NOT NULL,
  username       VARCHAR(60)  NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  -- supervisor files, head_sahayak verifies, mla decides. Seeded by SQL only.
  role           ENUM('supervisor','head_sahayak','mla') NOT NULL,
  block_id       INT UNSIGNED NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY ix_users_block (block_id),
  CONSTRAINT fk_users_block FOREIGN KEY (block_id) REFERENCES blocks (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Uploaded files. Stored outside the web root; served through an
-- authenticated route only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS files (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- distribution_photo is the proof-of-handover shot taken when a Sahayak
  -- records that an approved application's money reached the applicant.
  kind          ENUM('applicant_photo','document','distribution_photo') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(160) NOT NULL,
  mime_type     VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  uploaded_by   INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_files_stored_name (stored_name),
  CONSTRAINT fk_files_user FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Beneficiaries — one row per Aadhaar, ever. Many applications may point here.
-- Aadhaar is stored encrypted; lookup happens on a separate SHA-256 hash so the
-- plaintext number is never indexed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS beneficiaries (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  aadhaar_hash   CHAR(64) NOT NULL,
  aadhaar_enc    VARBINARY(255) NOT NULL,
  aadhaar_last4  CHAR(4) NOT NULL,
  full_name      VARCHAR(120) NOT NULL,
  guardian_name  VARCHAR(120) NOT NULL,
  phone          CHAR(10) NOT NULL,
  block_id       INT UNSIGNED NOT NULL,
  zone_id        INT UNSIGNED NOT NULL,
  panchayat_id   INT UNSIGNED NOT NULL,
  pin_code       CHAR(6) NOT NULL,
  photo_file_id  INT UNSIGNED NULL,
  created_by     INT UNSIGNED NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_beneficiary_aadhaar (aadhaar_hash),
  KEY ix_beneficiary_name (full_name),
  KEY ix_beneficiary_phone (phone),
  CONSTRAINT fk_beneficiary_block     FOREIGN KEY (block_id)      REFERENCES blocks (id),
  CONSTRAINT fk_beneficiary_zone      FOREIGN KEY (zone_id)       REFERENCES zones (id),
  CONSTRAINT fk_beneficiary_panchayat FOREIGN KEY (panchayat_id)  REFERENCES panchayats (id),
  CONSTRAINT fk_beneficiary_photo     FOREIGN KEY (photo_file_id) REFERENCES files (id),
  CONSTRAINT fk_beneficiary_creator   FOREIGN KEY (created_by)    REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Applications — many per beneficiary.
-- Block / panchayat / pin are snapshotted at submission time so historical
-- records are never rewritten when a beneficiary's details later change.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS applications (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference_no      VARCHAR(32) NOT NULL,
  beneficiary_id    INT UNSIGNED NOT NULL,

  -- Identity and address are snapshotted at submission time. The beneficiary
  -- row holds the *current* values and drives autofill; these columns hold
  -- what was actually submitted, so a decided application always shows the
  -- details it was decided on, even if the person later changes their phone
  -- number or corrects a spelling.
  applicant_name    VARCHAR(120) NOT NULL,
  guardian_name     VARCHAR(120) NOT NULL,
  phone             CHAR(10) NOT NULL,
  block_id          INT UNSIGNED NOT NULL,
  zone_id           INT UNSIGNED NOT NULL,
  panchayat_id      INT UNSIGNED NOT NULL,
  pin_code          CHAR(6) NOT NULL,

  support_type_id   INT UNSIGNED NOT NULL,
  support_reason_id INT UNSIGNED NOT NULL,
  -- Amount of support sought, in rupees. DECIMAL, never FLOAT — money summed
  -- as binary floating point drifts, and these totals are reported upward.
  amount            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  -- What the MLA actually sanctions. NULL until they decide. May be higher or
  -- lower than `amount` — every total describing money *granted* reads this
  -- column, and every total describing money *asked for* reads `amount`.
  approved_amount   DECIMAL(12,2) NULL,

  pp_recommend      ENUM('yes','no') NOT NULL,
  pp_comment        TEXT NULL,
  ms_recommend      ENUM('yes','no') NOT NULL,
  ms_comment        TEXT NULL,
  mp_recommend      ENUM('yes','no') NOT NULL,
  mp_comment        TEXT NULL,

  -- Head Sahayak verification. A comment is required whether they forward the
  -- application to the MLA or reject it, so there is always a record of why.
  head_comment      TEXT NULL,
  head_reviewed_by  INT UNSIGNED NULL,
  head_reviewed_at  DATETIME NULL,

  -- The three-stage pipeline, in order:
  --   pending_head   filed, waiting on the Head Sahayak
  --   pending_mla    forwarded by the Head Sahayak, waiting on the MLA
  --   head_rejected  turned down by the Head Sahayak — terminal, never reaches the MLA for a decision
  --   accepted       MLA accepted; approved_amount is set
  --   rejected       MLA rejected; rejection_reason is set
  status            ENUM('pending_head','pending_mla','head_rejected','accepted','rejected')
                      NOT NULL DEFAULT 'pending_head',
  -- Required when rejecting; shown to the supervisor as the reason.
  rejection_reason  TEXT NULL,
  -- Optional note the MLA can leave when accepting (or alongside a rejection).
  mla_comment       TEXT NULL,
  reviewed_by       INT UNSIGNED NULL,
  reviewed_at       DATETIME NULL,

  -- Handover. Deliberately NOT a sixth status: distribution is a separate axis
  -- from the decision, and folding it into `status` would take distributed
  -- money out of the `accepted` totals the MLA reports upward. An accepted
  -- application is either undistributed (distributed_at IS NULL) or
  -- distributed, and stays accepted either way.
  distributed_at    DATETIME NULL,
  distributed_by    INT UNSIGNED NULL,
  distribution_photo_file_id INT UNSIGNED NULL,

  submitted_by      INT UNSIGNED NOT NULL,
  submitted_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_application_reference (reference_no),
  KEY ix_app_submitter_status (submitted_by, status),
  KEY ix_app_status (status),
  KEY ix_app_beneficiary (beneficiary_id),
  KEY ix_app_submitted_at (submitted_at),
  KEY ix_app_applicant_name (applicant_name),
  KEY ix_app_rollup (block_id, panchayat_id, status),
  KEY ix_app_phone (phone),
  KEY ix_app_head_reviewer (head_reviewed_by),
  KEY ix_app_zone (zone_id),
  KEY ix_app_zone_rollup (block_id, zone_id, panchayat_id, status),
  -- Drives the approval list: accepted forms, undistributed first.
  KEY ix_app_distribution (status, distributed_at),
  CONSTRAINT fk_app_beneficiary FOREIGN KEY (beneficiary_id)    REFERENCES beneficiaries (id),
  CONSTRAINT fk_app_block       FOREIGN KEY (block_id)          REFERENCES blocks (id),
  CONSTRAINT fk_app_panchayat   FOREIGN KEY (panchayat_id)      REFERENCES panchayats (id),
  CONSTRAINT fk_app_type        FOREIGN KEY (support_type_id)   REFERENCES support_types (id),
  CONSTRAINT fk_app_reason      FOREIGN KEY (support_reason_id) REFERENCES support_reasons (id),
  CONSTRAINT fk_app_reviewer    FOREIGN KEY (reviewed_by)       REFERENCES users (id),
  CONSTRAINT fk_app_head_reviewer FOREIGN KEY (head_reviewed_by) REFERENCES users (id),
  CONSTRAINT fk_app_zone        FOREIGN KEY (zone_id)           REFERENCES zones (id),
  CONSTRAINT fk_app_distributor FOREIGN KEY (distributed_by)    REFERENCES users (id),
  CONSTRAINT fk_app_dist_photo  FOREIGN KEY (distribution_photo_file_id) REFERENCES files (id),
  CONSTRAINT fk_app_submitter   FOREIGN KEY (submitted_by)      REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS application_files (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id INT UNSIGNED NOT NULL,
  file_id        INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_file (application_id, file_id),
  KEY ix_app_files_app (application_id),
  CONSTRAINT fk_appfile_app  FOREIGN KEY (application_id) REFERENCES applications (id) ON DELETE CASCADE,
  CONSTRAINT fk_appfile_file FOREIGN KEY (file_id)        REFERENCES files (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Reference number counter. One row per block per year; incremented inside a
-- transaction with SELECT ... FOR UPDATE so concurrent submissions cannot
-- produce the same number. The UNIQUE index on applications.reference_no is
-- the second line of defence.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reference_counters (
  block_code VARCHAR(8) NOT NULL,
  year       SMALLINT UNSIGNED NOT NULL,
  last_seq   INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (block_code, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NULL,
  entity      VARCHAR(40) NOT NULL,
  entity_id   VARCHAR(40) NULL,
  action      VARCHAR(40) NOT NULL,
  detail      TEXT NULL,
  ip_address  VARCHAR(45) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity, entity_id),
  KEY ix_audit_user (user_id),
  KEY ix_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
