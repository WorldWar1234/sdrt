import Koa from 'koa';
import proxy from './proxy.js';  // Import the proxy handler

const app = new Koa();

// Handle all GET requests at the root path ("/")
app.use(async (ctx) => {
  // Call the proxy handler defined in proxy.js
  await proxy(ctx);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
