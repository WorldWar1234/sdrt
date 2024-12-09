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
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start the server
app.listen({ host, port })
.then(server => {
    console.log(
        `Listen on http://${server.address().address}:${server.address().port}`,
    );
})
.catch(err => {
    throw Error(err.message);
});
