package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type claims struct {
	OrganizationName string   `json:"organization_name"`
	Features         []string `json:"features"`
	MaxUsers         int      `json:"max_users"`
	MaxCompanyRisks  int      `json:"max_company_risks"`
	jwt.RegisteredClaims
}

type ledgerEntry struct {
	JTI              string    `json:"jti"`
	OrganizationName string    `json:"organization_name"`
	MaxUsers         int       `json:"max_users"`
	MaxCompanyRisks  int       `json:"max_company_risks"`
	IssuedAt         time.Time `json:"issued_at"`
	ExpiresAt        time.Time `json:"expires_at"`
}

func configDir() string {
	if value := os.Getenv("SADAR_LICENSE_HOME"); value != "" {
		return value
	}
	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	return filepath.Join(home, ".config", "sadar-license")
}

func privatePath() string { return filepath.Join(configDir(), "private.pem") }
func publicPath() string  { return filepath.Join(configDir(), "public.pem") }
func ledgerPath() string  { return filepath.Join(configDir(), "issued.jsonl") }

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func initKeys() error {
	if _, err := os.Stat(privatePath()); err == nil {
		return errors.New("private key already exists; refusing to overwrite")
	}
	if err := os.MkdirAll(configDir(), 0o700); err != nil {
		return err
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return err
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return err
	}
	if err := os.WriteFile(privatePath(), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateDER}), 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(publicPath(), pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}), 0o644); err != nil {
		return err
	}
	fmt.Println("Private key:", privatePath())
	fmt.Println("Public key :", publicPath())
	fmt.Println("Set ENTITLEMENT_PUBLIC_KEY to the public PEM contents on sadarbencana.id.")
	return nil
}

func loadPrivateKey() (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(privatePath())
	if err != nil {
		return nil, err
	}
	key, err := jwt.ParseEdPrivateKeyFromPEM(data)
	if err != nil {
		return nil, err
	}
	typed, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("private key is not Ed25519")
	}
	return typed, nil
}

func loadPublicKey() (ed25519.PublicKey, error) {
	data, err := os.ReadFile(publicPath())
	if err != nil {
		return nil, err
	}
	key, err := jwt.ParseEdPublicKeyFromPEM(data)
	if err != nil {
		return nil, err
	}
	typed, ok := key.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("public key is not Ed25519")
	}
	return typed, nil
}

func randomID() (string, error) {
	value := make([]byte, 18)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func issue(args []string) error {
	flags := flag.NewFlagSet("issue", flag.ContinueOnError)
	org := flags.String("organization", "", "organization name")
	maxUsers := flags.Int("max-users", 5, "maximum organization members")
	maxRisks := flags.Int("max-risks", 1000, "maximum company risks")
	days := flags.Int("days", 365, "validity in days")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*org) == "" || *maxUsers < 1 || *maxRisks < 1 || *days < 1 {
		return errors.New("--organization, positive --max-users, --max-risks, and --days are required")
	}
	privateKey, err := loadPrivateKey()
	if err != nil {
		return err
	}
	jti, err := randomID()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	expires := now.Add(time.Duration(*days) * 24 * time.Hour)
	payload := claims{
		OrganizationName: strings.TrimSpace(*org),
		Features:         []string{"company_portfolio"},
		MaxUsers:         *maxUsers,
		MaxCompanyRisks:  *maxRisks,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "sadar-license", Subject: "organization-entitlement",
			Audience: jwt.ClaimStrings{"sadar-bencana-hosted"}, ID: jti,
			IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, payload).SignedString(privateKey)
	if err != nil {
		return err
	}
	entry, _ := json.Marshal(ledgerEntry{
		JTI: jti, OrganizationName: payload.OrganizationName,
		MaxUsers: *maxUsers, MaxCompanyRisks: *maxRisks,
		IssuedAt: now, ExpiresAt: expires,
	})
	file, err := os.OpenFile(ledgerPath(), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(append(entry, '\n')); err != nil {
		return err
	}
	fmt.Println(token)
	return nil
}

func list() error {
	file, err := os.Open(ledgerPath())
	if os.IsNotExist(err) {
		fmt.Println("No tokens issued.")
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	fmt.Println("JTI\tORGANIZATION\tUSERS\tRISKS\tEXPIRES")
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var entry ledgerEntry
		if json.Unmarshal(scanner.Bytes(), &entry) == nil {
			fmt.Printf("%s\t%s\t%d\t%d\t%s\n", entry.JTI, entry.OrganizationName,
				entry.MaxUsers, entry.MaxCompanyRisks, entry.ExpiresAt.Format("2006-01-02"))
		}
	}
	return scanner.Err()
}

func inspect(raw string) error {
	publicKey, err := loadPublicKey()
	if err != nil {
		return err
	}
	payload := &claims{}
	if _, err := jwt.ParseWithClaims(raw, payload, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != jwt.SigningMethodEdDSA.Alg() {
			return nil, jwt.ErrSignatureInvalid
		}
		return publicKey, nil
	}, jwt.WithIssuer("sadar-license"), jwt.WithAudience("sadar-bencana-hosted")); err != nil {
		return err
	}
	output, _ := json.MarshalIndent(payload, "", "  ")
	fmt.Println(string(output))
	return nil
}

func usage() {
	fmt.Println(`Usage:
  sadar-license init
  sadar-license issue --organization NAME [--max-users 5] [--max-risks 1000] [--days 365]
  sadar-license renew --organization NAME [same flags as issue]
  sadar-license inspect TOKEN
  sadar-license list`)
}

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "init":
		must(initKeys())
	case "issue", "renew":
		must(issue(os.Args[2:]))
	case "inspect":
		if len(os.Args) != 3 {
			must(errors.New("inspect requires one token"))
		}
		must(inspect(os.Args[2]))
	case "list":
		must(list())
	case "version":
		fmt.Println("sadar-license " + strconv.Itoa(time.Now().Year()))
	default:
		usage()
		os.Exit(2)
	}
}
