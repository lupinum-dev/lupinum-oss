// Tests the docs site's Vercel "Ignored Build Step" from the library starter.
// Exit 0 skips the build, exit 1 builds.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../starters/_shared/library/docs/scripts/vercel-ignore.mjs', import.meta.url))

test('docs build runs only when the docs changed since the last build of the branch', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'vercel-ignore-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const git = (cwd, ...args) => {
    const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const origin = join(dir, 'origin')
  await mkdir(join(origin, 'docs'), { recursive: true })
  await mkdir(join(origin, 'src'))
  git(origin, 'init', '-q', '-b', 'main')
  // GitHub serves any commit by its SHA; a local remote needs this switched on.
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  const commit = async (file, text) => {
    await writeFile(join(origin, file), text)
    git(origin, 'add', '.')
    git(origin, 'commit', '-q', '-m', file)
    return git(origin, 'rev-parse', 'HEAD')
  }
  const main = await commit('docs/index.md', 'docs 1\n')
  git(origin, 'checkout', '-q', '-b', 'feat')
  const srcOnly = await commit('src/a.js', '// 1\n')
  const docsChange = await commit('docs/index.md', 'docs 2\n')
  const srcAgain = await commit('src/a.js', '// 2\n')

  // Vercel's clone: shallow, at the pushed commit, with the remote named origin.
  let clones = 0
  const ignore = (sha, branch, previousSha) => {
    const clone = join(dir, `clone-${clones++}`)
    git(dir, 'init', '-q', clone)
    git(clone, 'remote', 'add', 'origin', `file://${origin}`)
    git(clone, 'fetch', '-q', '--depth=1', 'origin', sha)
    git(clone, 'checkout', '-q', 'FETCH_HEAD')
    const env = { PATH: process.env.PATH, VERCEL_GIT_COMMIT_REF: branch, VERCEL_GIT_COMMIT_SHA: sha, ...(previousSha && { VERCEL_GIT_PREVIOUS_SHA: previousSha }) }
    return spawnSync(process.execPath, [script, '.'], { cwd: join(clone, 'docs'), env }).status
  }

  // The branch changed the docs earlier, and that build exists: the next push without docs changes must not build again.
  assert.equal(ignore(srcAgain, 'feat', docsChange), 0, 'later push without docs changes skips')
  assert.equal(ignore(docsChange, 'feat', srcOnly), 1, 'later push with docs changes builds')
  assert.equal(ignore(srcOnly, 'feat'), 0, 'first push without docs changes skips')
  assert.equal(ignore(srcAgain, 'feat'), 1, 'first push with docs changes builds')
  // The last build is gone (force-push): it may hold a docs change that this push took back, so a clean diff with main proves nothing.
  assert.equal(ignore(srcOnly, 'feat', '0123456789abcdef0123456789abcdef01234567'), 1, 'last build that cannot be fetched builds')
  // "Redeploy" after an env change reuses the deployed commit; skipping it keeps the old env values live.
  assert.equal(ignore(srcAgain, 'feat', srcAgain), 1, 'redeploy of the same commit builds')
  assert.equal(ignore(main, 'main'), 1, 'main without an earlier build builds')
})
