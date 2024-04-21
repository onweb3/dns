const { MongoClient } = require('mongodb');

// MongoDB connection URL
const mongoURL = 'mongodb://localhost:27017';
const dbName = 'dns';
const collectionName = 'domains';

// Connect to MongoDB
const mongoClient = new MongoClient(mongoURL);

async function saveDomain(domain, records) {
  try {
    // Connect to MongoDB
    await mongoClient.connect();

    // Get the database and collection
    const db = mongoClient.db(dbName);
    const collection = db.collection(collectionName);

    // Insert domain and its records into the collection
    const result = await collection.insertOne({ domain, records });

    console.log('Domain added successfully:', result.insertedId);
  } catch (err) {
    console.error('Error saving domain to MongoDB:', err);
  } finally {
    // Close the connection
    await mongoClient.close();
  }
}

module.exports = saveDomain;
