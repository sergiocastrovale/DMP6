#!/usr/bin/env tsx

import { exec } from 'node:child_process'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import readline from 'node:readline'
import dotenv from 'dotenv'
import minimist from 'minimist'
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

dotenv.config()

const execAsync = promisify(exec)

interface DatabaseConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

function parseDatabaseUrl(url: string): DatabaseConfig {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
      user: parsed.username,
      password: parsed.password,
      database: parsed.pathname.substring(1),
    }
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error}`)
  }
}

function getS3Client(): S3Client | null {
  const region = process.env.S3_REGION || process.env.AWS_REGION
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
  const endpoint = process.env.S3_ENDPOINT

  if (!region || !accessKeyId || !secretAccessKey) {
    return null
  }

  const config: any = {
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  }

  // Only set custom endpoint if explicitly provided (for non-AWS S3)
  if (endpoint && endpoint.trim()) {
    config.endpoint = endpoint
    config.forcePathStyle = true
  }

  return new S3Client(config)
}

async function listS3Backups(): Promise<Array<{ key: string; lastModified: Date; size: number }>> {
  const s3Client = getS3Client()
  if (!s3Client) {
    throw new Error('S3 credentials not configured')
  }

  const bucket = process.env.S3_BACKUPS_BUCKET || 'backups'
  
  const listCommand = new ListObjectsV2Command({
    Bucket: bucket,
  })
  
  const response = await s3Client.send(listCommand)
  
  if (!response.Contents || response.Contents.length === 0) {
    return []
  }
  
  return response.Contents
    .filter(obj => obj.Key && obj.Key.endsWith('.sql.gz'))
    .map(obj => ({
      key: obj.Key!,
      lastModified: obj.LastModified || new Date(0),
      size: obj.Size || 0,
    }))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
}

async function downloadFromS3(key: string, destPath: string): Promise<void> {
  const s3Client = getS3Client()
  if (!s3Client) {
    throw new Error('S3 credentials not configured')
  }

  const bucket = process.env.S3_BACKUPS_BUCKET || 'backups'
  
  console.log(`⏳ Downloading from S3: s3://${bucket}/${key}`)
  
  const getCommand = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })
  
  const response = await s3Client.send(getCommand)
  
  if (!response.Body) {
    throw new Error('No data received from S3')
  }
  
  const writeStream = createWriteStream(destPath)
  
  // @ts-ignore - Body is a stream
  await pipeline(response.Body, writeStream)
  
  console.log('✅ Downloaded from S3')
}

async function listBackups(dumpsDir: string): Promise<void> {
  try {
    const files = await readdir(dumpsDir)
    const sqlFiles = files.filter(file => file.endsWith('.sql.gz'))

    if (sqlFiles.length === 0) {
      console.log('📂 No backup files found in dump/ directory')
      return
    }

    console.log('📋 Available backups:')

    const backupInfo = await Promise.all(
      sqlFiles.map(async (file) => {
        const filePath = path.join(dumpsDir, file)
        const stats = await stat(filePath)
        const sizeKB = (stats.size / 1024).toFixed(1)
        return {
          file,
          size: sizeKB,
          date: stats.mtime.toLocaleString(),
        }
      }),
    )

    backupInfo.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    backupInfo.forEach((backup, index) => {
      const indicator = index === 0 ? '👆 ' : '   '
      console.log(`${indicator}${backup.file} (${backup.size} KB) - ${backup.date}`)
    })
  } catch (error) {
    console.log('📂 No dump/ directory found')
  }
}

async function findMostRecentBackup(dumpsDir: string): Promise<string | null> {
  try {
    const files = await readdir(dumpsDir)
    const sqlFiles = files.filter(file => file.endsWith('.sql.gz'))

    if (sqlFiles.length === 0)
      return null

    const fileStats = await Promise.all(
      sqlFiles.map(async (file) => {
        const filePath = path.join(dumpsDir, file)
        const stats = await stat(filePath)
        return { file, mtime: stats.mtime }
      }),
    )

    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    return fileStats[0].file
  } catch (error) {
    return null
  }
}

async function confirmRestore(backupFile: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(
      `⚠️  This will COMPLETELY REPLACE the current database with backup: ${backupFile}\n`
      + `💥 ALL CURRENT DATA WILL BE LOST!\n\n`
      + `Type 'yes' to continue: `,
      (answer) => {
        rl.close()
        resolve(answer.toLowerCase() === 'yes')
      },
    )
  })
}

