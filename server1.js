// server.js
const { Server } = require('@cmmv/server');
const hhproxy = require('./proxy1.js');

const port = 3000;

// Create a server instance
const server = new Server({
  routes: [
    {
      method: 'GET',
      path: '/proxy1',
      handler: hhproxy
    }
  ]
});

// Start the server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
