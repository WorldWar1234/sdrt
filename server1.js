"use strict";

import Koa from "koa";
import proxy from "./proxy.js";

const app = new Koa();
const PORT = process.env.PORT || 3000;

// Middleware to handle favicon requests
app.use(async (ctx, next) => {
  if (ctx.path === "/favicon.ico") {
    ctx.status = 204;
    return;
  }
  await next();
});

// Route to handle proxy requests
app.use(async (ctx) => {
  ctx.req.query = ctx.query;
  proxy(ctx.req, ctx.res);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
