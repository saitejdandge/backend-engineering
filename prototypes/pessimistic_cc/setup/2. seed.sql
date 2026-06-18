-- 2. seed.sql

-- 5,000,000 users with random names
INSERT INTO users (name)
SELECT
    (ARRAY['James','John','Robert','Michael','William','David','Richard','Joseph','Thomas','Charles',
           'Mary','Patricia','Jennifer','Linda','Barbara','Elizabeth','Susan','Jessica','Sarah','Karen',
           'Emma','Liam','Noah','Olivia','Ava','Sophia','Isabella','Mia','Amelia','Harper',
           'Ethan','Mason','Logan','Lucas','Oliver','Aiden','Elijah','Jackson','Sebastian','Mateo']
    )[floor(random() * 40 + 1)::int]
    || ' ' ||
    (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Taylor',
           'Anderson','Thomas','Jackson','White','Harris','Martin','Thompson','Moore','Young','Allen',
           'King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson',
           'Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts','Gomez','Phillips','Evans']
    )[floor(random() * 40 + 1)::int]
FROM generate_series(1, 5000000);

-- 100 seats: 1A-25D
INSERT INTO seats (seat_no)
SELECT
    row_num || col
FROM
    generate_series(1, 25) AS row_num,
    unnest(ARRAY['A','B','C','D']) AS col
ORDER BY row_num, col;

-- Seed bookings: one row per seat, all available
INSERT INTO bookings (seat_id, status)
SELECT id, 'available' FROM seats;
