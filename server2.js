"use strict";

import cluster from "cluster";
import os from "os";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import proxy from "./proxy1.js";

const PORT = process.env.PORT || 8080;

// Clustering for multi-core systems
if (cluster.isPrimary) {
  const numClusters = process.env.CLUSTERS || (os.availableParallelism ? os.availableParallelism() : (os.cpus().length || 2));

  console.log(`Primary ${process.pid} is running. Will fork ${numClusters} clusters.`);

  // Fork workers
  for (let i = 0; i < numClusters; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Forking another one....`);
    cluster.fork();
  });

  return true;
}

// Worker processes run the Express server
const app = express();

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
  console.log(`Worker ${process.pid} started, Server is running on port ${PORT}`);
});
