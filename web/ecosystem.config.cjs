require('dotenv').config()

module.exports = {
  apps: [{
    name: 'dmp',
    script: './.output/server/index.mjs',
    instances: 'max',
    exec_mode: 'cluster',
    wait_ready: true,
    listen_timeout: 10000,
    kill_timeout: 5000,
    max_memory_restart: '500M',
  }]
}
