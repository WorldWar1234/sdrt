"use strict";

import cmmv, { json, urlencoded } from '@cmmv/server';
import hhproxy from './proxy1.js';

const host = '0.0.0.0';
const port = 3000;

// Create the server
const app = cmmv();

// Use JSON and URL-encoded plugins to parse data
app.use(json());
app.use(urlencoded({ extended: true }));

// Setup the route with the proxy handler
app.get('/', hhproxy);

// Middleware to handle favicon requests
app.get('/favicon.ico', (req, res) => {
  // `res` is an object returned from the `@cmmv/server` framework, so it has `.send()` instead of `.status()`
  res.send().status(204);
});

// Start the server
app.listen({ host, port })
  .then(server => {
    console.log(
      `Listen on http://${server.address().address}:${server.address().port}`,
    );
  })
  .catch(err => {
    throw new Error(err.message);
  });