async function performRestore(backupPath: string): Promise<void> {
  const startTime = performance.now()

  console.log('\n🔄 Starting database restore...')
  console.log('='.repeat(60))

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const config = parseDatabaseUrl(databaseUrl)
  console.log(`📊 Target database: ${config.database} on ${config.host}:${config.port}`)

  const stats = await stat(backupPath)
  const fileSize = (stats.size / 1024 / 1024).toFixed(1)
  console.log(`📁 Backup file: ${path.basename(backupPath)} (${fileSize} MB)`)
  console.log(`📅 Created: ${stats.mtime.toLocaleString()}`)

  console.log('⏳ Dropping and recreating database...')
  
  process.env.PGPASSWORD = config.password
  
  const dropCmd = `psql --host=${config.host} --port=${config.port} --username=${config.user} -d postgres -c "DROP DATABASE IF EXISTS ${config.database};"`
  await execAsync(dropCmd)
  
  const createCmd = `psql --host=${config.host} --port=${config.port} --username=${config.user} -d postgres -c "CREATE DATABASE ${config.database} OWNER ${config.user};"`
  await execAsync(createCmd)

  const psqlCmd = [
    'gunzip -c',
    `"${backupPath}"`,
    '|',
    'psql',
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--username=${config.user}`,
    `--dbname=${config.database}`,
  ].join(' ')

  try {
    console.log('⏳ Decompressing and restoring database from backup...')

    const { stdout, stderr } = await execAsync(psqlCmd)

    if (stderr && !stderr.includes('NOTICE')) {
      console.warn('⚠️  psql warnings:', stderr)
    }

    const duration = (performance.now() - startTime) / 1000

    console.log('='.repeat(60))
    console.log('✅ Database restore completed successfully!')
    console.log(`⏱️  Duration: ${duration.toFixed(1)}s`)
    console.log('\n💡 Remember to restart your application if it\'s currently running')
  } catch (error: any) {
    if (error.code === 'ENOENT' && error.message.includes('psql')) {
      console.error('❌ Error: psql client not found')
      console.error('💡 Please install PostgreSQL client tools:')
      console.error('   - Ubuntu/Debian: sudo apt install postgresql-client')
      console.error('   - macOS: brew install postgresql')
      console.error('   - Windows: Install PostgreSQL')
    } else if (error.code === 'ENOENT' && error.message.includes('gunzip')) {
      console.error('❌ Error: gunzip not found')
      console.error('💡 Please install gzip tools')
    } else {
      console.error('❌ Restore failed:', error.message)
      if (error.stderr) {
        console.error('Details:', error.stderr)
      }
    }
    throw error
  }
}

async function restoreBackup(fromTimestamp?: string): Promise<void> {
  const dumpsDir = path.join(process.cwd(), 'dump')
  const backupStorage = process.env.BACKUP_STORAGE || 'local'
  let backupPath: string | null = null
  let backupFilename: string | null = null

  // Determine source based on BACKUP_STORAGE
  if (backupStorage === 's3' || (backupStorage === 'both' && !fromTimestamp)) {
    console.log('☁️  Fetching backups from S3...')
    const s3Backups = await listS3Backups()
    
    if (s3Backups.length === 0) {
      console.error('\n❌ No backup files found in S3')
      console.log('💡 Create a backup first using: pnpm run backup')
      return
    }
    
    console.log('📋 Available S3 backups:')
    s3Backups.forEach((backup, index) => {
      const indicator = index === 0 ? '👆 ' : '   '
      const sizeMB = (backup.size / 1024 / 1024).toFixed(1)
      console.log(`${indicator}${backup.key} (${sizeMB} MB) - ${backup.lastModified.toLocaleString()}`)
    })
    
    // Select backup based on timestamp or latest
    let selectedBackup: typeof s3Backups[0] | undefined
    
    if (fromTimestamp) {
      selectedBackup = s3Backups.find(b => b.key.includes(fromTimestamp))
      if (!selectedBackup) {
        console.error(`\n❌ No backup found matching timestamp: ${fromTimestamp}`)
        return
      }
    } else {
      selectedBackup = s3Backups[0]
    }
    
    console.log(`\n🎯 Using backup: ${selectedBackup.key}`)
    
    // Download to temporary location
    backupFilename = selectedBackup.key
    backupPath = path.join(dumpsDir, backupFilename)
    await downloadFromS3(selectedBackup.key, backupPath)
  } else {
    // Use local backup
    console.log('📁 Using local backups...')
    await listBackups(dumpsDir)
    
    if (fromTimestamp) {
      const files = await readdir(dumpsDir)
      const matchingFile = files.find(f => f.includes(fromTimestamp) && f.endsWith('.sql.gz'))
      
      if (!matchingFile) {
        console.error(`\n❌ No backup found matching timestamp: ${fromTimestamp}`)
        return
      }
      
      backupFilename = matchingFile
      backupPath = path.join(dumpsDir, matchingFile)
    } else {
      const mostRecent = await findMostRecentBackup(dumpsDir)
      
      if (!mostRecent) {
        console.error('\n❌ No backup files found in dump/ directory')
        console.log('💡 Create a backup first using: pnpm run backup')
        return
      }
      
      backupFilename = mostRecent
      backupPath = path.join(dumpsDir, mostRecent)
    }
    
    console.log(`\n🎯 Using most recent backup: ${backupFilename}`)
  }

  const confirmed = await confirmRestore(backupFilename)

  if (!confirmed) {
    console.log('👋 Restore cancelled')
    return
  }

  await performRestore(backupPath)
}

async function main() {
  const args = minimist(process.argv.slice(2), {
    boolean: ['help'],
    string: ['from'],
    alias: { h: 'help' },
  })

  if (args.help) {
    console.log(`
Database Restore Tool

Restores your PostgreSQL database from a backup.

Usage:
  tsx scripts/restore.ts [--from=TIMESTAMP]

Options:
  --from=YYYY-MM-DD-HH-MM-SS    Restore from specific backup timestamp

Storage:
  Controlled by BACKUP_STORAGE environment variable:
    - 'local' (default): Read from dump/ directory
    - 's3': Read from S3 bucket
    - 'both': Read from S3 (prefer remote for production)

Input:
  Automatically selects the most recent backup unless --from is specified

Requirements:
  - psql command (PostgreSQL client tools)
  - gunzip command
  - DATABASE_URL environment variable

⚠️  WARNING: This will DROP and completely recreate your database!
`)
    return
  }

  await restoreBackup(args.from)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
