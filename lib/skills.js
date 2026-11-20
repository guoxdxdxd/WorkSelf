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
      'AI 工作助手核心技能：看到【工作上下文】先展开项目、事项、依赖、负责人/涉及人员的打交道经验，用第一人称给出判断、动作、风险与检查点；每轮对话自动把内容归到项目/事项并把事实、决定、日志、经验写回工作档案；对话里出现新联系人时先问清资料再补进联系人。',
    whenToUse: '用户带着工作上下文提问、问某件事怎么推进/找谁/怎么说，或对话里出现新事实、决定、状态变化需要归档，或出现没见过的负责人/涉及人员/沟通对象时。',
  },
  {
    name: 'workos-maintain',
    file: 'workos-maintain.md',
    description:
      '工作助手的信息维护：自动判断对话属于哪个项目/事项（没有就补建），把一次变更的前因、事件、结果与关联写成一条日志（不写流水账、重复条目），发现新联系人先问清资料再入库，并提炼某人的打交道经验、通用经验写进档案。',
    whenToUse: '每轮对话结束后归档时，或用户提到某个人做了什么、事情有新进展或处理结果、出现新联系人、出现新制度/资源/组织变化时。',
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
