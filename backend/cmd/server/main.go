package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	_ "github.com/johnny4young/open-yojob/backend/migrations"
)

func main() {
	app := pocketbase.New()

	// Enable auto-migration in development
	var migrationsDir string
	switch {
	case strings.HasPrefix(os.Args[0], os.TempDir()):
		// Running via "go run"
		migrationsDir = "./migrations"
	default:
		// Running via compiled binary
		migrationsDir = filepath.Join(filepath.Dir(os.Args[0]), "migrations")
	}

	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Dir:         migrationsDir,
		Automigrate: true,
	})

	// Setup custom routes
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		// Add CORS middleware
		e.Router.Use(corsMiddleware())

		// Health check endpoint
		e.Router.GET("/api/health", func(c echo.Context) error {
			return c.JSON(200, map[string]string{
				"status":  "healthy",
				"version": "1.0.0",
			})
		}, apis.ActivityLogger(app))

		// Custom sync endpoints
		setupSyncRoutes(e, app)

		return nil
	})

	// Hook: Ensure tenant isolation on record creation
	app.OnRecordBeforeCreateRequest().Add(func(e *core.RecordCreateEvent) error {
		return ensureTenantIsolation(e.Record, e.HttpContext)
	})

	// Hook: Ensure tenant isolation on record update
	app.OnRecordBeforeUpdateRequest().Add(func(e *core.RecordUpdateEvent) error {
		return ensureTenantIsolation(e.Record, e.HttpContext)
	})

	// Hook: Filter records by tenant
	app.OnRecordsListRequest().Add(func(e *core.RecordsListEvent) error {
		return filterByTenant(e, app)
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
