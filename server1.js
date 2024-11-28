// server.js
import http from 'http';
import Koa from 'koa';
import proxy from './proxy.js';

const app = new Koa();

app.use(proxy);

const server = http.createServer(app.callback());
const port = 8080;

server.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
