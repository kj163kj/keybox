-- Persistent latch: existing (including disabled) administrators close setup.
-- Every bootstrap path locks this row before checking/inserting administrators.
INSERT INTO settings (setting_key, setting_value, updated_at)
SELECT 'admin_setup_completed',
       IF(EXISTS(SELECT 1 FROM admins), 'true', 'false'),
       UTC_TIMESTAMP(6);
