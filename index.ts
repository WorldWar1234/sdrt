#!/usr/bin/env node
"use strict";

import express, { Request, Response } from "express";
import { proxy } from "./proxy";

const app = express();

app.enable("trust proxy");
app.disable("x-powered-by");

app.get("/", proxy);
app.get("/favicon.ico", (_req: Request, res: Response) => res.status(204).end());

export default app;
