# SmartFactory ERP — NIT Tiruchirappalli Winter Internship 2026

A role-based web ERP prototype implementing the NIT Order-to-Audit brief for a small packaged-snack manufacturer. It connects salesman orders, admin stock verification, GST billing, dispatch, raw-material purchasing, BOM-driven production, costing, collections and auditor reports.

> Use only the supplied dummy benchmark data. The GSTIN values are demonstration placeholders, not real registrations. This is an internship prototype, not certified tax/accounting software.

## 1. Stack and architecture

- **Frontend:** responsive HTML5, CSS3, Bootstrap 5 and browser JavaScript; the salesman order screen is installable as a lightweight PWA shell.
- **Backend:** Node.js 20+, Express REST API.
- **Database:** MySQL 8 / InnoDB with transactional writes and a source-linked stock movement ledger.
- **Security:** bcrypt password hashing, JWT authentication, role middleware, Helmet security headers and API rate limiting.
- **Documents:** PDFKit GST invoice and PDF report output; CSV exports for tabular audit reports.

A browser-based web system is appropriate for the factory desktop and salesman's phone without requiring separate native apps. The backend owns all stock, tax, workflow and costing calculations so that users cannot update inventory balances by editing a screen.

## 2. Roles and demo accounts

All demo accounts initially use `ChangeMe123!`.

| Role | Login | Main access |
|---|---|---|
| Owner | `owner@smartfactory.local` | Dashboard, masters, orders, reports |
| Admin / billing | `admin@smartfactory.local` | Verify orders, invoice, dispatch, payments, masters |
| Salesman A | `salesman@smartfactory.local` | Mobile order capture, own orders and customer-wise sales |
| Salesman B | `salesmanb@smartfactory.local` | Mobile order capture and own orders |
| Production | `production@smartfactory.local` | Purchases/receipts and production runs |
| Accountant / auditor | `auditor@smartfactory.local` | Read-only invoices, collections and reports |

Change demo passwords and replace all demo secrets/GSTIN values before any public deployment. Running the seed script resets the dummy business transactions and restores the initial demo password.

## 3. Run locally

Prerequisites: Node.js 20+, npm and MySQL 8.

1. Create the schema (the SQL file drops/recreates tables in the selected database; use a dedicated empty internship database):
   ```bash
   mysql -u root -p < database/schema.sql
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env`. Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and a long random `JWT_SECRET`.
4. Load the benchmark master data, opening balances and 60 kg flour purchase:
   ```bash
   npm run seed
   ```
5. Start the website:
   ```bash
   npm start
   ```
6. Open `http://localhost:3000` and sign in using one of the demo accounts.

### Docker Compose

```bash
docker compose up --build -d
docker compose exec app npm run seed
```

Open `http://localhost:3000`. The Compose file includes MySQL health checking. Change the example root password and JWT secret in `docker-compose.yml` before use outside a local demo. To stop the services, run `docker compose down`; to remove the dummy database volume too, run `docker compose down -v`.

## 4. Run the NIT benchmark end to end

The seed command loads only the initial state. To create the complete benchmark transaction set automatically, run:

```bash
npm run benchmark
```

This script posts one production run, Retailer A's approved/invoiced/dispatched order, Distributor B's pending order, and Retailer A's ₹4,000 payment. It prints the calculated closing stock, shortage and cost. Run `npm run seed` first. Do not run the benchmark repeatedly against the same seeded state unless you reset it first; duplicate scenario transactions will be created.

For a live walkthrough instead of preloading the scenario, use the role screens in this order:

1. Sign in as Production and open **Purchases** to record the 60 kg flour purchase (already present in the seeded state; skip if using the seeded purchase).
2. Open **Production**. Select **Murukku (200 g)** from the Product dropdown (its active BOM loads automatically), set batch count `1`, good output `188`, wastage `12`, damaged pouches `6`, labour `1200`, utilities `600`, and adjust the auto-filled material consumption to Cooking oil `10.5`, 200 g pouch `194`, and Carton `9`.
3. Sign in as Salesman A and submit 150 packets to Retailer A. Sign in as Admin, verify stock, create the GST invoice, then dispatch.
4. Sign in as Salesman B and submit 120 packets to Distributor B. Admin verification must return a 32-packet shortage because only 88 packets remain.
5. Record ₹4,000 against Retailer A's invoice in **Collections**.
6. Sign in as Auditor and review the monthly reports.

## 5. Benchmark expected results

| Check | Expected |
|---|---:|
| Flour closing | 120 kg |
| Cooking oil closing | 19.5 L |
| Spice mix closing | 3.8 kg |
| Pouches closing | 306 pieces |
| Cartons closing | 21 pieces |
| Finished goods after production | 238 packets |
| Finished goods after Retailer A dispatch | 88 packets |
| Yield variance | -6% (flagged) |
| Oil consumption variance | +5% (flagged) |
| Retailer A taxable value | ₹7,500.00 |
| CGST / SGST | ₹187.50 each |
| Retailer A invoice total | ₹7,875.00 |
| Retailer A outstanding after payment | ₹3,875.00 |
| Distributor B shortage | 32 packets |
| Approx. production material cost | ₹4,055.00 |
| Labour + gas/power | ₹1,800.00 |
| Total production cost | ₹5,855.00 |
| Cost per good packet | ₹31.14 (₹5,855 / 188, rounded for display) |

