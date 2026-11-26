const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const { setupInMemoryDb } = require('./testDb');
const { validateInventoryEvent } = require('../src/validators/eventValidator');
const fifoService = require('../src/services/fifoService');
const inventoryRoutes = require('../src/routes/inventoryRoutes');
const kafkaProducer = require('../src/kafka/producer');
const { JWT_SECRET } = require('../src/middlewares/auth');
const errorHandler = require('../src/middlewares/errorHandler');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api', inventoryRoutes);
  app.use(errorHandler);
  return app;
};

describe('Shared Event Validator', () => {
  it('normalizes trimmed product_id, case-insensitive event_type, defaults missing timestamp, and ignores sale unit_price', () => {
    const purchase = validateInventoryEvent({
      product_id: '  PRD-01  ',
      event_type: 'PURCHASE',
      quantity: 10,
      unit_price: 25.5,
    });
    assert.equal(purchase.valid, true);
    assert.equal(purchase.value.product_id, 'PRD-01');
    assert.equal(purchase.value.event_type, 'purchase');
    assert.equal(purchase.value.quantity, 10);
    assert.equal(purchase.value.unit_price, 25.5);
    assert.ok(Date.parse(purchase.value.timestamp));

    const sale = validateInventoryEvent({
      product_id: 'PRD-01',
      event_type: 'Sale',
      quantity: 5,
      unit_price: -999,
      timestamp: '2026-05-01T12:00:00Z',
    });
    assert.equal(sale.valid, true);
    assert.equal(sale.value.event_type, 'sale');
    assert.equal(sale.value.unit_price, undefined);
    assert.equal(sale.value.timestamp, '2026-05-01T12:00:00.000Z');
  });

  it('rejects negative, zero, decimal, non-numeric, NaN, and Infinity quantities', () => {
    for (const badQty of [-10, 0, 1.5, '1.5', 'abc', NaN, Infinity, -Infinity, '', true, null]) {
      const res = validateInventoryEvent({
        product_id: 'PRD-1',
        event_type: 'purchase',
        quantity: badQty,
        unit_price: 10,
      });
      assert.equal(res.valid, false, `Expected quantity=${String(badQty)} to fail`);
      assert.ok(res.errors.some((e) => e.field === 'quantity'));
    }
  });

  it('rejects invalid event_type, missing/oversized product_id, purchase without unit_price, and invalid timestamp', () => {
    const badType = validateInventoryEvent({
      product_id: 'PRD-1',
      event_type: 'adjustment',
      quantity: 5,
      unit_price: 10,
    });
    assert.equal(badType.valid, false);
    assert.ok(badType.errors.some((e) => e.field === 'event_type'));

    const missingPid = validateInventoryEvent({
      event_type: 'purchase',
      quantity: 5,
      unit_price: 10,
    });
    assert.equal(missingPid.valid, false);
    assert.ok(missingPid.errors.some((e) => e.field === 'product_id'));

    const longPid = validateInventoryEvent({
      product_id: 'A'.repeat(51),
      event_type: 'purchase',
      quantity: 5,
      unit_price: 10,
    });
    assert.equal(longPid.valid, false);
    assert.ok(longPid.errors.some((e) => e.field === 'product_id'));

    const noPrice = validateInventoryEvent({
      product_id: 'PRD-1',
      event_type: 'purchase',
      quantity: 5,
    });
    assert.equal(noPrice.valid, false);
    assert.ok(noPrice.errors.some((e) => e.field === 'unit_price'));

    const zeroPrice = validateInventoryEvent({
      product_id: 'PRD-1',
      event_type: 'purchase',
      quantity: 5,
      unit_price: 0,
    });
    assert.equal(zeroPrice.valid, false);
    assert.ok(zeroPrice.errors.some((e) => e.field === 'unit_price'));

    const badTs = validateInventoryEvent({
      product_id: 'PRD-1',
      event_type: 'sale',
      quantity: 5,
      timestamp: '2026-02-30T10:00:00Z',
    });
    assert.equal(badTs.valid, false);
    assert.ok(badTs.errors.some((e) => e.field === 'timestamp'));
  });
});

describe('API Validation & Stock Rejection (HTTP 400 / 409)', () => {
  let app;
  let authHeader;
  let producedEvents;

  beforeEach(() => {
    setupInMemoryDb();
    app = createTestApp();
    const token = jwt.sign({ id: 1, username: 'tester' }, JWT_SECRET, { expiresIn: '1h' });
    authHeader = `Bearer ${token}`;

    producedEvents = [];
    kafkaProducer.isProducerConnected = () => true;
    kafkaProducer.produceEvent = async (ev) => {
      producedEvents.push(ev);
    };
  });

  it('POST /api/event returns 400 with { success:false, message, errors } on invalid input', async () => {
    const res = await request(app)
      .post('/api/event')
      .set('Authorization', authHeader)
      .send({
        product_id: '   ',
        event_type: 'return',
        quantity: -3,
        timestamp: 'not-a-date',
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(typeof res.body.message, 'string');
    assert.ok(Array.isArray(res.body.errors));
    const fields = res.body.errors.map((e) => e.field);
    assert.ok(fields.includes('product_id'));
    assert.ok(fields.includes('event_type'));
    assert.ok(fields.includes('quantity'));
    assert.ok(fields.includes('timestamp'));
    assert.equal(producedEvents.length, 0);
  });

  it('POST /api/simulate validates custom payloads with shared validator and returns 400 on invalid payload', async () => {
    const invalidRes = await request(app)
      .post('/api/simulate')
      .set('Authorization', authHeader)
      .send({
        events: [
          { product_id: 'PRD1', event_type: 'purchase', quantity: 0, unit_price: 10 },
        ],
      });

    assert.equal(invalidRes.status, 400);
    assert.equal(invalidRes.body.success, false);
    assert.ok(Array.isArray(invalidRes.body.errors));
    assert.equal(producedEvents.length, 0);

    const validDefaultRes = await request(app)
      .post('/api/simulate')
      .set('Authorization', authHeader)
      .send({});

    assert.equal(validDefaultRes.status, 200);
    assert.equal(validDefaultRes.body.success, true);
    assert.equal(producedEvents.length, 5);
  });

  it('POST /api/event returns 409 with Insufficient stock and available_quantity when stock is short', async () => {
    await fifoService.processEvent({
      product_id: 'PRD-API',
      event_type: 'purchase',
      quantity: 8,
      unit_price: 15,
      timestamp: '2026-01-01T10:00:00.000Z',
    });

    const shortRes = await request(app)
      .post('/api/event')
      .set('Authorization', authHeader)
      .send({
        product_id: 'PRD-API',
        event_type: 'sale',
        quantity: 20,
      });

    assert.equal(shortRes.status, 409);
    assert.equal(shortRes.body.success, false);
    assert.equal(shortRes.body.message, 'Insufficient stock');
    assert.equal(shortRes.body.available_quantity, 8);
    assert.equal(producedEvents.length, 0);

    const okRes = await request(app)
      .post('/api/event')
      .set('Authorization', authHeader)
      .send({
        product_id: 'PRD-API',
        event_type: 'sale',
        quantity: 5,
      });

    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.success, true);
    assert.equal(producedEvents.length, 1);
  });
});
