#!/usr/bin/env tsx

import { exec } from 'node:child_process'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import dotenv from 'dotenv'
import minimist from 'minimist'
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

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
  } catch (error: any) {
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

async function uploadToS3(filePath: string, filename: string): Promise<void> {
  const s3Client = getS3Client()
  if (!s3Client) {
    throw new Error('S3 credentials not configured')
  }

  const bucket = process.env.S3_BACKUPS_BUCKET || 'backups'
  const fileStream = createReadStream(filePath)
  const fileStats = await stat(filePath)

  console.log(`⏳ Uploading to S3 bucket: ${bucket}...`)

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: filename,
      Body: fileStream,
      ContentType: 'application/gzip',
    },
  })

  upload.on('httpUploadProgress', (progress) => {
    if (progress.loaded && progress.total) {
      const percent = Math.round((progress.loaded / progress.total) * 100)
      process.stdout.write(`\r⏳ Uploading to S3: ${percent}%`)
    }
  })

  await upload.done()
  console.log('\n✅ Uploaded to S3')
}

async function cleanupS3(): Promise<void> {
  const s3Client = getS3Client()
  if (!s3Client) {
    throw new Error('S3 credentials not configured')
  }

  const bucket = process.env.S3_BACKUPS_BUCKET || 'backups'
  
  console.log(`⏳ Listing backups in S3 bucket: ${bucket}...`)
  
  const listCommand = new ListObjectsV2Command({
    Bucket: bucket,
  })
  
  const response = await s3Client.send(listCommand)
  
  if (!response.Contents || response.Contents.length === 0) {
    console.log('📂 No backups found in S3')
    return
  }
  
  console.log(`🗑️  Deleting ${response.Contents.length} backup(s) from S3...`)
  
  for (const object of response.Contents) {
    if (object.Key) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucket,
        Key: object.Key,
      })
      await s3Client.send(deleteCommand)
      console.log(`  ✓ Deleted: ${object.Key}`)
    }
  }
  
  console.log('✅ S3 cleanup complete')
}

async function cleanupLocal(dumpsDir: string): Promise<void> {
  console.log('🗑️  Deleting local backups...')
  
  const files = await readdir(dumpsDir)
  const sqlFiles = files.filter(file => file.endsWith('.sql.gz'))
  
  if (sqlFiles.length === 0) {
    console.log('📂 No local backups found')
    return
  }
  
  for (const file of sqlFiles) {
    await rm(path.join(dumpsDir, file))
    console.log(`  ✓ Deleted: ${file}`)
  }
  
  console.log('✅ Local cleanup complete')
}

