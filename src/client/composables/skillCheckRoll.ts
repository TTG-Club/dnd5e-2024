/**
 * Окно проверки навыка сущности — одно на все действия, где проверку бросают
 * не с листа: «вырваться» (`effectEscapeAction.ts`), Сл от проверки навыка
 * применившего (`effectActivationUse.ts`) и проверка по запросу мастера
 * (`requestedCheckRoll.ts`).
 *
 * Модификатор, режим и кости к навыку считаются так же, как при броске навыка
 * на листе: характеристика берётся из настройки листа (Атлетику переводят на
 * Телосложение — и флаги читаются по нему), «Наставление» катается и здесь.
 */

import type { SkillType } from '@vtt/shared';
import type {
  AbilityCheckSubject,
  AttackRollMode,
  DnDSceneEntity,
} from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';
import type { RollBonusEvaluator } from './rollBonusEvaluator';

import {
  ABILITY_CHECK_KEY,
  getSkillCheckBonusKeys,
  getSkillSetting,
  getSkillSettingAbility,
  resolveAbilityCheckModifier,
  resolveAbilityCheckRollMode,
  SKILLS_LABELS,
} from '@vtt/shared/system/dnd.js';

import { openDiceRollWindow } from './diceRollWindow';
import { buildRollBonusEvaluator } from './rollBonusEvaluator';
import { resolveEntityStats } from './useResolvedStats';

/**
 * Числа броска проверки — одни для окна и для броска без окна: модификатор,
 * режим по флагам бросающего и бонусные кости эффектов.
 */
export interface CheckRollSetup {
  /** Модификатор проверки */
  modifier: number;
  /** Режим броска по флагам бросающего */
  rollMode: AttackRollMode;
  /** Бонусные кости эффектов в момент броска («Наставление») */
  evaluateBonusRollFormulas: RollBonusEvaluator;
  /** Действующие флаги бросающего — для режима поверх режима проверки */
  activeFlags: ReadonlySet<string>;
}

/**
 * Считает бросок проверки характеристики или навыка так же, как лист: у
 * навыка характеристика берётся из настройки листа (Атлетику переводят на
 * Телосложение — и флаги читаются по нему), у характеристики к модификатору
 * прибавляется прибавка ко всем проверкам.
 *
 * @param entity - кто бросает
 * @param subject - что проверяют
 * @returns модификатор, режим и бонусные кости
 */
export function resolveCheckRollSetup(
  entity: DnDSceneEntity,
  subject: AbilityCheckSubject,
): CheckRollSetup {
  const stats = resolveEntityStats(entity);

  if (subject.check === 'skill') {
    const ability = getSkillSettingAbility(
      getSkillSetting(entity.system.skillSettings, subject.skill),
      subject.skill,
    );

    return {
      modifier: stats.skills[subject.skill],
      rollMode: resolveAbilityCheckRollMode({
        flags: stats.activeFlags,
        ability,
        skill: subject.skill,
      }),
      evaluateBonusRollFormulas: buildRollBonusEvaluator(
        () => entity,
        getSkillCheckBonusKeys(subject.skill),
      ),
      activeFlags: stats.activeFlags,
    };
  }

  return {
    modifier: resolveAbilityCheckModifier(
      stats.abilityMods[subject.ability],
      stats,
    ),
    rollMode: resolveAbilityCheckRollMode({
      flags: stats.activeFlags,
      ability: subject.ability,
    }),
    evaluateBonusRollFormulas: buildRollBonusEvaluator(
      () => entity,
      ABILITY_CHECK_KEY,
    ),
    activeFlags: stats.activeFlags,
  };
}

/** Разделитель навыка и имени в подписи броска */
const SKILL_ROLL_LABEL_SEPARATOR = ' — ';

/** Чем окно проверки отличается у разных действий */
export interface SkillCheckRollOptions {
  /** Ключ окна: повторное нажатие второго окна не открывает */
  modalKey: string;
  /** Заголовок окна */
  title: string;
  /** Подпись кнопки броска */
  rollButtonText: string;
  /** Сложность проверки, если она известна */
  targetDc?: number;
  /**
   * Режим броска поверх режима самой проверки: у «вырваться» — режим из
   * эффекта и флаги того, кто держит
   *
   * @param checkMode - режим проверки навыка по флагам бросающего
   * @param flags - действующие флаги бросающего
   * @returns итоговый режим
   */
  resolveMode?: (
    checkMode: AttackRollMode,
    flags: ReadonlySet<string>,
  ) => AttackRollMode;
  /** Бросок сделан */
  onRoll: (result: CheckRollResult) => void;
}

/**
 * Открывает окно проверки навыка сущности.
 *
 * @param entity - кто бросает
 * @param skill - навык
 * @param options - подписи окна, сложность, режим и исход
 */
export function openSkillCheckModal(
  entity: DnDSceneEntity,
  skill: SkillType,
  options: SkillCheckRollOptions,
): void {
  const setup = resolveCheckRollSetup(entity, { check: 'skill', skill });

  openDiceRollWindow(
    {
      title: options.title,
      rollLabel: `${SKILLS_LABELS[skill]}${SKILL_ROLL_LABEL_SEPARATOR}${entity.name}`,
      rollButtonText: options.rollButtonText,
      actorName: entity.name,
      modifier: setup.modifier,
      evaluateBonusRollFormulas: setup.evaluateBonusRollFormulas,
      initialRollMode:
        options.resolveMode?.(setup.rollMode, setup.activeFlags)
        ?? setup.rollMode,
      ...(options.targetDc === undefined ? {} : { targetDc: options.targetDc }),
      onCheckRoll: options.onRoll,
    },
    options.modalKey === undefined ? {} : { modalKey: options.modalKey },
  );
}
