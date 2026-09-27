import { describe, expect, it } from 'vitest'
import { appProofPrompt, gitFact, rootFact, verifyAppProof, type AppProof } from '../src/readiness/app-proof.ts'

const expected: AppProof = {
  challenge: 'TEST_CHALLENGE_MUST_NOT_LEAK', workspaceId: 'workspace-private',
  root: rootFact({ path: '', entries: [{ name: 'z', type: 'dir', sensitive: false }, { name: 'a', type: 'file' }], truncated: false }),
  git: gitFact({ isRepo: true, head: 'head-private', branch: 'branch-private', dirty: true }),
}
const reply = (value: unknown) => '[D2C_APP_PROOF_V1]\n' + JSON.stringify(value)

describe('App proof', () => {
  it('projects only bounded visible directory and Git facts', () => {
    expect(expected.root.firstVisibleEntry).toEqual({ name: 'a', type: 'file' })
    expect(rootFact({ path: '', entries: [], truncated: false }).firstVisibleEntry).toBeNull()
    expect(rootFact({ path: '', entries: Array.from({ length: 500 }, (_, index) => ({ name: String(index), type: 'file' })), truncated: true })).toMatchObject({ visibleEntryCount: 500, truncated: true })
    expect(gitFact({ isRepo: false, head: null, branch: null, dirty: false })).toEqual({ isRepo: false, head: null, branch: null })
    expect(() => gitFact({ isRepo: false, head: 'invalid', branch: null })).toThrow()
    expect(() => rootFact({ path: '', entries: [{ name: 'x', type: 'symlink' }], truncated: false })).toThrow()
  })
  it('accepts matching facts without supplying answers in the prompt', () => {
    expect(verifyAppProof(reply(expected), expected)).toBeUndefined()
    for (const value of [expected.challenge, expected.workspaceId, expected.git.head!, expected.git.branch!]) expect(appProofPrompt).not.toContain(value)
  })
  it.each([
    ['', 'APP_PROOF_REPLY_MISSING'],
    ['[D2C_APP_PROOF_V1]{}', 'APP_PROOF_MALFORMED'],
    [reply(expected) + reply(expected), 'APP_PROOF_MALFORMED'],
    [reply(expected) + '{}', 'APP_PROOF_MALFORMED'],
    ['[D2C_APP_PROOF_V1]{', 'APP_PROOF_MALFORMED'],
    [reply({ ...expected, challenge: 'old' }), 'APP_PROOF_CHALLENGE_MISMATCH'],
    [reply({ ...expected, workspaceId: 'other' }), 'APP_PROOF_WORKSPACE_MISMATCH'],
    [reply({ ...expected, root: { ...expected.root, visibleEntryCount: 8 } }), 'APP_PROOF_ROOT_MISMATCH'],
    [reply({ ...expected, git: { ...expected.git, head: 'other' } }), 'APP_PROOF_GIT_MISMATCH'],
  ])('rejects invalid proof %#', (text, code) => {
    expect(verifyAppProof(text, expected)).toBe(code)
  })
})
