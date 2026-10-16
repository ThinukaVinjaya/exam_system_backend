import app from './app.js';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { initScheduledJobs } from './jobs/cleanupJob.js';
import { backfillQuizNumbers } from './quizzes/quizNumberService.js';
import cluster from 'node:cluster';
import os from 'node:os';

const port = parseInt(env.PORT, 10) || 5000;
const isProduction = env.NODE_ENV === 'production';
const enableCluster = isProduction || process.env.ENABLE_CLUSTER === 'true';

async function startWorker() {
  await connectDB();
  const server = app.listen(port, () => {
    logger.info(`Worker ${process.pid} running on http://localhost:${port} in ${env.NODE_ENV} mode.`);
  });

  // Enable HTTP Keep-Alive connection reuse for 2000-4000 concurrent users
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const shutdown = async () => {
    logger.info(`Worker ${process.pid} shutting down...`);
    server.close(() => {
      logger.info(`Worker ${process.pid} closed.`);
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function startServer() {
  if (enableCluster && cluster.isPrimary) {
    logger.info(`Primary process ${process.pid} is running.`);

    // Connect to DB and run scheduled jobs once on primary process
    await connectDB();
    await backfillQuizNumbers();
    initScheduledJobs();

    const cpuCount = os.cpus().length;
    const workerCount = Math.max(1, Math.min(cpuCount, Number(process.env.MAX_WORKERS) || 4));
    logger.info(`Forking ${workerCount} worker processes for 2000-4000 concurrent user capability...`);

    for (let i = 0; i < workerCount; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      logger.warn(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Spawning replacement worker...`);
      cluster.fork();
    });
  } else {
    // In worker process, or single process mode (dev)
    if (!enableCluster) {
      await connectDB();
      await backfillQuizNumbers();
      initScheduledJobs();
      const server = app.listen(port, () => {
        logger.info(`Server is running on http://localhost:${port} in ${env.NODE_ENV} mode.`);
      });
      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;
    } else {
      await startWorker();
    }
  }
}

startServer();
