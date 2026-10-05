/**
 * Вид атаки «рукопашная или дальнобойная» на стороне клиента: вопрос
 * бросающему перед броском и строка чата о выбранном виде.
 *
 * Что считается возможным и как выглядит атака выбранным видом, решает
 * движок (`attackKind.ts`); здесь — то, что требует сцены, плашки и чата.
 */

import type {
  AttackKind,
  CreatureAction,
  DnDGameItem,
  EffectVariantChoices,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useTargetStore } from '@/stores/targetStore';
import { generateId } from '@vtt/shared';
import {
  listCreatureActionAttackKinds,
  listReachableCreatureActionAttackKinds,
  listReachableWeaponAttackKinds,
  listWeaponAttackKinds,
  withCreatureActionAttackKind,
  withMeleeReachBonus,
  withWeaponAttackKind,
} from '@vtt/shared/system/dnd.js';

import {
  WEAPON_ATTACK_KIND_CHAT_LABELS,
  WEAPON_ATTACK_KIND_LABELS,
} from '../ui/actor/constants';
import {
  CREATURE_ATTACK_KIND_CHAT_LABELS,
  CREATURE_ATTACK_KIND_LABELS,
} from '../ui/creature/constants';
import {
  ATTACK_KIND_MODAL_KEY_PREFIX,
  ATTACK_KIND_PROMPT_LABELS,
  EFFECT_VARIANT_PROMPT_MODAL,
} from '../ui/effect/constants';
import { runWithEffectVariants } from './effectVariantChoice';
import { measureTokenDistanceOnScene } from './useSceneRangeCheck';
import { useWorldEntities } from './useWorldEntities';

/** Как спросить и применить вид атаки у конкретного источника */
interface AttackKindSetup<Source> {
  /** Какими видами источник вообще атакует */
  kinds: readonly AttackKind[];
  /** Какими видами цель достаётся с этого расстояния */
  listReachable: (distance: number) => readonly AttackKind[];
  /** Источник, атакующий выбранным видом */
  apply: (kind: AttackKind) => Source;
  /** Варианты вопроса */
  promptLabels: Record<AttackKind, string>;
  /** Выбранный вид в строке чата */
  chatLabels: Record<AttackKind, string>;
}

/**
 * Расстояние от атакующего до выбранной цели на сцене.
 *
 * @param attackerId - id атакующего (персонажа или существа)
 * @returns расстояние в единицах сцены либо `undefined` — цели или сцены нет
 */
function measureDistanceToTarget(
  attackerId: string | undefined,
): number | undefined {
  const targetTokenId = useTargetStore().targetTokenId;

  if (!attackerId || !targetTokenId) {
    return undefined;
  }

  return measureTokenDistanceOnScene(attackerId, targetTokenId)?.distance;
}

/**
 * Выполняет атаку выбранным видом. Источник с одним видом идёт сразу. С
 * двумя: если цель выбрана и достаётся только одним видом (за досягаемостью
 * — только дальнобойной), он берётся без вопроса; иначе бросающий выбирает
 * плашкой — той же, что у вариантов эффектов. Закрытая без выбора плашка
 * отменяет атаку. Цель вне обеих дальностей — атака идёт дальнобойной, и
 * обычная проверка расстояния скажет «вне досягаемости».
 *
 * В чат уходит выбранный вид: иначе по итогу броска не понять, ударил
 * гоблин копьём или бросил его.
 *
 * @param source - оружие или действие существа
 * @param setup - виды источника, подписи и применение вида
 * @param attackerId - id атакующего, от чьих токенов меряется расстояние
 * @param proceed - продолжение с источником выбранного вида
 */
