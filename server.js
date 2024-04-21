const express = require('express');
const bodyParser = require('body-parser');
const saveDomain = require('./saveDomain');

const app = express();
const port = 3000;

// Body parser middleware
app.use(bodyParser.json());

// Endpoint for adding domain records
app.post('/domains', (req, res) => {
  const { domain, records, ipAddress, device } = req.body;

  if (!domain || !records || !ipAddress || !device) {
    return res.status(400).json({ error: 'Domain, records, ipAddress, and device are required' });
  }

  // Save domain and its records to the database
  saveDomain(domain, records);

  res.status(201).json({ message: 'Domain and records added successfully' });
});

// Start the server
app.listen(port, () => {
  console.log(`Express server listening on port ${port}`);
});
