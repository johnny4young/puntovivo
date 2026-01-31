package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// =============================================================================
// Configuration
// =============================================================================

type Config struct {
	SourceDB      string
	TargetURL     string
	AdminEmail    string
	AdminPassword string
	DryRun        bool
	BatchSize     int
}

// =============================================================================
// PocketBase Client
// =============================================================================

type PBClient struct {
	BaseURL string
	Token   string
	Client  *http.Client
}

type AuthResponse struct {
	Token string `json:"token"`
}

type RecordResponse struct {
	ID string `json:"id"`
}

type ListResponse struct {
	Items      []map[string]interface{} `json:"items"`
	TotalItems int                      `json:"totalItems"`
	TotalPages int                      `json:"totalPages"`
}

func NewPBClient(baseURL, email, password string) (*PBClient, error) {
	client := &PBClient{
		BaseURL: strings.TrimSuffix(baseURL, "/"),
		Client:  &http.Client{Timeout: 30 * time.Second},
	}

	if err := client.authenticate(email, password); err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	return client, nil
}

func (c *PBClient) authenticate(email, password string) error {
	payload := fmt.Sprintf(`{"identity":"%s","password":"%s"}`, email, password)

	req, err := http.NewRequest("POST", c.BaseURL+"/api/admins/auth-with-password", strings.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("auth failed with status %d", resp.StatusCode)
	}

	var authResp AuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return err
	}

	c.Token = authResp.Token
	return nil
}

func (c *PBClient) CreateRecord(collection string, data map[string]interface{}) (string, error) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", c.BaseURL+"/api/collections/"+collection+"/records", strings.NewReader(string(jsonData)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Token)

	resp, err := c.Client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", fmt.Errorf("create failed with status %d", resp.StatusCode)
	}

	var result RecordResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	return result.ID, nil
}

func (c *PBClient) GetRecords(collection string) ([]map[string]interface{}, error) {
	var allItems []map[string]interface{}
	page := 1

	for {
		req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/collections/%s/records?page=%d&perPage=500", c.BaseURL, collection, page), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.Token)

		resp, err := c.Client.Do(req)
		if err != nil {
			return nil, err
		}

		var result ListResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			resp.Body.Close()
			return nil, err
		}
		resp.Body.Close()

		allItems = append(allItems, result.Items...)

		if page >= result.TotalPages {
			break
		}
		page++
	}

	return allItems, nil
}

func (c *PBClient) DeleteRecord(collection, id string) error {
	req, err := http.NewRequest("DELETE", c.BaseURL+"/api/collections/"+collection+"/records/"+id, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)

	resp, err := c.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// =============================================================================
// Migration Runner
// =============================================================================

type MigrationRunner struct {
	Config      Config
	DB          *sql.DB
	PB          *PBClient
	TenantMap   map[string]string
	CustomerMap map[string]string
	CategoryMap map[string]string
	ProductMap  map[string]string
	ProviderMap map[string]string
	SiteMap     map[string]string
}

func NewMigrationRunner(config Config) (*MigrationRunner, error) {
	db, err := sql.Open("sqlite3", config.SourceDB)
	if err != nil {
		return nil, fmt.Errorf("failed to open source database: %w", err)
	}

	var pb *PBClient
	if !config.DryRun {
		pb, err = NewPBClient(config.TargetURL, config.AdminEmail, config.AdminPassword)
		if err != nil {
			return nil, fmt.Errorf("failed to connect to PocketBase: %w", err)
		}
	}

	return &MigrationRunner{
		Config:      config,
		DB:          db,
		PB:          pb,
		TenantMap:   make(map[string]string),
		CustomerMap: make(map[string]string),
		CategoryMap: make(map[string]string),
		ProductMap:  make(map[string]string),
		ProviderMap: make(map[string]string),
		SiteMap:     make(map[string]string),
	}, nil
}

func (r *MigrationRunner) Close() {
	if r.DB != nil {
		r.DB.Close()
	}
}

func (r *MigrationRunner) MigrateTenants() error {
	fmt.Println("\n📦 Migrating Tenants (Companies)...")

	rows, err := r.DB.Query("SELECT CompanyID, ID, Name, Owner, Role FROM Company")
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var companyID, id, name string
		var owner, role sql.NullString

		if err := rows.Scan(&companyID, &id, &name, &owner, &role); err != nil {
			log.Printf("Warning: failed to scan company: %v", err)
			continue
		}

		data := map[string]interface{}{
			"legacy_id": companyID,
			"name":      name,
			"tax_id":    id,
			"settings":  map[string]interface{}{},
		}

		if owner.Valid {
			data["owner"] = owner.String
		}

		if r.Config.DryRun {
			fmt.Printf("  [DRY RUN] Would create tenant: %s\n", name)
		} else {
			newID, err := r.PB.CreateRecord("tenants", data)
			if err != nil {
				log.Printf("Warning: failed to create tenant %s: %v", name, err)
				continue
			}
			r.TenantMap[companyID] = newID
		}
		count++
	}

	fmt.Printf("  ✅ Migrated %d tenants\n", count)
	return nil
}

