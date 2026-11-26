# Suggested NIT demo video (maximum 8 minutes)

Use the seeded dummy data only. If you want the full scenario preloaded, run `npm run seed` followed by `npm run benchmark`; otherwise demonstrate each transaction manually.

1. **0:00–0:45 — Login and roles.** Show the salesman mobile layout and explain that each role has different API permissions.
2. **0:45–1:30 — Masters and purchase.** Show Murukku 200 g, the five-line BOM, supplier and the 60 kg flour receipt at ₹45/kg. Point out the opening flour quantity of 100 kg at ₹42/kg.
3. **1:30–3:00 — Production.** Record one batch: 40 kg flour, 10.5 L oil, 1.2 kg spice, 194 pouches including 6 damaged, 9 cartons, 188 good packets, 12-packet yield loss, ₹1,200 labour and ₹600 gas/power. Show the -6% yield and +5% oil variance and ₹31.14 cost per good packet.
4. **3:00–4:30 — Salesman A and billing.** Submit 150 packets for Retailer A. Switch to admin, verify stock, create the invoice and show ₹7,500 taxable + ₹187.50 CGST + ₹187.50 SGST = ₹7,875. Download the PDF.
5. **4:30–5:15 — Dispatch.** Dispatch 150 packets and show finished stock falling from 238 to 88.
6. **5:15–6:00 — Distributor B.** Submit 120 packets from Salesman B and attempt admin verification. Show the 32-packet shortage response.
7. **6:00–6:45 — Collection.** Record ₹4,000 against Retailer A's invoice and show ₹3,875 outstanding.
8. **6:45–8:00 — Auditor view.** Show sales register, GST summary, purchase register, stock summary/ledger, production variance, costing, collections and receivables ageing. Export CSV/PDF.

Explain that the GSTIN values are fictional and that the prototype is not statutory GST filing software.
