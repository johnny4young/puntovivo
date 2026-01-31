package main

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
)

// SyncPushRequest represents a sync push request
type SyncPushRequest struct {
	TenantID        string       `json:"tenantId"`
	Changes         []SyncChange `json:"changes"`
	ClientTimestamp string       `json:"clientTimestamp"`
}

// SyncChange represents a single change to sync
type SyncChange struct {
	EntityType   string                 `json:"entityType"`
	EntityID     string                 `json:"entityId"`
	Operation    string                 `json:"operation"` // create, update, delete
	Data         map[string]interface{} `json:"data"`
	LocalVersion int                    `json:"localVersion"`
}

// SyncPullResponse represents a sync pull response
type SyncPullResponse struct {
	Changes         []SyncChange `json:"changes"`
	ServerTimestamp string       `json:"serverTimestamp"`
	HasMore         bool         `json:"hasMore"`
}

// SyncConflict represents a sync conflict
type SyncConflict struct {
	EntityType string                 `json:"entityType"`
	EntityID   string                 `json:"entityId"`
	LocalData  map[string]interface{} `json:"localData"`
	RemoteData map[string]interface{} `json:"remoteData"`
}

// SyncResult represents the result of a sync operation
type SyncResult struct {
	Success   bool           `json:"success"`
	Synced    int            `json:"synced"`
	Conflicts []SyncConflict `json:"conflicts,omitempty"`
	Errors    []string       `json:"errors,omitempty"`
}

// setupSyncRoutes configures the sync API endpoints
func setupSyncRoutes(e *core.ServeEvent, app *pocketbase.PocketBase) {
	// Push local changes to server
	e.Router.POST("/api/sync/push", func(c echo.Context) error {
		return handleSyncPush(c, app)
	}, apis.RequireRecordAuth())

	// Pull remote changes from server
	e.Router.GET("/api/sync/pull", func(c echo.Context) error {
		return handleSyncPull(c, app)
	}, apis.RequireRecordAuth())

	// Resolve a conflict
	e.Router.POST("/api/sync/resolve", func(c echo.Context) error {
		return handleSyncResolve(c, app)
	}, apis.RequireRecordAuth())

	// Get sync status
	e.Router.GET("/api/sync/status", func(c echo.Context) error {
		return handleSyncStatus(c, app)
	}, apis.RequireRecordAuth())
}

// handleSyncPush processes incoming changes from client
func handleSyncPush(c echo.Context, app *pocketbase.PocketBase) error {
	var req SyncPushRequest
	if err := c.Bind(&req); err != nil {
		return apis.NewBadRequestError("Invalid request body", err)
	}

	// Validate tenant access
	if err := validateTenantAccess(c, req.TenantID); err != nil {
		return apis.NewForbiddenError(err.Error(), nil)
	}

	result := SyncResult{
		Success: true,
		Synced:  0,
	}

	for _, change := range req.Changes {
		err := processChange(app, req.TenantID, change)
		if err != nil {
			result.Errors = append(result.Errors, err.Error())
			result.Success = false
		} else {
			result.Synced++
		}
	}

	return c.JSON(http.StatusOK, result)
}

// handleSyncPull retrieves changes since a given timestamp
func handleSyncPull(c echo.Context, app *pocketbase.PocketBase) error {
	tenantID := getTenantID(c)
	if tenantID == "" {
		return apis.NewBadRequestError("Tenant ID is required", nil)
	}

	since := c.QueryParam("since")
	if since == "" {
		// Default to 24 hours ago
		since = time.Now().Add(-24 * time.Hour).Format(time.RFC3339)
	}

	// Get changes from various collections
	changes := []SyncChange{}
	collections := []string{"products", "categories", "customers", "sales", "inventory_movements"}

	for _, collName := range collections {
		coll, err := app.Dao().FindCollectionByNameOrId(collName)
		if err != nil {
			continue
		}

		records, err := app.Dao().FindRecordsByFilter(
			coll.Id,
			"tenant_id = {:tenantId} && updated >= {:since}",
			"-updated",
			100,
			0,
			map[string]interface{}{
				"tenantId": tenantID,
				"since":    since,
			},
		)
		if err != nil {
			continue
		}

		for _, record := range records {
			data := map[string]interface{}{}
			for key, value := range record.PublicExport() {
				data[key] = value
			}
			changes = append(changes, SyncChange{
				EntityType:   collName,
				EntityID:     record.Id,
				Operation:    "update",
				Data:         data,
				LocalVersion: record.GetInt("sync_version"),
			})
		}
	}

	response := SyncPullResponse{
		Changes:         changes,
		ServerTimestamp: time.Now().Format(time.RFC3339),
		HasMore:         false, // Implement pagination if needed
	}

	return c.JSON(http.StatusOK, response)
}

