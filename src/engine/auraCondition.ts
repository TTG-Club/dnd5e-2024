/**
 * Условие ауры — запись, которой аура чужой фишки лежит на накрытом.
 *
 * Аура с флагами лежит на каждом, до кого достаёт, эффектом в его
 * `activeEffects` (id с префиксом `aura_cond_`): ведёт запись ядро, а читает
 * система. С VTTG 0.9.601 ядро переносит в неё эффект ауры ЦЕЛИКОМ и пишет
 * носителя ауры наложившим (`sourceActorId`) — раньше в записи были только имя,
 * значок, числа и флаги, и флаг «помеха исчадиям, которые бьют по носителю»
 * («Ореол») действовал на любого в ауре и по любой цели: условие броска и
 * наложивший терялись.
 *
 * Целый эффект накрытому не нужен и вреден. Та же аура приходит системе ещё и
 * списком аур (`resolveAmbientEffects` на сервере, стор аур на клиенте), и всё,
 * что исполняется по обоим спискам, сработало бы дважды: срабатывания на ходу —
 * один раз как эффект носителя, второй как аура. А что читается только с самой
 * сущности, появилось бы у накрытого зря: кнопка переключателя чужого умения,
 * свет, цена, право переброса.
 *
 * Поэтому условие остаётся ПАССИВНЫМ: числа, флаги и то, что решает, когда они
 * действуют. Всё исполняемое система берёт из списка аур, как и раньше.
 *
 * @module system/dnd/auraCondition
 */

import type { ActiveEffect } from './activeEffectTypes.js';

/**
 * Поля эффекта, которые условие ауры несёт накрытому.
 *
 * Служебные (`id` … `duration`) ставит ядро. Остальное — пассивное: числа и
 * флаги, условия, при которых они действуют (`rollCondition`; условия строк
 * лежат в самих `changes`), наложивший для условий «цель — носитель ауры»,
 * состояние и иммунитеты «пока в ауре», метка и правило сложения одноимённых.
 */
export const AURA_CONDITION_CARRIED_FIELDS = [
  'id',
  'name',
  'description',
  'icon',
  'disabled',
  'origin',
  'transfer',
  'duration',
  'sourceActorId',
  'sourceCreatureType',
  'changes',
  'flags',
  'rollCondition',
  'conditionKey',
  'conditionImmunities',
  'suppressConditions',
  'tag',
  'stackable',
] as const satisfies readonly (keyof ActiveEffect)[];

/**
 * Поля эффекта, которые в условие ауры не идут: исполняемое (срабатывания,
 * повторный урон и спасбросок, спасбросок и урон наложения, расход на атаке,
 * правило каста), органы управления и их состояние (применение, цена, заряды,
 * право переброса, варианты, ступени, «вырваться»), свет, поля излучения и
 * привязки эффекта к своему носителю, касту и зоне.
 *
 * Список нужен проверке: новое поле эффекта обязано попасть либо сюда, либо в
 * {@link AURA_CONDITION_CARRIED_FIELDS} — иначе о нём никто бы не решил.
 */
export const AURA_CONDITION_DROPPED_FIELDS = [
  'originId',
  'aura',
  'areaTrigger',
  'areaChoice',
  'effectTarget',
  'magical',
  'endsWithAreaId',
  'endsOnExitAreaId',
  'tagStacks',
  'landingCondition',
  'variant',
  'activation',
  'pay',
  'paid',
  'castId',
  'castLevel',
  'conditionLocked',
  'charges',
  'saveOverride',
  'light',
  'savedRoll',
  'savedRollValue',
  'carriedItemId',
  'durationFormula',
  'concentration',
  'applySave',
  'applyOnSuccess',
  'applyOnSuccessOnly',
  'consumeOn',
  'damageParts',
  'recurringSave',
  'recurringDamage',
  'triggers',
  'exhaustionLevel',
  'escape',
  'turnCurrent',
  'castRule',
  'stages',
  'stageIndex',
] as const satisfies readonly (keyof ActiveEffect)[];

/**
 * Оставляет в условии ауры только то, что действует у накрытого: числа, флаги
 * и их условия. Чистая и дешёвая — ядро зовёт её на каждой сверке аур для
 * каждого накрытого.
 *
 * @param condition - условие, собранное ядром из эффекта ауры
 * @returns условие для `activeEffects` накрытого
 */
export function shapeAuraCondition(condition: ActiveEffect): ActiveEffect {
  const {
    icon,
    sourceActorId,
    sourceCreatureType,
    rollCondition,
    conditionKey,
    conditionImmunities,
    suppressConditions,
    tag,
    stackable,
  } = condition;

  return {
    id: condition.id,
    name: condition.name,
    description: condition.description,
    disabled: condition.disabled,
    origin: condition.origin,
    transfer: condition.transfer,
    duration: condition.duration,
    changes: condition.changes,
    flags: condition.flags,
    ...(icon === undefined ? {} : { icon }),
    ...(sourceActorId === undefined ? {} : { sourceActorId }),
    ...(sourceCreatureType === undefined ? {} : { sourceCreatureType }),
    ...(rollCondition === undefined ? {} : { rollCondition }),
    ...(conditionKey === undefined ? {} : { conditionKey }),
    ...(conditionImmunities === undefined ? {} : { conditionImmunities }),
    ...(suppressConditions === undefined ? {} : { suppressConditions }),
    ...(tag === undefined ? {} : { tag }),
    ...(stackable === undefined ? {} : { stackable }),
  };
}
