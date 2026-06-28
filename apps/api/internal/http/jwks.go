package http

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// jwksCache fetches and caches a JWKS (JSON Web Key Set) from a URL, exposing
// public keys by `kid` for asymmetric JWT verification. Supabase signs user
// access tokens with rotating ES256 (or RS256) keys published at
// `<project>/auth/v1/.well-known/jwks.json`. Safe for concurrent use.
type jwksCache struct {
	url        string
	httpClient *http.Client

	mu        sync.RWMutex
	keys      map[string]any // kid -> *ecdsa.PublicKey | *rsa.PublicKey
	fetchedAt time.Time
}

// jwksMinRefreshInterval rate-limits refetches so an unknown (or forged) kid
// cannot trigger a request to the JWKS endpoint on every call.
const jwksMinRefreshInterval = time.Minute

func newJWKSCache(url string) *jwksCache {
	return &jwksCache{
		url:        url,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		keys:       map[string]any{},
	}
}

// keyByID returns the cached public key for kid, refreshing once from the JWKS
// endpoint when the kid is unknown and the cache is older than the refresh
// interval (handles key rotation without hammering the endpoint).
func (j *jwksCache) keyByID(kid string) (any, error) {
	j.mu.RLock()
	k, ok := j.keys[kid]
	last := j.fetchedAt
	j.mu.RUnlock()
	if ok {
		return k, nil
	}
	if !last.IsZero() && time.Since(last) < jwksMinRefreshInterval {
		return nil, fmt.Errorf("unknown signing key %q", kid)
	}
	if err := j.refresh(); err != nil {
		return nil, err
	}
	j.mu.RLock()
	defer j.mu.RUnlock()
	if k, ok := j.keys[kid]; ok {
		return k, nil
	}
	return nil, fmt.Errorf("unknown signing key %q", kid)
}

func (j *jwksCache) refresh() error {
	resp, err := j.httpClient.Get(j.url)
	if err != nil {
		return fmt.Errorf("fetch jwks: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("fetch jwks: status %d", resp.StatusCode)
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}
	parsed := make(map[string]any, len(set.Keys))
	for _, k := range set.Keys {
		pub, err := k.publicKey()
		if err != nil || k.Kid == "" {
			continue // skip keys we can't parse or that lack a kid
		}
		parsed[k.Kid] = pub
	}
	j.mu.Lock()
	j.keys = parsed
	j.fetchedAt = time.Now()
	j.mu.Unlock()
	return nil
}

// jwk is a single JSON Web Key (the subset of fields we need for EC/RSA).
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func (k jwk) publicKey() (any, error) {
	switch k.Kty {
	case "EC":
		var curve elliptic.Curve
		switch k.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("unsupported EC curve %q", k.Crv)
		}
		x, err := b64uBigInt(k.X)
		if err != nil {
			return nil, err
		}
		y, err := b64uBigInt(k.Y)
		if err != nil {
			return nil, err
		}
		return &ecdsa.PublicKey{Curve: curve, X: x, Y: y}, nil
	case "RSA":
		n, err := b64uBigInt(k.N)
		if err != nil {
			return nil, err
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return nil, fmt.Errorf("decode RSA exponent: %w", err)
		}
		var e int
		for _, b := range eBytes {
			e = e<<8 | int(b)
		}
		if e == 0 {
			return nil, errors.New("invalid RSA exponent")
		}
		return &rsa.PublicKey{N: n, E: e}, nil
	default:
		return nil, fmt.Errorf("unsupported key type %q", k.Kty)
	}
}

func b64uBigInt(s string) (*big.Int, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	return new(big.Int).SetBytes(b), nil
}
