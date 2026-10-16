/**
 * PM2 Cluster Configuration for Hostinger KVM 4 (4 vCPU, 16GB RAM)
 * 
 * Hostinger KVM 4 specs:
 *  - 4 vCPU Cores: 4 cluster workers utilizing all cores
 *  - 16 GB RAM: 2 GB memory ceiling per worker process
 *  - Supabase Small Compute (2 vCPU): Tuned connection pool per worker (20 connections * 4 = 80 max)
 */

module.exports = {
  apps: [
    {
      name: 'sinhala-quiz-backend',
      script: 'dist/server.js',
      instances: 4, // 1 worker per vCPU core on Hostinger KVM 4
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '2G', // Auto-restart worker if memory exceeds 2GB (out of 16GB total)
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        PG_MAX_POOL_SIZE: 20, // 20 * 4 workers = 80 connections to Supavisor (safe for Small Compute)
        PG_MIN_POOL_SIZE: 0,  // Prevents idle connection disconnects
      },
      exp_backoff_restart_delay: 100,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
