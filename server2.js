"use strict";

import express from "express";
import proxy from "./proxy1.js";

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware to handle favicon requests
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// Middleware to attach query parameters to the request object
app.use((req, res, next) => {
  req.query = req.query; // Express already parses query parameters
  next();
});

// Use the proxy function to handle all other requests
app.use((req, res) => {
  proxy(req, res);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
