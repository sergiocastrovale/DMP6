import { countByStatus } from '~/server/utils/issueTypes'

// PENDING issues across every issue table, for the sidebar badge. Seven tables, and the badge previously
// summed only five of them (duplicate-release and mismatched-release-id were missing), so it undercounted.
export const countPendingIssues = async (): Promise<number> =>
  Object.values(await countByStatus('PENDING')).reduce((a, b) => a + b, 0)
