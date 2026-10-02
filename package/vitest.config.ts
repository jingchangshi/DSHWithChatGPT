import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // Windows fixtures spawn real PowerShell ACL checks and Sidecar children.
    // Bound file concurrency instead of extending their security deadlines.
    ...(process.platform === 'win32' ? { maxWorkers: 1 } : {}),
  },
})
