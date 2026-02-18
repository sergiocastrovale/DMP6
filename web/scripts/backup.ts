#!/usr/bin/env tsx

import { exec } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import dotenv from 'dotenv'
import minimist from 'minimist'

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

async function createBackup(): Promise<void> {
  const startTime = performance.now()

  console.log('\n🗄️  Starting database backup...')
  console.log('='.repeat(60))

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  const config = parseDatabaseUrl(databaseUrl)
  console.log(`📊 Database: ${config.database} on ${config.host}:${config.port}`)

  const dumpsDir = path.join(process.cwd(), 'dump')
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
      console.warn('⚠️  mysqldump warnings:', stderr)
    }

    const { stdout: fileSizeOutput } = await execAsync(`ls -lh "${backupPath}" | awk '{print $5}'`)
    const fileSize = fileSizeOutput.trim()

    const duration = (performance.now() - startTime) / 1000

    console.log(`${'='.repeat(60)}`)
    console.log('✅ Database backup completed successfully!')
    console.log(`📁 File: dump/${backupFilename}`)
    console.log(`📊 Size: ${fileSize}`)
    console.log(`⏱️  Duration: ${duration.toFixed(1)}s`)

    console.log('\n📋 Recent backups:')
    try {
      const { stdout: recentFiles } = await execAsync(`ls -lt "${dumpsDir}"/*.sql.gz 2>/dev/null | head -5 | awk '{print $9, $5, $6, $7, $8}' || echo "No previous backups found"`)
      console.log(recentFiles)
    } catch {
      console.log('No previous backups found')
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
    boolean: ['help'],
    alias: { h: 'help' },
  })

  if (args.help) {
    console.log(`
Database Backup Tool

Creates a compressed SQL backup of your PostgreSQL database.

Usage:
  tsx scripts/backup.ts

Output:
  dump/YYYY-MM-DD-HH-MM-SS.sql.gz

Requirements:
  - pg_dump command (PostgreSQL client tools)
  - gzip command
  - DATABASE_URL environment variable
`)
    return
  }

  await createBackup()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
