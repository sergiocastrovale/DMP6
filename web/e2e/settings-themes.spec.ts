import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The accent theme (Settings → Themes) is a localStorage-only preference that re-colours the app by
// redefining the amber ramp on <html> (assets/css/themes.css). These specs check the three things
// unit tests can't: that the attribute actually reaches the document, that the rendered colour
// really changes, and that it survives a full reload with no flash of the default palette.

const gotoThemes = async (page: Page) => {
  await page.goto('/settings/themes')
  await expect(page.getByRole('heading', { name: 'Theme', exact: true })).toBeVisible()
}

const accentColour = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-amber-400').trim())

test.describe('settings themes', () => {
  test('offers one swatch per theme, amber active by default', async ({ page }) => {
    await gotoThemes(page)

    for (const label of ['Amber', 'Green', 'Cyan', 'Violet', 'Rose']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Amber' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('picking a theme repaints the accent and survives a reload', async ({ page }) => {
    await gotoThemes(page)
    const amberAccent = await accentColour(page)

    await page.getByRole('button', { name: 'Violet' }).click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'violet')
    const violetAccent = await accentColour(page)
    expect(violetAccent).not.toBe(amberAccent)

    // The inline head script in nuxt.config.ts re-applies the stored theme before first paint, so
    // the attribute is already correct on load rather than being set after hydration.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'violet')
    expect(await accentColour(page)).toBe(violetAccent)
    await expect(page.getByRole('button', { name: 'Violet' })).toHaveAttribute('aria-pressed', 'true')

    // Leave the suite on the default so a later run/spec isn't inheriting a themed app.
    await page.getByRole('button', { name: 'Amber' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber')
  })

  test('the theme applies on every page, not just the settings one', async ({ page }) => {
    await gotoThemes(page)
    await page.getByRole('button', { name: 'Rose' }).click()
    const roseAccent = await accentColour(page)

    await page.goto('/browse')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'rose')
    expect(await accentColour(page)).toBe(roseAccent)

    await gotoThemes(page)
    await page.getByRole('button', { name: 'Amber' }).click()
  })
})
