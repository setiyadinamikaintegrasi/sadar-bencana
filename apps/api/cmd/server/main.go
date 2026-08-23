package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/config"
	"github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/db"
	apihttp "github.com/setiyadinamikaintegrasi/sadar-bencana/api/internal/http"
)

func main() {
	cfg := config.Load()
	if cfg.IsProductionRuntime() {
		gin.SetMode(gin.ReleaseMode)
	}
	if err := cfg.ValidateSecurity(); err != nil {
		log.Fatalf("invalid security configuration: %v", err)
	}
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
	if err := router.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		log.Fatalf("invalid TRUSTED_PROXIES configuration: %v", err)
	}
	router.Use(cors.New(cors.Config{
		AllowOrigins: allowedOrigins,
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
	}))

	router.GET("/health", apihttp.Health)
	// Public read-heavy endpoints are served through a short in-memory TTL
	// cache so repeated polling (browser intervals or external pollers) does
	// not re-execute the same Postgres query on every request, which keeps
	// database egress proportional to data change rate rather than to poll rate.
	publicCache := apihttp.TTLGetCache(60 * time.Second)
	router.GET("/api/v1/meta", publicCache, apihttp.Meta(cfg.Env, cfg.RiskFreeLimit, cfg.DeploymentMode, cfg.PersonalAssetLimit))
	router.GET("/api/v1/events", publicCache, apihttp.Events(dbPool))
	router.GET("/api/v1/events/:id/evidence", apihttp.EventEvidenceList(dbPool))
	router.GET("/api/v1/events/:id/correlation-audit", apihttp.EventCorrelationAudit(dbPool))
	router.GET("/api/v1/news", publicCache, apihttp.News(dbPool))
	router.GET("/api/v1/risk-scores", publicCache, apihttp.RiskScores(dbPool))
	router.GET("/api/v1/briefings/today", apihttp.BriefingsToday(dbPool))
	router.GET("/api/v1/alerts", publicCache, apihttp.Alerts(dbPool))
	router.GET("/api/v1/alerts/:id/action-card", apihttp.AlertActionCardGet(dbPool))
	router.GET("/api/v1/official-alerts", publicCache, apihttp.OfficialAlerts(dbPool))
	router.GET("/api/v1/air-quality/observations", publicCache, apihttp.AirQualityObservations(dbPool))
	// Template CSV statis tetap publik (diunduh via <a href> tanpa token).
	router.GET("/api/v1/contracts/import/template", apihttp.ContractsImportTemplate())
	router.GET("/api/v1/evacuation-locations/import/template", apihttp.EvacuationImportTemplate())

	// Lokasi evakuasi: informasi keselamatan, publik tanpa login.
	router.GET("/api/v1/evacuation-locations", publicCache, apihttp.EvacuationLocationsList(dbPool))
	router.GET("/api/v1/evacuation-locations/nearest", apihttp.EvacuationLocationsNearest(dbPool))

	// Akun privat — aset personal, entitlement, dan undangan wajib login.
	account := router.Group("", apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL))
	{
		account.GET("/api/v1/entitlements/me", apihttp.EntitlementStatus(dbPool, cfg.DeploymentMode))
		account.POST("/api/v1/entitlements/activate", apihttp.EntitlementActivate(dbPool, cfg.DeploymentMode, cfg.EntitlementPublicKey))
		account.POST("/api/v1/organization-invitations/accept", apihttp.OrganizationInviteAccept(dbPool))
		account.GET("/api/v1/personal-assets", apihttp.PersonalAssetsList(dbPool, cfg.DeploymentMode, cfg.PersonalAssetLimit))
		account.POST("/api/v1/personal-assets", apihttp.PersonalAssetCreate(dbPool, cfg.DeploymentMode, cfg.PersonalAssetLimit))
		account.PUT("/api/v1/personal-assets/:id", apihttp.PersonalAssetUpdate(dbPool))
		account.DELETE("/api/v1/personal-assets/:id", apihttp.PersonalAssetDelete(dbPool))
		account.GET("/api/v1/personal-assets/:id/risk", apihttp.PersonalAssetRisk(dbPool))
		account.GET("/api/v1/geocoding/search", apihttp.GeocodingSearch(cfg.GeocoderBaseURL, cfg.GeocoderUserAgent))
		account.PATCH("/api/v1/alerts/:id/acknowledge", apihttp.AcknowledgeAlert(dbPool))
		account.GET("/api/v1/learning/me", apihttp.LearningMe(dbPool))
		account.POST("/api/v1/learning/modules/:module_id/complete", apihttp.LearningModuleComplete(dbPool))
	}

	// Generative AI consumes a paid upstream service. Require a verified
	// Supabase session and enforce per-account usage limits.
	ai := router.Group("/api/v1/ai", apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL))
	{
		ai.GET("/briefings/executive/stream", apihttp.AIExecutiveBriefingStream(
			dbPool,
			cfg.MastraBaseURL,
			cfg.MastraAPIToken,
			cfg.AIBriefingTimeout,
			apihttp.AIUsageLimits{
				PerMinute:        cfg.AIExecutivePerMinute,
				PerDay:           cfg.AIExecutivePerDay,
				Concurrent:       1,
				GlobalPerDay:     cfg.AIExecutiveGlobalPerDay,
				GlobalConcurrent: 1,
			},
			cfg.AIExecutiveCacheTTL,
		))
		ai.POST("/copilot/chat", apihttp.AICopilotChat(
			dbPool,
			cfg.MastraBaseURL,
			cfg.MastraAPIToken,
			cfg.AIBriefingTimeout,
			apihttp.AIUsageLimits{
				PerMinute:       cfg.AICopilotPerMinute,
				PerDay:          cfg.AICopilotPerDay,
				Concurrent:      1,
				GlobalPerMinute: cfg.AICopilotGlobalPerMinute,
				GlobalPerDay:    cfg.AICopilotGlobalPerDay,
			},
			cfg.AICopilotMaxCharacters,
		))
	}

	// Portofolio perusahaan: bebas pada community, entitlement organisasi pada hosted.
	company := router.Group("",
		apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL),
		apihttp.CompanyAccess(dbPool, cfg.DeploymentMode),
	)
	{
		company.GET("/api/v1/contracts", apihttp.ContractsList(dbPool))
		company.GET("/api/v1/contracts/:id", apihttp.ContractGet(dbPool))
		company.POST("/api/v1/contracts", apihttp.ContractCreate(dbPool, cfg.RiskFreeLimit))
		company.PUT("/api/v1/contracts/:id", apihttp.ContractUpdate(dbPool))
		company.DELETE("/api/v1/contracts/:id", apihttp.ContractDelete(dbPool))
		company.POST("/api/v1/contracts/import", apihttp.ContractsImport(dbPool, cfg.RiskFreeLimit))
		company.GET("/api/v1/accumulation", apihttp.Accumulation(dbPool))
		company.POST("/api/v1/organizations/invitations", apihttp.OrganizationInviteCreate(
			dbPool, cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom,
		))
	}
	correlationAdmin := router.Group(
		"/api/v1/correlations",
		apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL),
		apihttp.RequireEWSAdmin(dbPool),
	)
	{
		correlationAdmin.GET("/review-queue", apihttp.CorrelationReviewQueue(dbPool))
	}
	evacuationAdmin := router.Group(
		"/api/v1/evacuation-locations",
		apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL),
		apihttp.RequireEWSAdmin(dbPool),
	)
	{
		evacuationAdmin.GET("/all", apihttp.EvacuationLocationsListAdmin(dbPool))
		evacuationAdmin.POST("", apihttp.EvacuationLocationCreate(dbPool))
		evacuationAdmin.PATCH("/:id", apihttp.EvacuationLocationUpdate(dbPool))
		evacuationAdmin.DELETE("/:id", apihttp.EvacuationLocationDelete(dbPool))
		evacuationAdmin.POST("/import", apihttp.EvacuationImport(dbPool))
		evacuationAdmin.POST("/photo", apihttp.EvacuationPhotoUpload(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey))
	}
	router.GET("/api/v1/air-quality/asean", apihttp.AseanAirQualityList(dbPool))
	router.GET("/api/v1/regions/situation", apihttp.RegionsSituation(dbPool))

	adminUsers := router.Group(
		"/api/v1/admin/users",
		apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL),
		apihttp.RequireAdminEmail(cfg.AdminEmails),
	)
	{
		adminUsers.GET("", apihttp.AdminUsersList(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey))
		adminUsers.DELETE("/:id", apihttp.AdminUserDelete(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey))
		adminUsers.POST("/:id/ban", apihttp.AdminUserBan(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey, dbPool))
		adminUsers.POST("/:id/resend", apihttp.AdminUserResendConfirmation(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey))
	}

	settings := router.Group("/api/v1/settings", apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL))
	{
		settings.GET("/official-sources", apihttp.OfficialSourceSettingsList(dbPool))
		settings.PUT("/official-sources/:source", apihttp.OfficialSourceSettingUpdate(dbPool, cfg.OfficialSourceSettingsKey))
		settings.POST("/official-sources/:source/test", apihttp.OfficialSourceSettingTest(dbPool, cfg.OfficialSourceSettingsKey))
		settings.POST("/official-sources/:source/preview", apihttp.OfficialSourcePreview(dbPool, cfg.OfficialSourceSettingsKey))
		settings.POST("/official-sources/:source/dry-run", apihttp.OfficialSourceDryRun(dbPool, cfg.OfficialSourceSettingsKey))
		settings.POST("/official-sources/:source/activate", apihttp.OfficialSourceActivate(dbPool))
		settings.POST("/official-sources/:source/rollback", apihttp.OfficialSourceRollback(dbPool))
		settings.GET("/official-sources/:source/history", apihttp.OfficialSourceHistory(dbPool))
		settings.POST("/historical/bmkg-data-online/preview", apihttp.BMKGDataOnlinePreview(dbPool, cfg.WorkerBaseURL, cfg.WorkerAPIToken))
	}
	// Asset endpoints require authentication (JWT) — contain operational data
	assetsAuth := router.Group("/api/v1/assets", apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL))
	{
		assetsAuth.GET("/marine", apihttp.AssetsMarine(dbPool))
		assetsAuth.GET("/aviation", apihttp.AssetsAviation(dbPool))
	}
	router.GET("/api/v1/health/connectors", publicCache, apihttp.ConnectorHealthHandler(dbPool))
	router.GET("/api/v1/map/overlays", publicCache, apihttp.MapRiskOverlays(dbPool))
	publicMap := router.Group("/api/v1/map/operations", publicCache)
	publicMap.GET("/events", apihttp.OperationMapEvents(dbPool))
	publicMap.GET("/alerts", apihttp.OperationMapAlerts(dbPool))
	publicMap.GET("/air-quality", apihttp.OperationMapAirQuality(dbPool))
	publicMap.GET("/evacuations", apihttp.OperationMapEvacuations(dbPool))
	publicMap.GET("/aircraft", apihttp.OperationMapAircraft(dbPool))
	// Sprint 5 S1: statistik zonal populasi (WorldPop) untuk poligon bebas.
	spatial := router.Group("/api/v1/spatial", publicCache)
	spatial.GET("/population-summary", apihttp.SpatialPopulationSummary(dbPool))
	// Sprint 5 S2: fasilitas kritis dalam radius titik (OSM + manual).
	spatial.GET("/critical-facilities", apihttp.CriticalFacilitiesSummary(dbPool))
	// Sprint 5 S3: distribusi tutupan lahan (ESA WorldCover) untuk poligon.
	spatial.GET("/landcover-summary", apihttp.SpatialLandcoverSummary(dbPool))
	// Sprint 5 S4: ringkasan medan (elevasi) untuk bbox — AWS terrain tiles.
	spatial.GET("/elevation-summary", apihttp.SpatialElevationSummary())
	// Sprint 6 S5: impact engine — skor dampak event on-demand (S1-S4 + event).
	spatial.GET("/impact-score", apihttp.SpatialImpactScore(dbPool))
	// Sprint 6 S6: overlay Shakemap MMI BMKG (georeferensi bbox 5°).
	publicMap.GET("/shakemaps", apihttp.OperationMapShakemaps(dbPool))
	// Sprint 6 S7: status genangan banjir per area (PetaBencana/BPBD).
	publicMap.GET("/flood-areas", apihttp.OperationMapFloodAreas(dbPool))
	meMap := router.Group(
		"/api/v1/me/map",
		apihttp.OperationMapPrivateNoStore(),
		apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL),
	)
	{
		meMap.GET("/watch-zones", apihttp.OperationMapWatchZones(dbPool))
		meMap.GET("/personal-assets", apihttp.OperationMapPersonalAssets(dbPool))
	}
	mapMe := router.Group("/api/v1/map", apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL))
	{
		mapMe.GET("/overlays/me", apihttp.MapRiskOverlaysMe(dbPool))
	}
	router.GET("/api/v1/metrics/disaster", apihttp.DisasterMetrics(dbPool))
	router.GET("/api/v1/historical/regions/:code/profile", apihttp.RegionalHistoryProfile(dbPool))

	// EWS administration contains subscriber contact details and is admin-only.
	ewsAdmin := router.Group(
		"/api/v1/ews",
		apihttp.SupabaseAuth(cfg.SupabaseJWTSecret, cfg.SupabaseJWKSURL),
		apihttp.RequireEWSAdmin(dbPool),
	)
	{
		ewsAdmin.GET("/subscribers", apihttp.EWSSubscribersList(dbPool))
		ewsAdmin.POST("/subscribers", apihttp.EWSSubscriberCreate(dbPool))
		ewsAdmin.PUT("/subscribers/:id", apihttp.EWSSubscriberUpdate(dbPool))
		ewsAdmin.DELETE("/subscribers/:id", apihttp.EWSSubscriberDelete(dbPool))
		ewsAdmin.GET("/subscribers/:id/watch-zones", apihttp.EWSWatchZonesList(dbPool))
		ewsAdmin.POST("/subscribers/:id/watch-zones", apihttp.EWSWatchZoneCreate(dbPool))
		ewsAdmin.PUT("/watch-zones/:id", apihttp.EWSWatchZoneUpdate(dbPool))
		ewsAdmin.DELETE("/watch-zones/:id", apihttp.EWSWatchZoneDelete(dbPool))
		ewsAdmin.GET("/subscribers/:id/preferences", apihttp.EWSNotificationPrefsGet(dbPool))
		ewsAdmin.PUT("/subscribers/:id/preferences", apihttp.EWSNotificationPrefsUpdate(dbPool))
		ewsAdmin.GET("/notifications", apihttp.EWSNotificationLog(dbPool))
		ewsAdmin.GET("/channels/status", apihttp.EWSChannelsStatus(cfg.WorkerBaseURL, cfg.WorkerAPIToken))
		ewsAdmin.GET("/channels/audit", apihttp.EWSChannelSettingAudit(dbPool))
		ewsAdmin.PUT("/channels/:channel", apihttp.EWSChannelSettingUpdate(dbPool))
		ewsAdmin.POST("/subscribers/:id/channels/:channel/test", apihttp.EWSAdminChannelTest(
			dbPool, cfg.WorkerBaseURL, cfg.WorkerAPIToken,
		))
		ewsAdmin.POST("/deliveries/:id/retry", apihttp.EWSDeliveryRetry(
			cfg.WorkerBaseURL, cfg.WorkerAPIToken,
		))
	}

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
		ewsMe.GET("/channels/status", apihttp.EWSMeChannelsStatus(
			dbPool, cfg.WorkerBaseURL, cfg.WorkerAPIToken,
		))
		ewsMe.POST("/channels/:channel/test", apihttp.EWSMeChannelTest(
			dbPool, cfg.WorkerBaseURL, cfg.WorkerAPIToken,
		))
		ewsMe.GET("/active-warnings", apihttp.EWSMeActiveWarnings(dbPool))
		ewsMe.GET("/notifications", apihttp.EWSMeNotifications(dbPool))
		ewsMe.POST("/notifications/:id/acknowledge", apihttp.EWSMeNotificationAcknowledge(dbPool))
	}

	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	log.Printf("API server listening on %s", addr)
	log.Fatal(router.Run(addr))
}
