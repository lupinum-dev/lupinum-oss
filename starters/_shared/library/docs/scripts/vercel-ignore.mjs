// Vercel "Ignored Build Step": exit 0 skips the build, exit 1 builds.
// Usage in vercel.json: "ignoreCommand": "node scripts/vercel-ignore.mjs <paths that feed the site>"
// Paths are git pathspecs relative to the Root Directory, for example `. ../pnpm-lock.yaml`.
//
// Production compares with the last deployed commit. A preview compares with main, so the
// first push of a branch and force-pushed bot branches are judged too. Vercel clones
// shallowly, so missing commits are fetched; if git still cannot answer, we build.
import { spawnSync } from 'node:child_process'

const paths = process.argv.slice(2)
const git = (...args) => spawnSync('git', args, { stdio: 'ignore' }).status ?? 1
const hasCommit = (ref) => git('cat-file', '-e', `${ref}^{commit}`) === 0
const { VERCEL_ENV, VERCEL_GIT_COMMIT_REF: branch, VERCEL_GIT_PREVIOUS_SHA: previousSha } = process.env

if (!paths.length || !branch) process.exit(1)

let range
// main itself must never be compared with main: that diff is always empty.
if (VERCEL_ENV === 'production' || branch === 'main') {
  if (!previousSha) process.exit(1)
  if (!hasCommit(previousSha)) git('fetch', '--no-tags', '--depth=1', 'origin', previousSha)
  if (!hasCommit(previousSha)) process.exit(1)
  range = [previousSha, 'HEAD']
} else {
  git('fetch', '--no-tags', '--depth=200', 'origin', '+refs/heads/main:refs/remotes/origin/main')
  git('fetch', '--no-tags', '--deepen=200', 'origin', branch)
  // Without the fork point, comparing the two tips could hide a change, so build.
  if (git('merge-base', 'origin/main', 'HEAD') !== 0) process.exit(1)
  range = ['origin/main...HEAD']
}

// git diff --quiet: 0 = no changes (skip), 1 = changes (build), other = error (build).
process.exit(git('diff', '--quiet', ...range, '--', ...paths) === 0 ? 0 : 1)
