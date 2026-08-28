-- 002_seed_master.sql — master data.
-- Edit this file (or run UPDATE/INSERT directly on the server) to change the
-- lists. No application code changes are required.
--
-- The address hierarchy is three levels deep and the form loads it that way:
-- pick a Block, its Zones load; pick a Zone, its Panchayats load. Every level
-- is validated server-side on submission, so a crafted request cannot pair a
-- zone with the wrong block or a panchayat with the wrong zone.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Blocks. `code` is used inside the reference number, e.g. LRT/DHM/2026/000123
-- — changing a block's name is safe, changing its code is not.
-- ---------------------------------------------------------------------------

INSERT INTO blocks (id, name, code, sort_order) VALUES
  (1, 'Dharmasala', 'DHM', 1),
  (2, 'Rasulpur',   'RSD', 2)
ON DUPLICATE KEY UPDATE name = VALUES(name), code = VALUES(code);

-- ---------------------------------------------------------------------------
-- Zones — three per block.
--   rename:  UPDATE zones SET name = 'Real Zone Name' WHERE id = 1;
--   add:     INSERT INTO zones (block_id, name, sort_order) VALUES (1, 'Dharmasala Zone 4', 4);
--   retire:  UPDATE zones SET is_active = 0 WHERE id = 3;   -- never DELETE
-- ---------------------------------------------------------------------------

INSERT INTO zones (id, block_id, name, sort_order) VALUES
  (1, 1, 'Dharmasala Zone 1', 1),
  (2, 1, 'Dharmasala Zone 2', 2),
  (3, 1, 'Dharmasala Zone 3', 3),
  (4, 2, 'Rasulpur Zone 1', 1),
  (5, 2, 'Rasulpur Zone 2', 2),
  (6, 2, 'Rasulpur Zone 3', 3)
ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order);

-- ---------------------------------------------------------------------------
-- Panchayats — PLACEHOLDERS, ten per zone.
--
-- Numbering runs continuously across each block (Zone 1 gets 1–10, Zone 2 gets
-- 11–20, Zone 3 gets 21–30) rather than restarting at 1 in every zone, so no
-- two panchayats in the same block share a name and the MLA's rollup never
-- shows three identical rows.
--
--   rename:  UPDATE panchayats SET name = 'Bhagabanpur' WHERE id = 1;
--   add:     INSERT INTO panchayats (block_id, zone_id, name, sort_order)
--              VALUES (1, 1, 'New Panchayat', 31);
--   retire:  UPDATE panchayats SET is_active = 0 WHERE id = 7;   -- never DELETE,
--            existing applications reference it
--
-- Moving a panchayat between zones needs both columns updated together:
--   UPDATE panchayats SET zone_id = 2, block_id = 1 WHERE id = 5;
-- ---------------------------------------------------------------------------

INSERT INTO panchayats (block_id, zone_id, name, sort_order) VALUES
  (1, 1, 'Dharmasala Panchayat 1', 1), (1, 1, 'Dharmasala Panchayat 2', 2), (1, 1, 'Dharmasala Panchayat 3', 3),
  (1, 1, 'Dharmasala Panchayat 4', 4), (1, 1, 'Dharmasala Panchayat 5', 5), (1, 1, 'Dharmasala Panchayat 6', 6),
  (1, 1, 'Dharmasala Panchayat 7', 7), (1, 1, 'Dharmasala Panchayat 8', 8), (1, 1, 'Dharmasala Panchayat 9', 9),
  (1, 1, 'Dharmasala Panchayat 10', 10), (1, 2, 'Dharmasala Panchayat 11', 11), (1, 2, 'Dharmasala Panchayat 12', 12),
  (1, 2, 'Dharmasala Panchayat 13', 13), (1, 2, 'Dharmasala Panchayat 14', 14), (1, 2, 'Dharmasala Panchayat 15', 15),
  (1, 2, 'Dharmasala Panchayat 16', 16), (1, 2, 'Dharmasala Panchayat 17', 17), (1, 2, 'Dharmasala Panchayat 18', 18),
  (1, 2, 'Dharmasala Panchayat 19', 19), (1, 2, 'Dharmasala Panchayat 20', 20), (1, 3, 'Dharmasala Panchayat 21', 21),
  (1, 3, 'Dharmasala Panchayat 22', 22), (1, 3, 'Dharmasala Panchayat 23', 23), (1, 3, 'Dharmasala Panchayat 24', 24),
  (1, 3, 'Dharmasala Panchayat 25', 25), (1, 3, 'Dharmasala Panchayat 26', 26), (1, 3, 'Dharmasala Panchayat 27', 27),
  (1, 3, 'Dharmasala Panchayat 28', 28), (1, 3, 'Dharmasala Panchayat 29', 29), (1, 3, 'Dharmasala Panchayat 30', 30),
  (2, 4, 'Rasulpur Panchayat 1', 1), (2, 4, 'Rasulpur Panchayat 2', 2), (2, 4, 'Rasulpur Panchayat 3', 3),
  (2, 4, 'Rasulpur Panchayat 4', 4), (2, 4, 'Rasulpur Panchayat 5', 5), (2, 4, 'Rasulpur Panchayat 6', 6),
  (2, 4, 'Rasulpur Panchayat 7', 7), (2, 4, 'Rasulpur Panchayat 8', 8), (2, 4, 'Rasulpur Panchayat 9', 9),
  (2, 4, 'Rasulpur Panchayat 10', 10), (2, 5, 'Rasulpur Panchayat 11', 11), (2, 5, 'Rasulpur Panchayat 12', 12),
  (2, 5, 'Rasulpur Panchayat 13', 13), (2, 5, 'Rasulpur Panchayat 14', 14), (2, 5, 'Rasulpur Panchayat 15', 15),
  (2, 5, 'Rasulpur Panchayat 16', 16), (2, 5, 'Rasulpur Panchayat 17', 17), (2, 5, 'Rasulpur Panchayat 18', 18),
  (2, 5, 'Rasulpur Panchayat 19', 19), (2, 5, 'Rasulpur Panchayat 20', 20), (2, 6, 'Rasulpur Panchayat 21', 21),
  (2, 6, 'Rasulpur Panchayat 22', 22), (2, 6, 'Rasulpur Panchayat 23', 23), (2, 6, 'Rasulpur Panchayat 24', 24),
  (2, 6, 'Rasulpur Panchayat 25', 25), (2, 6, 'Rasulpur Panchayat 26', 26), (2, 6, 'Rasulpur Panchayat 27', 27),
  (2, 6, 'Rasulpur Panchayat 28', 28), (2, 6, 'Rasulpur Panchayat 29', 29), (2, 6, 'Rasulpur Panchayat 30', 30)
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), block_id = VALUES(block_id);

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
