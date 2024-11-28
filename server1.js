import Koa from "koa";
import proxy from "./proxy.js";

// Create Koa app and use the proxy middleware
const app = new Koa();
app.use(proxy);

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Koa server is running on port ${PORT}`);
});
