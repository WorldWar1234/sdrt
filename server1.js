// server.js
const { createServer } = require('@cmmv/server');
const hhproxy = require('./proxy1.js');

const port = 3000;

// Create the server
const server = createServer({
  route: '/proxy1',
  handler: hhproxy
});

// Start the server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
