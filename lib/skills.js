/**
 * Bundled skills: the persona/work-method skill and the archive-maintenance skill.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const PROVIDER = 'workos'

const SKILLS = [
  {
    name: 'workos-persona',
    file: 'workos-persona.md',
    description:
      'AI 工作助手核心技能：看到【工作上下文】先展开项目、事项、依赖、负责人/涉及人员的打交道经验，用第一人称给出判断、动作、风险与检查点；只依据档案回答，不编造。写回规则见 workos-maintain。',
    whenToUse: '用户带着工作上下文提问、问某件事怎么推进 / 找谁 / 怎么说，或需要基于项目、依赖、人物经验做判断时。',
  },
  {
    name: 'workos-maintain',
    file: 'workos-maintain.md',
    description:
      '工作助手的信息维护：自动判断对话属于哪个项目/事项（没有就补建），把一次变更的前因、事件、结果与关联写成一条日志，补联系人、写日报周报；只依据事实，不写流水账。',
    whenToUse: '每轮对话结束后归档时，或用户提到事情有新进展 / 处理结果 / 新联系人 / 新制度与资源时。',
  },
]

export function registerSkills(ctx, assetsDir) {
  const provider = {
    name: PROVIDER,
    async list() {
      return SKILLS.map(skill => ({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: PROVIDER,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: assetsDir },
        rank: 600,
        locator: { file: skill.file },
      }))
    },
    async get(candidate) {
      const file = candidate?.locator?.file || SKILLS.find(skill => skill.name === candidate?.name)?.file
      if (!file) return undefined
      const skill = SKILLS.find(item => item.file === file)
      if (!skill) return undefined
      return {
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: PROVIDER,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: assetsDir },
        content: await readFile(join(assetsDir, file), 'utf8'),
      }
    },
  }
  ctx.skills.registerProvider(() => provider)
}
