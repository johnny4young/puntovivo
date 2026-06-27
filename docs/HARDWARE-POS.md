# POS Hardware Integration

> Status: **Stub — design document, not yet implemented.**
> Phase 12 of the internal roadmap, re-prioritized to P0 (Tier-1 3b).
> Created: April 21, 2026.

## Scope

Four peripherals that a real Colombian retail store expects out of the box:

1. **Thermal receipt printer** (ESC/POS over USB / network / Bluetooth)
2. **Cash drawer** (RJ11 cable into the receipt printer)
3. **Barcode scanner** (USB HID keyboard-wedge, EAN-13 / Code 128 / UPC-A)
4. **Payment terminal** (Bold, Wompi, Mercado Pago Point — Bluetooth or HTTPS)

Each is behind an **adapter interface**, so new models or providers drop
in without touching business logic.

## Architectural pattern

All peripheral integration goes through the **main process** (Node),
never the renderer directly, except barcode scanners which are HID
keyboard events naturally arriving in the renderer.

```
Renderer          Main process                    Device
─────────         ────────────                    ──────
                  PrinterAdapter (system|escpos)  ESC/POS printer
 trpc/IPC  ─────▶ CashDrawerAdapter                (via printer RJ11)
                  PaymentAdapter  (manual|bold|wompi)  Payment terminal

Renderer  ◀────── keydown capture ─────────────   USB HID scanner
```

## Printer adapter

### Interface

```ts
interface PrinterAdapter {
  print(job: PrintJob): Promise<void>;
  openCashDrawer(): Promise<void>; // no-op for system adapter
  testPrint(): Promise<void>;
}

type PrintJob = {
  kind: 'sale-receipt' | 'fiscal-dee' | 'quotation' | 'kitchen-ticket';
  payload: ReceiptLayout; // from RECEIPT-TEMPLATES.md
};
```

### Drivers

| Driver   | Channel                         | Cash drawer | 58mm    | 80mm    | Notes                                                 |
| -------- | ------------------------------- | ----------- | ------- | ------- | ----------------------------------------------------- |
| `system` | `webContents.print()` — current | ❌          | via CSS | via CSS | Universal, any installed printer, no drawer control   |
| `escpos` | USB / TCP / serial              | ✅          | ✅      | ✅      | **New** — uses `escpos` or `node-thermal-printer` npm |

`escpos` implementation targets:

- **Xprinter XP-58 / XP-80** (ubiquitous in CO retail, ~$200-400k COP)
- **Epson TM-T20 / TM-T88**
- **Bixolon SRP-350**
- Generic ESC/POS-compatible with 58mm or 80mm paper width

### Cash drawer

Cash drawers open via a pulse on the `ESC p m t1 t2` command
(`0x1B 0x70 0x00 0x19 0xFA`) sent through the receipt printer stream.
Only the `escpos` driver supports this — `system` cannot, since macOS
and Windows print drivers generate PDFs and hide the device channel.

**Configuration**: one printer per site (stored in `site_peripherals`
table, below). The cash drawer command is integrated into the same
print stream as the receipt — opens as the cashier tears the paper.

## Barcode scanner

USB HID scanners (Honeywell Voyager, Zebra DS2208, Datalogic QuickScan,
Xprinter) emit the decoded string as fast keystrokes followed by
`Enter`. The renderer detects the burst:

```ts
// apps/web/src/features/sales/useBarcodeScanner.ts (planned)
const useBarcodeScanner = (opts: {
  onScan: (code: string) => void;
  minRateMs?: number; // default 50ms between keys for scan detection
  targetInput?: HTMLInputElement | null;
}) => {
  // Collect keydown bursts. Flush on Enter if burst is fast enough.
  // Ignore when an input/textarea has focus unless it is targetInput.
};
```

Validation:

- **EAN-13** checksum (reject misreads)
- **Price-embedded** codes (prefix 20-29): parse weight/price from the
  13-digit payload (carnicería, fruver)