// handleSyncResolve processes conflict resolution
func handleSyncResolve(c echo.Context, app *pocketbase.PocketBase) error {
	var req struct {
		ConflictID string                 `json:"conflictId"`
		Resolution string                 `json:"resolution"` // local_wins, remote_wins, merged
		MergedData map[string]interface{} `json:"mergedData,omitempty"`
	}

	if err := c.Bind(&req); err != nil {
		return apis.NewBadRequestError("Invalid request body", err)
	}

	// Find the conflict record
	collection, err := app.Dao().FindCollectionByNameOrId("sync_conflicts")
	if err != nil {
		return apis.NewNotFoundError("Sync conflicts collection not found", err)
	}

	conflict, err := app.Dao().FindRecordById(collection.Id, req.ConflictID)
	if err != nil {
		return apis.NewNotFoundError("Conflict not found", err)
	}

	// Apply resolution
	conflict.Set("resolution", req.Resolution)
	conflict.Set("resolved_at", time.Now().Format(time.RFC3339))

	if req.Resolution == "merged" && req.MergedData != nil {
		mergedJSON, _ := json.Marshal(req.MergedData)
		conflict.Set("merged_data", string(mergedJSON))
	}

	if err := app.Dao().SaveRecord(conflict); err != nil {
		return apis.NewBadRequestError("Failed to save resolution", err)
	}

	return c.JSON(http.StatusOK, map[string]string{
		"status": "resolved",
	})
}

// handleSyncStatus returns current sync status for the tenant
func handleSyncStatus(c echo.Context, app *pocketbase.PocketBase) error {
	tenantID := getTenantID(c)
	if tenantID == "" {
		return apis.NewBadRequestError("Tenant ID is required", nil)
	}

	// Count pending conflicts
	conflictsCollection, _ := app.Dao().FindCollectionByNameOrId("sync_conflicts")
	pendingConflicts := 0
	if conflictsCollection != nil {
		records, _ := app.Dao().FindRecordsByFilter(
			conflictsCollection.Id,
			"tenant_id = {:tenantId} && resolution = ''",
			"",
			0,
			0,
			map[string]interface{}{"tenantId": tenantID},
		)
		pendingConflicts = len(records)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"tenantId":         tenantID,
		"pendingConflicts": pendingConflicts,
		"serverTime":       time.Now().Format(time.RFC3339),
	})
}

// processChange applies a single change to the database
func processChange(app *pocketbase.PocketBase, tenantID string, change SyncChange) error {
	collection, err := app.Dao().FindCollectionByNameOrId(change.EntityType)
	if err != nil {
		return err
	}

	switch change.Operation {
	case "create":
		record := models.NewRecord(collection)
		for key, value := range change.Data {
			record.Set(key, value)
		}
		record.Set("tenant_id", tenantID)
		record.Set("sync_status", "synced")
		record.Set("sync_version", change.LocalVersion+1)
		return app.Dao().SaveRecord(record)

	case "update":
		record, err := app.Dao().FindRecordById(collection.Id, change.EntityID)
		if err != nil {
			return err
		}

		// Check for conflicts
		serverVersion := record.GetInt("sync_version")
		if serverVersion > change.LocalVersion {
			// Conflict detected - could create a conflict record here
			return nil // For now, skip conflicting updates
		}

		for key, value := range change.Data {
			if key != "id" && key != "tenant_id" {
				record.Set(key, value)
			}
		}
		record.Set("sync_status", "synced")
		record.Set("sync_version", serverVersion+1)
		return app.Dao().SaveRecord(record)

	case "delete":
		record, err := app.Dao().FindRecordById(collection.Id, change.EntityID)
		if err != nil {
			return err
		}
		return app.Dao().DeleteRecord(record)
	}

	return nil
}
