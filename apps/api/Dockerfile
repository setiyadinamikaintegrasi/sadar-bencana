# Stage 1 — build the Go binary
# NOTE: go.mod declares `go 1.25.0`, so the toolchain must be >= 1.25.
FROM golang:1.25-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /app/server ./cmd/server

# Stage 2 — minimal runtime image
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /app/server /app/server

EXPOSE 8001
CMD ["/app/server"]
