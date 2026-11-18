module.exports = {
  apps: [
    {
      name: "music-dashboard",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: "./",
      instances: "max", // Automatically balances load across all available CPU cores
      exec_mode: "cluster",
      node_args: "--max-old-space-size=2048",
      max_memory_restart: "1800M",
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
    {
      name: "music-worker",
      script: "npm",
      args: "run worker",
      cwd: "./",
      instances: 1, // Isolated background worker for FFmpeg & BullMQ
      exec_mode: "fork",
      max_memory_restart: "1800M",
      restart_delay: 5000,
      autorestart: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
