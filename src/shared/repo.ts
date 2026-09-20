/**
 * GitHub repository this build is published from.
 *
 * Sparkle's updater is pointed here instead of the upstream repository: pulling
 * an upstream release would replace this fork and silently drop the features it
 * carries. Keep in sync with `scripts/updater.ts`.
 */
export const REPO_SLUG = 'UshioA/Sparkle'

export const REPO_URL = `https://github.com/${REPO_SLUG}`
