package http

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"net/smtp"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const ctxOrganizationID = "organization_id"
const ctxCompanyRiskLimit = "company_risk_limit"

type entitlementClaims struct {
	OrganizationName string   `json:"organization_name"`
	Features         []string `json:"features"`
	MaxUsers         int      `json:"max_users"`
	MaxCompanyRisks  int      `json:"max_company_risks"`
	jwt.RegisteredClaims
}

func containsFeature(features []string, wanted string) bool {
	for _, feature := range features {
		if feature == wanted {
			return true
		}
	}
	return false
}

func parseEntitlementToken(raw, publicKeyPEM string) (*entitlementClaims, error) {
	publicKeyPEM = strings.ReplaceAll(publicKeyPEM, `\n`, "\n")
	key, err := jwt.ParseEdPublicKeyFromPEM([]byte(publicKeyPEM))
	if err != nil {
		return nil, err
	}
	publicKey, ok := key.(ed25519.PublicKey)
	if !ok {
		return nil, jwt.ErrSignatureInvalid
	}
	claims := &entitlementClaims{}
	_, err = jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != jwt.SigningMethodEdDSA.Alg() {
			return nil, jwt.ErrSignatureInvalid
		}
		return publicKey, nil
	}, jwt.WithAudience("sadar-bencana-hosted"), jwt.WithIssuer("sadar-license"))
	if err != nil {
		return nil, err
	}
	return claims, nil
}

func CompanyAccess(db *sql.DB, deploymentMode string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.EqualFold(deploymentMode, "community") {
			c.Next()
			return
		}
		if db == nil {
			dbUnavailable(c)
			c.Abort()
			return
		}
		var organizationID string
		var companyRiskLimit int
		err := db.QueryRowContext(c.Request.Context(), `
SELECT o.id,o.max_company_risks
FROM organization_members m
JOIN organizations o ON o.id = m.organization_id
WHERE m.auth_user_id = $1
  AND o.entitlement_state = 'active'
  AND (o.entitlement_expires_at IS NULL OR o.entitlement_expires_at > now())
LIMIT 1`, AuthUserID(c)).Scan(&organizationID, &companyRiskLimit)
		if err == sql.ErrNoRows {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":   "company_entitlement_required",
				"message": "aktifkan token organisasi untuk membuka portofolio perusahaan",
			})
			return
		}
		if err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		c.Set(ctxOrganizationID, organizationID)
		c.Set(ctxCompanyRiskLimit, companyRiskLimit)
		c.Next()
	}
}

func CompanyRiskLimit(c *gin.Context, fallback int) int {
	value, ok := c.Get(ctxCompanyRiskLimit)
	if !ok {
		return fallback
	}
	limit, ok := value.(int)
	if !ok {
		return fallback
	}
	return limit
}

func OrganizationID(c *gin.Context) string {
	value, _ := c.Get(ctxOrganizationID)
	id, _ := value.(string)
	return id
}

func EntitlementStatus(db *sql.DB, deploymentMode string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.EqualFold(deploymentMode, "community") {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{
				"deployment_mode": "community", "company_enabled": true,
			}})
			return
		}
		if db == nil {
			dbUnavailable(c)
			return
		}
		var id, name, state, role string
		var expires time.Time
		var maxUsers, maxRisks, memberCount, riskCount int
		err := db.QueryRowContext(c.Request.Context(), `
SELECT o.id, o.name, o.entitlement_state, o.entitlement_expires_at,
       o.max_users, o.max_company_risks, m.role,
       (SELECT count(*) FROM organization_members om WHERE om.organization_id=o.id),
       (SELECT count(*) FROM risk_entries r WHERE r.organization_id=o.id)
FROM organization_members m
JOIN organizations o ON o.id=m.organization_id
WHERE m.auth_user_id=$1
ORDER BY o.created_at DESC LIMIT 1`, AuthUserID(c)).
			Scan(&id, &name, &state, &expires, &maxUsers, &maxRisks, &role, &memberCount, &riskCount)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, gin.H{"data": gin.H{
				"deployment_mode": "hosted", "company_enabled": false,
			}})
			return
		}
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "database_query_failed", "message": err.Error()})
			return
		}
		enabled := state == "active" && expires.After(time.Now())
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"deployment_mode": "hosted", "company_enabled": enabled,
			"organization": gin.H{
				"id": id, "name": name, "role": role, "state": state,
				"expires_at": expires, "max_users": maxUsers, "member_count": memberCount,
				"max_company_risks": maxRisks, "company_risk_count": riskCount,
			},
		}})
	}
}

