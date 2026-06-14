module.exports = {
  apps: [
    {
      name: 'whop-wechat-bridge',
      script: 'server.js',
      interpreter: 'node',
      cwd: 'C:\\Users\\86597\\.gemini\\antigravity\\scratch\\whop-wechat-bridge',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 5000,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        PORT: '8085'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'C:\\Users\\86597\\.pm2\\logs\\whop-wechat-bridge-error.log',
      out_file: 'C:\\Users\\86597\\.pm2\\logs\\whop-wechat-bridge-out.log',
      merge_logs: true
    }
  ]
};
