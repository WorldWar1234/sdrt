#!/usr/bin/env node
"use strict";

import express from "express";
import proxy from "./proxy1.js";

const app = express();
const PORT = process.env.PORT || 8080;

// Uncomment the next line if you want to trust the proxy
// app.enable("trust proxy");
app.disable("x-powered-by");

// Define a route for the root path that uses the proxy function
app.get("/", proxy);

// Handle favicon requests
app.get("/favicon.ico", (req, res) => res.status(204).end());

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
