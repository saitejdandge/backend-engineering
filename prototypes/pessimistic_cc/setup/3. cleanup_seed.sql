-- 3. cleanup_seed.sql
-- Resets all bookings back to available

UPDATE bookings SET user_id = NULL, status = 'available';
