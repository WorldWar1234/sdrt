import app from "./index.js";
import http from "http";

const PORT = process.env.PORT || 8080;

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
