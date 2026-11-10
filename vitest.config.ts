import { defineConfig } from 'vitest/config'

export const include = ['tests/**/*.spec.ts']
export const exclude = ['tests/live.spec.ts']

export default defineConfig({
  test: { include, exclude },
})
