/**
 * PM2 process manager for VPS / Docker host (leave Hostinger shared Node when ready).
 *
 * Hostinger panel (until then):
 * - Health check URL: /health/live
 * - Keep app always-on / prevent sleep if the panel offers it
 * - API app: RUN_SCHEDULED_WORKERS=false, start = npm start
 * - Worker app (2nd Node app): npm run start:worker
 *
 * pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'cgm-api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        RUN_SCHEDULED_WORKERS: 'false',
        WORKER_ONLY: 'false',
        INSTANCE_ID: 'api',
        TRUST_PROXY: '1',
      },
      max_memory_restart: '512M',
      kill_timeout: 10_000,
      listen_timeout: 15_000,
      exp_backoff_restart_delay: 200,
    },
    {
      name: 'cgm-worker',
      script: 'dist/worker.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        RUN_SCHEDULED_WORKERS: 'true',
        WORKER_ONLY: 'true',
        INSTANCE_ID: 'worker',
      },
      max_memory_restart: '512M',
      kill_timeout: 15_000,
      exp_backoff_restart_delay: 200,
    },
  ],
};
