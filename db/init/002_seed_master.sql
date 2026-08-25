-- 002_seed_master.sql — master data.
-- Edit this file (or run UPDATE/INSERT directly on the server) to change the
-- lists. No application code changes are required.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Blocks. `code` is used inside the reference number, e.g. LRT/DHM/2026/000123
-- ---------------------------------------------------------------------------

INSERT INTO blocks (id, name, code, sort_order) VALUES
  (1, 'Dharmasala',           'DHM', 1),
  (2, 'Rasulpur Dharasamal',  'RSD', 2)
ON DUPLICATE KEY UPDATE name = VALUES(name), code = VALUES(code);

-- ---------------------------------------------------------------------------
-- Panchayats — PLACEHOLDERS.
-- Replace the names below with the real panchayat names when available:
--   UPDATE panchayats SET name = 'Real Name' WHERE id = 1;
-- Adding one:
--   INSERT INTO panchayats (block_id, name, sort_order) VALUES (1, 'New Name', 16);
-- Retiring one (keeps historical applications intact — never DELETE):
--   UPDATE panchayats SET is_active = 0 WHERE id = 7;
-- ---------------------------------------------------------------------------

INSERT INTO panchayats (block_id, name, sort_order) VALUES
  (1, 'Panchayat 1',  1),  (1, 'Panchayat 2',  2),  (1, 'Panchayat 3',  3),
  (1, 'Panchayat 4',  4),  (1, 'Panchayat 5',  5),  (1, 'Panchayat 6',  6),
  (1, 'Panchayat 7',  7),  (1, 'Panchayat 8',  8),  (1, 'Panchayat 9',  9),
  (1, 'Panchayat 10', 10), (1, 'Panchayat 11', 11), (1, 'Panchayat 12', 12),
  (2, 'Panchayat 1',  1),  (2, 'Panchayat 2',  2),  (2, 'Panchayat 3',  3),
  (2, 'Panchayat 4',  4),  (2, 'Panchayat 5',  5),  (2, 'Panchayat 6',  6),
  (2, 'Panchayat 7',  7),  (2, 'Panchayat 8',  8),  (2, 'Panchayat 9',  9),
  (2, 'Panchayat 10', 10), (2, 'Panchayat 11', 11), (2, 'Panchayat 12', 12)
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- ---------------------------------------------------------------------------
-- Type of Support
-- ---------------------------------------------------------------------------

INSERT INTO support_types (id, name, sort_order) VALUES
  (1, 'Education',     1),
  (2, 'Marriage',      2),
  (3, 'Health',        3),
  (4, 'Death Support', 4)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ---------------------------------------------------------------------------
-- Reason of Support — dependent on Type of Support.
-- These are working defaults; replace with the official list when available.
-- ---------------------------------------------------------------------------

INSERT INTO support_reasons (support_type_id, name, sort_order) VALUES
  -- Education
  (1, 'School Admission Fee',            1),
  (1, 'College / University Fee',        2),
  (1, 'Hostel Expenses',                 3),
  (1, 'Books and Study Material',        4),
  (1, 'Examination Fee',                 5),
  (1, 'Coaching / Competitive Exam',     6),
  (1, 'Other Educational Need',          7),
  -- Marriage
  (2, 'Marriage of Daughter',            1),
  (2, 'Marriage of Sister',              2),
  (2, 'Marriage of Dependent',           3),
  (2, 'Other Marriage Expense',          4),
  -- Health
  (3, 'Surgery / Operation',             1),
  (3, 'Hospitalisation',                 2),
  (3, 'Cancer Treatment',                3),
  (3, 'Dialysis',                        4),
  (3, 'Cardiac Treatment',               5),
  (3, 'Accident Injury',                 6),
  (3, 'Medicines and Diagnostics',       7),
  (3, 'Other Medical Need',              8),
  -- Death Support
  (4, 'Funeral Expenses',                1),
  (4, 'Death of Earning Member',         2),
  (4, 'Accidental Death',                3),
  (4, 'Other Death-related Support',     4)
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);
