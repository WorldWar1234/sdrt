#!/usr/bin/env node
"use strict";

import express from "express";
import {handleRequest} from "./proxy2.js";

const app = express();


app.set('trust proxy', false);
app.disable("x-powered-by");

app.get("/", handleRequest);
app.get("/favicon.ico", (req, res) => res.status(204).end());

export default app;
