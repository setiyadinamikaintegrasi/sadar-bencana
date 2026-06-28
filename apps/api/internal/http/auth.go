package http

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const (
	ctxAuthUserID = "auth_user_id"
	ctxAuthEmail  = "auth_email"
)

// SupabaseAuth returns middleware that validates a Supabase-issued JWT and
// stores the user id + email in the Gin context. It supports both signing
// schemes Supabase uses: asymmetric ES256/RS256 tokens verified against the
// project JWKS (jwksURL), and legacy HS256 tokens verified with the shared
// jwtSecret. Aborts with 401 on any failure, 503 if neither is configured.
func SupabaseAuth(jwtSecret, jwksURL string) gin.HandlerFunc {
	var jwks *jwksCache
	if jwksURL != "" {
		jwks = newJWKSCache(jwksURL)
	}

	keyFunc := func(t *jwt.Token) (interface{}, error) {
		switch t.Method.(type) {
		case *jwt.SigningMethodHMAC:
			if jwtSecret == "" {
				return nil, errors.New("HS256 token but no shared secret configured")
			}
			return []byte(jwtSecret), nil
		case *jwt.SigningMethodECDSA, *jwt.SigningMethodRSA:
			if jwks == nil {
				return nil, errors.New("asymmetric token but no JWKS configured")
			}
			kid, _ := t.Header["kid"].(string)
			if kid == "" {
				return nil, errors.New("token missing kid")
			}
			return jwks.keyByID(kid)
		default:
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
	}

	return func(c *gin.Context) {
		if jwtSecret == "" && jwks == nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error":   "auth_not_configured",
				"message": "neither SUPABASE_JWT_SECRET nor SUPABASE_URL/JWKS is set",
			})
			return
		}

		const prefix = "Bearer "
		authz := c.GetHeader("Authorization")
		if !strings.HasPrefix(authz, prefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "missing bearer token",
			})
			return
		}
		tokenStr := strings.TrimSpace(authz[len(prefix):])

		claims := jwt.MapClaims{}
		_, err := jwt.ParseWithClaims(
			tokenStr, claims, keyFunc,
			jwt.WithValidMethods([]string{"HS256", "ES256", "RS256"}),
		)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "invalid token",
			})
			return
		}

		sub, _ := claims["sub"].(string)
		if sub == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "token missing subject",
			})
			return
		}
		email, _ := claims["email"].(string)

		c.Set(ctxAuthUserID, sub)
		c.Set(ctxAuthEmail, email)
		c.Next()
	}
}

// AuthUserID returns the authenticated Supabase user id set by SupabaseAuth.
func AuthUserID(c *gin.Context) string {
	v, _ := c.Get(ctxAuthUserID)
	s, _ := v.(string)
	return s
}

// AuthEmail returns the authenticated user's email (may be empty).
func AuthEmail(c *gin.Context) string {
	v, _ := c.Get(ctxAuthEmail)
	s, _ := v.(string)
	return s
}
