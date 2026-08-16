import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const profiles = [
  {
    name: 'library',
    workflow: new URL('../starters/library/.github/workflows/publish.yml', import.meta.url),
    packages: ['@lupinum/example'],
  },
  {
    name: 'library-monorepo',
    workflow: new URL('../starters/library-monorepo/.github/workflows/publish.yml', import.meta.url),
    packages: ['@lupinum/alpha', '@lupinum/beta', '@lupinum/gamma'],
  },
]

for (const profile of profiles) {
  const workflow = readFileSync(profile.workflow, 'utf8').replaceAll(
    '{{PACKAGE_NAME}}',
    profile.packages[0],
  )
  const match = /node --input-type=module <<'NODE'\n([\s\S]*?)\n\s+NODE/.exec(workflow)
  assert(match, `${profile.name} publish workflow has no inline publication program.`)
  const program = dedent(match[1])

  runScenario(profile, program, 'matching bootstrap bytes', {
    bootstrapPackages: profile.packages,
    existing: profile.packages,
    expectedPublishes: 0,
  })
  runScenario(profile, program, 'bootstrap waits for registry visibility', {
    bootstrapPackages: profile.packages,
    delayedVisibility: profile.packages[0],
    existing: profile.packages,
    expectedPublishes: 0,
  })
  runScenario(profile, program, 'missing packages use OIDC', {
    existing: [],
    expectedPublishes: profile.packages.length,
  })
  if (profile.packages.length > 1) {
    runScenario(profile, program, 'mixed package sets recover safely', {
      bootstrapPackages: profile.packages.slice(0, 1),
      existing: profile.packages.slice(0, 1),
      expectedPublishes: profile.packages.length - 1,
    })
  }
  runScenario(profile, program, 'different bytes fail', {
    existing: profile.packages,
    differentBytes: profile.packages[0],
    expectedError: 'exists with different bytes',
  })
  runScenario(profile, program, 'wrong dist-tags fail', {
    existing: profile.packages,
    attested: profile.packages,
    wrongTag: profile.packages.at(-1),
    expectedError: 'did not expose the required bytes',
  })
  runScenario(profile, program, 'later provenance-free versions fail', {
    bootstrapPackages: profile.packages,
    existing: profile.packages,
    extraVersion: profile.packages[0],
    expectedError: 'is not the first package version and has no provenance',
  })
  runScenario(profile, program, 'bootstrap status is rechecked', {
    bootstrapPackages: profile.packages,
    existing: profile.packages,
    laterVersionDuringVerification: profile.packages[0],
    expectedError: 'did not expose the required bytes',
  })
  runScenario(profile, program, 'bootstrap requires explicit authorization', {
    existing: profile.packages,
    expectedError: 'requires explicit bootstrap authorization',
  })
  runScenario(profile, program, 'new provenance-free publications fail', {
    existing: [],
    publishProvenance: false,
    expectedError: 'did not expose the required bytes',
  })
}

process.stdout.write('Starter publish recovery policy verified.\n')

