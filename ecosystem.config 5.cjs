module.exports = {
  apps: [
    {
      name: 'ih35-erp',
      script: 'server.js',
      watch: false,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3100,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: process.env.PORT || 3100,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
