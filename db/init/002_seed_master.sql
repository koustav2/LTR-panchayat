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
-- Zones — the real list. Five zones sit under Dharmasala and one under
-- Rasulpur; the zone codes are the ward numbers the block office uses.
--   rename:  UPDATE zones SET name = 'Real Zone Name' WHERE id = 1;
--   add:     INSERT INTO zones (block_id, name, sort_order) VALUES (1, 'ZONE-16', 6);
--   retire:  UPDATE zones SET is_active = 0 WHERE id = 3;   -- never DELETE
-- ---------------------------------------------------------------------------

INSERT INTO zones (id, block_id, name, sort_order) VALUES
  (1, 1, 'ZONE-11',    1),
  (2, 1, 'ZONE-12',    2),
  (3, 1, 'ZONE-13',    3),
  (4, 1, 'ZONE-14',    4),
  (5, 1, 'ZONE-15',    5),
  (7, 1, 'ZONE-16',    6),
  (6, 2, 'ZONE-34/35', 1)
ON DUPLICATE KEY UPDATE block_id = VALUES(block_id), name = VALUES(name), sort_order = VALUES(sort_order);

-- ---------------------------------------------------------------------------
-- Panchayats — the real Gram Panchayat list, from "Zone Wise Panchayat Name".
--
-- sort_order restarts at 1 inside each zone (it mirrors the block office's own
-- Sl No), which is fine now that names are real and unique per zone — the
-- uniqueness key is (zone_id, name), so two zones can each hold a "Rasulpur"
-- without clashing.
--
--   rename:  UPDATE panchayats SET name = 'Bhagabanpur' WHERE id = 1;
--   add:     INSERT INTO panchayats (block_id, zone_id, name, sort_order)
--              VALUES (1, 1, 'New Panchayat', 10);
--   retire:  UPDATE panchayats SET is_active = 0 WHERE id = 7;   -- never DELETE,
--            existing applications reference it
--
-- Moving a panchayat between zones needs both columns updated together:
--   UPDATE panchayats SET zone_id = 2, block_id = 1 WHERE id = 5;
-- ---------------------------------------------------------------------------

INSERT INTO panchayats (block_id, zone_id, name, sort_order) VALUES
  -- Dharmasala / ZONE-11
  (1, 1, 'RAICHHANDA', 1), (1, 1, 'REKHIDEIPUR', 2), (1, 1, 'ENDALABA', 3),
  (1, 1, 'KABATABANDHA', 4), (1, 1, 'MADHUSUDANPUR', 5), (1, 1, 'CHAKRADHARPUR', 6),
  (1, 1, 'MARJITAPUR', 7), (1, 1, 'ANJIRA', 8), (1, 1, 'TALAJANGA', 9),
  -- Dharmasala / ZONE-12
  (1, 2, 'JENAPUR', 1), (1, 2, 'BRUNDADEIPUR', 2), (1, 2, 'SAHANIDHIA', 3),
  (1, 2, 'PURUNA BAULAMAL', 4), (1, 2, 'GARHMADHUPUR', 5), (1, 2, 'MAHISARA', 6),
  (1, 2, 'SAMPARU', 7), (1, 2, 'ANTIA', 8), (1, 2, 'KAMAGARH', 9),
  -- Dharmasala / ZONE-13
  (1, 3, 'TARANJIA', 1), (1, 3, 'PAKHARA', 2), (1, 3, 'ARUHA', 3),
  (1, 3, 'THANUAL', 4), (1, 3, 'GANGADHARPUR', 5), (1, 3, 'HARIDASPUR', 6),
  (1, 3, 'NEULUPUR', 7), (1, 3, 'KANTIGADIA', 8), (1, 3, 'KHETRAPAL', 9),
  (1, 3, 'KUMARI', 10),
  -- Dharmasala / ZONE-14
  (1, 4, 'JARAKA', 1), (1, 4, 'CHAHATA', 2), (1, 4, 'SUNDURIA', 3),
  (1, 4, 'ABHAYAPUR', 4), (1, 4, 'CHORAMUHAN', 5), (1, 4, 'KAIMA', 6),
  (1, 4, 'PATAPUR', 7), (1, 4, 'MIRZAPUR', 8), (1, 4, 'BHABANIPUR', 9),
  -- Dharmasala / ZONE-15
  (1, 5, 'UTTARPRATAP PUR', 1), (1, 5, 'DEODA', 2), (1, 5, 'MANGALAPUR', 3),
  (1, 5, 'ARABALA', 4), (1, 5, 'PATUNIA', 5), (1, 5, 'KOTAPUR', 6),
  (1, 5, 'KADAMPAL', 7), (1, 5, 'AREIKANA', 8),
  -- Dharmasala / ZONE-16
  (1, 7, 'FIRST GP', 1), (1, 7, 'SECOND GP', 2), (1, 7, 'THIRD GP', 3),
  -- Rasulpur / ZONE-34/35
  (2, 6, 'SRIBANTPUR', 1), (2, 6, 'NATHUABARA', 2), (2, 6, 'JABARA', 3),
  (2, 6, 'ODISSO', 4), (2, 6, 'KALAN', 5), (2, 6, 'SINGHAPUR', 6),
  (2, 6, 'BARABATI', 7), (2, 6, 'RAHAMBA', 8), (2, 6, 'RASULPUR', 9)
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), block_id = VALUES(block_id);

-- One-time, self-healing cleanup: retire the placeholder panchayats an earlier
-- seed created (names like 'Dharmasala Panchayat 1'). Every real name above is a
-- village name and never contains the word "Panchayat", so this only ever hits
-- placeholders. Retire rather than DELETE — an early test application may still
-- reference one, and a soft-deleted row keeps that foreign key valid while
-- dropping the name out of the form.
UPDATE panchayats SET is_active = 0 WHERE name LIKE '%Panchayat%';

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