### Costing assumption

Raw materials and packaging use **moving weighted-average purchase cost** based on opening stock and receipts. For flour, `(100 kg × ₹42 + 60 kg × ₹45) / 160 kg = ₹43.125/kg`. The run consumes 40 kg flour, 10.5 L oil, 1.2 kg spice mix, 194 pouches (188 good + 6 damaged) and 9 cartons. Their weighted-average material cost totals ₹4,055. Labour ₹1,200 and gas/power ₹600 are added to the run, giving ₹5,855 / 188 good packets = approximately ₹31.14 per packet. This allocation treats all run overhead as attributable to good output.

## 6. Features mapped to the brief

### Must-have
- Login with role-based access for salesman, admin, production and accountant/owner.
- Customer, product, raw-material, packaging and BOM master APIs/UI.
- Responsive mobile salesman order entry, offline local queue and retry on reconnect.
- Admin order edit, stock verification, approve/reject workflow.
- GST invoice with a transaction-locked financial-year sequence, HSN, GSTIN, integer-paise tax calculation, CGST/SGST for Tamil Nadu and IGST for other state codes; downloadable PDF.
- Dispatch transaction reduces finished stock; partial dispatch is supported.
- BOM production transaction issues raw/packaging stock and receives finished goods atomically.
- Planned/actual consumption, yield and wastage records; variance alerts over 3%.
- Stock summary and source-linked ledger.
- Sales and stock reports with CSV and PDF output.

### Should-have
- Supplier and purchase records; purchase receipt updates ledger.
- Payments against invoices, customer receivables and ageing buckets.
- Weighted-average material costing, labour/utility allocation, cost per packet and gross margin report.
- GST outward-supply summary.
- Owner dashboard with orders, pending work, variance alerts, low-stock alerts, latest cost per packet and outstanding dues.

### Additional engineering
- SQL transaction boundaries for production, purchase, order approval, invoice, dispatch and payment.
- Integer-paise arithmetic for order totals, GST and collections.
- Unit conversion helper for kg/g, litre/ml, pieces/packets and cartons/packets (20 packets per carton by default).
- Audit log entries for posted workflow transactions; stock adjustments have their own source document.
- Credit-note cancellation path for invoices that have not been dispatched or paid; posted invoices are not deleted.

## 7. Verification status

The local, dependency-free verification suite checks the complete supplied benchmark figures, intra/inter-state GST arithmetic, odd-paise rounding, unsafe monetary inputs, unit conversions, JavaScript syntax, mounted route files, frontend local asset references and invoice-sequence schema/reset wiring. Run `npm run verify` for these checks. The full MySQL-backed Express workflow still needs to be run on your machine; see [`docs/verification.md`](docs/verification.md) for the exact commands. Do not describe the project as production-certified or statutory GST software.

## 8. Tests

```bash
npm run verify   # dependency-free arithmetic + static project checks
npm test         # Jest test suite (after npm install)
```

The verification suite checks the NIT benchmark, GST split and rounding, monetary input boundaries, and unit conversions. The benchmark runner also asserts expected raw/packaging/finished stock, invoice totals, payment and shortage before it commits the scenario. `npm run benchmark` is the database-backed demonstration scenario; it requires MySQL and a freshly seeded database.

## 9. Important assumptions and limitations

- The factory state code is Tamil Nadu (`33`), configured by `FACTORY_STATE_CODE`; customer state code determines intra-state CGST/SGST versus inter-state IGST. Demo GSTIN/HSN data must be replaced and verified for any real business.
- The invoice prototype supports one GST rate per invoice. Mixed-rate invoice line tax grouping, real statutory GST validation, e-invoice/e-waybill government integration and tax filing are not implemented.
- Credit-note cancellation is intentionally blocked after dispatch or payment until goods-return/payment-adjustment workflows are recorded. It never silently deletes a posted invoice.
- The benchmark uses a 20-packet carton. Conversion helper accepts a configurable pieces-per-carton value.
- Offline salesman orders are stored in that browser's local storage and synced when online. They are not encrypted at rest and do not synchronize across devices before upload.
- CSV, PDF, and Tally-compatible XML exports are included (plus batch/expiry FEFO tracking, low-stock reorder alerts, Quality Control inspections, supplier payment history, idempotent offline sync, GPS salesman check-ins, e-Invoice/e-Way Bill mock, and a Tamil/English floor-staff UI toggle); native `.xlsx` binary export and advanced production planning are not included.
- GST numbers and the factory identity are fictional demo placeholders. Obtain professional review before treating generated invoices/reports as statutory records.
- The schema script is destructive to tables in `smartfactory_erp`; use a dedicated database. Do not point it at a real company's database.

## 10. Internship submission checklist

The code archive supplies the source, setup README, design note, ER diagram (`docs/er-diagram.mmd`), suggested demo walkthrough (`docs/demo-script.md`), API reference (`docs/api-reference.md`) and reproducible benchmark command. The applicant still needs to create a public GitHub/GitLab repository with meaningful commits, record an eight-minute-or-shorter walkthrough video, and publish/share a live demo or local run instructions and test logins. The internship brief requires individual work; understand every module and be ready to explain and modify it during an interview.
