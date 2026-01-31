package main

import (
	"errors"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
)

// Multi-tenant collections that require tenant isolation
var multiTenantCollections = map[string]bool{
	"products":            true,
	"categories":          true,
	"customers":           true,
	"sales":               true,
	"sale_items":          true,
	"inventory_movements": true,
	"sync_queue":          true,
	"sync_conflicts":      true,
}

// ensureTenantIsolation ensures records have proper tenant_id
func ensureTenantIsolation(record *models.Record, c echo.Context) error {
	collection := record.Collection().Name

	// Skip if not a multi-tenant collection
	if !multiTenantCollections[collection] {
		return nil
	}

	// Get tenant ID from header or authenticated user
	tenantID := getTenantID(c)
	if tenantID == "" {
		return apis.NewBadRequestError("Tenant ID is required", nil)
	}

	// Set tenant_id on record
	record.Set("tenant_id", tenantID)

	return nil
}

// filterByTenant adds tenant filter to list queries
func filterByTenant(e *core.RecordsListEvent, app *pocketbase.PocketBase) error {
	collection := e.Collection.Name

	// Skip if not a multi-tenant collection
	if !multiTenantCollections[collection] {
		return nil
	}

	// Get tenant ID
	tenantID := getTenantID(e.HttpContext)
	if tenantID == "" {
		return apis.NewBadRequestError("Tenant ID is required", nil)
	}

	// Add tenant filter to existing filter
	existingFilter := e.HttpContext.QueryParam("filter")
	tenantFilter := "tenant_id = '" + tenantID + "'"

	if existingFilter != "" {
		e.HttpContext.QueryParams().Set("filter", "("+existingFilter+") && "+tenantFilter)
	} else {
		e.HttpContext.QueryParams().Set("filter", tenantFilter)
	}

	return nil
}

// getTenantID extracts tenant ID from request
func getTenantID(c echo.Context) string {
	// First, check X-Tenant-ID header
	tenantID := c.Request().Header.Get("X-Tenant-ID")
	if tenantID != "" {
		return tenantID
	}

	// Then, try to get from authenticated user's tenant
	authRecord, _ := c.Get(apis.ContextAuthRecordKey).(*models.Record)
	if authRecord != nil {
		if tid := authRecord.GetString("tenant_id"); tid != "" {
			return tid
		}
	}

	return ""
}

// validateTenantAccess checks if user has access to the specified tenant
func validateTenantAccess(c echo.Context, tenantID string) error {
	authRecord, _ := c.Get(apis.ContextAuthRecordKey).(*models.Record)
	if authRecord == nil {
		return errors.New("unauthorized")
	}

	userTenantID := authRecord.GetString("tenant_id")
	if userTenantID != tenantID {
		return errors.New("access denied to this tenant")
	}

	return nil
}

// isSystemAdmin checks if the authenticated user is a system admin
func isSystemAdmin(c echo.Context) bool {
	authRecord, _ := c.Get(apis.ContextAuthRecordKey).(*models.Record)
	if authRecord == nil {
		return false
	}

	role := authRecord.GetString("role")
	return strings.ToLower(role) == "admin"
}
