#!/usr/bin/env node
"use strict";

import express from "express";
import proxy from "./proxy1.js";
import UserAgent from 'user-agents';

const app = express();

// Uncomment the next line if you want to trust the proxy
// app.enable("trust proxy");
app.disable("x-powered-by");

// Middleware to set a random User-Agent header
app.use((req, res, next) => {
  const userAgent = new UserAgent();
  req.headers['User-Agent'] = userAgent.toString();
  next();
});

app.get("/", proxy);
app.get("/favicon.ico", (req, res) => res.status(204).end());

export default app;
