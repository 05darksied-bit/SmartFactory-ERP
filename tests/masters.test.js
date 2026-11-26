'use strict';
const request = require('supertest');
const { execSync } = require('node:child_process');
const path = require('node:path');
const app = require('../backend/app');
const db = require('../backend/config/db');

const DEMO_PASSWORD = 'ChangeMe123!';
const tokens = {};

beforeAll(async () => {
  execSync('node backend/scripts/seed.js', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
  for (const email of [
    'owner@smartfactory.local',
    'admin@smartfactory.local',
    'salesman@smartfactory.local',
    'production@smartfactory.local',
    'auditor@smartfactory.local'
  ]) {
    const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
    tokens[email] = res.body.token;
  }
}, 30000);

afterAll(async () => {
  await db.end();
});

describe('SmartFactory ERP – Complete Masters Upgrade Integration Tests', () => {
  test('Customer CRUD, search/filter, GSTIN & state-code validation, activate/deactivate', async () => {
    const admin = tokens['admin@smartfactory.local'];
    const salesman = tokens['salesman@smartfactory.local'];

    // Invalid GSTIN rejected
    const badGstin = await request(app)
      .post('/api/masters/customers')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Bad GST Co', customerType: 'RETAILER', stateCode: '33', gstin: 'INVALID123' });
    expect(badGstin.status).toBe(400);

    // Invalid state code rejected
    const badState = await request(app)
      .post('/api/masters/customers')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Bad State Co', customerType: 'RETAILER', stateCode: '99' });
    expect(badState.status).toBe(400);

    // Valid customer create
    const created = await request(app)
      .post('/api/masters/customers')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        name: 'Coimbatore Mart',
        customerType: 'RETAILER',
        stateCode: '33',
        gstin: '33CCCCC0000C1Z5',
        phone: '9876543210',
        email: 'mart@example.com',
        creditLimit: 75000
      });
    expect(created.status).toBe(201);
    const cid = created.body.id;

    // Edit customer
    const edited = await request(app)
      .put(`/api/masters/customers/${cid}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Coimbatore Super Mart', creditLimit: 90000 });
    expect(edited.status).toBe(200);

    // Deactivate customer
    const deact = await request(app)
      .patch(`/api/masters/customers/${cid}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isActive: false });
    expect(deact.status).toBe(200);

    // Salesman only sees active customers
    const salesCusts = await request(app)
      .get('/api/masters/customers?all=1')
      .set('Authorization', `Bearer ${salesman}`);
    expect(salesCusts.status).toBe(200);
    expect(salesCusts.body.some(c => c.id === cid)).toBe(false);

    // Admin with ?all=1 sees inactive customer
    const adminCusts = await request(app)
      .get('/api/masters/customers?all=1&type=RETAILER')
      .set('Authorization', `Bearer ${admin}`);
    expect(adminCusts.status).toBe(200);
    expect(adminCusts.body.some(c => c.id === cid && c.name === 'Coimbatore Super Mart')).toBe(true);
  });

  test('Product CRUD, XSS image URL rejection, finished stock & history, activate/deactivate', async () => {
    const admin = tokens['admin@smartfactory.local'];

    // Reject javascript: image URL (XSS protection)
    const xssImg = await request(app)
      .post('/api/masters/products')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        sku: 'BAD-XSS', name: 'Bad', packSize: '100 g', expectedYield: 100,
        sellingPrice: 20, hsnCode: '190590', gstRate: 5, imageUrl: 'javascript:alert(1)'
      });
    expect(xssImg.status).toBe(400);

    // Create product
    const prod = await request(app)
      .post('/api/masters/products')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        sku: 'THATTAI-200', name: 'Thattai', packSize: '200 g', expectedYield: 150,
        sellingPrice: 45, hsnCode: '190590', gstRate: 5, imageUrl: 'https://example.com/thattai.jpg'
      });
    expect(prod.status).toBe(201);
    const pid = prod.body.id;

    // Edit product
    const edit = await request(app)
      .put(`/api/masters/products/${pid}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ sellingPrice: 48 });
    expect(edit.status).toBe(200);

    // History endpoint
    const hist = await request(app)
      .get(`/api/masters/products/${pid}/history`)
      .set('Authorization', `Bearer ${admin}`);
    expect(hist.status).toBe(200);
    expect(Array.isArray(hist.body.sales)).toBe(true);
    expect(Array.isArray(hist.body.production)).toBe(true);

    // Deactivate product
    const deact = await request(app)
      .patch(`/api/masters/products/${pid}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isActive: false });
    expect(deact.status).toBe(200);
  });

  test('Inventory item creation with opening stock & stock calculation', async () => {
    const admin = tokens['admin@smartfactory.local'];
    const item = await request(app)
      .post('/api/masters/inventory-items')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        sku: 'RAW-CHILI', name: 'Red Chilli Powder', itemType: 'RAW',
        baseUnit: 'kg', opening: 25, reorderLevel: 5
      });
    expect(item.status).toBe(201);

    const list = await request(app)
      .get('/api/masters/inventory-items')
      .set('Authorization', `Bearer ${admin}`);
    expect(list.status).toBe(200);
    const created = list.body.find(x => x.id === item.body.id);
    expect(Number(created.balance)).toBe(25);
  });

  test('BOM dynamic revision, duplicate prevention, and version history', async () => {
    const admin = tokens['admin@smartfactory.local'];
    const prod = tokens['production@smartfactory.local'];

    // Duplicate component rejected
    const dupBom = await request(app)
      .post('/api/masters/boms')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        productId: 1,
        items: [
          { itemId: 1, itemType: 'RAW', quantityPerBatch: 40, unit: 'kg' },
          { itemId: 1, itemType: 'RAW', quantityPerBatch: 5, unit: 'kg' }
        ]
      });
    expect(dupBom.status).toBe(400);

    // Valid BOM revision (creates v2)
    const rev = await request(app)
      .post('/api/masters/boms')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        productId: 1,
        effectiveDate: '2026-11-26',
        notes: 'Revised recipe v2',
        items: [
          { itemId: 1, itemType: 'RAW', quantityPerBatch: 40, unit: 'kg' },
          { itemId: 2, itemType: 'RAW', quantityPerBatch: 10, unit: 'litre' },
          { itemId: 3, itemType: 'RAW', quantityPerBatch: 1.2, unit: 'kg' },
          { itemId: 4, itemType: 'PACKAGING', quantityPerBatch: 200, unit: 'piece' },
          { itemId: 5, itemType: 'PACKAGING', quantityPerBatch: 10, unit: 'piece' }
        ]
      });
    expect(rev.status).toBe(201);
    expect(rev.body.versionNo).toBe(2);

    // Production role can view BOM versions
    const versions = await request(app)
      .get('/api/masters/boms/1/versions')
      .set('Authorization', `Bearer ${prod}`);
    expect(versions.status).toBe(200);
    expect(versions.body.length).toBeGreaterThanOrEqual(2);
    expect(versions.body[0].version_no).toBe(2);
    expect(versions.body[0].is_active).toBe(1);
  });

  test('Supplier validation, edit, and supplier payment history', async () => {
    const admin = tokens['admin@smartfactory.local'];

    const badSup = await request(app)
      .post('/api/purchases/suppliers')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Bad Sup', gstin: 'BAD', stateCode: '33' });
    expect(badSup.status).toBe(400);

    const sup = await request(app)
      .post('/api/purchases/suppliers')
      .set('Authorization', `Bearer ${admin}`)
      .send({ name: 'Erode Oil Mills', gstin: '33DDDDD0000D1Z5', stateCode: '33', phone: '9988776655' });
    expect(sup.status).toBe(201);

    const pay = await request(app)
      .post(`/api/purchases/suppliers/${sup.body.id}/payments`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ amount: 1500, mode: 'UPI', referenceNo: 'UPI-999' });
    expect(pay.status).toBe(201);

    const payHist = await request(app)
      .get(`/api/purchases/suppliers/${sup.body.id}/payments`)
      .set('Authorization', `Bearer ${admin}`);
    expect(payHist.status).toBe(200);
    expect(Number(payHist.body[0].amount)).toBe(1500);
  });

  test('Role restrictions on Masters endpoints', async () => {
    const salesman = tokens['salesman@smartfactory.local'];
    const prod = tokens['production@smartfactory.local'];
    const acc = tokens['auditor@smartfactory.local'];

    expect((await request(app).post('/api/masters/customers').set('Authorization', `Bearer ${salesman}`).send({})).status).toBe(403);
    expect((await request(app).post('/api/masters/products').set('Authorization', `Bearer ${prod}`).send({})).status).toBe(403);
    expect((await request(app).post('/api/masters/boms').set('Authorization', `Bearer ${prod}`).send({})).status).toBe(403);
    expect((await request(app).post('/api/masters/customers').set('Authorization', `Bearer ${acc}`).send({})).status).toBe(403);
    expect((await request(app).get('/api/masters/boms/1').set('Authorization', `Bearer ${salesman}`)).status).toBe(403);
  });
});
