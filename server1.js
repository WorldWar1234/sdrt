"use strict";

import pkg from '@cmmv/server';
import hhproxy from './proxy1.js';

const { createServer, json, urlencoded } = pkg;
const PORT = process.env.PORT || 8080;

// Create the server
const app = createServer();

// Use JSON and URL-encoded plugins to parse data
app.use(json());
app.use(urlencoded({ extended: true }));

// Setup the route with the proxy handler
app.get('/', hhproxy);

// Middleware to handle favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
