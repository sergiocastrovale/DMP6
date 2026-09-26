import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCRIPT_OOM_SCORE_ADJ } from '../../../helpers/constants'
import { OOM_SHIELD_SHELL, oomShielded } from '../../../server/utils/oomShield'
import { buildScript } from '../../../server/utils/terminalCommand'

const onLinux = existsSync('/proc/self/oom_score_adj')
const ownAdj = onLinux ? Number(readFileSync('/proc/self/oom_score_adj', 'utf8')) : 0

describe('oomShielded', () => {
  it('wraps the command in bash and passes the command and every argument through untouched', () => {
    const [command, args] = oomShielded('/srv/index', ['--only', 'AC/DC', 'a b; rm -rf x'])
    expect(command).toBe('bash')
    expect(args.slice(2)).toEqual(['/srv/index', '--only', 'AC/DC', 'a b; rm -rf x'])
  })

  it('runs the command with its arguments and returns its exit code', () => {
    const [command, args] = oomShielded('sh', ['-c', 'echo "$1"; exit 3', 'sh', 'a b; echo injected'])
    const result = spawnSync(command, args, { encoding: 'utf8' })
    expect(result.stdout).toBe('a b; echo injected\n')
    expect(result.status).toBe(3)
  })

  it.skipIf(!onLinux)('starts the command with a higher oom_score_adj than the process that spawned it', () => {
    const [command, args] = oomShielded('cat', ['/proc/self/oom_score_adj'])
    const adj = Number(execFileSync(command, args, { encoding: 'utf8' }))
    // Raising is always allowed; the child ends up at the shield value unless the parent already sits above it.
    expect(adj).toBe(Math.max(SCRIPT_OOM_SCORE_ADJ, ownAdj))
  })

  it('still runs where /proc cannot be written', () => {
    const result = spawnSync('bash', ['-c', `${OOM_SHIELD_SHELL.replace('/proc/self/oom_score_adj', '/proc/nonexistent/oom_score_adj')}; echo ran`], { encoding: 'utf8' })
    expect(result.stdout).toBe('ran\n')
    expect(result.stderr).toBe('')
  })
})

describe('the terminal wrapper script', () => {
  it.skipIf(!onLinux)('runs as generated: the command starts shielded and the exit sentinel is still written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oom-shield-'))
    const log = join(dir, 'run.log')
    const file = join(dir, 'run.sh')
    writeFileSync(file, buildScript(dir, 'cat /proc/self/oom_score_adj', log, 'no-such-session'), { mode: 0o700 })

    spawnSync('bash', [file])

    const out = readFileSync(log, 'utf8')
    expect(out).toContain(String(Math.max(SCRIPT_OOM_SCORE_ADJ, ownAdj)))
    expect(out).toContain('DMP_EXIT:0')
  })
})
