package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/models/schema"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		// Create Tenants collection
		tenantsCollection := &models.Collection{
			Name:       "tenants",
			Type:       models.CollectionTypeBase,
			ListRule:   nil,
			ViewRule:   nil,
			CreateRule: nil,
			UpdateRule: nil,
			DeleteRule: nil,
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "name",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "slug",
					Type:     schema.FieldTypeText,
					Required: true,
					Options: &schema.TextOptions{
						Pattern: "^[a-z0-9-]+$",
					},
				},
				&schema.SchemaField{
					Name:     "settings",
					Type:     schema.FieldTypeJson,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "is_active",
					Type:     schema.FieldTypeBool,
					Required: false,
				},
			),
			Indexes: []string{
				"CREATE UNIQUE INDEX idx_tenants_slug ON tenants (slug)",
			},
		}

		dao := daos.New(db)
		if err := dao.SaveCollection(tenantsCollection); err != nil {
			return err
		}

		// Create Categories collection
		categoriesCollection := &models.Collection{
			Name:       "categories",
			Type:       models.CollectionTypeBase,
			ListRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			ViewRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			CreateRule: strPtr("@request.auth.id != ''"),
			UpdateRule: strPtr("@request.auth.tenant_id = tenant_id"),
			DeleteRule: strPtr("@request.auth.tenant_id = tenant_id && @request.auth.role = 'admin'"),
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "tenant_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
					Options: &schema.RelationOptions{
						CollectionId:  "", // Will be set after tenant collection is created
						MaxSelect:     intPtr(1),
						CascadeDelete: false,
					},
				},
				&schema.SchemaField{
					Name:     "name",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "description",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "parent_id",
					Type:     schema.FieldTypeRelation,
					Required: false,
					Options: &schema.RelationOptions{
						CollectionId:  "", // Self-reference
						MaxSelect:     intPtr(1),
						CascadeDelete: false,
					},
				},
			),
		}

		if err := dao.SaveCollection(categoriesCollection); err != nil {
			return err
		}

		// Create Products collection
		productsCollection := &models.Collection{
			Name:       "products",
			Type:       models.CollectionTypeBase,
			ListRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			ViewRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			CreateRule: strPtr("@request.auth.id != ''"),
			UpdateRule: strPtr("@request.auth.tenant_id = tenant_id"),
			DeleteRule: strPtr("@request.auth.tenant_id = tenant_id && @request.auth.role = 'admin'"),
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "tenant_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
					Options: &schema.RelationOptions{
						MaxSelect:     intPtr(1),
						CascadeDelete: false,
					},
				},
				&schema.SchemaField{
					Name:     "name",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "sku",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "description",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "category_id",
					Type:     schema.FieldTypeRelation,
					Required: false,
					Options: &schema.RelationOptions{
						MaxSelect:     intPtr(1),
						CascadeDelete: false,
					},
				},
				&schema.SchemaField{
					Name:     "price",
					Type:     schema.FieldTypeNumber,
					Required: true,
					Options: &schema.NumberOptions{
						Min: floatPtr(0),
					},
				},
				&schema.SchemaField{
					Name:     "cost",
					Type:     schema.FieldTypeNumber,
					Required: false,
					Options: &schema.NumberOptions{
						Min: floatPtr(0),
					},
				},
				&schema.SchemaField{
					Name:     "tax_rate",
					Type:     schema.FieldTypeNumber,
					Required: false,
					Options: &schema.NumberOptions{
						Min: floatPtr(0),
						Max: floatPtr(1),
					},
				},
				&schema.SchemaField{
					Name:     "stock",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "min_stock",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "is_active",
					Type:     schema.FieldTypeBool,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "barcode",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "image",
					Type:     schema.FieldTypeFile,
					Required: false,
					Options: &schema.FileOptions{
						MaxSelect: 1,
						MaxSize:   5242880, // 5MB
						MimeTypes: []string{"image/jpeg", "image/png", "image/webp"},
					},
				},
				&schema.SchemaField{
					Name:     "sync_status",
					Type:     schema.FieldTypeSelect,
					Required: false,
					Options: &schema.SelectOptions{
						Values:    []string{"pending", "synced", "conflict", "error"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "sync_version",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
			),
			Indexes: []string{
				"CREATE INDEX idx_products_tenant ON products (tenant_id)",
				"CREATE INDEX idx_products_sku ON products (sku)",
				"CREATE INDEX idx_products_barcode ON products (barcode)",
			},
		}

		if err := dao.SaveCollection(productsCollection); err != nil {
			return err
		}

		// Create Customers collection
		customersCollection := &models.Collection{
			Name:       "customers",
			Type:       models.CollectionTypeBase,
			ListRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			ViewRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			CreateRule: strPtr("@request.auth.id != ''"),
			UpdateRule: strPtr("@request.auth.tenant_id = tenant_id"),
			DeleteRule: strPtr("@request.auth.tenant_id = tenant_id && @request.auth.role = 'admin'"),
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "tenant_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "name",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "email",
					Type:     schema.FieldTypeEmail,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "phone",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "address",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "city",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "state",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "postal_code",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "country",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "tax_id",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "notes",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "is_active",
					Type:     schema.FieldTypeBool,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "sync_status",
					Type:     schema.FieldTypeSelect,
					Required: false,
					Options: &schema.SelectOptions{
						Values:    []string{"pending", "synced", "conflict", "error"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "sync_version",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
			),
			Indexes: []string{
				"CREATE INDEX idx_customers_tenant ON customers (tenant_id)",
				"CREATE INDEX idx_customers_email ON customers (email)",
			},
		}

		if err := dao.SaveCollection(customersCollection); err != nil {
			return err
		}

		// Create Sales collection
		salesCollection := &models.Collection{
			Name:       "sales",
			Type:       models.CollectionTypeBase,
			ListRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			ViewRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			CreateRule: strPtr("@request.auth.id != ''"),
			UpdateRule: strPtr("@request.auth.tenant_id = tenant_id"),
			DeleteRule: strPtr("@request.auth.tenant_id = tenant_id && @request.auth.role = 'admin'"),
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "tenant_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "sale_number",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "customer_id",
					Type:     schema.FieldTypeRelation,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "subtotal",
					Type:     schema.FieldTypeNumber,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "tax_amount",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "discount_amount",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "total",
					Type:     schema.FieldTypeNumber,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "payment_method",
					Type:     schema.FieldTypeSelect,
					Required: true,
					Options: &schema.SelectOptions{
						Values:    []string{"cash", "card", "transfer", "credit", "other"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "payment_status",
					Type:     schema.FieldTypeSelect,
					Required: true,
					Options: &schema.SelectOptions{
						Values:    []string{"pending", "paid", "partial", "refunded"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "status",
					Type:     schema.FieldTypeSelect,
					Required: true,
					Options: &schema.SelectOptions{
						Values:    []string{"draft", "completed", "cancelled", "voided"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "notes",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "created_by",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "sync_status",
					Type:     schema.FieldTypeSelect,
					Required: false,
					Options: &schema.SelectOptions{
						Values:    []string{"pending", "synced", "conflict", "error"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "sync_version",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
			),
			Indexes: []string{
				"CREATE INDEX idx_sales_tenant ON sales (tenant_id)",
				"CREATE UNIQUE INDEX idx_sales_number ON sales (tenant_id, sale_number)",
			},
		}

		if err := dao.SaveCollection(salesCollection); err != nil {
			return err
		}

		// Create Sale Items collection
		saleItemsCollection := &models.Collection{
			Name:       "sale_items",
			Type:       models.CollectionTypeBase,
			ListRule:   strPtr("sale_id.tenant_id = @request.auth.tenant_id"),
			ViewRule:   strPtr("sale_id.tenant_id = @request.auth.tenant_id"),
			CreateRule: strPtr("@request.auth.id != ''"),
			UpdateRule: strPtr("sale_id.tenant_id = @request.auth.tenant_id"),
			DeleteRule: strPtr("sale_id.tenant_id = @request.auth.tenant_id"),
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "sale_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
					Options: &schema.RelationOptions{
						MaxSelect:     intPtr(1),
						CascadeDelete: true,
					},
				},
				&schema.SchemaField{
					Name:     "product_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "quantity",
					Type:     schema.FieldTypeNumber,
					Required: true,
					Options: &schema.NumberOptions{
						Min: floatPtr(1),
					},
				},
				&schema.SchemaField{
					Name:     "unit_price",
					Type:     schema.FieldTypeNumber,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "discount",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "tax_rate",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "tax_amount",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "total",
					Type:     schema.FieldTypeNumber,
					Required: true,
				},
			),
			Indexes: []string{
				"CREATE INDEX idx_sale_items_sale ON sale_items (sale_id)",
			},
		}

		if err := dao.SaveCollection(saleItemsCollection); err != nil {
			return err
		}

		// Create Inventory Movements collection
		inventoryCollection := &models.Collection{
			Name:       "inventory_movements",
			Type:       models.CollectionTypeBase,
			ListRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			ViewRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			CreateRule: strPtr("@request.auth.id != ''"),
			UpdateRule: nil, // Inventory movements should not be updated
			DeleteRule: strPtr("@request.auth.tenant_id = tenant_id && @request.auth.role = 'admin'"),
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "tenant_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "product_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "type",
					Type:     schema.FieldTypeSelect,
					Required: true,
					Options: &schema.SelectOptions{
						Values:    []string{"purchase", "sale", "adjustment", "transfer", "return"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "quantity",
					Type:     schema.FieldTypeNumber,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "previous_stock",
					Type:     schema.FieldTypeNumber,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "new_stock",
					Type:     schema.FieldTypeNumber,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "reference",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "notes",
					Type:     schema.FieldTypeText,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "created_by",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "sync_status",
					Type:     schema.FieldTypeSelect,
					Required: false,
					Options: &schema.SelectOptions{
						Values:    []string{"pending", "synced", "conflict", "error"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "sync_version",
					Type:     schema.FieldTypeNumber,
					Required: false,
				},
			),
			Indexes: []string{
				"CREATE INDEX idx_inventory_tenant ON inventory_movements (tenant_id)",
				"CREATE INDEX idx_inventory_product ON inventory_movements (product_id)",
			},
		}

		if err := dao.SaveCollection(inventoryCollection); err != nil {
			return err
		}

		// Create Sync Conflicts collection
		syncConflictsCollection := &models.Collection{
			Name:       "sync_conflicts",
			Type:       models.CollectionTypeBase,
			ListRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			ViewRule:   strPtr("@request.auth.tenant_id = tenant_id"),
			CreateRule: strPtr("@request.auth.id != ''"),
			UpdateRule: strPtr("@request.auth.tenant_id = tenant_id"),
			DeleteRule: strPtr("@request.auth.tenant_id = tenant_id"),
			Schema: schema.NewSchema(
				&schema.SchemaField{
					Name:     "tenant_id",
					Type:     schema.FieldTypeRelation,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "entity_type",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "entity_id",
					Type:     schema.FieldTypeText,
					Required: true,
				},
				&schema.SchemaField{
					Name:     "local_data",
					Type:     schema.FieldTypeJson,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "remote_data",
					Type:     schema.FieldTypeJson,
					Required: false,
				},
				&schema.SchemaField{
					Name:     "resolution",
					Type:     schema.FieldTypeSelect,
					Required: false,
					Options: &schema.SelectOptions{
						Values:    []string{"local_wins", "remote_wins", "merged"},
						MaxSelect: 1,
					},
				},
				&schema.SchemaField{
					Name:     "resolved_at",
					Type:     schema.FieldTypeDate,
					Required: false,
				},
			),
			Indexes: []string{
				"CREATE INDEX idx_sync_conflicts_tenant ON sync_conflicts (tenant_id)",
			},
		}

		return dao.SaveCollection(syncConflictsCollection)
	}, func(db dbx.Builder) error {
		// Rollback - drop collections in reverse order
		dao := daos.New(db)
		collections := []string{
			"sync_conflicts",
			"inventory_movements",
			"sale_items",
			"sales",
			"customers",
			"products",
			"categories",
			"tenants",
		}

		for _, name := range collections {
			if coll, _ := dao.FindCollectionByNameOrId(name); coll != nil {
				dao.DeleteCollection(coll)
			}
		}

		return nil
	})
}

// Helper functions
func strPtr(s string) *string {
	return &s
}

func intPtr(i int) *int {
	return &i
}

func floatPtr(f float64) *float64 {
	return &f
}
