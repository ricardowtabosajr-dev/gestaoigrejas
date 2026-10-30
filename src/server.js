const config = require('./config');
const app = require('./app');
const prisma = require('./lib/prisma');
const { startJobs } = require('./jobs/scheduler');

const server = app.listen(config.port, () => {
  console.log(`Sistema de Gestão da Igreja em http://localhost:${config.port}`);
  startJobs();
});

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
