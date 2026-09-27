import { z } from 'zod'
import { compareDirectoryEntries } from '../workspace/directory-order.ts'

const entrySchema = z.strictObject({ name: z.string(), type: z.enum(['file', 'dir']) })
const rootSchema = z.strictObject({ path: z.literal(''), visibleEntryCount: z.number().int().nonnegative(), truncated: z.boolean(), firstVisibleEntry: entrySchema.nullable() })
const gitSchema = z.strictObject({ isRepo: z.boolean(), head: z.string().nullable(), branch: z.string().nullable() }).refine(value => value.isRepo || value.head === null && value.branch === null)
const proofSchema = z.strictObject({ challenge: z.string().min(1), workspaceId: z.string().min(1), root: rootSchema, git: gitSchema })

export type AppProof = z.infer<typeof proofSchema>

export function rootFact(value: unknown): AppProof['root'] {
  const listing = z.object({ path: z.literal(''), entries: z.array(z.object(entrySchema.shape)), truncated: z.boolean() }).parse(value)
  const entries = [...listing.entries].sort(compareDirectoryEntries)
  return { path: '', visibleEntryCount: entries.length, truncated: listing.truncated, firstVisibleEntry: entries[0] ?? null }
}

export function gitFact(value: unknown): AppProof['git'] {
  return gitSchema.parse(z.object(gitSchema.shape).parse(value))
}

export const appProofPrompt = 'Use the active App. Call workspace_info, list_directory with path "", and git_status. Do not infer or guess values. Return exactly [D2C_APP_PROOF_V1] followed by one JSON object, without code fences or prose, with keys challenge (workspace_info.appProof.challenge), workspaceId, root, git. root has path "", visibleEntryCount (returned entries.length), truncated (returned boolean), firstVisibleEntry (null if empty, otherwise only name and type of the first returned entry; type is file or dir). git has only isRepo, head, branch; use null for missing head/branch. Do not include any other keys.'

export function verifyAppProof(text: string, expected: AppProof): string | undefined {
  const marker = '[D2C_APP_PROOF_V1]'
  const parts = text.split(marker)
  if (parts.length === 1) return 'APP_PROOF_REPLY_MISSING'
  if (parts.length !== 2 || parts[0]!.trim() !== '') return 'APP_PROOF_MALFORMED'
  let proof: AppProof
  try {
    proof = proofSchema.parse(JSON.parse(parts[1]!))
  } catch {
    return 'APP_PROOF_MALFORMED'
  }
  if (proof.challenge !== expected.challenge) return 'APP_PROOF_CHALLENGE_MISMATCH'
  if (proof.workspaceId !== expected.workspaceId) return 'APP_PROOF_WORKSPACE_MISMATCH'
  if (JSON.stringify(proof.root) !== JSON.stringify(expected.root)) return 'APP_PROOF_ROOT_MISMATCH'
  if (JSON.stringify(proof.git) !== JSON.stringify(expected.git)) return 'APP_PROOF_GIT_MISMATCH'
  return undefined
}