func (r *MigrationRunner) MigrateCategories() error {
	fmt.Println("\n📁 Migrating Categories...")

	rows, err := r.DB.Query("SELECT CategoryID, CompanyID, Name, Description FROM Category")
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var categoryID, companyID, name string
		var description sql.NullString

		if err := rows.Scan(&categoryID, &companyID, &name, &description); err != nil {
			continue
		}

		tenantID := r.TenantMap[companyID]
		if tenantID == "" && !r.Config.DryRun {
			continue
		}

		data := map[string]interface{}{
			"legacy_id": categoryID,
			"name":      name,
			"tenant":    tenantID,
			"is_active": true,
		}

		if description.Valid {
			data["description"] = description.String
		}

		if r.Config.DryRun {
			fmt.Printf("  [DRY RUN] Would create category: %s\n", name)
		} else {
			newID, err := r.PB.CreateRecord("categories", data)
			if err != nil {
				log.Printf("Warning: failed to create category %s: %v", name, err)
				continue
			}
			r.CategoryMap[categoryID] = newID
		}
		count++
	}

	fmt.Printf("  ✅ Migrated %d categories\n", count)
	return nil
}

func (r *MigrationRunner) MigrateCustomers() error {
	fmt.Println("\n👥 Migrating Customers (Clients)...")

	query := `
		SELECT c.ClientID, c.IdentificationCard, c.Name, c.LastName,
		       c.Address, c.Phone, c.Email, c.CellPhone, c.CreditLine,
		       cxc.CompanyID
		FROM Client c
		LEFT JOIN ClientXCompany cxc ON c.ClientID = cxc.ClientID
	`

	rows, err := r.DB.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var clientID, idCard, name string
		var lastName, address, phone, email, cellPhone sql.NullString
		var creditLine sql.NullFloat64
		var companyID sql.NullString

		if err := rows.Scan(&clientID, &idCard, &name, &lastName, &address, &phone, &email, &cellPhone, &creditLine, &companyID); err != nil {
			continue
		}

		tenantID := ""
		if companyID.Valid {
			tenantID = r.TenantMap[companyID.String]
		}
		if tenantID == "" && !r.Config.DryRun {
			continue
		}

		fullName := name
		if lastName.Valid && lastName.String != "" {
			fullName = name + " " + lastName.String
		}

		phoneNum := ""
		if phone.Valid {
			phoneNum = phone.String
		} else if cellPhone.Valid {
			phoneNum = cellPhone.String
		}

		data := map[string]interface{}{
			"legacy_id":      clientID,
			"name":           fullName,
			"tenant":         tenantID,
			"identification": idCard,
			"is_active":      true,
		}

		if email.Valid {
			data["email"] = email.String
		}
		if phoneNum != "" {
			data["phone"] = phoneNum
		}
		if address.Valid {
			data["address"] = address.String
		}
		if creditLine.Valid {
			data["credit_limit"] = creditLine.Float64
		}

		if r.Config.DryRun {
			fmt.Printf("  [DRY RUN] Would create customer: %s\n", fullName)
		} else {
			newID, err := r.PB.CreateRecord("customers", data)
			if err != nil {
				log.Printf("Warning: failed to create customer %s: %v", fullName, err)
				continue
			}
			r.CustomerMap[clientID] = newID
		}
		count++
	}

	fmt.Printf("  ✅ Migrated %d customers\n", count)
	return nil
}

