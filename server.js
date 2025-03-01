import Fastify from 'fastify';
import { fetchImageAndHandle } from './request.js'; // Adjust the path as needed

const fastify = Fastify({ logger: true });

// Route to handle image compression requests
fastify.get('/', async (req, reply) => {
  await fetchImageAndHandle(req, reply);
});

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: 8080, host: '0.0.0.0' });
    fastify.log.info(`Server is running on http://0.0.0.0:8080`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
