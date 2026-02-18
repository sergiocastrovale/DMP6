import { execSync } from 'node:child_process'
import { config } from 'dotenv'

config()

const SERVER_HOST = process.env.SERVER_HOST
const SERVER_USER = process.env.SERVER_USER
const DEPLOY_PATH = process.env.DEPLOY_PATH
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || ''

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
  console.log('  SSH_KEY_PATH=~/.ssh/your_key (optional)')
  process.exit(1)
}

// Build SSH and rsync commands with optional key
const sshKeyArg = SSH_KEY_PATH ? `-i ${SSH_KEY_PATH}` : ''
const sshCmd = (cmd: string) => `ssh ${sshKeyArg} ${SERVER_USER}@${SERVER_HOST} '${cmd}'`
const rsyncCmd = (src: string, dest: string, extraArgs = '') => {
  const sshOpt = SSH_KEY_PATH ? `-e "ssh -i ${SSH_KEY_PATH}"` : ''
  return `rsync -avz ${extraArgs} ${sshOpt} ${src} ${SERVER_USER}@${SERVER_HOST}:${dest}`
}

console.log('🔍 Testing SSH connection...')
try {
  execSync(sshCmd('echo "SSH connection successful"'), { stdio: 'pipe' })
  console.log('✅ SSH connection verified\n')
}
catch (error) {
  console.error('❌ Failed to connect to server via SSH')
  console.error('\nPossible issues:')
  console.error('  - SSH key not configured or not found')
  console.error('  - Server is unreachable')
  console.error('  - Incorrect SERVER_HOST or SERVER_USER')
  console.log('\nMake sure your SSH key is configured in ~/.ssh/config or add SSH_KEY_PATH to .env')
  console.log(`Try manually: ssh ${SERVER_USER}@${SERVER_HOST}`)
  process.exit(1)
}

function clearCache() {
  console.log('\nClearing Nginx cache...')
  execSync(sshCmd('sudo rm -rf /var/cache/nginx/dmp/* && sudo systemctl reload nginx'), { stdio: 'inherit' })
  console.log('✅ Nginx cache cleared')
}

