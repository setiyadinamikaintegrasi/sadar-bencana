package http

import (
	"bytes"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// responseCache is a small in-memory TTL cache for public GET endpoints.
//
// It exists to decouple read volume from database egress: the browser and any
// external poller can hit the same public payload (for example the BMKG CAP
// alert feed) without each request re-executing the Postgres query behind it.
// Only successful GET responses are stored; entries are bounded so the map
// cannot grow without limit when clients request many distinct query strings.
type responseCache struct {
	mu         sync.Mutex
	entries    map[string]cachedResponse
	order      []string
	ttl        time.Duration
	maxEntries int
}

type cachedResponse struct {
	status      int
	contentType string
	body        []byte
	storedAt    time.Time
}

func newResponseCache(ttl time.Duration, maxEntries int) *responseCache {
	return &responseCache{
		entries:    make(map[string]cachedResponse, maxEntries),
		order:      make([]string, 0, maxEntries),
		ttl:        ttl,
		maxEntries: maxEntries,
	}
}

func (c *responseCache) get(key string) (cachedResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	resp, ok := c.entries[key]
	if !ok {
		return cachedResponse{}, false
	}
	if time.Since(resp.storedAt) >= c.ttl {
		delete(c.entries, key)
		c.removeOrder(key)
		return cachedResponse{}, false
	}
	return resp, true
}

func (c *responseCache) put(key string, resp cachedResponse) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[key]; !exists {
		if len(c.order) >= c.maxEntries {
			oldest := c.order[0]
			c.order = c.order[1:]
			delete(c.entries, oldest)
		}
		c.order = append(c.order, key)
	}
	c.entries[key] = resp
}

func (c *responseCache) removeOrder(key string) {
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			return
		}
	}
}

// captureResponseWriter records the status, content type, and body produced by
// the wrapped handler so the middleware can replay them on a cache hit.
type captureResponseWriter struct {
	gin.ResponseWriter
	body   *bytes.Buffer
	status int
}

func (w *captureResponseWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *captureResponseWriter) Write(data []byte) (int, error) {
	w.body.Write(data)
	return w.ResponseWriter.Write(data)
}

func (w *captureResponseWriter) WriteString(s string) (int, error) {
	w.body.WriteString(s)
	return w.ResponseWriter.WriteString(s)
}

// TTLGetCache returns middleware that serves cached copies of successful GET
// responses for the given TTL. Cache hits are served without touching the
// database; the response is marked with X-Cache: HIT for observability.
func TTLGetCache(ttl time.Duration) gin.HandlerFunc {
	cache := newResponseCache(ttl, 512)

	return func(g *gin.Context) {
		if g.Request.Method != http.MethodGet {
			g.Next()
			return
		}

		key := g.Request.URL.RequestURI()
		if resp, ok := cache.get(key); ok {
			g.Header("X-Cache", "HIT")
			g.Data(resp.status, resp.contentType, resp.body)
			g.Abort()
			return
		}

		writer := &captureResponseWriter{ResponseWriter: g.Writer, body: &bytes.Buffer{}}
		g.Writer = writer
		g.Next()

		if writer.status >= http.StatusOK && writer.status < http.StatusBadRequest && writer.body.Len() > 0 {
			cache.put(key, cachedResponse{
				status:      writer.status,
				contentType: writer.Header().Get("Content-Type"),
				body:        writer.body.Bytes(),
				storedAt:    time.Now(),
			})
		}
	}
}
