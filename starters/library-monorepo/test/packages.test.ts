import { describe, expect, it } from 'vitest'
import { createItem } from '../packages/{{PACKAGE_1_DIR}}/src/index.js'

describe('package set', () => {
  it('shares one public contract', () => expect(createItem('one', 'One')).toEqual({ id: 'one', label: 'One' }))
})