function runScenario(profile, program, scenario, options) {
  const root = mkdtempSync(join(tmpdir(), `lupinum-${profile.name}-publish-`))
  try {
    const releaseDir = join(root, 'release-artifacts')
    const binDir = join(root, 'bin')
    mkdirSync(releaseDir)
    mkdirSync(binDir)
    const version = '1.0.0'
    const packages = profile.packages.map(name => {
      const filename = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
      const packageRoot = join(root, 'tar', name.replaceAll('/', '-'))
      mkdirSync(join(packageRoot, 'package'), { recursive: true })
      writeFileSync(join(packageRoot, 'package', 'package.json'), JSON.stringify({ name, version }))
      const packed = spawnSync('tar', ['-czf', join(releaseDir, filename), 'package'], {
        cwd: packageRoot,
        encoding: 'utf8',
      })
      assert(packed.status === 0, packed.stderr || `Could not create ${filename}.`)
      const bytes = readFileSync(join(releaseDir, filename))
      return {
        name,
        version,
        filename,
        shasum: createHash('sha1').update(bytes).digest('hex'),
      }
    })
    const record = profile.name === 'library'
      ? { ...packages[0], distTag: 'latest' }
      : { version, distTag: 'latest', packages }
    writeFileSync(join(releaseDir, 'release.json'), JSON.stringify(record))

    const existing = new Set(options.existing)
    const attested = new Set(options.attested ?? [])
    const registry = Object.fromEntries(packages.map(pkg => {
      if (!existing.has(pkg.name)) return [pkg.name, null]
      const versions = [version]
      if (options.extraVersion === pkg.name) versions.push('1.0.1')
      return [pkg.name, {
        versions,
        visibilityViews: 0,
        visibleAfter: options.delayedVisibility === pkg.name ? 3 : 0,
        versionViews: 0,
        addLaterVersion: options.laterVersionDuringVerification === pkg.name,
        tags: { latest: options.wrongTag === pkg.name ? '0.9.0' : version },
        releases: {
          [version]: {
            shasum: options.differentBytes === pkg.name ? '0'.repeat(40) : pkg.shasum,
            attestations: attested.has(pkg.name) ? { url: 'https://registry.example/provenance' } : null,
          },
        },
      }]
    }))
    const statePath = join(root, 'registry.json')
    writeFileSync(statePath, JSON.stringify({
      packages: registry,
      tarballs: Object.fromEntries(packages.map(pkg => [pkg.filename, pkg])),
      publishProvenance: options.publishProvenance !== false,
      publishes: [],
    }))
    const npmPath = join(binDir, 'npm')
    writeFileSync(npmPath, fakeNpmProgram())
    chmodSync(npmPath, 0o755)
    const runnerPath = join(root, 'publish.mjs')
    writeFileSync(runnerPath, program)
    const outputPath = join(root, 'output.txt')
    const result = spawnSync(process.execPath, [runnerPath], {
      cwd: releaseDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        ALLOW_BOOTSTRAP: profile.name === 'library' && options.bootstrapPackages?.includes(profile.packages[0]) ? 'true' : 'false',
        BOOTSTRAP_PACKAGES: profile.name === 'library-monorepo' ? (options.bootstrapPackages ?? []).join(',') : '',
        PATH: `${binDir}:${process.env.PATH}`,
        FAKE_NPM_STATE: statePath,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
        RELEASE_VERSION: version,
        REGISTRY_POLL_ATTEMPTS: '5',
        REGISTRY_POLL_DELAY_MS: '0',
      },
    })
    const diagnostic = `${result.stdout}\n${result.stderr}`
    if (options.expectedError) {
      assert(result.status !== 0, `${profile.name}: ${scenario} unexpectedly succeeded.`)
      assert(
        diagnostic.includes(options.expectedError),
        `${profile.name}: ${scenario} failed for the wrong reason: ${diagnostic}`,
      )
      return
    }
    assert(result.status === 0, `${profile.name}: ${scenario} failed: ${diagnostic}`)
    const modes = Object.fromEntries(profile.packages.map(name => [
      name,
      existing.has(name) ? (attested.has(name) ? 'oidc' : 'bootstrap') : 'oidc',
    ]))
    const bootstrapPackages = Object.entries(modes)
      .filter(([, mode]) => mode === 'bootstrap')
      .map(([name]) => name)
    const output = readFileSync(outputPath, 'utf8')
    assert(output.includes(`modes=${JSON.stringify(modes)}`), `${profile.name}: wrong mode evidence.`)
    assert(
      output.includes(`bootstrap-packages=${bootstrapPackages.join(',')}`),
      `${profile.name}: wrong bootstrap package evidence.`,
    )
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert(
      state.publishes.length === options.expectedPublishes,
      `${profile.name}: ${scenario} published the wrong package count.`,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function dedent(value) {
  const lines = value.split('\n')
  const indentation = Math.min(...lines.filter(Boolean).map(line => line.match(/^\s*/)[0].length))
  return lines.map(line => line.slice(indentation)).join('\n')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function fakeNpmProgram() {
  return `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const statePath = process.env.FAKE_NPM_STATE
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const args = process.argv.slice(2)
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
const output = value => process.stdout.write(JSON.stringify(value) + '\\n')
if (args[0] === 'view') {
  const spec = args[1]
  const field = args[2]
  const match = /^(@[^/]+\\/[^@]+)@(.+)$/.exec(spec)
  const name = match ? match[1] : spec
  const version = match?.[2]
  const pkg = state.packages[name]
  if (pkg && pkg.visibilityViews < pkg.visibleAfter) {
    pkg.visibilityViews += 1
    save()
    process.stderr.write('E404 404 Not Found\\n')
    process.exit(1)
  }
  const release = version ? pkg?.releases?.[version] : null
  let value
  if (field === 'dist.shasum') value = release?.shasum
  else if (field === 'dist.attestations') value = release?.attestations
  else if (field === 'versions') {
    if (pkg?.addLaterVersion && pkg.versionViews > 0 && !pkg.versions.includes('1.0.1')) pkg.versions.push('1.0.1')
    if (pkg) pkg.versionViews += 1
    save()
    value = pkg?.versions
  } else if (field.startsWith('dist-tags.')) value = pkg?.tags?.[field.slice('dist-tags.'.length)]
  if (value === undefined || value === null) {
    process.stderr.write('E404 404 Not Found\\n')
    process.exit(1)
  }
  output(value)
  process.exit(0)
}
if (args[0] === 'publish') {
  const filename = path.basename(args[1])
  const tarball = state.tarballs[filename]
  if (!tarball) throw new Error('Unknown tarball: ' + filename)
  const tag = args[args.indexOf('--tag') + 1]
  state.packages[tarball.name] = {
    versions: [tarball.version],
    versionViews: 0,
    addLaterVersion: false,
    tags: { [tag]: tarball.version },
    releases: {
      [tarball.version]: {
        shasum: tarball.shasum,
        attestations: state.publishProvenance ? { url: 'https://registry.example/provenance' } : null,
      },
    },
  }
  state.publishes.push(tarball.name)
  save()
  process.exit(0)
}
throw new Error('Unsupported fake npm command: ' + args.join(' '))
`
}
