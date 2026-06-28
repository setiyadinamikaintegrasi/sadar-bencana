package http

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func signTestToken(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func newAuthTestRouter(secret string) *gin.Engine {
	return newAuthTestRouterFull(secret, "")
}

func newAuthTestRouterFull(secret, jwksURL string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/protected", SupabaseAuth(secret, jwksURL), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"uid": AuthUserID(c), "email": AuthEmail(c)})
	})
	return r
}

// newTestJWKS spins up an httptest server that serves a single ES256 public
// key as a JWKS, and returns the server, its URL, the signing key, and the kid.
func newTestJWKS(t *testing.T) (*httptest.Server, *ecdsa.PrivateKey, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	kid := "test-kid-1"
	b64 := func(i *big.Int) string {
		return base64.RawURLEncoding.EncodeToString(i.Bytes())
	}
	jwksBody, _ := json.Marshal(map[string]any{
		"keys": []map[string]any{{
			"kty": "EC", "crv": "P-256", "use": "sig", "kid": kid,
			"x": b64(key.PublicKey.X), "y": b64(key.PublicKey.Y),
		}},
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwksBody)
	}))
	t.Cleanup(srv.Close)
	return srv, key, kid
}

func signES256(t *testing.T, key *ecdsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("sign es256: %v", err)
	}
	return s
}

func doGet(r *gin.Engine, bearer string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/protected", nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestSupabaseAuth_ValidToken(t *testing.T) {
	secret := "test-secret"
	tok := signTestToken(t, secret, jwt.MapClaims{
		"sub":   "11111111-1111-1111-1111-111111111111",
		"email": "a@b.id",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})
	w := doGet(newAuthTestRouter(secret), tok)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestSupabaseAuth_MissingToken(t *testing.T) {
	w := doGet(newAuthTestRouter("test-secret"), "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestSupabaseAuth_ExpiredToken(t *testing.T) {
	secret := "test-secret"
	tok := signTestToken(t, secret, jwt.MapClaims{
		"sub": "x", "exp": time.Now().Add(-time.Hour).Unix(),
	})
	w := doGet(newAuthTestRouter(secret), tok)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for expired, got %d", w.Code)
	}
}

func TestSupabaseAuth_WrongSecret(t *testing.T) {
	tok := signTestToken(t, "other-secret", jwt.MapClaims{
		"sub": "x", "exp": time.Now().Add(time.Hour).Unix(),
	})
	w := doGet(newAuthTestRouter("test-secret"), tok)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong secret, got %d", w.Code)
	}
}

func TestSupabaseAuth_NotConfigured(t *testing.T) {
	w := doGet(newAuthTestRouter(""), "anything")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when neither secret nor JWKS set, got %d", w.Code)
	}
}

func TestSupabaseAuth_ValidES256TokenViaJWKS(t *testing.T) {
	srv, key, kid := newTestJWKS(t)
	tok := signES256(t, key, kid, jwt.MapClaims{
		"sub":   "22222222-2222-2222-2222-222222222222",
		"email": "ec@b.id",
		"exp":   time.Now().Add(time.Hour).Unix(),
	})
	w := doGet(newAuthTestRouterFull("", srv.URL), tok)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid ES256 token, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestSupabaseAuth_ES256WrongKeyRejected(t *testing.T) {
	srv, _, kid := newTestJWKS(t)
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tok := signES256(t, other, kid, jwt.MapClaims{
		"sub": "x", "exp": time.Now().Add(time.Hour).Unix(),
	})
	w := doGet(newAuthTestRouterFull("", srv.URL), tok)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for ES256 token signed by unknown key, got %d", w.Code)
	}
}
