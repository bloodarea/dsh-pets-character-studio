// 内置人物包管理器：Node 侧纯函数自检聚合入口。
// 顺序：先加载模块（track-edit 必须在 pose-tools 之前：pose-tools 复用其 skeletonSignature），
// 再加载各套件；**文件存在即挂载，缺失则跳过并在结果里注明**（P2 起有多个任务并行新增模块）。
const modules = [
  'spine-core.js',
  'bundle.js',
  'bone-edit.js',
  'track-edit.js',
  'pose-tools.js',
  'ik-aim.js',
  'timeline.js',
  'frame-timeline.js',
  'pose-compare.js',
  'key-inspector.js',
  'curve-presets.js',
  'deform-edit.js',
  'anim-markers.js',
  'frame-thumbs.js',
  'audio-wave.js',
  'curve-edit.js',
  'batch-edit.js',
  'keymap.js',
  'anim-edit.js',
  'slot-groups.js',
  'event-names.js',
  'voice.js',
  'fixtures/cases.js',
]
const suiteFiles = [
  'selftest.js',
  'selftest-anim.js',
  'selftest-slotgroups.js',
  'selftest-boneedit.js',
  'selftest-trackedit.js',
  'selftest-posetools.js',
  'selftest-ikaim.js',
  'selftest-timeline.js',
  'selftest-frametimeline.js',
  'selftest-posecompare.js',
  'selftest-keyinspector.js',
  'selftest-curvepresets.js',
  'selftest-deformedit.js',
  'selftest-animmarkers.js',
  'selftest-framethumbs.js',
  'selftest-audiowave.js',
  'selftest-curveedit.js',
  'selftest-batchedit.js',
  'selftest-keymap.js',
  'selftest-eventnames.js',
]
const missing = []
for (const file of modules.concat(suiteFiles)) {
  try {
    await import(new URL(file, import.meta.url))
  } catch (err) {
    missing.push(file + '（' + (err && err.message ? err.message.split('\n')[0] : '加载失败') + '）')
  }
}
const SUITES = [
  ['core', globalThis.__selftestResult],
  ['anim', globalThis.__selftestAnimResult],
  ['slot-groups', globalThis.__selftestSlotGroupsResult],
  ['bone-edit', globalThis.__selftestBoneEditResult],
  ['track-edit', globalThis.__selftestTrackEditResult],
  ['pose-tools', globalThis.__selftestPoseToolsResult],
  ['ik-aim', globalThis.__selftestIkAimResult],
  ['timeline', globalThis.__selftestTimelineResult],
  ['frame-timeline', globalThis.__selftestFrameTimelineResult],
  ['pose-compare', globalThis.__selftestPoseCompareResult],
  ['key-inspector', globalThis.__selftestKeyInspectorResult],
  ['curve-presets', globalThis.__selftestCurvePresetsResult],
  ['deform-edit', globalThis.__selftestDeformEditResult],
  ['anim-markers', globalThis.__selftestAnimMarkersResult],
  ['frame-thumbs', globalThis.__selftestFrameThumbsResult],
  ['audio-wave', globalThis.__selftestAudioWaveResult],
  ['curve-edit', globalThis.__selftestCurveEditResult],
  ['batch-edit', globalThis.__selftestBatchEditResult],
  ['keymap', globalThis.__selftestKeymapResult],
  ['event-names', globalThis.__selftestEventNamesResult],
]
const absent = []
let passed = 0
let failed = 0
let total = 0
const parts = []
for (const [name, suite] of SUITES) {
  if (!suite) {
    absent.push(name)
    parts.push(name + ' 未加载')
    continue
  }
  passed += suite.passed ?? 0
  failed += suite.failed ?? 0
  total += suite.total ?? 0
  parts.push(`${name} ${suite.passed ?? 0}/${suite.total ?? 0}`)
}
if (absent.length || failed > 0) process.exitCode = 1
console.log(`Character editor: ${passed}/${total} passed; ${failed} failed`)
console.log('  suites: ' + parts.join(', '))
if (absent.length) console.log('  suites not loaded (file missing): ' + absent.join(', '))
if (missing.length) console.log('  files not loaded: ' + missing.join('; '))
for (const [name, suite] of SUITES) {
  if (!suite || !suite.failed) continue
  for (const f of suite.failures || []) console.log(`  FAIL [${name}] ${f.case || ''} ${f.name || ''} expected=${JSON.stringify(f.expected ?? null)} actual=${JSON.stringify(f.actual ?? null)}`)
}