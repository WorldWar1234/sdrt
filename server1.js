"use strict";

// Import necessary modules
const { CmmvServer } = require('@cmmv/server');
const hhproxy = require('./proxy1'); // Assuming proxy.js is in the same directory
const url = require('url');

// Create a new CMMV server instance
const server = new CmmvServer({
  port: 3000,
  host: '0.0.0.0',
});

// Middleware to handle all requests with the proxy function
server.use((req, res, next) => {
  // Parse the URL to extract query parameters
  const parsedUrl = url.parse(req.url, true);
  req.query = parsedUrl.query;
  req.url = parsedUrl.pathname; // This might be needed if hhproxy expects req.url to be just the path

  // Call hhproxy with the modified request and response objects
  hhproxy(req, res);
});

// Start the server
server.start(() => {
  console.log('Server with proxy functionality is running on port 3000');
});

// Error handling middleware (if needed)
server.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});
