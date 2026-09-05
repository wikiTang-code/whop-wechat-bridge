/**
 * @file docs/ecosystem.p1-11.sample.cjs
 * @description P1-11: Web 看板与 Ingest 独立双进程 PM2 部署样例配置 (仅供参考，禁止直接替换生产文件)
 *
 * 958MB 内存预算约束:
 * - whop-ingest-worker: 稳态 90~120MB, max_memory_restart 180M
 * - whop-web-dashboard: 稳态 50~80MB,  max_memory_restart 130M
 * - 两进程稳态合计预算 <= 200MB (警戒线 220MB)
 *
 * 部署安全铁律:
 * 1. 绝不使用 pm2 delete all
 * 2. 只有在评审完全通过且灰度验收后，方可由运维按 Runbook 引入
 */

module.exports = {
  apps: [
    // 1. 数据拉取、推送与 AI 调度独占 Worker (零 Web 端口)
    {
      name: 'whop-ingest-worker',
      script: 'scripts/ingest_runner.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '180M',
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        ROLE: 'ingest_worker',
        INGEST_WORKER_KEY: 'primary'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/ingest-error.log',
      out_file: './logs/ingest-out.log',
      merge_logs: true
    },

    // 2. 独立只读 Web 看板与健康探测服务 (独占 8085 端口与 Tunnel)
    {
      name: 'whop-web-dashboard',
      script: 'scripts/web_runner.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '130M',
      restart_delay: 3000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        ROLE: 'web_dashboard',
        READONLY_MODE: '1',
        PORT: '8085'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      merge_logs: true
    }
  ]
};
