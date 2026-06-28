# Local Deployment Notes

## Target local ports
- web: 3001
- api: 8001
- worker: 8002
- postgres: 5432
- redis: 6379
- local llm: 8080

## Deployment approach
- postgres, redis, grafana via Docker Compose
- web, api, worker host-native saat development
- akses remote via Tailscale jika diperlukan
