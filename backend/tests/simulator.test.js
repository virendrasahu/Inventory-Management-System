const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCliArgs,
  generateSimulationEvents,
  DEFAULT_PRODUCTS,
} = require('../../simulator/producer');
const { validateInventoryEvent } = require('../src/validators/eventValidator');

describe('Standalone Kafka Simulator Event Generator', () => {
  it('parses CLI options and enforces count between 5 and 10', () => {
    const defaults = parseCliArgs([]);
    assert.equal(defaults.count, 8);
    assert.equal(defaults.product, null);
    assert.equal(defaults.intervalMs, 1000);
    assert.equal(defaults.dryRun, false);

    const custom = parseCliArgs(['--count', '6', '--product', 'PRD002', '--interval', '250', '--dry-run']);
    assert.equal(custom.count, 6);
    assert.equal(custom.product, 'PRD002');
    assert.equal(custom.intervalMs, 250);
    assert.equal(custom.dryRun, true);

    assert.throws(() => parseCliArgs(['--count', '4']), /between 5 and 10/);
    assert.throws(() => parseCliArgs(['--count', '11']), /between 5 and 10/);
  });

  it('generates purchases before sales with total sold strictly less than total bought per product', () => {
    for (const count of [5, 6, 8, 10]) {
      const events = generateSimulationEvents({
        count,
        startTime: new Date('2026-11-26T10:00:00Z'),
      });
      assert.equal(events.length, count);

      let seenSale = false;
      const bought = new Map();
      const sold = new Map();
      let prevTime = 0;

      for (const ev of events) {
        assert.ok(DEFAULT_PRODUCTS.includes(ev.product_id));
        const validation = validateInventoryEvent(ev);
        assert.equal(validation.valid, true, `Event failed validation: ${JSON.stringify(ev)}`);

        // Strictly increasing ISO 8601 UTC timestamps
        assert.match(ev.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        const ts = Date.parse(ev.timestamp);
        assert.ok(ts > prevTime);
        prevTime = ts;

        if (ev.event_type === 'purchase') {
          assert.equal(seenSale, false, 'All purchases must appear before sales');
          assert.equal(typeof ev.unit_price, 'number');
          assert.ok(ev.unit_price > 0);
          bought.set(ev.product_id, (bought.get(ev.product_id) || 0) + ev.quantity);
        } else {
          seenSale = true;
          assert.equal(Object.prototype.hasOwnProperty.call(ev, 'unit_price'), false);
          sold.set(ev.product_id, (sold.get(ev.product_id) || 0) + ev.quantity);
          assert.ok(
            sold.get(ev.product_id) < (bought.get(ev.product_id) || 0),
            `Sale quantity for ${ev.product_id} must stay strictly below bought quantity`
          );
        }
      }
    }
  });

  it('supports filtering to a single product with --product', () => {
    const events = generateSimulationEvents({ count: 7, product: 'PRD001' });
    assert.equal(events.length, 7);
    assert.ok(events.every((e) => e.product_id === 'PRD001'));

    const totalBought = events
      .filter((e) => e.event_type === 'purchase')
      .reduce((sum, e) => sum + e.quantity, 0);
    const totalSold = events
      .filter((e) => e.event_type === 'sale')
      .reduce((sum, e) => sum + e.quantity, 0);
    assert.ok(totalSold > 0);
    assert.ok(totalSold < totalBought);
  });
});