type activateEntitlementBody struct {
	Token string `json:"token"`
}

func EntitlementActivate(db *sql.DB, deploymentMode, publicKeyPEM string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !strings.EqualFold(deploymentMode, "hosted") {
			c.JSON(http.StatusConflict, gin.H{"error": "not_hosted", "message": "community mode does not require entitlement"})
			return
		}
		if db == nil {
			dbUnavailable(c)
			return
		}
		if strings.TrimSpace(publicKeyPEM) == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "entitlement_not_configured"})
			return
		}
		var body activateEntitlementBody
		if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Token) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body", "message": "token is required"})
			return
		}
		claims, err := parseEntitlementToken(strings.TrimSpace(body.Token), publicKeyPEM)
		if err != nil || !containsFeature(claims.Features, "company_portfolio") ||
			claims.ID == "" || strings.TrimSpace(claims.OrganizationName) == "" ||
			claims.ExpiresAt == nil || claims.MaxUsers < 1 || claims.MaxCompanyRisks < 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_entitlement", "message": "token tidak valid atau tidak lengkap"})
			return
		}
		hash := sha256.Sum256([]byte(body.Token))
		claimsJSON, err := json.Marshal(claims)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "claims_audit_failed"})
			return
		}
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction_failed"})
			return
		}
		defer tx.Rollback()

		var organizationID string
		err = tx.QueryRowContext(c.Request.Context(), `
INSERT INTO organizations
  (name, entitlement_jti, entitlement_expires_at, max_users, max_company_risks, created_by)
VALUES ($1,$2,$3,$4,$5,$6)
RETURNING id`, strings.TrimSpace(claims.OrganizationName), claims.ID, claims.ExpiresAt.Time,
			claims.MaxUsers, claims.MaxCompanyRisks, AuthUserID(c)).Scan(&organizationID)
		if err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "entitlement_already_used", "message": "token sudah diaktifkan"})
			return
		}
		if _, err = tx.ExecContext(c.Request.Context(), `
INSERT INTO organization_members(organization_id,auth_user_id,email,role)
VALUES ($1,$2,$3,'owner')`, organizationID, AuthUserID(c), AuthEmail(c)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "membership_failed"})
			return
		}
		if _, err = tx.ExecContext(c.Request.Context(), `
INSERT INTO entitlement_activations
  (organization_id,entitlement_jti,token_hash,claims,activated_by)
VALUES ($1,$2,$3,$4::jsonb,$5)`, organizationID, claims.ID, hex.EncodeToString(hash[:]),
			string(claimsJSON), AuthUserID(c)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "activation_audit_failed"})
			return
		}
		if _, err = tx.ExecContext(c.Request.Context(), `
UPDATE risk_entries SET organization_id=$1
WHERE auth_user_id=$2 AND organization_id IS NULL`, organizationID, AuthUserID(c)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "legacy_claim_failed"})
			return
		}
		if err = tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "activation_commit_failed"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"data": gin.H{"organization_id": organizationID, "company_enabled": true}})
	}
}

type invitationBody struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

// emailAddrRe admits only the RFC 5322 local/domain safe printable charset.
// Control characters (CR/LF) are structurally impossible to match, which
// prevents SMTP header injection through the invitation email field.
var emailAddrRe = regexp.MustCompile(`^[A-Za-z0-9.!#$%&'*+/=?^_\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)+$`)