async function createBackup(shouldClean: boolean): Promise<void> {
  const startTime = performance.now()
  const backupStorage = process.env.BACKUP_STORAGE || 'local'
  const dumpsDir = path.join(process.cwd(), 'dump')

  console.log('\n🗄️  Starting database backup...')
  console.log('='.repeat(60))
  console.log(`📦 Storage mode: ${backupStorage}`)

  // Handle cleanup if requested
  if (shouldClean) {
    console.log('\n🧹 Cleaning up old backups...')
    
    if (backupStorage === 's3' || backupStorage === 'both') {
      await cleanupS3()
    }
    
    if (backupStorage === 'local' || backupStorage === 'both') {
      await cleanupLocal(dumpsDir)
    }
    
    console.log()
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const config = parseDatabaseUrl(databaseUrl)
  console.log(`📊 Database: ${config.database} on ${config.host}:${config.port}`)

  await mkdir(dumpsDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const backupFilename = `${timestamp}.sql.gz`
  const backupPath = path.join(dumpsDir, backupFilename)

  console.log(`📁 Backup file: ${backupFilename}`)

  const pgDumpCmd = [
    'pg_dump',
    '--no-owner',
    '--no-acl',
    '--clean',
    '--if-exists',
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--username=${config.user}`,
    `--dbname=${config.database}`,
    '|',
    'gzip',
    `> "${backupPath}"`,
  ].join(' ')

  process.env.PGPASSWORD = config.password

  try {
    console.log('⏳ Creating compressed database dump...')

    const { stdout, stderr } = await execAsync(pgDumpCmd)

    if (stderr && !stderr.includes('Warning')) {
      console.warn('⚠️  pg_dump warnings:', stderr)
    }

    const { stdout: fileSizeOutput } = await execAsync(`ls -lh "${backupPath}" | awk '{print $5}'`)
    const fileSize = fileSizeOutput.trim()

    console.log(`✅ Local backup created (${fileSize})`)

    // Upload to S3 if configured
    if (backupStorage === 's3' || backupStorage === 'both') {
      await uploadToS3(backupPath, backupFilename)
    }

    // Remove local file if only using S3
    if (backupStorage === 's3') {
      await rm(backupPath)
      console.log('🗑️  Local file removed (S3-only mode)')
    }

    const duration = (performance.now() - startTime) / 1000

    console.log(`${'='.repeat(60)}`)
    console.log('✅ Database backup completed successfully!')
    
    if (backupStorage === 'local' || backupStorage === 'both') {
      console.log(`📁 File: dump/${backupFilename}`)
      console.log(`📊 Size: ${fileSize}`)
    }
    
    if (backupStorage === 's3' || backupStorage === 'both') {
      const bucket = process.env.S3_BACKUPS_BUCKET || 'backups'
      console.log(`☁️  S3: s3://${bucket}/${backupFilename}`)
    }
    
    console.log(`⏱️  Duration: ${duration.toFixed(1)}s`)

    if (backupStorage === 'local' || backupStorage === 'both') {
      console.log('\n📋 Recent local backups:')
      try {
        const { stdout: recentFiles } = await execAsync(`ls -lt "${dumpsDir}"/*.sql.gz 2>/dev/null | head -5 | awk '{print $9, $5, $6, $7, $8}' || echo "No previous backups found"`)
        console.log(recentFiles)
      } catch {
        console.log('No previous backups found')
      }
    }
  } catch (error: any) {
    if (error.code === 'ENOENT' && error.message.includes('pg_dump')) {
      console.error('❌ Error: pg_dump not found')
      console.error('💡 Please install PostgreSQL client tools:')
      console.error('   - Ubuntu/Debian: sudo apt install postgresql-client')
      console.error('   - macOS: brew install postgresql')
      console.error('   - Windows: Install PostgreSQL')
    } else {
      console.error('❌ Backup failed:', error.message)
      if (error.stderr) {
        console.error('Details:', error.stderr)
      }
    }
    throw error
  }
}

async function main() {
  const args = minimist(process.argv.slice(2), {
    boolean: ['help', 'clean'],
    alias: { h: 'help' },
  })

  if (args.help) {
    console.log(`
Database Backup Tool

Creates a compressed SQL backup of your PostgreSQL database.

Usage:
  tsx scripts/backup.ts [--clean]

Options:
  --clean    Delete all existing backups before creating new one

Storage:
  Controlled by BACKUP_STORAGE environment variable:
    - 'local' (default): Store in dump/ directory
    - 's3': Store in S3 bucket (requires S3 credentials)
    - 'both': Store in both locations

S3 Configuration:
  AWS_REGION=us-east-1
  AWS_ACCESS_KEY_ID=your_key
  AWS_SECRET_ACCESS_KEY=your_secret
  S3_ENDPOINT=https://s3.amazonaws.com (optional)
  S3_BACKUPS_BUCKET=backups (default)

Output:
  dump/YYYY-MM-DD-HH-MM-SS.sql.gz (if local/both)
  s3://bucket-name/YYYY-MM-DD-HH-MM-SS.sql.gz (if s3/both)

Requirements:
  - pg_dump command (PostgreSQL client tools)
  - gzip command
  - DATABASE_URL environment variable
`)
    return
  }

  await createBackup(args.clean)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
