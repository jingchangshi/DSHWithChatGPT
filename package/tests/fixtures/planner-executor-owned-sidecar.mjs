import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { recordTargetPointer } from '../../scripts/planner-executor-owned-sidecar.mjs'

const [entry, pointer] = process.argv.slice(2)
assert.ok(entry && path.isAbsolute(entry) && pointer && path.isAbsolute(pointer))
// Runtime supplies either the original explicit ID or its trusted replacement ID.
// Import in this process so the actual supervisor owns the actual native child.
await recordTargetPointer(pointer, process.env.PLANNERBRIDGE_SIDECAR_TARGET_ID)
await import(pathToFileURL(entry).href)
