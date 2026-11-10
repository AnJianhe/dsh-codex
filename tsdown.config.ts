import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const id = '@goodjin2/dsh-codex'
const root = fileURLToPath(new URL('.', import.meta.url))
const cssPrefix = '\0codex-css:'
const cssSuffix = '.mjs'
const externals = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-primitives',
])

export default defineConfig({
  entry: { client: `${root}lib/src/client/index.js` },
  outDir: `${root}lib`,
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  minify: true,
  clean: false,
  external: [...externals],
  noExternal: (specifier: string) => !externals.has(specifier),
  plugins: [{
    name: 'codex-css-modules',
    resolveId(source: string, importer?: string) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      const emitted = new URL(source, `file://${importer}`).pathname
      const file = existsSync(emitted) ? emitted : emitted.replace('/lib/src/', '/src/')
      return `${cssPrefix}${file}${cssSuffix}`
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(cssPrefix)) return null
      const file = virtualId.slice(cssPrefix.length, -cssSuffix.length)
      this.addWatchFile(file)
      const result = transform({
        filename: basename(file),
        code: await readFile(file),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes: Record<string, string> = {}
      const exported = Object.entries(result.exports ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      for (const [local, value] of exported) classes[local] = value.name
      const css = result.code.toString()
      const tag = `${id}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(css)};`,
        `const tag = ${JSON.stringify(tag)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tag) + ']') === null) {",
        "  const element = document.createElement('style');",
        `  element.dataset.plugin = ${JSON.stringify(id)};`,
        '  element.dataset.pluginCss = tag;',
        '  element.textContent = css;',
        '  document.head.appendChild(element);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    inlineDynamicImports: true,
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    sourcemapPathTransform: (source: string) => isAbsolute(source) ? relative(root, source).replaceAll('\\', '/') : source,
  },
})
