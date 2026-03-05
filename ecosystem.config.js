module.exports = {
  apps: [
    {
      name: "muel-backend",
      script: "npm",
      args: "run start:server",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: "production",
        START_BOT: "true",
        START_AUTOMATION_BOT: "true"
      }
    }
  ]
};
