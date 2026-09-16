import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Settings → Subsonic (per-user API keys for the /rest/* Subsonic API - docs/feature_subsonic.md).
// These specs check the one thing a unit/integration test can't: the plaintext key really only
// appears once, right after creation, and never again on a list refresh.

const gotoSubsonic = async (page: Page) => {
  await page.goto('/settings/subsonic')
  await expect(page.getByRole('heading', { name: 'Subsonic API keys' })).toBeVisible()
}

test.describe('settings subsonic api keys', () => {
  test('creating a key reveals it once, then only its prefix is listed', async ({ page }) => {
    await gotoSubsonic(page)

    const name = `e2e key ${Date.now()}`
    await page.getByRole('button', { name: 'New Key' }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()

    // The revealed key banner shows a dmp_-prefixed key immediately after creation.
    const revealedKey = page.locator('code', { hasText: 'dmp_' })
    await expect(revealedKey).toBeVisible()
    const key = (await revealedKey.textContent())!.trim()
    expect(key).toMatch(/^dmp_/)

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(revealedKey).not.toBeVisible()

    // Reload - the row is listed by name/prefix, never the full key again.
    await page.reload()
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row).toBeVisible()
    await expect(row).not.toContainText(key)
  })

  test('revoking a key removes it from the list', async ({ page }) => {
    await gotoSubsonic(page)

    const name = `e2e revoke ${Date.now()}`
    await page.getByRole('button', { name: 'New Key' }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
    await page.getByRole('button', { name: 'Done' }).click()

    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: `Revoke ${name}` }).click()

    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0)
  })
})
