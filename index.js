/**
 * Character Studio 的 Host 入口：把制作技能注册进 Agent 技能目录。
 *
 * 网页制作工具可独立启动，不依赖 DSH；安装 Cordis bundle 后，内置的
 * `skills/<name>/SKILL.md` 会出现在技能目录中。桌宠运行由 dsh-pets 单独负责。
 *
 * 注册形态（CONTRIBUTING 的内置技能约定）：
 * 激活时读取 `skills/` 下每个直接子项（目录 bundle 或扁平 `.md`），调用
 * `ctx.skills.register()` 注册成进程内 `runtime` provider。刻意不依赖
 * `@deepseek-ai/dsh-skill-filesystem`：本仓以 `link:` 方式装进 profile，链接目录
 * 没有自己的 node_modules，引入该包会让插件在零安装的 checkout 里无法激活。
 *
 * 代价：SKILL.md 在插件激活时读取一次；改完正文/描述后需要重载该插件行或重启
 * Harness。技能数量增加后若需要热更新，再按 CONTRIBUTING §5b 的形态一换成
 * `FileSystemSkillProvider`（届时把依赖装进本包）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Loader 行 id / 包名，与 cordis.patch.yml 保持一致。 */
export const name = 'dsh-pets-character-studio'
/** 没有 skills 服务时插件不激活：注册技能是本入口的唯一职责。 */
export const inject = ['skills']

/** 本包内置技能根；`import.meta.url` 保证在 pnpm 链接、虚拟 store 或源码 checkout 下都正确。 */
const SKILLS_DIR = fileURLToPath(new URL('./skills/', import.meta.url))
/** 技能名语法（kebab-case），与 `@deepseek-ai/dsh-skill` 的 isSkillName 一致。 */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u
const YAML_BOOLEANS = new Map([
  ['true', true], ['yes', true], ['on', true], ['1', true],
  ['false', false], ['no', false], ['off', false], ['0', false],
])

/** 一条内置技能在加载期就失败时，用统一前缀区分是本插件抛出的。 */
function fail(message) {
  throw new Error(`dsh-pets-character-studio: ${message}`)
}

/**
 * 解析 frontmatter 里的单行标量。
 * 本仓的技能清单只用单行 `key: value`；遇到多行块（`|` / `>`）或空值宁可报错，
 * 也不猜一个可能截断的描述。
 */
function parseScalar(raw, key) {
  const value = raw.trim()
  if (value === '' || value === '>' || value === '|' || value === '>-' || value === '|-') {
    fail(`frontmatter 字段 ${key} 暂不支持多行或空值（内置注册器只解析单行标量）`)
  }
  const quoted = (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  return quoted ? value.slice(1, -1) : value
}

/** 解析严格布尔值；拼错时整条技能失败，避免"看起来允许但实际没生效"。 */
function parseBoolean(fields, key) {
  if (!(key in fields)) return undefined
  const raw = parseScalar(fields[key], key).toLowerCase()
  if (!YAML_BOOLEANS.has(raw)) fail(`frontmatter 字段 ${key} 只接受布尔值（true/false/yes/no/on/off/1/0）`)
  return YAML_BOOLEANS.get(raw)
}

/**
 * 拆出 YAML frontmatter 与 Markdown 正文。
 * `---` 必须是文件首行；字段只按首个冒号切分，因此中文全角冒号不影响解析。
 */
function parseFrontmatter(text, file) {
  const match = FRONTMATTER.exec(text)
  if (match === null) fail(`${file} 缺少 YAML frontmatter（首行必须是 ---）`)

  const fields = Object.create(null)
  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (/^\s/u.test(line)) fail(`${file} 的 frontmatter 含嵌套字段；内置注册器只支持平铺的 key: value`)
    const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line)
    if (field === null) fail(`${file} 的 frontmatter 行无法解析：${line}`)
    fields[field[1]] = field[2]
  }

  return { fields, body: text.slice(match[0].length).trim() }
}

/** 读取并校验一个技能文件，产出 `ctx.skills.register()` 需要的注册对象。 */
function readSkill(file, resourceDir) {
  const { fields, body } = parseFrontmatter(readFileSync(file, 'utf8'), file)

  if (!('name' in fields)) fail(`${file} 缺少必填字段 name`)
  const skillName = parseScalar(fields.name, 'name')
  if (!KEBAB_CASE.test(skillName)) fail(`${file} 的 name 必须是 kebab-case，实际为 ${JSON.stringify(skillName)}`)

  if (!('description' in fields)) fail(`${file} 缺少必填字段 description`)
  const description = parseScalar(fields.description, 'description')

  const whenToUse = 'whenToUse' in fields ? parseScalar(fields.whenToUse, 'whenToUse') : undefined
  const disableModelInvocation = parseBoolean(fields, 'disable-model-invocation')
  const userInvocable = parseBoolean(fields, 'user-invocable')

  return {
    path: file,
    name: skillName,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    /** 随包分发：与项目级/用户级技能区分开，避免误判来源。 */
    source: 'bundled',
    provider: name,
    /** `references/` 等相对资源按技能目录解析。 */
    resourceBase: { kind: 'directory', path: resourceDir },
    content: body,
    invocation: {
      modelInvocable: disableModelInvocation !== true,
      userInvocable: userInvocable !== false,
    },
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * 扫描 `skills/` 的直接子项：`<name>/SKILL.md` 目录 bundle 或扁平的 `<name>.md`。
 * 与 `dsh-skill-filesystem` 一致，不递归。单条技能解析失败只告警并跳过，
 * 不让一个坏文件拖垮整批内置技能。
 */
function readBundledSkills(log) {
  let entries
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
  } catch (error) {
    log(`skills 目录不可读（${SKILLS_DIR}）：${String(error?.message ?? error)}`)
    return []
  }

  const skills = []
  const owners = new Map()
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue

    let file
    let resourceDir
    if (entry.isDirectory()) {
      file = join(SKILLS_DIR, entry.name, 'SKILL.md')
      resourceDir = join(SKILLS_DIR, entry.name)
      if (!isFile(file)) continue
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      file = join(SKILLS_DIR, entry.name)
      resourceDir = SKILLS_DIR
    } else {
      continue
    }

    let skill
    try {
      skill = readSkill(file, resourceDir)
    } catch (error) {
      log(String(error?.message ?? error))
      continue
    }

    const owner = owners.get(skill.name)
    if (owner !== undefined) {
      log(`技能名重复：${skill.name}（${owner} 与 ${file}），已跳过后者`)
      continue
    }
    owners.set(skill.name, file)
    skills.push(skill)
  }
  return skills
}

/** 插件入口。每个技能注册成一个 effect，插件卸载/重载时随 lifecycle 一起注销。 */
export function apply(ctx) {
  const log = (message) => {
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
    else console.warn(message)
  }

  for (const skill of readBundledSkills(log)) {
    ctx.effect(() => ctx.skills.register(skill), `dsh-pets-character-studio: skill ${skill.name}`)
  }
}
