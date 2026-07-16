const { Kafka } = require('kafkajs');
const db = require('./db');
require('dotenv').config();

const kafka = new Kafka({
  clientId: 'inventory-app',
  brokers: [process.env.KAFKA_BROKERS],
  ssl: true,
  sasl: {
    mechanism: 'scram-sha-256',
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
  },
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'inventory-group' });

const TOPIC = 'inventory-events';

const connectKafka = async () => {
  try {
    await producer.connect();
    console.log('Kafka Producer connected');

    await consumer.connect();
    console.log('Kafka Consumer connected');

    await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          console.log('Received event:', event);
          await processEvent(event);
        } catch (err) {
          console.error('Error processing message:', err);
        }
      },
    });
  } catch (err) {
    console.error('Error connecting to Kafka:', err);
  }
};

const processEvent = async (event) => {
  const { product_id, event_type, quantity, unit_price, timestamp } = event;
  
  if (!product_id || !event_type || !quantity || !timestamp) {
    console.error('Invalid event data:', event);
    return;
  }

  // Use a transaction for DB operations
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Ensure product exists
    await client.query(
      "INSERT INTO products (product_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [product_id, `Product ${product_id}`]
    );

    if (event_type === 'purchase') {
      await client.query(
        "INSERT INTO inventory_batches (product_id, quantity, remaining_quantity, unit_price, timestamp) VALUES ($1, $2, $3, $4, $5)",
        [product_id, quantity, quantity, unit_price, timestamp]
      );
      console.log(`Processed purchase: ${quantity} units of ${product_id}`);
    } else if (event_type === 'sale') {
      // FIFO logic
      let remainingToSell = quantity;
      let totalCost = 0;

      // Fetch available batches ordered by timestamp (oldest first) FOR UPDATE to lock rows
      const res = await client.query(
        "SELECT * FROM inventory_batches WHERE product_id = $1 AND remaining_quantity > 0 ORDER BY timestamp ASC FOR UPDATE",
        [product_id]
      );

      const batches = res.rows;

      for (let batch of batches) {
        if (remainingToSell <= 0) break;

        const take = Math.min(batch.remaining_quantity, remainingToSell);
        const cost = take * batch.unit_price;
        totalCost += cost;
        remainingToSell -= take;

        // Update batch remaining quantity
        await client.query(
          "UPDATE inventory_batches SET remaining_quantity = remaining_quantity - $1 WHERE id = $2",
          [take, batch.id]
        );
      }

      if (remainingToSell > 0) {
        console.warn(`Not enough inventory to fulfill sale of ${quantity} for ${product_id}. Proceeding with partial/zero inventory but recording cost for available items.`);
        // Note: Depending on business rules, we might fail the transaction. 
        // For now, we just deduct what we can and record the sale.
      }

      await client.query(
        "INSERT INTO sales (product_id, quantity, total_cost, timestamp) VALUES ($1, $2, $3, $4)",
        [product_id, quantity, totalCost, timestamp]
      );
      console.log(`Processed sale: ${quantity} units of ${product_id} with total cost ${totalCost}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', err);
    throw err;
  } finally {
    client.release();
  }
};

const produceEvent = async (event) => {
  await producer.send({
    topic: TOPIC,
    messages: [
      { value: JSON.stringify(event) },
    ],
  });
};

module.exports = {
  connectKafka,
  produceEvent,
};
