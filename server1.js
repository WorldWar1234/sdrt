import Koa from 'koa';
import Router from 'koa-router';
import proxy from './proxy.js';  // Import the proxy handler

const app = new Koa();
const router = new Router();

// Define the root route ("/")
router.get('/', async (ctx) => {
  // Call the proxy handler defined in proxy.js
  await proxy(ctx);
});

// Add the router to the Koa app
app.use(router.routes()).use(router.allowedMethods());

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
