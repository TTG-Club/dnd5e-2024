import type { InitiativeRollPromptResult } from '@/core/systems/uiSystemRegistry';
import type { SceneEntity } from '@vtt/shared';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  dnd5eSystemInstance,
  resolveInitiativeRollMode,
} from '@vtt/shared/system/dnd.js';

import { INITIATIVE_ROLL_LABELS } from '../ui/actor/constants';

/**
 * Открывает окно броска инициативы за участника боя — то же `DiceRollModal`,
 * что и по клику на инициативу в листе персонажа: свой бонус,
 * преимущество/помеха, видимость броска. Ядро зовёт эту функцию на «личном»
 * броске из трекера или промпта на сцене (слот `promptInitiativeRoll`).
 *
 * Сообщение о броске пишет само окно (со своей формулой и видимостью), поэтому
 * результат помечается `announced` — серверное сообщение о том же броске тогда
 * не выводится.
 *
 * @param entity - участник боя: актёр или существо
 * @param onRolled - принимает бросок; не вызывается, если окно закрыли без броска
 * @returns всегда `true` — бросок за системой (её окном)
 */
export function promptInitiativeRoll(
  entity: SceneEntity,
  onRolled: (result: InitiativeRollPromptResult) => void,
): boolean {
  const { openModal } = useModalManager();

  const modifier = dnd5eSystemInstance.getInitiativeModifier(entity);

  const initialRollMode = resolveInitiativeRollMode(
    dnd5eSystemInstance.getEntityActiveFlags(entity),
  );

  // Имя участника: в трекере их много — по одной «Инициативе» не видно ни за
  // кого открыто окно, ни за кого ушёл бросок в чат
  const nameSuffix = `${INITIATIVE_ROLL_LABELS.nameSeparator}${entity.name}`;

  openModal('DiceRollModal', {
    // Ключ окна — по участнику: мастер бросает за нескольких подряд, и окна
    // должны стоять рядом, а повторный клик по тому же участнику — поднимать
    // уже открытое окно, а не плодить второе
    _modalKey: `initiative:${entity.id}`,
    title: `${INITIATIVE_ROLL_LABELS.title}${nameSuffix}`,
    rollLabel: `${INITIATIVE_ROLL_LABELS.rollLabel}${nameSuffix}`,
    rollButtonText: INITIATIVE_ROLL_LABELS.button,
    modifier,
    initialRollMode,
    onCheckRoll: (result: CheckRollResult) => {
      onRolled({
        roll: result.natural,
        modifier: result.modifier,
        announced: true,
      });
    },
  });

  // Окно того же участника уже открыто — менеджер поднял его наверх. Бросок всё
  // равно за системой: мгновенный бросок ядра «вторым» тут был бы подлогом.
  return true;
}
