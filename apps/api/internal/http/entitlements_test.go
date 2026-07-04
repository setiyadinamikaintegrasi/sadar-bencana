package http

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func entitlementFixture(t *testing.T, expires time.Time) (string, string) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	now := time.Now().UTC()
	payload := entitlementClaims{
		OrganizationName: "PT Test",
		Features:         []string{"company_portfolio"},
		MaxUsers:         5,
		MaxCompanyRisks:  100,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "sadar-license", Audience: jwt.ClaimStrings{"sadar-bencana-hosted"},
			ID: "test-jti", IssuedAt: jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(expires),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, payload).SignedString(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	return token, publicPEM
}

func TestParseEntitlementTokenAcceptsValidSignedToken(t *testing.T) {
	token, publicPEM := entitlementFixture(t, time.Now().Add(time.Hour))
	claims, err := parseEntitlementToken(token, publicPEM)
	if err != nil {
		t.Fatalf("expected valid token: %v", err)
	}
	if claims.OrganizationName != "PT Test" || !containsFeature(claims.Features, "company_portfolio") {
		t.Fatalf("unexpected claims: %#v", claims)
	}
}

func TestParseEntitlementTokenRejectsExpiredToken(t *testing.T) {
	token, publicPEM := entitlementFixture(t, time.Now().Add(-time.Hour))
	if _, err := parseEntitlementToken(token, publicPEM); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}
