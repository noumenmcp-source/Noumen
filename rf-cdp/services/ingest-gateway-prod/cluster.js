'use strict';
/**
 * CDP ingest-gateway cluster bootstrap (plain Node 18 'cluster').
 * Master forks WORKERS = CLUSTER_WORKERS || os.cpus().length children, each running server.js
 * (require). All workers listen on the same PORT — Node's cluster shares the listening socket
 * across children (round-robin accept; SO_REUSEPORT-style fan-out), multiplying ingest across cores.
 * Master never serves traffic: it only forks, logs worker pids, and restarts any worker that dies.
 * NOTE: server.js state is PER-PROCESS — in-process queue, DLQ and counters are NOT shared between
 * workers, so GET /v1/health reports only the worker that happened to accept that request.
 */
const cluster = require('cluster');
const os = require('os');
const pino = require('pino');

const log = pino({ level: 'info' });
const WORKERS = Math.max(1, parseInt(process.env.CLUSTER_WORKERS || '', 10) || os.cpus().length);

if (cluster.isPrimary) {
  log.info({ workers: WORKERS, pid: process.pid }, 'cdp-gateway cluster — forking workers');

  const fork = () => {
    const w = cluster.fork();
    log.info({ pid: w.process.pid }, 'worker forked');
    return w;
  };
  for (let i = 0; i < WORKERS; i++) fork();

  cluster.on('exit', (worker, code, signal) => {
    log.warn({ pid: worker.process.pid, code, signal }, 'worker died — restarting');
    fork();
  });

  // Forward shutdown signals to the whole cluster; workers handle their own SIGTERM/SIGINT drain.
  const broadcast = (sig) => () => {
    log.info({ sig }, 'cluster — broadcasting shutdown to workers');
    for (const id in cluster.workers) { try { cluster.workers[id].kill(sig); } catch {} }
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', broadcast('SIGTERM'));
  process.on('SIGINT', broadcast('SIGINT'));
} else {
  // Worker process: boot the gateway. server.js self-starts (calls listen) on require;
  // cluster intercepts listen() so every worker shares the same PORT.
  require('./server');
}
