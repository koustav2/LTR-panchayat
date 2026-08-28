-- 003_seed_users.sql — the only place accounts are created.
-- There is no signup and no user-management screen, by design.
--
-- DEFAULT PASSWORDS — change these before going live:
--   mla         / Mla@2026#LRT     decides, and sets the sanctioned amount
--   head        / Head@2026#LRT    verifies and forwards to the MLA
--   sup.dharma  / Sup@2026#DHM     files applications
--   sup.rasul   / Sup@2026#RSD     files applications
--
-- To change a password:
--   cd api && npm run hash-password -- "NewStrongPassword"
--   UPDATE users SET password_hash = '<paste the output>' WHERE username = 'mla';
--
-- The Head Sahayak covers the whole constituency, so block_id is NULL. There is
-- exactly one verification stage between the supervisors and the MLA; adding a
-- second head account works, but they share one queue.
--
-- To add another supervisor:
--   INSERT INTO users (full_name, username, role, block_id, password_hash, is_active)
--   VALUES ('Supervisor - Area 3', 'sup.area3', 'supervisor', 1, '<hash>', 1);
--
-- To disable someone (never DELETE — their submissions reference this row):
--   UPDATE users SET is_active = 0 WHERE username = 'sup.rasul';

SET NAMES utf8mb4;

INSERT INTO users (full_name, username, role, block_id, password_hash, is_active) VALUES
  ('Head Sahayak', 'head', 'head_sahayak', NULL, 'scrypt$16384$8$1$cf3f424077799189464e0899cdf97277$d944c830c9eb4dd9a3c9cd5635216c3161c9b14b32fd515df3bf1a7264eda122510bc14d170a22eb71c2e57940021b1a3323b42e4ee234b7b1379ecbfbf252f1', 1),
  ('MLA Office', 'mla', 'mla', NULL, 'scrypt$16384$8$1$377cea368cc6d27c0477d8e132232ad2$9333e12217e2f47142ca3e58a3ad37f1b3a265778509c32a4dc7352d9ff9d5150fe14cb3c6dd2566408d52690a718cbae5895fd6dac848558f0bb57ccbda5dbe', 1),
  ('Supervisor - Dharmasala', 'sup.dharma', 'supervisor', 1, 'scrypt$16384$8$1$b4509d81dfaccaf6ec13633d639e5a7c$79f6d411d4b04a9cbaf89ff4daf80e15a12fa750891a462afbd9b3bbb7585c86a1c139b45c6faae3b492bab3a25f9f763954735c9896f928e304ac0df64b90ea', 1),
  ('Supervisor - Rasulpur Dharasamal', 'sup.rasul', 'supervisor', 2, 'scrypt$16384$8$1$234bfe0f8057a9f84e7e4a0877776dbc$4c7f0bcb0d8689147bc16a36a90ad4492cc50d8b92002c199d751448634fb34d5a64da0307d61e055f89b2b79d383793f4a1e3a93c035c7b3f369c18bff767c4', 1)
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);
