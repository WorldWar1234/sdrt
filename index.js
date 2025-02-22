#!/usr/bin/env node
"use strict";

import express from "express";
import {imageHandler} from "./request.js";
const app = express();
app.disable("x-powered-by");
app.get("/", imageHandler);
app.get("/favicon.ico", (req, res) => res.status(204).end());

export default app;
