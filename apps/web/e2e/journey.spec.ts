import path from 'node:path'

import { expect, type Page, test } from '@playwright/test'

// The core journey of the roadmap: sign up → upload → watch → like → comment, through the real
// UI of a real deployment (stage, or local dev). It creates a fresh account and one real Stream
// video (a 5 s test pattern), and deletes the video at the end; the account stays, since
// accounts can't be deleted in the MVP.

const CLIP = path.join(import.meta.dirname, 'fixtures', 'clip.mp4')

// The Turnstile widget writes its token into a hidden input once it has passed. A page has one
// widget, and a token is single-use, so wait for a fresh one before every submit.
async function turnstilePassed(page: Page) {
  await expect(
    page.locator('input[name="cf-turnstile-response"]').first(),
    'the Turnstile widget did not pass',
  ).not.toHaveValue('', { timeout: 30_000 })
}

test('sign up → upload → watch → like → comment', async ({ page }) => {
  const run = `e2e${Date.now().toString(36)}`
  const title = `E2E journey ${run}`
  let videoId: string | undefined

  try {
    await test.step('sign up', async () => {
      await page.goto('/signup')
      await page.getByLabel('Email').fill(`${run}@example.com`)
      await page.getByLabel('Password').fill('correct horse battery staple')
      await page.getByLabel('Handle').fill(run)
      await page.getByLabel('Channel name').fill(`E2E ${run}`)
      await turnstilePassed(page)
      await page.getByRole('button', { name: 'Sign up' }).click()
      await expect(page).toHaveURL('/')
      await expect(page.getByRole('link', { name: `E2E ${run}` })).toBeVisible()
    })

    await test.step('upload', async () => {
      await page.goto('/upload')
      await page.locator('input[type="file"]').setInputFiles(CLIP)
      await page.getByLabel('Title').fill(title)
      await turnstilePassed(page)
      const created = page.waitForResponse(
        (res) => res.url().endsWith('/api/videos/uploads') && res.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Upload' }).click()
      const res = await created
      expect(res.status()).toBe(201)
      videoId = ((await res.json()) as { videoId: string }).videoId
      // The bytes went to Stream with tus and the API was told: processing (or already ready).
      await expect(page.getByRole('status')).toContainText(/Stream is processing|is ready/, {
        timeout: 60_000,
      })
    })

    await test.step('wait until Stream has encoded it', async () => {
      // On stage the webhook marks it ready; locally no webhook arrives, so ask Stream with the
      // studio's Re-check (harmless on stage).
      await page.goto('/studio')
      const row = page.getByRole('row').filter({ hasText: title })
      await expect(async () => {
        await page.reload()
        await expect(row).toBeVisible()
        if (await row.getByText('Failed').isVisible()) throw new Error('Stream failed to encode')
        const recheck = row.getByRole('button', { name: 'Re-check' })
        if (await recheck.isVisible()) await recheck.click()
        await expect(row.getByText('Ready')).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 4 * 60_000, intervals: [5_000, 10_000] })
    })

    await test.step('watch', async () => {
      await page.goto(`/watch/${videoId}`)
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
      // The Stream player loads in its iframe (bytes come from Stream's CDN, not our Worker).
      const player = page.locator(`iframe[title="${title}"]`)
      await expect(player).toBeVisible()
      await expect(player).toHaveAttribute('src', /cloudflarestream\.com\/.+\/iframe/)
    })

    await test.step('like', async () => {
      const like = page.getByRole('button', { name: 'Like' })
      await expect(like).toContainText('0')
      await like.click()
      const unlike = page.getByRole('button', { name: 'Unlike' })
      await expect(unlike).toHaveAttribute('aria-pressed', 'true')
      await expect(unlike).toContainText('1')
      // Saved, not just optimistic.
      await page.reload()
      await expect(page.getByRole('button', { name: 'Unlike' })).toContainText('1')
    })

    await test.step('comment', async () => {
      const body = `Nice clip (${run})`
      await page.getByLabel('Add a comment').fill(body)
      await turnstilePassed(page)
      await page.getByRole('button', { name: 'Comment', exact: true }).click()
      await expect(page.getByText(body)).toBeVisible()
      await expect(page.getByRole('heading', { name: '1 comment' })).toBeVisible()
      await page.reload()
      await expect(page.getByText(body)).toBeVisible()
    })
  } finally {
    // Remove the video (Stream and D1) whatever happened, with this session's cookie.
    if (videoId) {
      const res = await page.request.delete(`/api/videos/${videoId}`)
      expect([204, 404]).toContain(res.status())
    }
  }
})
