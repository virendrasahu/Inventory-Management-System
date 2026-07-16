require('dotenv').config();
const kafka = require('./src/kafka/config');


const producer = kafka.producer();
const TOPIC = 'inventory-events';

const run = async () => {
  await producer.connect();
  console.log('Producer connected');
  
  const now = new Date();
  
  const events = [
    { product_id: 'PRD003', event_type: 'purchase', quantity: 300, unit_price: 15.0, timestamp: new Date(now.getTime() - 20000).toISOString() },
    { product_id: 'PRD003', event_type: 'sale', quantity: 50, timestamp: new Date(now.getTime() - 15000).toISOString() },
  ];

  for (let ev of events) {
    await producer.send({
      topic: TOPIC,
      messages: [{ value: JSON.stringify(ev) }],
    });
    console.log('Sent event:', ev);
  }

  await producer.disconnect();
  console.log('Producer disconnected');
};

run().catch(console.error);
