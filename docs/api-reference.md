# REST API quick reference

All protected endpoints require `Authorization: Bearer <JWT>`. Login is `POST /api/auth/login` with `{ "email": "...", "password": "..." }`.

| Method | Endpoint | Purpose / access |
|---|---|---|
| GET | `/api/health` | Health check |
| GET/POST | `/api/masters/customers` | List / create customers (create: admin/owner) |
| GET/POST | `/api/masters/products` | List / create products (create: admin/owner) |
| GET/POST | `/api/masters/inventory-items` | List / create raw and packaging items (create: admin/owner) |
| GET/POST | `/api/masters/boms/:productId`, `/api/masters/boms` | Read / create active BOM versions |
| GET/POST | `/api/purchases/suppliers`, `/api/purchases` | Supplier list/create and purchase receipt |
| GET | `/api/inventory/summary`, `/api/inventory/ledger` | Current stock and source-linked movements |
| POST | `/api/inventory/adjustments` | Source-documented stock adjustment (admin/owner) |
| POST/GET | `/api/orders` | Submit and list orders; salesmen see only their own |
| GET | `/api/orders/my-customer-sales` | Salesman customer-wise sales totals |
| PATCH | `/api/orders/:id` | Admin/owner edits submitted order lines |
| POST | `/api/orders/:id/verify`, `/reject` | Admin/owner stock verification and decision |
| POST | `/api/orders/:id/invoice` | Create GST invoice from approved order |
| POST | `/api/orders/:id/dispatch` | Dispatch goods and reduce finished stock |
| GET | `/api/invoices` | Posted invoices for admin/owner/accountant |
| GET | `/api/invoices/:id/pdf` | Download invoice PDF |
| POST | `/api/invoices/:id/credit-note` | Cancel an unpaid, undispatched invoice through credit note |
| POST/GET | `/api/production/runs` | Post a BOM production run / list runs |
| POST/GET | `/api/payments` | Record / list collections (record: admin/owner; accountant read-only) |
| GET | `/api/dashboard/summary` | Owner/admin/accountant dashboard metrics |
| GET | `/api/reports/sales-register`, `/stock-ledger`, `/stock-summary`, `/production`, `/purchases`, `/gst-summary`, `/collections`, `/receivables`, `/costing` | Date-filterable audit reports (where applicable) |
| GET | `/api/reports/:report/pdf` | PDF report export |
| GET | `/api/utils/convert?value=1000&from=g&to=kg` | Unit conversion utility |

The database schema and role checks are the source of truth. For complete request bodies, see the browser forms and route validation in `backend/routes/`.
