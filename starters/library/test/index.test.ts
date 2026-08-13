import { describe, expect, it } from 'vitest'
import { greet } from '../src/index.js'

describe('greet', () => {
  it('returns a stable greeting', () => expect(greet('Lupinum')).toBe('Hello, Lupinum.'))
})
