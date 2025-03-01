import Fastify from 'fastify';
import { fetchImageAndHandle } from './request.js'; // Adjust the path as needed

const fastify = Fastify({ logger: false });

// Route to handle image compression requests
fastify.get('/', async (req, reply) => {
  await fetchImageAndHandle(req, reply);
});

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    fastify.log.info(`Server is running on port 3000`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
