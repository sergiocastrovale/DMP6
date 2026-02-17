import { execSync } from 'node:child_process'
import { config } from 'dotenv'

config()

const SERVER_HOST = process.env.SERVER_HOST
const SERVER_USER = process.env.SERVER_USER
const DEPLOY_PATH = process.env.DEPLOY_PATH

if (!SERVER_HOST || !SERVER_USER || !DEPLOY_PATH) {
  console.error('❌ Missing required environment variables in .env file:')

  if (!SERVER_HOST) {
    console.error('  - SERVER_HOST')
  }

  if (!SERVER_USER) {
    console.error('  - SERVER_USER')
  }

  if (!DEPLOY_PATH) {
    console.error('  - DEPLOY_PATH')
  }

  console.log('\nPlease add these variables to your .env file:')
  console.log('  SERVER_HOST=your.server.ip')
  console.log('  SERVER_USER=your_username')
  console.log('  DEPLOY_PATH=/path/to/deployment')
  process.exit(1)
}

console.log('🔍 Testing SSH connection...')
try {
  execSync(`ssh -o BatchMode=yes -o ConnectTimeout=5 ${SERVER_USER}@${SERVER_HOST} 'echo "SSH connection successful"'`, { stdio: 'pipe' })
  console.log('✅ SSH connection verified\n')
}
catch (error) {
  console.error('❌ Failed to connect to server via SSH')
  console.error('\nPossible issues:')
  console.error('  - SSH key not configured or not found')
  console.error('  - Server is unreachable')
  console.error('  - Incorrect SERVER_HOST or SERVER_USER')
  console.log('\nMake sure your SSH key is configured in ~/.ssh/config or ~/.ssh/id_rsa exists')
  console.log(`Try manually: ssh ${SERVER_USER}@${SERVER_HOST}`)
  process.exit(1)
}

function clearCache() {
  console.log('\nClearing Nginx cache...')
  execSync(`ssh ${SERVER_USER}@${SERVER_HOST} 'sudo rm -rf /var/cache/nginx/dmp/* && sudo systemctl reload nginx'`, { stdio: 'inherit' })
  console.log('✅ Nginx cache cleared')
}

const mode = process.argv[2]

if (mode === 'db') {
  console.log(`Restoring database on ${SERVER_USER}@${SERVER_HOST}`)

  console.log('\nFinding latest local dump...')
  const latestLocalDump = execSync('ls -t dump/*.sql.gz 2>/dev/null | head -1', { encoding: 'utf-8' }).trim()

  if (!latestLocalDump) {
    console.error('❌ No local dump files found in dump/ directory')
    console.log('\nRun "pnpm backup" first to create a backup')
    process.exit(1)
  }

  console.log(`✅ Found local backup: ${latestLocalDump}`)

  console.log('\nCleaning up old dumps on server...')
  execSync(`ssh ${SERVER_USER}@${SERVER_HOST} 'rm -rf ${DEPLOY_PATH}/dump/*.sql.gz'`, { stdio: 'inherit' })

  console.log('\nSyncing latest dump to server...')
  execSync(`rsync -avz ${latestLocalDump} ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_PATH}/dump/`, { stdio: 'inherit' })

  const dumpFileName = latestLocalDump.split('/').pop()

  console.log('\nRestoring database...')
  const command = `ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${DEPLOY_PATH} && source .env && DB_USER=$(echo $DATABASE_URL | sed -n "s|.*://\\([^:]*\\):.*|\\1|p") && DB_PASS=$(echo $DATABASE_URL | sed -n "s|.*://[^:]*:\\([^@]*\\)@.*|\\1|p") && DB_HOST=$(echo $DATABASE_URL | sed -n "s|.*@\\([^:/]*\\).*|\\1|p") && DB_NAME=$(echo $DATABASE_URL | sed -n "s|.*/\\([^?]*\\).*|\\1|p") && cd dump && echo "Dropping and recreating database..." && mysql -h $DB_HOST -u $DB_USER -p$DB_PASS -e "DROP DATABASE IF EXISTS $DB_NAME; CREATE DATABASE $DB_NAME;" && echo "Decompressing and restoring from ${dumpFileName}..." && gunzip -c "${dumpFileName}" | mysql -h $DB_HOST -u $DB_USER -p$DB_PASS $DB_NAME && echo "Database restored successfully!"'`

  execSync(command, { stdio: 'inherit' })

  console.log('\nReloading PM2...')
  execSync(`ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${DEPLOY_PATH} && pm2 reload dmp'`, { stdio: 'inherit' })

  clearCache()
}
else if (mode === 'app') {
  console.log(`Deploying to ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_PATH}`)

  console.log('\nBuilding application...')
  execSync('pnpm build', { stdio: 'inherit' })

  console.log('\nSyncing .output/ to server...')
  execSync(`rsync -avz .output/ ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_PATH}/.output/`, { stdio: 'inherit' })

  console.log('\nSyncing public/ to server...')
  execSync(`rsync -avz --delete public/ ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_PATH}/public/`, { stdio: 'inherit' })

  console.log('\nSyncing ecosystem.config.cjs to server...')
  execSync(`rsync -avz ecosystem.config.cjs ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_PATH}/`, { stdio: 'inherit' })

  console.log('\nReloading PM2 (zero-downtime)...')
  execSync(`ssh ${SERVER_USER}@${SERVER_HOST} 'cd ${DEPLOY_PATH} && pm2 reload dmp'`, { stdio: 'inherit' })

  clearCache()

  console.log('\nDeployment complete!')
}
else if (mode === 'nginx') {
  console.log(`Deploying Nginx configuration to ${SERVER_USER}@${SERVER_HOST}`)

  console.log('\nSyncing nginx-dmp.conf to server...')
  execSync(`rsync -avz nginx-dmp.conf ${SERVER_USER}@${SERVER_HOST}:/tmp/nginx-dmp.conf`, { stdio: 'inherit' })

  console.log('\nInstalling Nginx configuration...')
  execSync(`ssh ${SERVER_USER}@${SERVER_HOST} 'sudo mv /tmp/nginx-dmp.conf /etc/nginx/sites-available/dmp && sudo ln -sf /etc/nginx/sites-available/dmp /etc/nginx/sites-enabled/dmp && sudo rm -f /etc/nginx/sites-enabled/default && sudo mkdir -p /var/cache/nginx/dmp && sudo chown -R www-data:www-data /var/cache/nginx/dmp && sudo nginx -t && sudo systemctl reload nginx'`, { stdio: 'inherit' })

  console.log('\nNginx configuration deployed and reloaded!')
}
else if (mode === 'uncache') {
  clearCache()
}
else {
  console.error('❌ Invalid mode. Use "app", "db", "nginx", or "uncache"')
  console.log('\nUsage:')
  console.log('  pnpm deploy:app     - Deploy application')
  console.log('  pnpm deploy:db      - Restore database')
  console.log('  pnpm deploy:nginx   - Deploy Nginx configuration')
  console.log('  pnpm deploy:uncache - Clear Nginx cache only')
  process.exit(1)
}
