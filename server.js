import app from "./index.js";
import http2 from "http2";

const PORT = process.env.PORT || 8080;

const server = http2.createServer(app);
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
