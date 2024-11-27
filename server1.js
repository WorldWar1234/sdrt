"use strict";

import http from "http";
import url from "url";
import proxy from "./proxy.js";

const PORT = process.env.PORT || 8080;

// Create the HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // Handle favicon requests
  if (parsedUrl.pathname === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Attach query parameters to the request object
  req.query = parsedUrl.query;

  // Use the proxy function to handle the request
  proxy(req, res);
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
