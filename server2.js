"use strict";

import express from "express";
import compression from "compression";
import helmet from "helmet";
import proxy from "./proxy1.js";

const app = express();
const PORT = process.env.PORT || 8080;

// Use Helmet to secure your app
app.use(helmet());

// Use compression to compress response bodies
app.use(compression());

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware to handle favicon requests
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});


// Use the proxy function to handle all other requests
app.use((req, res) => {
  proxy(req, res);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