function runWithAttackKind<Source extends { name: string }>(
  source: Source,
  setup: AttackKindSetup<Source>,
  attackerId: string | undefined,
  proceed: (chosen: Source) => void,
): void {
  const lastKind = setup.kinds.at(-1);

  if (setup.kinds.length < 2 || !lastKind) {
    proceed(source);

    return;
  }

  const finish = (kind: AttackKind, byDistance: boolean): void => {
    useChatStore().sendMessage(
      `${source.name}${ATTACK_KIND_PROMPT_LABELS.chatSeparator}${setup.chatLabels[kind]}${byDistance ? ATTACK_KIND_PROMPT_LABELS.byDistanceSuffix : ''}`,
      'text',
    );

    proceed(setup.apply(kind));
  };

  const distance = measureDistanceToTarget(attackerId);

  const reachable =
    distance === undefined ? setup.kinds : setup.listReachable(distance);

  // Цель не достаётся ни одним видом: спрашивать не о чем — дальнобойная
  // проверка расстояния сама остановит атаку сообщением в чат
  if (reachable.length === 0) {
    proceed(setup.apply(lastKind));

    return;
  }

  const [onlyKind] = reachable;

  if (reachable.length === 1 && onlyKind) {
    finish(onlyKind, true);

    return;
  }

  const group = ATTACK_KIND_PROMPT_LABELS.group;

  const handleConfirm = (answers: EffectVariantChoices): void => {
    const kind = reachable.find(
      (candidate) => setup.promptLabels[candidate] === answers[group],
    );

    if (kind) {
      finish(kind, false);
    }
  };

  useModalManager().openModal(EFFECT_VARIANT_PROMPT_MODAL, {
    _modalKey: generateId(ATTACK_KIND_MODAL_KEY_PREFIX),
    sourceName: source.name,
    groups: [
      {
        group,
        pick: 'choose',
        labels: reachable.map((kind) => setup.promptLabels[kind]),
      },
    ],
    onConfirm: handleConfirm,
  });
}

/**
 * Оружие или действие с досягаемостью атакующего («досягаемость +10 футов»):
 * дальше её читают и выбор вида атаки, и проверка расстояния.
 *
 * @param source - оружие или действие существа
 * @param attackerId - кто атакует
 * @returns источник с досягаемостью атакующего
 */
function withAttackerReach<Source extends { reach?: number }>(
  source: Source,
  attackerId: string | undefined,
): Source {
  const attacker = attackerId
    ? useWorldEntities().findCurrentDndEntity(attackerId)
    : undefined;

  return attacker ? withMeleeReachBonus(source, attacker) : source;
}

/**
 * Готовит атаку оружием: метательное рукопашное спрашивает «Удар / Бросок»,
 * затем выбираются варианты эффектов (`runWithEffectVariants`).
 *
 * @param sourceWeapon - оружие (после подготовки выстрела)
 * @param attackerId - id владельца оружия
 * @param proceed - продолжение с оружием выбранного вида и вариантами
 */
export function runWeaponAttackChoices(
  sourceWeapon: DnDGameItem,
  attackerId: string | undefined,
  proceed: (chosen: DnDGameItem) => void,
): void {
  const weapon = withAttackerReach(sourceWeapon, attackerId);

  runWithAttackKind(
    weapon,
    {
      kinds: listWeaponAttackKinds(weapon),
      listReachable: (distance) =>
        listReachableWeaponAttackKinds(weapon, distance),
      apply: (kind) => withWeaponAttackKind(weapon, kind),
      promptLabels: WEAPON_ATTACK_KIND_LABELS,
      chatLabels: WEAPON_ATTACK_KIND_CHAT_LABELS,
    },
    attackerId,
    (chosen) => runWithEffectVariants(chosen, proceed),
  );
}

/**
 * Готовит действие существа: «рукопашная или дальнобойная» спрашивает вид
 * атаки, затем выбираются варианты эффектов (`runWithEffectVariants`).
 *
 * @param sourceAction - действие существа
 * @param creatureId - id существа
 * @param proceed - продолжение с действием выбранного вида и вариантами
 */
export function runCreatureActionChoices(
  sourceAction: CreatureAction,
  creatureId: string | undefined,
  proceed: (chosen: CreatureAction) => void,
): void {
  const action = withAttackerReach(sourceAction, creatureId);

  runWithAttackKind(
    action,
    {
      kinds: listCreatureActionAttackKinds(action),
      listReachable: (distance) =>
        listReachableCreatureActionAttackKinds(action, distance),
      apply: (kind) => withCreatureActionAttackKind(action, kind),
      promptLabels: CREATURE_ATTACK_KIND_LABELS,
      chatLabels: CREATURE_ATTACK_KIND_CHAT_LABELS,
    },
    creatureId,
    (chosen) => runWithEffectVariants(chosen, proceed),
  );
}
