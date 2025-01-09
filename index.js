#!/usr/bin/env node
"use strict";

import express from "express";
import {fetchImageAndHandle} from "./request.js";
const app = express();
app.disable("x-powered-by");
app.get("/", fetchImageAndHandle);
app.get("/favicon.ico", (req, res) => res.status(204).end());

export default app;
