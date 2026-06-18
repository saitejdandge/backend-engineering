-- 1. create_table.sql

CREATE TABLE users (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL
);

CREATE TABLE seats (
    id      SERIAL PRIMARY KEY,
    seat_no VARCHAR(10) NOT NULL
);

CREATE TABLE bookings (
    seat_id INTEGER      NOT NULL REFERENCES seats(id) PRIMARY KEY,
    user_id INTEGER      REFERENCES users(id),
    status  VARCHAR(20)  NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'pending'))
);
