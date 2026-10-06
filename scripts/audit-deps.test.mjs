import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { classifyAdvisories } from '../starters/_shared/library/scripts/audit-deps.mjs'

test('only high or critical findings through public importers block', () => {
  const report = JSON.parse(readFileSync(new URL('./fixtures/audit-deps.json', import.meta.url)))
  assert.deepEqual(classifyAdvisories(report, new Set(['.', 'packages__x'])).map(({ title, blocks }) => [title, blocks]), [
    ['Public dependency', true], ['Docs dependency', false], ['Moderate dependency', false],
  ])
  assert.deepEqual(classifyAdvisories(report, new Set()).map(({ blocks }) => blocks), [false, false, false])
})
