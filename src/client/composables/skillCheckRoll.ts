/**
 * Окно проверки навыка сущности — одно на все действия, где проверку бросают
 * не с листа: «вырваться» (`effectEscapeAction.ts`) и Сл от проверки навыка
 * применившего (`effectActivationUse.ts`).
 *
 * Модификатор, режим и кости к навыку считаются так же, как при броске навыка
 * на листе: характеристика берётся из настройки листа (Атлетику переводят на
 * Телосложение — и флаги читаются по нему), «Наставление» катается и здесь.
 */

import type { SkillType } from '@vtt/shared';
import type { AttackRollMode, DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import {
  getSkillCheckBonusKeys,
  getSkillSetting,
  getSkillSettingAbility,
  resolveAbilityCheckRollMode,
  SKILLS_LABELS,
} from '@vtt/shared/system/dnd.js';

import { openDiceRollWindow } from './diceRollWindow';
import { buildRollBonusEvaluator } from './rollBonusEvaluator';
import { resolveEntityStats } from './useResolvedStats';

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
  const stats = resolveEntityStats(entity);

  // Характеристику навыка берут из настройки листа, как при броске навыка на
  // листе: Атлетику переводят на Телосложение — и флаги читаются по нему
  const ability = getSkillSettingAbility(
    getSkillSetting(entity.system.skillSettings, skill),
    skill,
  );

  const checkMode = resolveAbilityCheckRollMode({
    flags: stats.activeFlags,
    ability,
    skill,
  });

  openDiceRollWindow(
    {
      title: options.title,
      rollLabel: `${SKILLS_LABELS[skill]}${SKILL_ROLL_LABEL_SEPARATOR}${entity.name}`,
      rollButtonText: options.rollButtonText,
      modifier: stats.skills[skill],
      evaluateBonusRollFormulas: buildRollBonusEvaluator(
        () => entity,
        getSkillCheckBonusKeys(skill),
      ),
      initialRollMode:
        options.resolveMode?.(checkMode, stats.activeFlags) ?? checkMode,
      ...(options.targetDc === undefined ? {} : { targetDc: options.targetDc }),
      onCheckRoll: options.onRoll,
    },
    options.modalKey,
  );
}
