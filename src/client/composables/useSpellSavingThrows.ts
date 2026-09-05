import type { AbilityType, SceneEntity } from '@vtt/shared';
import type { ConditionRef } from '@vtt/shared/system/dnd.js';

import type { ActorSaveInfo, SavingThrowResult } from './spellResolutionShared';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useDiceRollerStore } from '@/stores/diceRollerStore';
import {
  isDndSceneEntity,
  resolveActorStats,
  resolveSavingThrowRollMode,
  SAVE_TYPE_LABELS,
} from '@vtt/shared/system/dnd.js';

import { determineRollMode, resolveAutoSaves } from './spellResolutionShared';

/**
 * Композабл для обработки спасбросков от заклинаний.
 */
export function useSpellSavingThrows() {
  const diceRollerStore = useDiceRollerStore();
  const chatStore = useChatStore();
  const { openModal } = useModalManager();

  /**
   * Рассчитывает модификатор спасброска актора с учётом Active Effects.
   *
   * @param entity - сущность-цель
   * @param saveAbility - характеристика спасброска
   * @param againstCondition - состояние, которого спасбросок позволяет избежать
   * @returns модификатор спасброска и флаги (преимущество/помеха/автопровал)
   */
  function getActorSaveInfo(
    entity: SceneEntity,
    saveAbility: AbilityType,
    againstCondition?: ConditionRef,
  ): ActorSaveInfo {
    // Ядро видит entity как Base*; D&D-форму подтверждает гвард. Без данных
    // системы считать нечего: спасбросок идёт «голым» кубиком, а не роняет каст
    if (!isDndSceneEntity(entity)) {
      return {
        modifier: 0,
        hasAdvantage: false,
        hasDisadvantage: false,
        autoFail: false,
      };
    }

    const stats = resolveActorStats(entity);

    const modifier = stats.saves[saveAbility] ?? 0;

    // Сюда попадают только спасброски, навязанные заклинанием, поэтому
    // `againstMagic` истинно всегда: Мантия сопротивления заклинаниям должна
    // сработать здесь и промолчать на спасброске от яда.
    const rollMode = resolveSavingThrowRollMode({
      flags: stats.activeFlags,
      ability: saveAbility,
      againstMagic: true,
      againstCondition,
    });

    const hasAdvantage = rollMode === 'advantage';
    const hasDisadvantage = rollMode === 'disadvantage';

    const autoFail = stats.activeFlags.has(`save.autoFail.${saveAbility}`);

    return { modifier, hasAdvantage, hasDisadvantage, autoFail };
  }

  /**
   * Бросает спасбросок за актора автоматически.
   *
   * @param entity - сущность-цель
   * @param saveAbility - характеристика спасброска
   * @param saveDC - сложность спасброска
   * @param againstCondition - состояние, которого спасбросок позволяет избежать
   * @returns результат спасброска
   */
  function rollSavingThrow(
    entity: SceneEntity,
    saveAbility: AbilityType,
    saveDC: number,
    againstCondition?: ConditionRef,
  ): SavingThrowResult {
    const { modifier, hasAdvantage, hasDisadvantage, autoFail } =
      getActorSaveInfo(entity, saveAbility, againstCondition);

    if (autoFail) {
      return { roll: 1, modifier, total: 1 + modifier, passed: false };
    }

    // Определяем формулу (преимущество/помеха)
    let formula = '1к20';

    if (hasAdvantage && !hasDisadvantage) {
      formula = '2к20вл1';
    } else if (hasDisadvantage && !hasAdvantage) {
      formula = '2к20ул1';
    }

    if (modifier !== 0) {
      const sign = modifier >= 0 ? '+' : '';

      formula += `${sign}${modifier}`;
    }

    const rollData = diceRollerStore.parseAndRoll(formula);
    const total = rollData.total;
    const passed = total >= saveDC;

    // Отправляем бросок спасброска в чат
    const saveLabel = SAVE_TYPE_LABELS[saveAbility] ?? saveAbility;

    rollData.label = `Спасбросок ${saveLabel} — ${entity.name}`;

    if (passed) {
      rollData.label += ' ✓ Успех';
    } else {
      rollData.label += ' ✗ Провал';
    }

    chatStore.sendMessage(formula, 'roll', rollData);

    // Извлекаем значение первого (или лучшего/худшего) кубика
    const dieRoll = rollData.dice[0]?.values[0] ?? 0;

    return { roll: dieRoll, modifier, total, passed };
  }

  /**
   * Запрашивает ручной бросок спасброска через DiceRollModal.
   * Открывает модалку с предзаполненным модификатором и ждёт результат.
   *
   * Окно можно закрыть, не бросив, — тогда промис отдаёт `null`. Это НЕ провал
   * спасброска и не успех: вызывающий обязан свернуть начатое действие целиком
   * (без такого ответа оно повисало навсегда — молча, без урона и без чата).
   *
   * @param entity - сущность-цель
   * @param saveAbility - характеристика спасброска
   * @param saveDC - сложность спасброска
   * @param againstCondition - состояние, которого спасбросок позволяет избежать
   * @returns промис с результатом спасброска или `null`, если окно закрыли
   */
  function requestManualSavingThrow(
    entity: SceneEntity,
    saveAbility: AbilityType,
    saveDC: number,
    againstCondition?: ConditionRef,
  ): Promise<SavingThrowResult | null> {
    return new Promise((resolve) => {
      const { modifier, hasAdvantage, hasDisadvantage, autoFail } =
        getActorSaveInfo(entity, saveAbility, againstCondition);

      const saveLabel = SAVE_TYPE_LABELS[saveAbility] ?? saveAbility;
      const rollMode = determineRollMode(hasAdvantage, hasDisadvantage);

      openModal('DiceRollModal', {
        allowMultiple: true,
        title: `Спасбросок ${saveLabel} — ${entity.name} (DC ${saveDC})`,
        rollLabel: `Спасбросок ${saveLabel} — ${entity.name}`,
        rollButtonText: 'Бросить спасбросок',
        modifier,
        initialRollMode: rollMode,
        autoFail,
        targetDc: saveDC,
        onRoll: (total: number) => {
          const passed = !autoFail && total >= saveDC;

          resolve({
            roll: total - modifier,
            modifier,
            total,
            passed,
          });
        },
        onCancel: () => {
          resolve(null);
        },
      });
    });
  }

  /**
   * Разрешает спасбросок цели с учётом режима `autoSaves`.
   *
   * Существа и сущности с включёнными автоспасбросками кидают автоматически
   * (`rollSavingThrow`), PC с `autoSaves: false` — вручную через DiceRollModal
   * (`requestManualSavingThrow`).
   *
   * Ручной бросок можно отменить, закрыв окно, — тогда промис отдаёт `null`
   * (см. `requestManualSavingThrow`). Автоспасбросок отменить нельзя.
   *
   * @param entity - сущность-цель
   * @param saveAbility - характеристика спасброска
   * @param saveDC - сложность спасброска
   * @param againstCondition - состояние, которого спасбросок позволяет избежать
   * @returns промис с результатом спасброска или `null`, если бросок отменили
   */
  function resolveSavingThrowForTarget(
    entity: SceneEntity,
    saveAbility: AbilityType,
    saveDC: number,
    againstCondition?: ConditionRef,
  ): Promise<SavingThrowResult | null> {
    if (resolveAutoSaves(entity)) {
      return Promise.resolve(
        rollSavingThrow(entity, saveAbility, saveDC, againstCondition),
      );
    }

    return requestManualSavingThrow(
      entity,
      saveAbility,
      saveDC,
      againstCondition,
    );
  }

  return {
    getActorSaveInfo,
    rollSavingThrow,
    requestManualSavingThrow,
    resolveSavingThrowForTarget,
  };
}
