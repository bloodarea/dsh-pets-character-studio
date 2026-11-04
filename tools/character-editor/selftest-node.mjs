// Run the existing browser-independent data suite with its dependencies loaded.
for (const file of ['spine-core.js', 'bundle.js', 'voice.js', 'fixtures/cases.js', 'selftest.js']) {
  await import(new URL(file, import.meta.url))
}
const result = globalThis.__selftestResult
if (!result || result.failed > 0) process.exitCode = 1
console.log(`Character editor: ${result?.passed ?? 0}/${result?.total ?? 0} passed; ${result?.failed ?? 'missing result'} failed`)