- **QR codes** from 2D scanners: detected when payload is not numeric

## Payment terminal

Initial targets ordered by market share in CO:

- **Bold** — dominant in neighborhood retail, Bluetooth/WiFi + REST SDK
- **Wompi** (Bancolombia) — REST + Bluetooth
- **Mercado Pago Point** — Bluetooth SDK

### Interface

```ts
interface PaymentAdapter {
  charge(amount: number, reference: string): Promise<PaymentResult>;
  void(txnId: string): Promise<void>;
  printSlip(txnId: string): Promise<void>;
}

type PaymentResult =
  | { status: 'approved'; authCode: string; last4?: string; brand?: string }
  | { status: 'declined'; reason: string }
  | { status: 'cancelled' };
```

`ManualAdapter` (shipped today — the cashier reads and types the auth
code) remains the fallback when no terminal is configured.

## Peripheral configuration schema

```sql
CREATE TABLE site_peripherals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  kind TEXT NOT NULL CHECK (kind IN ('printer', 'cash_drawer', 'scanner', 'payment_terminal', 'customer_display')),
  driver TEXT NOT NULL,             -- 'system', 'escpos', 'bold', 'wompi', 'manual'
  config_json TEXT NOT NULL,        -- driver-specific connection info
  is_active INTEGER NOT NULL DEFAULT 1,
  last_tested_at TEXT,
  last_test_result TEXT             -- 'ok' | 'failed' | NULL
);
```

## UI

- `/setup/peripherals` (admin or per-site manager) — per-site list +
  test buttons: "Test print", "Open drawer", "Scan test", "Charge $0.01"
- Status indicator in the POS topbar: green/yellow/red per peripheral

## Implementation status

- **ENG-060** (Shipped) — peripheral registry + 4 contracts + admin UI
  - 2 default drivers (`system` printer, `manual` payment terminal).
- **ENG-061** (Shipped) — barcode scanner pipeline (USB HID keyboard
  wedge), pure parser with EAN-13/EAN-8/UPC-A checksums and GS1
  prefix-2x weight/price labels, `useBarcodeWedgeListener` hook
  wired on SalesPage.
- **ENG-062** (Shipped) — ESC/POS printer driver
  (`EscPosReceiptPrinterAdapter` at
  `services/peripherals/drivers/escpos-receipt-printer.ts`) +
  RJ11 cash drawer driver
  (`EscPosCashDrawerAdapter` at
  `services/peripherals/drivers/escpos-cash-drawer.ts`) +
  `hardware_outbox` (migration `0015_hardware_outbox.sql`) +
  hardware worker mirror of the fiscal worker. Mock + TCP
  transports ship today; USB + serial transports are stubs that
  throw `DRIVER_NOT_IMPLEMENTED` until a follow-up ticket adds the
  native bindings against a physical hardware lab.
- **ENG-063** (Gated) — Bold / Wompi / MercadoPago payment terminals,
  blocked on signed PT contract + sandbox credentials.

## Testing plan

- Unit: ESC/POS byte sequence builder (print, cut, drawer)
- Unit: EAN-13 checksum validation + price-embedded parsing
- Integration: optional — requires a physical printer/scanner; gated
  behind a `PHYSICAL_HARDWARE=1` env flag in the test runner
- Manual smoke: documented in [TEST-PLAN.md](./TEST-PLAN.md) under HW-01..HW-10

## Open questions

- Native USB/serial access in Electron: **Node.js `usb` npm** vs
  **Electron `webusb` API** — current choice: `node-thermal-printer`
  which wraps native Node bindings, keeps main process as the single
  owner of the device
- Windows driver compatibility: printer sometimes requires vendor
  driver even for ESC/POS direct — mitigation: fallback to the `system`
  driver path is always available
- Bluetooth pairing UX on Windows vs macOS vs Linux: likely need
  per-OS "pair scanner" wizard
