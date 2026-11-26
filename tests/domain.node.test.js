'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toPaise, calculateGst } = require('../backend/services/tax');
const { benchmark } = require('../backend/services/benchmark');
const { convert } = require('../backend/utils/units');

test('NIT benchmark outputs match all stated stock, tax and costing figures', () => {
  const b = benchmark();
  assert.deepEqual(b.stock, { flourKg: 120, oilL: 19.5, spiceKg: 3.8, pouches: 306, cartons: 21, finishedAfterProduction: 238, finishedAfterRetailerDispatch: 88 });
  assert.equal(b.variance.yieldPercent, -6);
  assert.equal(b.variance.oilPercent, 5);
  assert.deepEqual(b.invoice, { taxablePaise: 750000, cgstPaise: 18750, sgstPaise: 18750, totalPaise: 787500, outstandingPaise: 387500 });
  assert.equal(b.distributorShortage, 32);
  assert.equal(b.costing.materialPaise, 405500);
  assert.equal(b.costing.totalPaise, 585500);
  assert.ok(Math.abs(b.costing.costPerPacket - 31.1436170213) < 1e-8);
});

test('GST calculation produces exact intra-state CGST and SGST in paise', () => {
  const gst = calculateGst(750000, 5, true);
  assert.deepEqual(gst, { cgstPaise: 18750, sgstPaise: 18750, igstPaise: 0, totalTaxPaise: 37500 });
});

test('GST calculation produces IGST only for inter-state supplies', () => {
  const gst = calculateGst(750000, 5, false);
  assert.deepEqual(gst, { cgstPaise: 0, sgstPaise: 0, igstPaise: 37500, totalTaxPaise: 37500 });
});

test('GST odd-paise split preserves total tax without losing one paisa', () => {
  const gst = calculateGst(1, 100, true);
  assert.equal(gst.cgstPaise + gst.sgstPaise, 1);
});

test('money conversion rejects invalid and unsafe amounts', () => {
  assert.equal(toPaise('12.34'), 1234);
  assert.throws(() => toPaise(-1));
  assert.throws(() => toPaise('NaN'));
  assert.throws(() => toPaise(Number.MAX_SAFE_INTEGER));
});

test('unit conversions cover mass, volume, carton and packet', () => {
  assert.equal(convert(1000, 'g', 'kg'), 1);
  assert.equal(convert(2, 'litre', 'ml'), 2000);
  assert.equal(convert(3, 'carton', 'packet'), 60);
  assert.equal(convert(40, 'packet', 'carton'), 2);
  assert.throws(() => convert(1, 'kg', 'litre'));
  assert.throws(() => convert(-1, 'kg', 'g'));
});
