# Implementation Plan: Tactical Sales Cockpit Redesign, Modular Verticals Strategy & Premium UI/UX Concepts

This implementation plan details the tactical redesign of the high-frequency checkout flow ("Sales Cockpit"), the architectural strategy for dynamic modular vertical loading (Restaurant, Pharmacy, Supermarket, Hardware Store, and Services), and premium UI/UX concepts to elevate the user experience of Puntovivo.

---

## 1. Vision & Objectives

The primary goal of Puntovivo is to deliver a premium, friction-free, and highly adaptable point-of-sale operational experience. The **Sales Cockpit** optimizes the checkout experience for high-frequency cashiers by introducing clean minimalist interfaces, context-aware keyboard shortcuts (`Shift + E`), instant focus behaviors, and unified payment modules. Simultaneously, the **Module Activation System** ensures that the system loads only the files, UI routes, and database tables relevant to the vertical explicitly activated by the tenant.

---

## 2. Granular Multi-Vertical Analysis (LatAm Compliance)

To ensure Puntovivo excels in Latin American retail and service sectors, we specify the core operational capabilities of two complex verticals: **Hardware Stores** and **Professional Services**.

### A. Hardware Store Vertical (Phase 15)
Hardware stores in Latin America handle dense catalogs (10k to 50k SKUs), diverse volumetric packagings, and deep contractor relations.
1.  **Fractional Units & Volumetric Measures:** Supports fractional quantities (mapped to standard floating-point `real` types in SQLite) and enforces strict measurement steps (e.g., selling cable in steps of `0.5m`).
2.  **Unit Conversions:** Auto-translates custom client packages inside the cart lines. For example, converting box units to square meters ($m^2$) or rolls to linear meters based on product conversion multipliers.
3.  **Advanced Contractor Credit Limits:** Connects to the customer credit account ledger (`ENG-090` / `ENG-014`). Supports custom credit balances, late interest rates, partial invoice payouts, and site-level credit caps.
4.  **Project Kits Explosion:** Allows pre-packaging grouped products (e.g., a Paint Project Kit containing brush, rolls, paint, and tape). Selecting the kit in the POS explodes it into individual, editable cart lines for granular quantity tuning before payment.
5.  **FTS5 High-Density Search:** Deploys SQLite `FTS5` virtual table indexing to ensure rapid search queries across 50,000 SKUs on low-spec local All-in-One devices.

### B. Service Vertical: Salons, Barber Shops & Repair Garages (Phase 12)
Service flows shift from rigid inventory movement tracking to time scheduling, employee commission allocation, and customer asset history.
1.  **Appointment Scheduling Calendar:** An interactive dashboard managing timeslots, supporting status states (`Scheduled` → `In Progress` → `Done` → `Invoiced`).
2.  **Item-Level Employee Assignment:** Allows assigning distinct stylists or technicians to individual lines within the same transaction (e.g., Item 1 Haircut assigned to Stylist A, Item 2 Manicure assigned to Beautician B).
3.  **Dynamic Commission Rates:** Auto-calculates flat or percentage commissions per employee on checkout. Accrued commissions are summarized in daily cash sessions.
4.  **Customer Historical Record Assets:**
    *   *Repair Garages:* Tracks license plates, mileage, inspection checklists, and service records.
    *   *Salons:* Detailed records of hair types, color formulas, and historical preferences.

### Architectural Decision: Standalone Dynamic Modules
**Grouping these verticals under a single bloated generic retail package is rejected.** They must load as independent, dynamic modules via the `Module Activation System` due to:
*   *Database Performance:* Avoids forcing a standard boutique retail tenant to carry unused tables like `appointments` or commission schemas, keeping SQLite file sizes small.
*   *UI Focus:* A cashier in a supermarket should not be distracted by stylist selectors or vehicle plate inputs.
*   *JS Bundle Size:* Relying on `React.lazy` route code splitting ensures that legacy terminal devices only download the code they actually use.

---

## 3. Module Activation System Architecture

To scale Puntovivo to dozens of verticals while keeping the core codebase lean, we implement a three-tier modular gating architecture:

1.  **DB State Persistence (`tenant_modules`):**
    Tracks enabled verticals per tenant:
    ```sql
    CREATE TABLE tenant_modules (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_key TEXT NOT NULL, -- 'restaurant' | 'pharmacy' | 'supermarket' | 'hardware-store' | 'services'
      activated_at TEXT NOT NULL,
      activated_by TEXT NOT NULL REFERENCES users(id),
      config_json TEXT,
      PRIMARY KEY (tenant_id, module_key)
    );
    ```
2.  **tRPC Boundary Middleware Gating:**
    Introduces `tenantProcedureWithModule(moduleKey)` to block unauthorized network calls. If Tenant A tries to execute endpoints in the inactive `services` namespace, the server immediately returns `FORBIDDEN` with code `MODULE_NOT_ACTIVE`.
3.  **Vite Client Route Code Splitting:**
    Conditionally mounts dynamic route chunks in `App.tsx` and filters UI menu options in `Sidebar.tsx` based on the active modules list, keeping the startup memory usage low.

---

## 4. Premium UI/UX Concepts (WOW Factors)

We establish guidelines using HSL color systems, glassmorphism, and responsive tap grids:

*   **Multichannel KDS:** Deep dark background (`#0b0f19`), translucent frosted glass cards, and a 3-tier time border warning glow (`0-5m` green, `5-10m` amber, `>10m` pulsating red) with a Recall action button.
*   **Touch POS Numpad:** Highly compact `120x120px` tile buttons with rounded corners, minimum hit targets of `44px`, and a floating Touch Numpad with circular buttons for quantity adjustments.
*   **Fiscal Tax Wizard:** A amical 3-step setup guide capturing location, legal entity regimes, and auto-provisioning tax rules (such as 19% IVA or Impuesto Saludable) based on local LatAm requirements.
*   **Recipe BOM Margins:** Visual list desconstructing weighted average ingredient costs next to pricing sliders. Dynamically updates profit donuts and alerts in red if margins drop below `30%`.
*   **Quotation 1-Click Invoice:** Grid columns supporting description notes, rapid email/WhatsApp sharing, and a conversion CTA to atomicly populate the active cart.
*   **Glassmorphic Admin Dashboard:** Backdrop-blurred Outfit cards summarizing Net Sales, Ticket Size, AI-powered Anomaly notifications, and revenue share distributions.

---

## 5. Verification & Testing Matrix

### Automated Testing
*   *Vitest tRPC Units:* Verify that `appointments.create` returns `FORBIDDEN` for tenants without the services module activated.
*   *Playwright E2E:* Validate that typing `Shift + E` rapidly processes exact cash payments and prints receipts without modal interruptions. Assert that manual navigation to gated routes redirects to `/sales`.

### Manual Testing
*   Test FTS5 search queries under simulated dense catalogs (50k items) on Celeron CPUs to verify responses remain under 100ms.
*   Validate Touch Numpad targets on tablet displays to assure a minimum hit area of 44px.