func (r *MigrationRunner) MigrateProducts() error {
	fmt.Println("\n📦 Migrating Products...")

	query := `SELECT ProductID, Code, CompanyID, Description, StockMin, StockMax, AllowSellWithoutStock, Enabled FROM Product`

	rows, err := r.DB.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var productID, code, companyID, description string
		var stockMin, stockMax sql.NullFloat64
		var allowNegative, enabled sql.NullBool

		if err := rows.Scan(&productID, &code, &companyID, &description, &stockMin, &stockMax, &allowNegative, &enabled); err != nil {
			continue
		}

		tenantID := r.TenantMap[companyID]
		if tenantID == "" && !r.Config.DryRun {
			continue
		}

		data := map[string]interface{}{
			"legacy_id": productID,
			"tenant":    tenantID,
			"code":      code,
			"name":      description,
			"is_active": true,
		}

		if stockMin.Valid {
			data["min_stock"] = stockMin.Float64
		}
		if stockMax.Valid {
			data["max_stock"] = stockMax.Float64
		}
		if allowNegative.Valid {
			data["allow_negative_stock"] = allowNegative.Bool
		}
		if enabled.Valid {
			data["is_active"] = enabled.Bool
		}

		if r.Config.DryRun {
			fmt.Printf("  [DRY RUN] Would create product: %s\n", description)
		} else {
			newID, err := r.PB.CreateRecord("products", data)
			if err != nil {
				log.Printf("Warning: failed to create product %s: %v", description, err)
				continue
			}
			r.ProductMap[productID] = newID
		}
		count++
	}

	fmt.Printf("  ✅ Migrated %d products\n", count)
	return nil
}

func (r *MigrationRunner) MigrateSales() error {
	fmt.Println("\n💰 Migrating Sales...")

	query := `SELECT SaleID, CompanyID, ClientID, Subtotal, Vat, Discount, Total, State, Date FROM Sale WHERE State = 'PA'`

	rows, err := r.DB.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var saleID string
		var companyID, clientID sql.NullString
		var subtotal, vat, discount, total sql.NullFloat64
		var state sql.NullString
		var date sql.NullString

		if err := rows.Scan(&saleID, &companyID, &clientID, &subtotal, &vat, &discount, &total, &state, &date); err != nil {
			continue
		}

		tenantID := ""
		if companyID.Valid {
			tenantID = r.TenantMap[companyID.String]
		}
		if tenantID == "" && !r.Config.DryRun {
			continue
		}

		data := map[string]interface{}{
			"legacy_id": saleID,
			"tenant":    tenantID,
			"status":    "completed",
		}

		if clientID.Valid {
			if custID := r.CustomerMap[clientID.String]; custID != "" {
				data["customer"] = custID
			}
		}
		if subtotal.Valid {
			data["subtotal"] = subtotal.Float64
		}
		if vat.Valid {
			data["tax"] = vat.Float64
		}
		if discount.Valid {
			data["discount"] = discount.Float64
		}
		if total.Valid {
			data["total"] = total.Float64
		}

		if r.Config.DryRun {
			fmt.Printf("  [DRY RUN] Would create sale: %s\n", saleID)
		} else {
			_, err := r.PB.CreateRecord("sales", data)
			if err != nil {
				log.Printf("Warning: failed to create sale %s: %v", saleID, err)
				continue
			}
		}
		count++
	}

	fmt.Printf("  ✅ Migrated %d sales\n", count)
	return nil
}

func (r *MigrationRunner) Run() error {
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("🚀 Starting Data Migration")
	fmt.Printf("   Source: %s\n", r.Config.SourceDB)
	fmt.Printf("   Target: %s\n", r.Config.TargetURL)
	fmt.Printf("   Dry Run: %v\n", r.Config.DryRun)
	fmt.Println(strings.Repeat("=", 60))

	// Order matters for foreign key relationships
	if err := r.MigrateTenants(); err != nil {
		return fmt.Errorf("tenant migration failed: %w", err)
	}

	if err := r.MigrateCategories(); err != nil {
		return fmt.Errorf("category migration failed: %w", err)
	}

	if err := r.MigrateCustomers(); err != nil {
		return fmt.Errorf("customer migration failed: %w", err)
	}

	if err := r.MigrateProducts(); err != nil {
		return fmt.Errorf("product migration failed: %w", err)
	}

	if err := r.MigrateSales(); err != nil {
		return fmt.Errorf("sales migration failed: %w", err)
	}

	fmt.Println()
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("✅ Migration completed successfully!")
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("\n📊 Migration Summary:")
	fmt.Printf("   Tenants:    %d\n", len(r.TenantMap))
	fmt.Printf("   Categories: %d\n", len(r.CategoryMap))
	fmt.Printf("   Customers:  %d\n", len(r.CustomerMap))
	fmt.Printf("   Products:   %d\n", len(r.ProductMap))

	return nil
}

