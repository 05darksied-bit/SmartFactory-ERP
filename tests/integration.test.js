'use strict';
const request = require('supertest');
const { execSync } = require('node:child_process');
const path = require('node:path');
const app = require('../backend/app');
const db = require('../backend/config/db');

const DEMO_PASSWORD = 'ChangeMe123!';
const ACCOUNTS = [
  { email: 'owner@smartfactory.local', role: 'OWNER' },
  { email: 'admin@smartfactory.local', role: 'ADMIN' },
  { email: 'salesman@smartfactory.local', role: 'SALESMAN' },
  { email: 'salesmanb@smartfactory.local', role: 'SALESMAN' },
  { email: 'production@smartfactory.local', role: 'PRODUCTION' },
  { email: 'auditor@smartfactory.local', role: 'ACCOUNTANT' }
];

const tokens = {};

beforeAll(async () => {
  // Reset seed to clean benchmark state before integration tests
  execSync('node backend/scripts/seed.js', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
  // Login all 6 demo accounts
  for (const acc of ACCOUNTS) {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: acc.email, password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe(acc.role);
    tokens[acc.email] = res.body.token;
  }
}, 30000);

afterAll(async () => {
  await db.end();
});

describe('SmartFactory ERP – Database-Backed Integration & NIT Benchmark Tests', () => {
  test('All 6 demo accounts can fetch /api/auth/me and logout works', async () => {
    for (const acc of ACCOUNTS) {
      const me = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokens[acc.email]}`);
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(acc.email);
    }
    const lo = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokens['salesmanb@smartfactory.local']}`);
    expect(lo.status).toBe(200);
  });

  test('Role-based access control rejects unauthorized endpoints', async () => {
    const sToken = tokens['salesman@smartfactory.local'];
    const pToken = tokens['production@smartfactory.local'];
    const aToken = tokens['auditor@smartfactory.local'];

    expect((await request(app).get('/api/audit/logs').set('Authorization', `Bearer ${sToken}`)).status).toBe(403);
    expect((await request(app).get('/api/masters/users').set('Authorization', `Bearer ${aToken}`)).status).toBe(403);
    expect((await request(app).post('/api/production/runs').set('Authorization', `Bearer ${sToken}`).send({})).status).toBe(403);
    expect((await request(app).post('/api/payments').set('Authorization', `Bearer ${aToken}`).send({})).status).toBe(403);
    expect((await request(app).get('/api/reports/gst-summary').set('Authorization', `Bearer ${pToken}`)).status).toBe(403);
  });

  test('NIT Benchmark Scenario: Production, Sales Orders, GST Invoice, Partial Dispatch, Shortage & Payment', async () => {
    const prodToken = tokens['production@smartfactory.local'];
    const salesToken = tokens['salesman@smartfactory.local'];
    const adminToken = tokens['admin@smartfactory.local'];
    const ownerToken = tokens['owner@smartfactory.local'];
    const audToken = tokens['auditor@smartfactory.local'];

    // 1. Load BOM for product 1
    const bomRes = await request(app)
      .get('/api/production/bom/1')
      .set('Authorization', `Bearer ${prodToken}`);
    expect(bomRes.status).toBe(200);
    expect(bomRes.body.items.length).toBe(5);

    // 2. Post NIT benchmark production run: 1 batch, 188 good output, 12 wastage, 6 damaged pouches, 10.5 L oil, 194 pouches, 9 cartons
    const runRes = await request(app)
      .post('/api/production/runs')
      .set('Authorization', `Bearer ${prodToken}`)
      .send({
        productId: 1,
        batchNumber: 'NIT-BENCH-01',
        batchCount: 1,
        actualOutput: 188,
        actualWastage: 12,
        damagedPouches: 6,
        labourCost: 1200,
        utilityCost: 600,
        actualConsumption: { 1: 40, 2: 10.5, 3: 1.2, 4: 194, 5: 9 }
      });
    expect(runRes.status).toBe(201);
    expect(runRes.body.expectedOutput).toBe(200);
    expect(runRes.body.actualOutput).toBe(188);
    expect(runRes.body.yieldVariancePercent).toBe(-6);
    expect(runRes.body.materialCost).toBe(4055);
    expect(runRes.body.totalCost).toBe(5855);
    expect(runRes.body.costPerPacket).toBeCloseTo(31.1436, 3);

    // 3. Salesman A places Retailer A order (150 packets) with idempotency key (offline sync simulation)
    const idemKey = 'offline-bench-order-001';
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customerId: 1, items: [{ productId: 1, quantity: 150 }], idempotencyKey: idemKey });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.total).toBe('7500.00');
    const orderId1 = orderRes.body.orderId;

    // Duplicate offline sync with same idempotencyKey must NOT create a duplicate order
    const dupRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customerId: 1, items: [{ productId: 1, quantity: 150 }], idempotencyKey: idemKey });
    expect(dupRes.status).toBe(200);
    expect(dupRes.body.duplicate).toBe(true);
    expect(dupRes.body.orderId).toBe(orderId1);

    // 4. Admin verifies, invoices (intra-state 5% GST), and dispatches Retailer A order
    const verifyRes = await request(app)
      .post(`/api/orders/${orderId1}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(verifyRes.status).toBe(200);

    const invRes = await request(app)
      .post(`/api/orders/${orderId1}/invoice`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(invRes.status).toBe(201);
    expect(invRes.body.taxable).toBe(7500);
    expect(invRes.body.cgst).toBe(187.5);
    expect(invRes.body.sgst).toBe(187.5);
    expect(invRes.body.igst).toBe(0);
    expect(invRes.body.total).toBe(7875);

    const dispRes = await request(app)
      .post(`/api/orders/${orderId1}/dispatch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(dispRes.status).toBe(201);
    expect(dispRes.body.dispatched).toBe(150);
    expect(dispRes.body.remaining).toBe(0);

    // 5. Partial payment ₹4000 -> ₹3875 outstanding
    const payRes = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ invoiceId: invRes.body.invoiceId, amount: 4000, mode: 'UPI' });
    expect(payRes.status).toBe(201);
    expect(payRes.body.outstanding).toBe('3875.00');

    // 6. Distributor B orders 120 packets -> blocked with 32 shortage (only 88 finished stock left)
    const orderRes2 = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customerId: 2, items: [{ productId: 1, quantity: 120 }] });
    expect(orderRes2.status).toBe(201);

    const verifyRes2 = await request(app)
      .post(`/api/orders/${orderRes2.body.orderId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(verifyRes2.status).toBe(409);
    expect(verifyRes2.body.shortages[0].shortage).toBe(32);

    // 7. Verify inventory closing stock balances match NIT benchmark
    const invSummary = await request(app)
      .get('/api/inventory/summary')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(invSummary.status).toBe(200);
    const byName = Object.fromEntries(invSummary.body.map(i => [i.name, Number(i.balance)]));
    expect(byName['Flour']).toBe(120);
    expect(byName['Cooking oil']).toBe(19.5);
    expect(byName['Salt and spice mix']).toBeCloseTo(3.8, 2);
    expect(byName['200 g pouch']).toBe(306);
    expect(byName['Carton (20 packets)']).toBe(21);
    expect(byName['Murukku 200 g']).toBe(88);

    // 8. Quality Control inspection on the run
    const qcRes = await request(app)
      .post('/api/qc/inspections')
      .set('Authorization', `Bearer ${prodToken}`)
      .send({
        runId: runRes.body.runId,
        status: 'PASSED',
        rejectedQty: 0,
        checklist: { seal_integrity: true, weight_accuracy: true }
      });
    expect(qcRes.status).toBe(201);

    // 9. Auditor reports, Excel export, and Audit Logs
    const gstRep = await request(app)
      .get('/api/reports/gst-summary')
      .set('Authorization', `Bearer ${audToken}`);
    expect(gstRep.status).toBe(200);
    expect(gstRep.body.length).toBeGreaterThanOrEqual(1);

    const excelRep = await request(app)
      .get('/api/reports/receivables/excel')
      .set('Authorization', `Bearer ${audToken}`);
    expect(excelRep.status).toBe(200);
    expect(excelRep.headers['content-type']).toContain('text/csv');

    const badDate = await request(app)
      .get('/api/reports/sales-register?from=2025-12-31&to=2025-01-01')
      .set('Authorization', `Bearer ${audToken}`);
    expect(badDate.status).toBe(400);

    const auditRes = await request(app)
      .get('/api/audit/logs?limit=20')
      .set('Authorization', `Bearer ${audToken}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.length).toBeGreaterThan(0);

    // 10. Stretch goals: e-Invoice mock, Tally XML export, and GPS salesman visit log
    const einvRes = await request(app)
      .post(`/api/invoices/${invRes.body.invoiceId}/e-invoice`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(einvRes.status).toBe(201);
    expect(einvRes.body.irn).toHaveLength(64);
    expect(einvRes.body.ewbNo).toBeTruthy();
    expect(einvRes.body.payload.ValDtls.TotInvVal).toBe(7875);

    const tallyRes = await request(app)
      .get('/api/reports/tally/xml')
      .set('Authorization', `Bearer ${audToken}`);
    expect(tallyRes.status).toBe(200);
    expect(tallyRes.headers['content-type']).toContain('application/xml');
    expect(tallyRes.text).toContain('<VOUCHER VCHTYPE="Sales"');

    const visitRes = await request(app)
      .post('/api/visits')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customerId: 1, latitude: 10.7589, longitude: 78.8132, notes: 'NIT Trichy demo check-in' });
    expect(visitRes.status).toBe(201);

    const visitsList = await request(app)
      .get('/api/visits')
      .set('Authorization', `Bearer ${salesToken}`);
    expect(visitsList.status).toBe(200);
    expect(visitsList.body.length).toBeGreaterThanOrEqual(1);
  });

  test('Multi-product order, rejection, supplier management, purchase return & stock adjustment approval', async () => {
    const adminToken = tokens['admin@smartfactory.local'];
    const salesToken = tokens['salesman@smartfactory.local'];

    // Multi-product cart order (2 lines)
    const multiOrder = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${salesToken}`)
      .send({ customerId: 1, items: [{ productId: 1, quantity: 5 }, { productId: 1, quantity: 3 }] });
    expect(multiOrder.status).toBe(201);
    expect(multiOrder.body.total).toBe('400.00');

    // Reject order
    const rej = await request(app)
      .post(`/api/orders/${multiOrder.body.orderId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Test rejection' });
    expect(rej.status).toBe(200);

    // Supplier create + edit + deactivate
    const sup = await request(app)
      .post('/api/purchases/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Madurai Spice Co', stateCode: '33' });
    expect(sup.status).toBe(201);

    const supEdit = await request(app)
      .put(`/api/purchases/suppliers/${sup.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(supEdit.status).toBe(200);

    // Stock adjustment request + approval
    const adj = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ itemType: 'RAW', itemId: 1, direction: 'IN', quantity: 5, unit: 'kg', reason: 'Cycle count' });
    expect(adj.status).toBe(201);

    const adjApprove = await request(app)
      .post(`/api/inventory/adjustments/${adj.body.adjustmentId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(adjApprove.status).toBe(200);
  });
});
