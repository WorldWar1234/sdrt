import pkg from "@cmmv/server";
const { createServer } = pkg;
import hhproxy from "./hhproxy.js";

// Define server configuration
const config = {
  port: process.env.PORT || 3000,
  host: "0.0.0.0",
};

// Create the server
const server = createServer((req, res) => {
  // Route requests to the hhproxy handler
  hhproxy(req, res);
});

// Start the server
server.listen(config.port, config.host, () => {
  console.log(`CMMV server is running on http://${config.host}:${config.port}`);
});
