package http

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type roleDriver struct{}
type roleConn struct{ role string }
type roleRows struct {
	role string
	done bool
}

func (roleDriver) Open(name string) (driver.Conn, error) { return &roleConn{role: name}, nil }
func (*roleConn) Prepare(string) (driver.Stmt, error)    { return nil, driver.ErrSkip }
func (*roleConn) Close() error                           { return nil }
func (*roleConn) Begin() (driver.Tx, error)              { return nil, driver.ErrSkip }
func (c *roleConn) QueryContext(context.Context, string, []driver.NamedValue) (driver.Rows, error) {
	return &roleRows{role: c.role}, nil
}
func (*roleRows) Columns() []string { return []string{"role"} }
func (*roleRows) Close() error      { return nil }
func (r *roleRows) Next(values []driver.Value) error {
	if r.done || r.role == "" {
		return io.EOF
	}
	values[0] = r.role
	r.done = true
	return nil
}

func init() {
	sql.Register("ews_role_test", roleDriver{})
}

func adminTestRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/admin", func(c *gin.Context) {
		c.Set(ctxAuthEmail, "admin@example.test")
	}, RequireEWSAdmin(db), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})
	return router
}

func TestRequireEWSAdminAllowsAdmin(t *testing.T) {
	db, err := sql.Open("ews_role_test", "admin")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/admin", nil)
	adminTestRouter(db).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
}

func TestRequireEWSAdminRejectsNonAdmin(t *testing.T) {
	db, err := sql.Open("ews_role_test", "member")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/admin", nil)
	adminTestRouter(db).ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
}

func TestRequireEWSAdminHandlesUnavailableDatabase(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/admin", nil)
	adminTestRouter(nil).ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", response.Code, response.Body.String())
	}
}
