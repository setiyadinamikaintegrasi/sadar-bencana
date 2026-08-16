package http

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestTTLGetCacheServesSecondRequestFromCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/data", TTLGetCache(60*time.Second), func(c *gin.Context) {
		c.Header("Content-Type", "application/json")
		c.String(http.StatusOK, `{"value":"fresh"}`)
	})

	first := perform(router, "/data")
	if first.Code != http.StatusOK || first.Body.String() != `{"value":"fresh"}` {
		t.Fatalf("first request: got %d %q", first.Code, first.Body.String())
	}
	if first.Header().Get("X-Cache") == "HIT" {
		t.Fatalf("first request must be a cache miss")
	}

	second := perform(router, "/data")
	if second.Body.String() != `{"value":"fresh"}` {
		t.Fatalf("second request body differs: %q", second.Body.String())
	}
	if second.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("second request must be a cache hit")
	}
}

func TestTTLGetCacheDistinguishesQueryStrings(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/data", TTLGetCache(time.Minute), func(c *gin.Context) {
		c.String(http.StatusOK, c.Query("source"))
	})

	if got := perform(router, "/data?source=a").Body.String(); got != "a" {
		t.Fatalf("query a: %q", got)
	}
	if got := perform(router, "/data?source=a").Body.String(); got != "a" {
		t.Fatalf("query a cached: %q", got)
	}
	if got := perform(router, "/data?source=b").Body.String(); got != "b" {
		t.Fatalf("query b must not reuse a's cache: %q", got)
	}
}

func TestTTLGetCacheExpiresAfterTTL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/data", TTLGetCache(30*time.Millisecond), func(c *gin.Context) {
		c.String(http.StatusOK, time.Now().String())
	})

	first := perform(router, "/data").Body.String()
	if hit := perform(router, "/data"); hit.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("expected hit within TTL")
	}
	time.Sleep(60 * time.Millisecond)
	second := perform(router, "/data")
	if second.Header().Get("X-Cache") == "HIT" {
		t.Fatalf("expected miss after TTL")
	}
	if second.Body.String() == first {
		t.Fatalf("expected fresh response after TTL")
	}
}

func TestTTLGetCacheSkipsNonGetAndErrorResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/data", TTLGetCache(time.Minute), func(c *gin.Context) {
		c.String(http.StatusOK, "payload")
	})
	router.POST("/data", TTLGetCache(time.Minute), func(c *gin.Context) {
		c.String(http.StatusOK, "post-payload")
	})
	router.GET("/error", TTLGetCache(time.Minute), func(c *gin.Context) {
		c.String(http.StatusInternalServerError, "boom")
	})

	// POST must never be cached.
	_ = perform(router, "/data").Body.String()
	post := perform(router, "/data", "POST")
	if post.Header().Get("X-Cache") == "HIT" {
		t.Fatalf("POST must not be cached")
	}

	// Error responses must not poison the cache.
	firstErr := perform(router, "/error")
	secondErr := perform(router, "/error")
	if secondErr.Header().Get("X-Cache") == "HIT" {
		t.Fatalf("5xx responses must not be cached")
	}
	if !strings.Contains(firstErr.Body.String(), "boom") || !strings.Contains(secondErr.Body.String(), "boom") {
		t.Fatalf("error handler must re-run on every request")
	}
}

func TestTTLGetCacheBoundedEviction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/data", TTLGetCache(5*time.Minute), func(c *gin.Context) {
		c.String(http.StatusOK, c.Query("key"))
	})

	// Exceed the 512-entry bound with distinct query strings.
	for i := 0; i < 600; i++ {
		key := strconv.Itoa(i)
		if got := perform(router, "/data?key="+key).Body.String(); got != key {
			t.Fatalf("unexpected body for key %d: %q", i, got)
		}
	}
	// The first entries must have been evicted (fresh miss), the last still hit.
	if perform(router, "/data?key=0").Header().Get("X-Cache") == "HIT" {
		t.Fatalf("oldest entry must be evicted")
	}
	if perform(router, "/data?key=599").Header().Get("X-Cache") != "HIT" {
		t.Fatalf("newest entry must still be cached")
	}
}

func perform(router http.Handler, target string, method ...string) *httptest.ResponseRecorder {
	reqMethod := http.MethodGet
	if len(method) > 0 {
		reqMethod = method[0]
	}
	req := httptest.NewRequest(reqMethod, target, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}
