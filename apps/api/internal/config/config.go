package config

import "os"

type Config struct {
	Host string
	Port string
	Env  string
}

func Load() Config {
	return Config{
		Host: getEnv("API_HOST", "0.0.0.0"),
		Port: getEnv("API_PORT", "8001"),
		Env:  getEnv("API_ENV", "local"),
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}

	return fallback
}
