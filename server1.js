"use strict";

import cmmv, { json, urlencoded } from '@cmmv/server';
import proxy from "./proxy1.js";

const PORT = process.env.PORT || 8080;

// Create the server
const app = cmmv();

// Use JSON and URL-encoded plugins to parse data
app.use(json());
app.use(urlencoded({ extended: true }));

// Middleware to handle favicon requests
app.get('/', proxy);
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
