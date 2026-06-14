module.exports = {
  apps: [{
    name: 'whop-wechat-bridge',
    script: 'server.js',
    cwd: '/home/wikitang628/whop-wechat-bridge',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '400M',
    restart_delay: 5000,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
      PORT: '8085'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/home/wikitang628/.pm2/logs/whop-wechat-bridge-error.log',
    out_file: '/home/wikitang628/.pm2/logs/whop-wechat-bridge-out.log',
    merge_logs: true
  }]
};
