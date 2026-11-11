-- Rolling this migration back does not delete any administrator or audit event.
DELETE FROM settings WHERE setting_key = 'admin_setup_completed';
