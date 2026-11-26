const fs = require('fs');
const path = require('path');

// Load backend/.env when running standalone (without printing secrets)
const dotenv = require(path.resolve(__dirname, '../backend/node_modules/dotenv'));
const backendEnvPath = path.resolve(__dirname, '../backend/.env');
if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, quiet: true });
} else {
  dotenv.config({ quiet: true });
}

const { Partitioners } = require(path.resolve(__dirname, '../backend/node_modules/kafkajs'));
const { createKafkaInstance } = require(path.resolve(__dirname, '../backend/src/kafka/config'));

const DEFAULT_PRODUCTS = ['PRD001', 'PRD002', 'PRD003'];
const DEFAULT_COUNT = 8;
const DEFAULT_INTERVAL_MS = 1000;
const CONNECT_TIMEOUT_MS = 10000;

const PRODUCT_DEFAULTS = {
  PRD001: { qty: [50, 30], price: [100.0, 120.0] },
  PRD002: { qty: [80, 40], price: [25.0, 30.0] },
  PRD003: { qty: [60, 25], price: [45.0, 50.0] },
};

const toIsoUtcSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

const parseCliArgs = (argv) => {
  const options = {
    count: DEFAULT_COUNT,
    product: null,
    intervalMs: DEFAULT_INTERVAL_MS,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--count' || arg.startsWith('--count=')) {
      const raw = arg.includes('=') ? arg.split('=')[1] : argv[++i];
      const count = Number(raw);
      if (!Number.isInteger(count) || count < 5 || count > 10) {
        throw new Error('--count must be an integer between 5 and 10');
      }
      options.count = count;
    } else if (arg === '--product' || arg.startsWith('--product=')) {
      const raw = arg.includes('=') ? arg.split('=')[1] : argv[++i];
      if (!raw || typeof raw !== 'string' || !raw.trim() || raw.trim().length > 50) {
        throw new Error('--product must be a non-empty product_id (1-50 chars)');
      }
      options.product = raw.trim();
    } else if (arg === '--interval' || arg.startsWith('--interval=')) {
      const raw = arg.includes('=') ? arg.split('=')[1] : argv[++i];
      const interval = Number(raw);
      if (!Number.isInteger(interval) || interval < 0) {
        throw new Error('--interval must be an integer >= 0 (milliseconds)');
      }
      options.intervalMs = interval;
    } else {
      throw new Error(`Unknown CLI option: ${arg}`);
    }
  }

  return options;
};

/**
 * Generates 5..10 valid FIFO events:
 * - Purchases come first, then sales.
 * - Every sale quantity is strictly smaller than the total quantity bought for that product in the run.
 * - Uses PRD001, PRD002, PRD003 by default (or the single --product if specified).
 */
const generateSimulationEvents = ({
  count = DEFAULT_COUNT,
  product = null,
  startTime = new Date(),
} = {}) => {
  if (!Number.isInteger(count) || count < 5 || count > 10) {
    throw new Error('count must be an integer between 5 and 10');
  }

  const products = product ? [product] : DEFAULT_PRODUCTS;
  const numPurchases = Math.max(products.length, Math.ceil(count * 0.6));
  const numSales = count - numPurchases;

  const baseMs = startTime instanceof Date ? startTime.getTime() : Date.parse(startTime);
  const events = [];
  const boughtByProduct = new Map();
  const soldByProduct = new Map();

  for (let i = 0; i < numPurchases; i += 1) {
    const prod = products[i % products.length];
    const occ = Math.floor(i / products.length);
    const preset = PRODUCT_DEFAULTS[prod] || { qty: [40, 25], price: [20.0, 24.0] };
    const quantity = preset.qty[occ % preset.qty.length];
    const unit_price = preset.price[occ % preset.price.length];

    boughtByProduct.set(prod, (boughtByProduct.get(prod) || 0) + quantity);

    events.push({
      product_id: prod,
      event_type: 'purchase',
      quantity,
      unit_price,
      timestamp: toIsoUtcSeconds(baseMs + i * 5000),
    });
  }

  for (let j = 0; j < numSales; j += 1) {
    const prod = products[j % products.length];
    const totalBought = boughtByProduct.get(prod) || 0;
    const alreadySold = soldByProduct.get(prod) || 0;
    const remainingCapacity = totalBought - alreadySold - 1; // keep strictly smaller than bought

    const remainingSalesForProd =
      Math.floor((numSales - 1 - j) / products.length) + 1;
    const desired = Math.max(
      1,
      Math.floor(remainingCapacity / Math.max(1, remainingSalesForProd) * 0.7)
    );
    const quantity = Math.min(desired, remainingCapacity);

    if (quantity <= 0) {
      throw new Error(`Unable to allocate valid sale quantity for ${prod}`);
    }

    soldByProduct.set(prod, alreadySold + quantity);

    events.push({
      product_id: prod,
      event_type: 'sale',
      quantity,
      timestamp: toIsoUtcSeconds(baseMs + (numPurchases + j) * 5000),
    });
  }

  return events;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, timeoutMs, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      if (timer.unref) timer.unref();
    }),
  ]);

