// server.js
import http from 'http';
import proxy from './proxy1.js';

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  // Pass the request to the proxy handler
  proxy(req, res);
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