func OrganizationInviteCreate(db *sql.DB, smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body invitationBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_email"})
			return
		}
		body.Email = strings.TrimSpace(body.Email)
		if body.Email == "" || strings.ContainsAny(body.Email, "\r\n") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_email"})
			return
		}
		parsedEmail, err := mail.ParseAddress(body.Email)
		if err != nil || parsedEmail.Address != body.Email {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_email"})
			return
		}
		if body.Role != "admin" {
			body.Role = "member"
		}
		orgID := OrganizationID(c)
		var role string
		if err := db.QueryRowContext(c.Request.Context(),
			`SELECT role FROM organization_members WHERE organization_id=$1 AND auth_user_id=$2`,
			orgID, AuthUserID(c)).Scan(&role); err != nil || (role != "owner" && role != "admin") {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization_admin_required"})
			return
		}
		var memberCount, pendingCount, maxUsers int
		if err := db.QueryRowContext(c.Request.Context(), `
SELECT
  (SELECT count(*) FROM organization_members WHERE organization_id=$1),
  (SELECT count(*) FROM organization_invitations WHERE organization_id=$1 AND accepted_at IS NULL AND expires_at>now()),
  max_users
FROM organizations WHERE id=$1`, orgID).Scan(&memberCount, &pendingCount, &maxUsers); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "organization_count_failed"})
			return
		}
		if memberCount+pendingCount >= maxUsers {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization_user_limit_reached"})
			return
		}
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "token_generation_failed"})
			return
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		hash := sha256.Sum256([]byte(token))
		var id string
		err = db.QueryRowContext(c.Request.Context(), `
INSERT INTO organization_invitations
  (organization_id,email,role,token_hash,expires_at,invited_by)
VALUES ($1,lower($2),$3,$4,now()+interval '7 days',$5)
RETURNING id`, orgID, body.Email, body.Role, hex.EncodeToString(hash[:]), AuthUserID(c)).Scan(&id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invitation_failed", "message": err.Error()})
			return
		}
		emailSent := false
		emailWarning := ""
		// Validate the parsed address against a strict email charset. The
		// regex only admits alphanumerics and the safe printable set, so
		// CR/LF or any control byte can never reach the SMTP sink.
		if !emailAddrRe.MatchString(parsedEmail.Address) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_email"})
			return
		}
		safeEmail := parsedEmail.Address
		// Final guard on the exact value that reaches the SMTP sink: reject
		// any control characters even though the regex above already forbids
		// them (defense in depth for the header/envelope path).
		if strings.Contains(safeEmail, "\r") || strings.Contains(safeEmail, "\n") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_email"})
			return
		}
		if smtpHost != "" && smtpUser != "" && smtpPassword != "" {
			address := smtpHost + ":" + smtpPort
			message := fmt.Sprintf(
				"From: %s\r\nTo: %s\r\nSubject: Undangan organisasi SadarBencana\r\n"+
					"Content-Type: text/plain; charset=UTF-8\r\n\r\n"+
					"Anda diundang bergabung ke organisasi SadarBencana.\n\n"+
					"Masuk ke sadarbencana.id, buka Daftar Risiko > Portofolio Perusahaan, "+
					"lalu masukkan kode berikut:\n\n%s\n\nKode berlaku 7 hari.\n",
				smtpFrom, safeEmail, token,
			)
			auth := smtp.PlainAuth("", smtpUser, smtpPassword, smtpHost)
			if err := smtp.SendMail(address, auth, smtpFrom, []string{safeEmail}, []byte(message)); err == nil {
				emailSent = true
			} else {
				emailWarning = "email gagal dikirim; salin kode undangan secara manual"
			}
		} else {
			emailWarning = "SMTP belum dikonfigurasi; salin kode undangan secara manual"
		}
		c.JSON(http.StatusCreated, gin.H{"data": gin.H{
			"id": id, "invite_token": token, "expires_in_days": 7,
			"email_sent": emailSent, "warning": emailWarning,
		}})
	}
}

func OrganizationInviteAccept(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			Token string `json:"token"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Token == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "token_required"})
			return
		}
		hash := sha256.Sum256([]byte(body.Token))
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "transaction_failed"})
			return
		}
		defer tx.Rollback()
		var id, orgID, email, role string
		err = tx.QueryRowContext(c.Request.Context(), `
SELECT id,organization_id,email,role FROM organization_invitations
WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()
FOR UPDATE`, hex.EncodeToString(hash[:])).Scan(&id, &orgID, &email, &role)
		if err != nil || !strings.EqualFold(email, AuthEmail(c)) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_invitation"})
			return
		}
		var memberCount, maxUsers int
		if err = tx.QueryRowContext(c.Request.Context(), `
SELECT (SELECT count(*) FROM organization_members WHERE organization_id=$1),max_users
FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&memberCount, &maxUsers); err != nil || memberCount >= maxUsers {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization_user_limit_reached"})
			return
		}
		if _, err = tx.ExecContext(c.Request.Context(), `
INSERT INTO organization_members(organization_id,auth_user_id,email,role)
VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, orgID, AuthUserID(c), email, role); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "membership_failed"})
			return
		}
		_, _ = tx.ExecContext(c.Request.Context(), `UPDATE organization_invitations SET accepted_at=now() WHERE id=$1`, id)
		if err = tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invitation_commit_failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"organization_id": orgID}})
	}
}
