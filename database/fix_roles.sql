-- ============================================================
-- Teen Girl POS — Fix Roles & Users
-- Run this in pgAdmin Query Tool
-- ============================================================

-- STEP 1: Rename original "Admin" role to "Owner"
-- (id=1 is the original role your admin user already has)
UPDATE roles SET role_name = 'Owner' WHERE id = 1;

-- STEP 2: Point all users with the new duplicate roles (id=16,17,18)
-- back to the originals (id=1,2,3), then delete the duplicates

-- Move owner user back to role id=1 (now renamed to Owner)
UPDATE users SET role_id = 1 WHERE username = 'owner';

-- Move manager1 to original Manager (id=2) — already correct but just in case
UPDATE users SET role_id = 2 WHERE username = 'manager1';

-- Move cashier1 to original Cashier (id=3) — already correct
UPDATE users SET role_id = 3 WHERE username = 'cashier1';

-- STEP 3: Delete the duplicate roles we added by mistake
DELETE FROM roles WHERE id IN (16, 17, 18);

-- STEP 4: Verify final state
SELECT u.id, u.username, r.role_name, u.is_active
FROM users u
JOIN roles r ON u.role_id = r.id
ORDER BY r.id, u.username;

SELECT id, role_name FROM roles ORDER BY id;