const printHelp = () => {
  console.log(`Standalone Kafka Inventory Event Simulator

Usage:
  node simulator/producer.js [options]
  npm run simulate -- [options]   (from backend/)

Options:
  --count N        Number of events to generate (5 to 10, default: ${DEFAULT_COUNT})
  --product ID     Generate events only for a specific product_id (default: PRD001, PRD002, PRD003)
  --interval MS    Delay between sent events in ms (default: ${DEFAULT_INTERVAL_MS})
  --dry-run        Print generated events without connecting or sending to Kafka
  --help, -h       Show this help message`);
};

const runSimulator = async (argv = process.argv.slice(2)) => {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (err) {
    console.error(`Invalid arguments: ${err.message}`);
    process.exit(1);
  }

  if (options.help) {
    printHelp();
    return;
  }

  const events = generateSimulationEvents({
    count: options.count,
    product: options.product,
  });

  if (options.dryRun) {
    console.log(`[DRY RUN] Generated ${events.length} valid events (not sent to Kafka):`);
    events.forEach((ev, idx) => {
      console.log(`[${idx + 1}/${events.length}] key=${ev.product_id} ${JSON.stringify(ev)}`);
    });
    const purchases = events.filter((e) => e.event_type === 'purchase').length;
    const sales = events.filter((e) => e.event_type === 'sale').length;
    console.log(
      `Summary (dry-run): total=${events.length}, purchases=${purchases}, sales=${sales}, products=${[
        ...new Set(events.map((e) => e.product_id)),
      ].join(',')}`
    );
    return;
  }

  if (!process.env.KAFKA_BROKERS || !process.env.KAFKA_BROKERS.trim()) {
    console.error('Error: KAFKA_BROKERS environment variable is not set. Configure backend/.env or export KAFKA_BROKERS.');
    process.exit(1);
  }

  const kafka = createKafkaInstance({
    connectionTimeout: CONNECT_TIMEOUT_MS,
    authenticationTimeout: CONNECT_TIMEOUT_MS,
    retry: { retries: 1 },
  });
  const topic = kafka.KAFKA_TOPIC;
  const producer = kafka.producer({
    createPartitioner: Partitioners.LegacyPartitioner,
  });

  let sentCount = 0;
  try {
    await withTimeout(
      producer.connect(),
      CONNECT_TIMEOUT_MS + 2000,
      `Timed out connecting to Kafka after ${CONNECT_TIMEOUT_MS}ms`
    );
    console.log(`Connected to Kafka. Topic: ${topic}`);

    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i];
      const records = await withTimeout(
        producer.send({
          topic,
          messages: [{ key: ev.product_id, value: JSON.stringify(ev) }],
        }),
        CONNECT_TIMEOUT_MS,
        `Timed out sending event ${i + 1} to Kafka`
      );

      const meta = records[0] || {};
      sentCount += 1;
      console.log(
        `Sent [${i + 1}/${events.length}] partition=${meta.partition ?? 0} offset=${meta.baseOffset ?? 'N/A'} key=${ev.product_id} payload=${JSON.stringify(ev)}`
      );

      if (i < events.length - 1 && options.intervalMs > 0) {
        await sleep(options.intervalMs);
      }
    }

    const purchases = events.filter((e) => e.event_type === 'purchase').length;
    const sales = events.filter((e) => e.event_type === 'sale').length;
    console.log(
      `Summary: sent=${sentCount}/${events.length} topic=${topic} purchases=${purchases} sales=${sales}`
    );
  } catch (err) {
    console.error(`Kafka simulator failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await producer.disconnect().catch(() => {});
  }
};

if (require.main === module) {
  runSimulator();
}

module.exports = {
  parseCliArgs,
  generateSimulationEvents,
  runSimulator,
  DEFAULT_PRODUCTS,
};
