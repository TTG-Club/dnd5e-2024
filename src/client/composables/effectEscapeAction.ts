import type { ActiveEffect, DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  ABILITY_CHECK_KEY,
  canEscapeEffect,
  formatEffectEscapeLabel,
  getSkillSetting,
  getSkillSettingAbility,
  listEffectEscapeRemovals,
  resolveAbilityCheckRollMode,
  resolveActorStats,
  resolveEffectEscapeDc,
  SKILLS_LABELS,
} from '@vtt/shared/system/dnd.js';

import {
  EFFECT_ESCAPE_LABELS,
  EFFECT_ESCAPE_MODAL_KEY_PREFIX,
} from '../ui/effect/constants';
import { buildRollBonusEvaluator } from './rollBonusEvaluator';

/** Что нужно действию «вырваться» */
export interface EffectEscapeOptions {
  /** Носитель эффекта */
  entity: DnDSceneEntity;
  /** Эффект с блоком «вырваться» */
  effect: ActiveEffect;
  /** Действующие флаги носителя: преимущество и помеха на проверку */
  flags: ReadonlySet<string>;
  /** Успех: какие эффекты снять с носителя */
  onEscaped: (effectIds: string[]) => void;
}

/**
 * Открывает бросок действия «вырваться» и по успеху снимает эффект.
 *
 * Действие без проверки снимает эффект сразу: окно костей в нём ни при чём.
 * Проверка против Сл 0 не бросается вовсе — Сл источника не проставлена, и
 * бросок был бы подлогом (`resolveEffectEscapeDc` отдаёт `null`).
 *
 * @param options - носитель, эффект, флаги и что делать по успеху
 * @returns `true`, если действие пошло (бросок открыт или эффект снят)
 */
export function runEffectEscape(options: EffectEscapeOptions): boolean {
  const { entity, effect, flags, onEscaped } = options;
  const { escape } = effect;

  // Выключенный эффект не держит — вырываться не из чего
  if (!escape || !canEscapeEffect(effect)) {
    return false;
  }

  const removals = listEffectEscapeRemovals(effect, entity.activeEffects ?? []);

  if (!escape.check) {
    onEscaped(removals);

    return true;
  }

  const dc = resolveEffectEscapeDc(escape);

  if (dc === null) {
    return false;
  }

  const { skill } = escape.check;
  const modifier = resolveActorStats(entity).skills[skill];
  const { openModal } = useModalManager();

  // Характеристику навыка берут из настройки листа, как при броске навыка на
  // листе: Атлетику переводят на Телосложение — и флаги читаются по нему
  const ability = getSkillSettingAbility(
    getSkillSetting(entity.system.skillSettings, skill),
    skill,
  );

  const title = `${formatEffectEscapeLabel(effect)}${EFFECT_ESCAPE_LABELS.titleSeparator}${entity.name}`;

  openModal('DiceRollModal', {
    _modalKey: `${EFFECT_ESCAPE_MODAL_KEY_PREFIX}${effect.id}`,
    title,
    rollLabel: `${SKILLS_LABELS[skill]}${EFFECT_ESCAPE_LABELS.titleSeparator}${entity.name}`,
    rollButtonText: EFFECT_ESCAPE_LABELS.rollButton,
    modifier,
    evaluateBonusRollFormulas: buildRollBonusEvaluator(
      () => entity,
      ABILITY_CHECK_KEY,
    ),
    initialRollMode: resolveAbilityCheckRollMode({ flags, ability, skill }),
    targetDc: dc,
    onCheckRoll: (result: CheckRollResult) => {
      if (result.total >= dc) {
        onEscaped(removals);
      }
    },
  });

  return true;
}
