const dgram = require('dgram');
const { DNSPacket } = require('dns-packet');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const { MongoClient } = require('mongodb');
const redis = require('redis');
const fs = require('fs');
const path = require('path');

const PORT = 53;
const HOST = '0.0.0.0'; // Listen on all available network interfaces

// MongoDB connection URL
const mongoURL = 'mongodb://localhost:27017';
const dbName = 'dns';
const collectionName = 'domains';

// Redis connection details
const redisClient = redis.createClient();

// Define rate limiting parameters
const RATE_LIMIT_INTERVAL = 1000; // Interval in milliseconds
const MAX_REQUESTS_PER_INTERVAL = 10; // Maximum requests per interval

// Log directory
const logDir = path.join(__dirname, 'logs');
const logFilename = `${new Date().toISOString().split('T')[0]}.txt`;

// Function to create log directory if it doesn't exist
function createLogDirectory(logDir) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// Function to log console output to a file
function logToFile(logDir, filename) {
  const logFilePath = path.join(logDir, filename);
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  // Intercept console.log
  const originalConsoleLog = console.log;
  console.log = function (...args) {
    const logMessage = `${new Date().toISOString()} - ${args.join(' ')}\n`;
    logStream.write(logMessage);
    originalConsoleLog.apply(console, args);
  };

  // Intercept console.error
  const originalConsoleError = console.error;
  console.error = function (...args) {
    const logMessage = `${new Date().toISOString()} [ERROR] - ${args.join(' ')}\n`;
    logStream.write(logMessage);
    originalConsoleError.apply(console, args);
  };
}

// Create log directory if it doesn't exist
createLogDirectory(logDir);

// Start logging to file
logToFile(logDir, logFilename);

// Connect to MongoDB
const mongoClient = new MongoClient(mongoURL);

mongoClient.connect((err) => {
  if (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }

  console.log('Connected to MongoDB');

  if (cluster.isMaster) {
    // Fork workers for each CPU core
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      console.log(`Worker ${worker.process.pid} died`);
    });
  } else {
    // Create UDP server socket
    const server = dgram.createSocket('udp4');

    server.on('error', (err) => {
      console.log(`Server error:\n${err.stack}`);
      server.close();
    });

    server.on('message', (msg, rinfo) => {
      const packet = DNSPacket.decode(msg);
      const query = packet.questions[0];

      console.log(`Received query for ${query.name} (${query.type}) from ${rinfo.address}`);

      // Check if the IP address is rate-limited
      if (isRateLimited(rinfo.address)) {
        console.log(`Rate limit exceeded for ${rinfo.address}. Dropping request.`);
        return;
      }

      // Increment request count for the IP address
      incrementRequestCount(rinfo.address);

      // Query MongoDB for domain details and records
      const db = mongoClient.db(dbName);
      const collection = db.collection(collectionName);

      collection.findOne({ domain: query.name }, (err, result) => {
        if (err) {
          console.error('Error querying MongoDB:', err);
          // Handle error
        } else if (result) {
          // Process domain details and records
          console.log('Domain details:', result);

          // Cache the domain details and records in Redis
          const cacheKey = `dns:${query.name}`;
          redisClient.setex(cacheKey, 300, JSON.stringify(result));

          // Construct and send DNS response
          const responsePacket = new DNSPacket();
          responsePacket.header.id = packet.header.id;
          responsePacket.header.qr = 1; // Response
          responsePacket.header.aa = 1; // Authoritative Answer

          const dnsRecords = result.records || {};
          const records = dnsRecords[query.type];
          if (records) {
            records.forEach((record) => {
              responsePacket.answers.push({
                type: query.type,
                name: record.name,
                ttl: record.ttl,
                class: 'IN',
                ...(record.data && { data: record.data }), // Add data property only if it exists
                ...(record.address && { address: record.address }), // Add address property only if it exists
                ...(record.priority && { priority: record.priority }), // Add priority property only if it exists
                ...(record.exchange && { exchange: record.exchange }), // Add exchange property only if it exists
                ...(record.weight && { weight: record.weight }), // Add weight property only if it exists
                ...(record.port && { port: record.port }), // Add port property only if it exists
                ...(record.target && { target: record.target }), // Add target property only if it exists
                ...(record.primary && { primary: record.primary }), // Add primary property only if it exists
                ...(record.admin && { admin: record.admin }), // Add admin property only if it exists
                ...(record.serial && { serial: record.serial }), // Add serial property only if it exists
                ...(record.refresh && { refresh: record.refresh }), // Add refresh property only if it exists
                ...(record.retry && { retry: record.retry }), // Add retry property only if it exists
                ...(record.expire && { expire: record.expire }), // Add expire property only if it exists
                ...(record.minimum && { minimum: record.minimum }), // Add minimum property only if it exists
                ...(record.flags && { flags: record.flags }), // Add flags property only if it exists
                ...(record.tag && { tag: record.tag }), // Add tag property only if it exists
                ...(record.publicKey && { publicKey: record.publicKey }), // Add publicKey property only if it exists
                ...(record.keyTag && { keyTag: record.keyTag }), // Add keyTag property only if it exists
                ...(record.algorithm && { algorithm: record.algorithm }), // Add algorithm property only if it exists
                ...(record.digestType && { digestType: record.digestType }), // Add digestType property only if it exists
                ...(record.digest && { digest: record.digest }), // Add digest property only if it exists
              });
            });
          } else {
            console.log(`Unsupported record type: ${query.type}`);
          }

          const responseBuffer = DNSPacket.encode(responsePacket);
          server.send(responseBuffer, rinfo.port, rinfo.address, (err) => {
            if (err) {
              console.error('Error sending response:', err);
            }
          });
        } else {
          console.log('Domain not found in MongoDB');
          // Handle missing domain
        }
      });
    });

    server.on('listening', () => {
      const address = server.address();
      console.log(`Worker ${process.pid} listening on ${address.address}:${address.port}`);
    });

    server.bind(PORT, HOST);
  }
});

// Function to check if the IP address is rate-limited
function isRateLimited(ipAddress) {
  const currentTime = Date.now();
  const lastRequestTime = parseInt(redisClient.get(ipAddress));
  if (lastRequestTime && currentTime - lastRequestTime < RATE_LIMIT_INTERVAL) {
    return true; // Rate limit exceeded
  }
  return false; // Not rate-limited
}

// Function to increment request count for the IP address
function incrementRequestCount(ipAddress) {
  const currentTime = Date.now();
  redisClient.setex(ipAddress, RATE_LIMIT_INTERVAL / 1000, currentTime);
}
