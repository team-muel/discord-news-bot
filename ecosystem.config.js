module.exports = {
  apps: [
    {
      name: "muel-bot",
      script: "npm",
      args: "run start:bot",
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
