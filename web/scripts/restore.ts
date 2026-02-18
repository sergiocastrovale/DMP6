#!/usr/bin/env tsx

import { exec } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import readline from 'node:readline'
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
  } catch (error) {
    throw new Error(`Invalid DATABASE_URL format: ${error}`)
  }
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

async function restoreBackup(): Promise<void> {
  const dumpsDir = path.join(process.cwd(), 'dump')

  await listBackups(dumpsDir)

  const mostRecent = await findMostRecentBackup(dumpsDir)

  if (!mostRecent) {
    console.error('\n❌ No backup files found in dump/ directory')
    console.log('💡 Create a backup first using: pnpm run backup')
    return
  }

  const backupPath = path.join(dumpsDir, mostRecent)
  console.log(`\n🎯 Using most recent backup: ${mostRecent}`)

  const confirmed = await confirmRestore(mostRecent)

  if (!confirmed) {
    console.log('👋 Restore cancelled')
    return
  }

  await performRestore(backupPath)
}

async function main() {
  const args = minimist(process.argv.slice(2), {
    boolean: ['help'],
    alias: { h: 'help' },
  })

  if (args.help) {
    console.log(`
Database Restore Tool

Restores your PostgreSQL database from the most recent backup.

Usage:
  tsx scripts/restore.ts

Input:
  Automatically selects the most recent .sql.gz file from dump/

Requirements:
  - psql command (PostgreSQL client tools)
  - gunzip command
  - DATABASE_URL environment variable

⚠️  WARNING: This will DROP and completely recreate your database!
`)
    return
  }

  await restoreBackup()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
