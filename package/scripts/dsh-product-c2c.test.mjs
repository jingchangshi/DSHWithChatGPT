import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../../', import.meta.url).pathname.replace(/^\//, '').replaceAll('/', '\\\\')
const setup = await readFile(join(root, 'scripts', 'prepare-dsh-c2c.ps1'), 'utf8')
const launch = await readFile(join(root, 'scripts', 'launch-dsh-c2c.ps1'), 'utf8')
assert.match(setup, /product-c2c/)
assert.match(setup, /secrets\.dpapi\.json/)
assert.match(setup, /ConvertFrom-SecureString/)
assert.match(setup, /CONTROL_PLANE_TUNNEL_ID/)
assert.match(setup, /CONTROL_PLANE_API_KEY/)
assert.doesNotMatch(setup, /c2c-launcher/)
assert.doesNotMatch(setup, /auth\.json|cookie|session storage/i)
assert.match(launch, /prepare-dsh-c2c\.ps1/)
assert.match(launch, /product-c2c/)
assert.match(launch, /C2C_DSH_CLI/)
assert.doesNotMatch(launch, /codex\.exe/i)
assert.doesNotMatch(launch, /CODEX_NOT_FOUND/)
console.log('DSH product C2C setup tests passed')