// =============================================================================
// Main
// =============================================================================

func main() {
	// Subcommands
	migrateCmd := flag.NewFlagSet("migrate", flag.ExitOnError)
	backupCmd := flag.NewFlagSet("backup", flag.ExitOnError)
	rollbackCmd := flag.NewFlagSet("rollback", flag.ExitOnError)

	// Migrate flags
	migrateSource := migrateCmd.String("source", "", "Path to source SQLite database")
	migrateTarget := migrateCmd.String("target", "http://localhost:8090", "PocketBase server URL")
	migrateEmail := migrateCmd.String("email", os.Getenv("PB_ADMIN_EMAIL"), "Admin email")
	migratePassword := migrateCmd.String("password", os.Getenv("PB_ADMIN_PASSWORD"), "Admin password")
	migrateDryRun := migrateCmd.Bool("dry-run", false, "Perform dry run without writing data")

	// Backup flags
	backupTarget := backupCmd.String("target", "http://localhost:8090", "PocketBase server URL")
	backupEmail := backupCmd.String("email", os.Getenv("PB_ADMIN_EMAIL"), "Admin email")
	backupPassword := backupCmd.String("password", os.Getenv("PB_ADMIN_PASSWORD"), "Admin password")
	backupOutput := backupCmd.String("output", "", "Output file path")

	// Rollback flags
	rollbackBackup := rollbackCmd.String("backup", "", "Path to backup JSON file")
	rollbackTarget := rollbackCmd.String("target", "http://localhost:8090", "PocketBase server URL")
	rollbackEmail := rollbackCmd.String("email", os.Getenv("PB_ADMIN_EMAIL"), "Admin email")
	rollbackPassword := rollbackCmd.String("password", os.Getenv("PB_ADMIN_PASSWORD"), "Admin password")
	rollbackDryRun := rollbackCmd.Bool("dry-run", false, "Perform dry run")

	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "migrate":
		migrateCmd.Parse(os.Args[2:])

		if *migrateSource == "" {
			fmt.Println("Error: --source is required")
			os.Exit(1)
		}
		if *migratePassword == "" {
			fmt.Println("Error: --password is required (or set PB_ADMIN_PASSWORD env var)")
			os.Exit(1)
		}

		config := Config{
			SourceDB:      *migrateSource,
			TargetURL:     *migrateTarget,
			AdminEmail:    *migrateEmail,
			AdminPassword: *migratePassword,
			DryRun:        *migrateDryRun,
		}

		runner, err := NewMigrationRunner(config)
		if err != nil {
			log.Fatalf("Failed to initialize migration: %v", err)
		}
		defer runner.Close()

		if err := runner.Run(); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}

	case "backup":
		backupCmd.Parse(os.Args[2:])

		if *backupPassword == "" {
			fmt.Println("Error: --password is required")
			os.Exit(1)
		}

		runBackup(*backupTarget, *backupEmail, *backupPassword, *backupOutput)

	case "rollback":
		rollbackCmd.Parse(os.Args[2:])

		if *rollbackBackup == "" {
			fmt.Println("Error: --backup is required")
			os.Exit(1)
		}
		if *rollbackPassword == "" {
			fmt.Println("Error: --password is required")
			os.Exit(1)
		}

		runRollback(*rollbackBackup, *rollbackTarget, *rollbackEmail, *rollbackPassword, *rollbackDryRun)

	default:
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("Open Yojob Migration Tool")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  migrate-tool <command> [options]")
	fmt.Println()
	fmt.Println("Commands:")
	fmt.Println("  migrate   Migrate data from .NET SQLite to PocketBase")
	fmt.Println("  backup    Create backup of PocketBase data")
	fmt.Println("  rollback  Restore from backup file")
	fmt.Println()
	fmt.Println("Run 'migrate-tool <command> -h' for command-specific help")
}

