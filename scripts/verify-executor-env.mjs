import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Load only the required credential, without modifying persistent environment.
const envPath = process.argv[2] ?? join(homedir(), '.env')
let key = process.env.DEEPSEEK_API_KEY
if (!key) {
  const source = readFileSync(envPath, 'utf8')
  const match = source.match(/^\s*(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.*?)\s*$/m)
  key = match?.[1]
  if (key?.startsWith('"') || key?.startsWith("'")) {
    const quote = key[0]
    const end = key.lastIndexOf(quote)
    if (end > 0) key = key.slice(1, end)
  } else key = key?.replace(/\s+#.*$/, '').trim()
}
if (!key) throw new Error('DEEPSEEK_API_KEY is missing; no credential value was printed.')
try {
  const response = await fetch('https://api.deepseek.com/models', {
    headers: { Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) {
    console.log(JSON.stringify({ status: 'FAILED', credentialPresent: true, httpStatus: response.status }))
    process.exitCode = 1
  } else {
    const result = await response.json()
    console.log(JSON.stringify({
      status: 'VERIFIED', credentialPresent: true, authentication: 'VERIFIED',
      requestedModelListed: result.data?.some(model => model.id === 'deepseek-flash') ?? false,
      generationSmoke: 'NOT_RUN',
    }))
  }
} catch {
  console.log(JSON.stringify({ status: 'FAILED', credentialPresent: true, reason: 'API request failed; secret-bearing diagnostics suppressed' }))
  process.exitCode = 1
}
