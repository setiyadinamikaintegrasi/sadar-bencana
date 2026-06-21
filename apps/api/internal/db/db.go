// Package db provides PostgreSQL connectivity for the API using the pgx
// driver. It exposes a *sql.DB backed by pgx's stdlib adapter so that the
// rest of the application can use the standard database/sql interface while
// benefiting from pgx's performance and feature set.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	// Register the pgx stdlib driver so database/sql can use it.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Default connection pool tuning.
const (
	defaultMaxOpenConns    = 25
	defaultMaxIdleConns    = 5
	defaultConnMaxLifetime = 30 * time.Minute
	defaultConnMaxIdleTime = 5 * time.Minute
)

// New opens a new connection pool to PostgreSQL using the pgx stdlib driver.
// The returned *sql.DB is safe for concurrent use and manages its own pool.
// Callers should defer db.Close() to release the pool.
func New(databaseURL string) (*sql.DB, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("database url is empty")
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("opening pgx connection: %w", err)
	}

	// Apply sane pool defaults.
	db.SetMaxOpenConns(defaultMaxOpenConns)
	db.SetMaxIdleConns(defaultMaxIdleConns)
	db.SetConnMaxLifetime(defaultConnMaxLifetime)
	db.SetConnMaxIdleTime(defaultConnMaxIdleTime)

	return db, nil
}

// Ping verifies the database connection is reachable within the given timeout.
func Ping(db *sql.DB, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return db.PingContext(ctx)
}

// Close closes the underlying connection pool. It is safe to call on a nil db.
func Close(db *sql.DB) error {
	if db == nil {
		return nil
	}
	return db.Close()
}