func runBackup(target, email, password, output string) {
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("📦 Creating Backup")
	fmt.Printf("   Source: %s\n", target)
	fmt.Println(strings.Repeat("=", 60))

	pb, err := NewPBClient(target, email, password)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}

	collections := []string{"tenants", "categories", "customers", "products", "sales", "inventory"}

	backupData := map[string]interface{}{
		"created_at":  time.Now().Format(time.RFC3339),
		"source":      target,
		"collections": map[string]interface{}{},
	}

	fmt.Println("\n📥 Backing up collections...")
	for _, collection := range collections {
		records, err := pb.GetRecords(collection)
		if err != nil {
			fmt.Printf("   ⚠️ %s: Failed - %v\n", collection, err)
			continue
		}
		backupData["collections"].(map[string]interface{})[collection] = records
		fmt.Printf("   ✅ %s: %d records\n", collection, len(records))
	}

	if output == "" {
		output = fmt.Sprintf("backup_%s.json", time.Now().Format("20060102_150405"))
	}

	jsonData, err := json.MarshalIndent(backupData, "", "  ")
	if err != nil {
		log.Fatalf("Failed to marshal backup: %v", err)
	}

	if err := os.WriteFile(output, jsonData, 0644); err != nil {
		log.Fatalf("Failed to write backup: %v", err)
	}

	fmt.Println()
	fmt.Println(strings.Repeat("=", 60))
	fmt.Printf("✅ Backup completed: %s\n", output)
	fmt.Println(strings.Repeat("=", 60))
}

func runRollback(backupFile, target, email, password string, dryRun bool) {
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("🔄 Starting Rollback")
	fmt.Printf("   Backup: %s\n", backupFile)
	fmt.Printf("   Target: %s\n", target)
	fmt.Printf("   Dry Run: %v\n", dryRun)
	fmt.Println(strings.Repeat("=", 60))

	data, err := os.ReadFile(backupFile)
	if err != nil {
		log.Fatalf("Failed to read backup: %v", err)
	}

	var backupData map[string]interface{}
	if err := json.Unmarshal(data, &backupData); err != nil {
		log.Fatalf("Failed to parse backup: %v", err)
	}

	fmt.Printf("\n📁 Loaded backup from %v\n", backupData["created_at"])

	if dryRun {
		collections := backupData["collections"].(map[string]interface{})
		fmt.Println("\n[DRY RUN] Would restore:")
		for name, records := range collections {
			recordList := records.([]interface{})
			fmt.Printf("   - %s: %d records\n", name, len(recordList))
		}
		return
	}

	pb, err := NewPBClient(target, email, password)
	if err != nil {
		log.Fatalf("Failed to connect: %v", err)
	}

	// Collections in reverse dependency order for deletion
	deleteOrder := []string{"inventory", "sales", "products", "customers", "categories", "tenants"}

	fmt.Println("\n🗑️ Clearing existing data...")
	for _, collection := range deleteOrder {
		records, _ := pb.GetRecords(collection)
		for _, record := range records {
			if id, ok := record["id"].(string); ok {
				pb.DeleteRecord(collection, id)
			}
		}
		fmt.Printf("   Deleted %d records from %s\n", len(records), collection)
	}

	// Restore in correct order
	restoreOrder := []string{"tenants", "categories", "customers", "products", "sales", "inventory"}
	collections := backupData["collections"].(map[string]interface{})

	fmt.Println("\n📥 Restoring backup data...")
	for _, collection := range restoreOrder {
		if records, ok := collections[collection]; ok {
			recordList := records.([]interface{})
			fmt.Printf("\n   Restoring %s (%d records)...\n", collection, len(recordList))

			for _, record := range recordList {
				recordMap := record.(map[string]interface{})
				// Remove system fields
				delete(recordMap, "id")
				delete(recordMap, "created")
				delete(recordMap, "updated")

				pb.CreateRecord(collection, recordMap)
			}
		}
	}

	fmt.Println()
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("✅ Rollback completed successfully!")
	fmt.Println(strings.Repeat("=", 60))
}