function createServerEnv() {
  console.log('\nCreating server .env file...')
  
  // Get required env vars from local .env
  const DATABASE_URL = process.env.DATABASE_URL || ''
  const IMAGE_STORAGE = process.env.IMAGE_STORAGE || 'local'
  const S3_BUCKET = process.env.S3_BUCKET || ''
  const S3_REGION = process.env.S3_REGION || ''
  const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || ''
  const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || ''
  const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL || ''
  
  // Party Mode - force listener role for production
  const PARTY_ENABLED = process.env.PARTY_ENABLED || 'false'
  const PARTY_URL = process.env.PARTY_URL || ''
  const RTC_MIN_PORT = process.env.RTC_MIN_PORT || '10000'
  const RTC_MAX_PORT = process.env.RTC_MAX_PORT || '10100'
  
  // Build the .env content
  const envContent = `# Database
DATABASE_URL=${DATABASE_URL}

# Image Storage
IMAGE_STORAGE=${IMAGE_STORAGE}
S3_BUCKET=${S3_BUCKET}
S3_REGION=${S3_REGION}
S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID}
S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY}
S3_PUBLIC_URL=${S3_PUBLIC_URL}

# Party Mode (Listener) - Auto-configured for production
PARTY_ENABLED=${PARTY_ENABLED}
PARTY_ROLE=listener
PARTY_URL=${PARTY_URL}
MEDIASOUP_ANNOUNCED_IP=${SERVER_HOST}
RTC_MIN_PORT=${RTC_MIN_PORT}
RTC_MAX_PORT=${RTC_MAX_PORT}
`

  // Write to server using heredoc to handle special characters
  const escapedContent = envContent.replace(/\$/g, '\\$').replace(/`/g, '\\`')
  execSync(sshCmd(`cat > ${DEPLOY_PATH}/.env << 'EOF'\n${escapedContent}EOF`), { stdio: 'inherit' })
  
  console.log('✅ Server .env file created with listener configuration')
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
  execSync(sshCmd(`rm -rf ${DEPLOY_PATH}/dump/*.sql.gz`), { stdio: 'inherit' })

  console.log('\nSyncing latest dump to server...')
  execSync(rsyncCmd(latestLocalDump, `${DEPLOY_PATH}/dump/`), { stdio: 'inherit' })

  const dumpFileName = latestLocalDump.split('/').pop()

  console.log('\nRestoring database...')
  const restoreDbCmd = `cd ${DEPLOY_PATH} && source .env && DB_USER=$(echo $DATABASE_URL | sed -n "s|.*://\\([^:]*\\):.*|\\1|p") && DB_PASS=$(echo $DATABASE_URL | sed -n "s|.*://[^:]*:\\([^@]*\\)@.*|\\1|p") && DB_HOST=$(echo $DATABASE_URL | sed -n "s|.*@\\([^:/]*\\).*|\\1|p") && DB_NAME=$(echo $DATABASE_URL | sed -n "s|.*/\\([^?]*\\).*|\\1|p") && cd dump && echo "Dropping and recreating database..." && PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" && PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" && echo "Decompressing and restoring from ${dumpFileName}..." && gunzip -c "${dumpFileName}" | PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d $DB_NAME && echo "Database restored successfully!"`

  execSync(sshCmd(restoreDbCmd), { stdio: 'inherit' })

  console.log('\nReloading PM2...')
  try {
    execSync(sshCmd(`cd ${DEPLOY_PATH} && pm2 reload dmp`), { stdio: 'inherit' })
  } catch (error) {
    console.log('⚠️  PM2 process not running, skipping reload')
  }

  clearCache()
}
else if (mode === 'app') {
  console.log(`Deploying to ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_PATH}`)

  console.log('\nBuilding application for production (listener mode)...')
  // Override PARTY_ROLE to 'listener' for production build
  const buildEnv = { ...process.env, PARTY_ROLE: 'listener' }
  execSync('pnpm build', { stdio: 'inherit', env: buildEnv })

  console.log('\nSyncing .output/ to server...')
  execSync(rsyncCmd('.output/', `${DEPLOY_PATH}/.output/`), { stdio: 'inherit' })

  console.log('\nSyncing public/ to server...')
  execSync(rsyncCmd('public/', `${DEPLOY_PATH}/public/`, '--delete'), { stdio: 'inherit' })

  console.log('\nSyncing ecosystem.config.cjs to server...')
  execSync(rsyncCmd('ecosystem.config.cjs', `${DEPLOY_PATH}/`), { stdio: 'inherit' })

  console.log('\nSyncing package.json and pnpm-lock.yaml...')
  execSync(rsyncCmd('package.json', `${DEPLOY_PATH}/`), { stdio: 'inherit' })
  execSync(rsyncCmd('pnpm-lock.yaml', `${DEPLOY_PATH}/`), { stdio: 'inherit' })

  createServerEnv()

  console.log('\nInstalling dependencies on server...')
  execSync(sshCmd(`cd ${DEPLOY_PATH} && pnpm install --frozen-lockfile`), { stdio: 'inherit' })

  console.log('\nStopping PM2 to copy mediasoup binary...')
  execSync(sshCmd(`cd ${DEPLOY_PATH} && pm2 stop dmp || true`), { stdio: 'inherit' })

  console.log('\nCopying mediasoup worker binary...')
  execSync(sshCmd(`cd ${DEPLOY_PATH} && mkdir -p .output/server/node_modules/mediasoup/worker/out/Release && cp -r node_modules/mediasoup/worker/out/Release/* .output/server/node_modules/mediasoup/worker/out/Release/`), { stdio: 'inherit' })

  console.log('\nStarting PM2...')
  try {
    execSync(sshCmd(`cd ${DEPLOY_PATH} && pm2 restart dmp --update-env`), { stdio: 'inherit' })
  } catch (error) {
    console.log('Process not found, starting fresh...')
    execSync(sshCmd(`cd ${DEPLOY_PATH} && pm2 start ecosystem.config.cjs && pm2 save`), { stdio: 'inherit' })
  }

  clearCache()

  console.log('\nDeployment complete!')
}
else if (mode === 'nginx') {
  console.log(`Deploying Nginx configuration to ${SERVER_USER}@${SERVER_HOST}`)

  console.log('\nSyncing nginx-dmp.conf to server...')
  execSync(rsyncCmd('nginx-dmp.conf', '/tmp/nginx-dmp.conf'), { stdio: 'inherit' })

  console.log('\nInstalling Nginx configuration...')
  execSync(sshCmd('sudo mv /tmp/nginx-dmp.conf /etc/nginx/sites-available/dmp && sudo ln -sf /etc/nginx/sites-available/dmp /etc/nginx/sites-enabled/dmp && sudo rm -f /etc/nginx/sites-enabled/default && sudo mkdir -p /var/cache/nginx/dmp && sudo chown -R www-data:www-data /var/cache/nginx/dmp && sudo nginx -t && sudo systemctl reload nginx'), { stdio: 'inherit' })

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
