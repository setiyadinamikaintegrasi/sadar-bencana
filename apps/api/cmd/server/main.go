package main

import (
	"fmt"
	"log"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/setiyadinamikaintegrasi/reinsurance-risk-monitor/api/internal/config"
	apihttp "github.com/setiyadinamikaintegrasi/reinsurance-risk-monitor/api/internal/http"
)

func main() {
	cfg := config.Load()

	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://localhost:3001"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
	}))

	router.GET("/health", apihttp.Health)
	router.GET("/api/v1/meta", apihttp.Meta(cfg.Env))

	addr := fmt.Sprintf("%s:%s", cfg.Host, cfg.Port)
	log.Fatal(router.Run(addr))
}
