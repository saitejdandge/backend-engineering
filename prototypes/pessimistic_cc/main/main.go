package main

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
)

const dsn = "host=localhost port=5433 user=admin password=secret dbname=mydb sslmode=disable"

var (
	totalBooked int64
	totalMissed int64
)

func bookSeat(ctx context.Context, db *sql.DB, userID int) (bool, error) {
	select {
	case <-ctx.Done():
		return false, nil
	default:
	}

	tx, err := db.Begin()
	if err != nil {
		return false, err
	}

	var seatID int
	err = tx.QueryRow(`
		SELECT seat_id FROM bookings
		WHERE status = 'available'
		ORDER BY seat_id
		LIMIT 1
		FOR UPDATE SKIP LOCKED 
	`).Scan(&seatID)

	if err == sql.ErrNoRows {
		tx.Rollback()
		return false, sql.ErrNoRows
	}
	if err != nil {
		tx.Rollback()
		return false, nil
	}

	_, err = tx.Exec(
		"UPDATE bookings SET status = 'pending', user_id = $1 WHERE seat_id = $2",
		userID, seatID,
	)
	if err != nil {
		tx.Rollback()
		return false, err
	}

	return true, tx.Commit()
}

func main() {
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		panic(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(200)
	db.SetMaxIdleConns(100)

	rows, err := db.Query("SELECT id, seat_no FROM seats ORDER BY id")
	if err != nil {
		panic(err)
	}
	type Seat struct {
		ID     int
		SeatNo string
	}
	var seats []Seat
	for rows.Next() {
		var s Seat
		rows.Scan(&s.ID, &s.SeatNo)
		seats = append(seats, s)
	}
	rows.Close()

	totalUsers := 10000

	fmt.Printf("\n🎟️  Seat Booking Simulation\n")
	fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
	fmt.Printf("  Users : %d goroutines\n", totalUsers)
	fmt.Printf("  Seats : %d available\n", len(seats))
	fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n")

	ctx, cancel := context.WithCancel(context.Background())
	var once sync.Once

	start := time.Now()
	var wg sync.WaitGroup

	for i := 1; i <= totalUsers; i++ {
		wg.Add(1)
		go func(userID int) {
			defer wg.Done()
			booked, err := bookSeat(ctx, db, userID)
			if booked {
				atomic.AddInt64(&totalBooked, 1)
			} else {
				atomic.AddInt64(&totalMissed, 1)
				if err == sql.ErrNoRows {
					once.Do(cancel) // cancel exactly once when seats run out
				}
			}
		}(i)
	}

	wg.Wait()
	elapsed := time.Since(start)

	// Fetch results
	resultRows, err := db.Query(`
		SELECT b.seat_id, s.seat_no, b.user_id
		FROM bookings b
		JOIN seats s ON s.id = b.seat_id
		WHERE b.status = 'pending'
		ORDER BY b.seat_id
	`)
	if err != nil {
		panic(err)
	}

	type Result struct {
		SeatID int
		SeatNo string
		UserID int
	}
	var results []Result
	for resultRows.Next() {
		var r Result
		resultRows.Scan(&r.SeatID, &r.SeatNo, &r.UserID)
		results = append(results, r)
	}
	resultRows.Close()

	fmt.Println("🗺️  Seat Map")
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	seatMap := make(map[int]Result)
	for _, r := range results {
		seatMap[r.SeatID] = r
	}

	for i, s := range seats {
		r, booked := seatMap[s.ID]
		if booked {
			fmt.Printf("  ✅ %-4s → User %-6d", s.SeatNo, r.UserID)
		} else {
			fmt.Printf("  ❌ %-4s → ------      ", s.SeatNo)
		}
		if (i+1)%4 == 0 {
			fmt.Println()
		}
	}

	contention := float64(totalMissed) / float64(totalBooked+totalMissed) * 100
	fmt.Println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Printf("\n📊 Results\n")
	fmt.Printf("   ✅ Seats booked : %d / %d\n", totalBooked, len(seats))
	fmt.Printf("   😔 Users missed : %d\n", totalMissed)
	fmt.Printf("   👥 Total users  : %d\n", totalUsers)
	fmt.Printf("   ⚡ Contention   : %.2f%%\n", contention)
	fmt.Printf("   ⏱️  Execution    : %s\n\n", elapsed)
}
