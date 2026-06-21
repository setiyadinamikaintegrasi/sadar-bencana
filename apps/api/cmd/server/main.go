package main

import (
	"fmt"
	"log"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/setiyadinamikaintegrasi/reinsurance-risk-monitor/api/internal/config"
	"github.com/setiyadinamikaintegrasi/reinsurance-risk-monitor/api/internal/db"
	apihttp "github.com/setiyadinamikaintegrasi/reinsurance-risk-monitor/api/internal/http"
)

func main() {
	cfg := config.Load()

	// Initialize the PostgreSQL connection pool. A failure here is logged as a
	// warning but does NOT crash the server: the API will keep serving routes
	// that do not depend on the database, and the /api/v1/events handler will
	// return HTTP 503 until the database becomes available.
	dbPool, err := db.New(cfg.DatabaseURL)
	if err != nil {
		log.Printf("WARN: failed to init database pool: %v (events endpoint disabled)", err)
	} else {
		defer func() {
			if cerr := db.Close(dbPool); cerr != nil {
				log.Printf("WARN: closing database pool: %v", cerr)
			}
		}()
		log.Printf("database pool initialized for %s env", cfg.Env)
	}

	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://localhost:3001"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
	}))

	router.GET("/health", apihttp.Health)
	router.GET("/api/v1/meta", apihttp.Meta(cfg.Env))
	router.GET("/api/v1/events", apihttp.Events(dbPool))
	router.GET("/api/v1/risk-scores", apihttp.RiskScores(dbPool))
	router.GET("/api/v1/briefings/today", apihttp.BriefingsToday(dbPool))
	router.GET("/api/v1/exposures", apihttp.Exposures(dbPool))
	router.GET("/api/v1/exposures/match", apihttp.ExposureMatch(dbPool))

	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	log.Printf("API server listening on %s", addr)
	log.Fatal(router.Run(addr))
}
