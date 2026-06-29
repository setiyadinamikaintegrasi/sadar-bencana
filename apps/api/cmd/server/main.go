package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/config"
	"github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/db"
	apihttp "github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/http"
)

func main() {
	cfg := config.Load()
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		log.Fatal("DATABASE_URL is required; configure the Supabase pooled connection string before starting the API")
	}

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

	allowedOrigins := []string{"http://localhost:3001", "http://localhost:5173", "http://127.0.0.1:5173"}
	if extra := os.Getenv("CORS_ALLOWED_ORIGINS"); extra != "" {
		allowedOrigins = strings.Split(extra, ",")
	}

	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins: allowedOrigins,
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
	}))

	router.GET("/health", apihttp.Health)
	router.GET("/api/v1/meta", apihttp.Meta(cfg.Env, cfg.RiskFreeLimit))
	router.GET("/api/v1/events", apihttp.Events(dbPool))
	router.GET("/api/v1/events/:id/evidence", apihttp.EventEvidenceList(dbPool))
	router.GET("/api/v1/events/:id/correlation-audit", apihttp.EventCorrelationAudit(dbPool))
	router.GET("/api/v1/correlations/review-queue", apihttp.CorrelationReviewQueue(dbPool))
	router.GET("/api/v1/news", apihttp.News(dbPool))
	router.GET("/api/v1/risk-scores", apihttp.RiskScores(dbPool))
	router.GET("/api/v1/briefings/today", apihttp.BriefingsToday(dbPool))
	router.GET("/api/v1/ai/briefings/executive/stream", apihttp.AIExecutiveBriefingStream(dbPool, cfg.MastraBaseURL, cfg.AIBriefingTimeout))
	router.POST("/api/v1/ai/copilot/chat", apihttp.AICopilotChat(cfg.MastraBaseURL, cfg.AIBriefingTimeout))
	router.GET("/api/v1/alerts", apihttp.Alerts(dbPool))
	router.PATCH("/api/v1/alerts/:id/acknowledge", apihttp.AcknowledgeAlert(dbPool))
	router.GET("/api/v1/alerts/:id/action-card", apihttp.AlertActionCardGet(dbPool))
	router.GET("/api/v1/official-alerts", apihttp.OfficialAlerts(dbPool))
	// Template CSV statis tetap publik (diunduh via <a href> tanpa token).
	router.GET("/api/v1/contracts/import/template", apihttp.ContractsImportTemplate())

	// Daftar Risiko — semua operasi risiko privat & wajib login.
	risk := router.Group("", apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL))
	{
		risk.GET("/api/v1/contracts", apihttp.ContractsList(dbPool))
		risk.GET("/api/v1/contracts/:id", apihttp.ContractGet(dbPool))
		risk.POST("/api/v1/contracts", apihttp.ContractCreate(dbPool, cfg.RiskFreeLimit))
		risk.PUT("/api/v1/contracts/:id", apihttp.ContractUpdate(dbPool))
		risk.DELETE("/api/v1/contracts/:id", apihttp.ContractDelete(dbPool))
		risk.POST("/api/v1/contracts/import", apihttp.ContractsImport(dbPool, cfg.RiskFreeLimit))
		risk.GET("/api/v1/accumulation", apihttp.Accumulation(dbPool))
	}
	router.GET("/api/v1/assets/marine", apihttp.AssetsMarine(dbPool))
	router.GET("/api/v1/assets/aviation", apihttp.AssetsAviation(dbPool))
	router.GET("/api/v1/health/connectors", apihttp.ConnectorHealthHandler(dbPool))

	// EWS — Early Warning System
	router.GET("/api/v1/ews/subscribers", apihttp.EWSSubscribersList(dbPool))
	router.POST("/api/v1/ews/subscribers", apihttp.EWSSubscriberCreate(dbPool))
	router.PUT("/api/v1/ews/subscribers/:id", apihttp.EWSSubscriberUpdate(dbPool))
	router.DELETE("/api/v1/ews/subscribers/:id", apihttp.EWSSubscriberDelete(dbPool))
	router.GET("/api/v1/ews/subscribers/:id/watch-zones", apihttp.EWSWatchZonesList(dbPool))
	router.POST("/api/v1/ews/subscribers/:id/watch-zones", apihttp.EWSWatchZoneCreate(dbPool))
	router.PUT("/api/v1/ews/watch-zones/:id", apihttp.EWSWatchZoneUpdate(dbPool))
	router.DELETE("/api/v1/ews/watch-zones/:id", apihttp.EWSWatchZoneDelete(dbPool))
	router.GET("/api/v1/ews/subscribers/:id/preferences", apihttp.EWSNotificationPrefsGet(dbPool))
	router.PUT("/api/v1/ews/subscribers/:id/preferences", apihttp.EWSNotificationPrefsUpdate(dbPool))
	router.GET("/api/v1/ews/notifications", apihttp.EWSNotificationLog(dbPool))

	// EWS self-service (authenticated; scoped to the logged-in subscriber)
	ewsMe := router.Group("/api/v1/ews/me", apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL))
	{
		ewsMe.GET("", apihttp.EWSMeProfile(dbPool))
		ewsMe.PUT("", apihttp.EWSMeProfileUpdate(dbPool))
		ewsMe.GET("/watch-zones", apihttp.EWSMeWatchZonesList(dbPool))
		ewsMe.POST("/watch-zones", apihttp.EWSMeWatchZoneCreate(dbPool))
		ewsMe.PUT("/watch-zones/:id", apihttp.EWSMeWatchZoneUpdate(dbPool))
		ewsMe.DELETE("/watch-zones/:id", apihttp.EWSMeWatchZoneDelete(dbPool))
		ewsMe.GET("/preferences", apihttp.EWSMePrefsGet(dbPool))
		ewsMe.PUT("/preferences", apihttp.EWSMePrefsUpdate(dbPool))
		ewsMe.GET("/notifications", apihttp.EWSMeNotifications(dbPool))
		ewsMe.POST("/notifications/:id/acknowledge", apihttp.EWSMeNotificationAcknowledge(dbPool))
	}

	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	log.Printf("API server listening on %s", addr)
	log.Fatal(router.Run(addr))
}
