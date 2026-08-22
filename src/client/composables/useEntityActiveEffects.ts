import type { ComputedRef, Ref } from 'vue';

import type { ActiveEffect, ConditionRef } from '@vtt/shared/system/dnd.js';

import { computed } from 'vue';

import {
  buildConditionActiveEffect,
  resolveEffectConditionKey,
  withInitializedDuration,
} from '@vtt/shared/system/dnd.js';

/** Что нужно хуку: откуда читать эффекты и куда отдавать изменённый список */
export interface EntityActiveEffectsOptions {
  /** Активные эффекты сущности (актёра или существа) */
  effects: Ref<readonly ActiveEffect[]> | ComputedRef<readonly ActiveEffect[]>;

  /**
   * Записать новый список эффектов в сущность. Вызывающий лист сам решает, как
   * именно (свой эмит `update:actor` либо `update:creature`) и нужно ли
   * немедленное сохранение.
   */
  onChange: (effects: ActiveEffect[]) => void;
}

/**
 * Общая механика вкладки эффектов для листа персонажа и листа существа:
 * список своих эффектов, включение и удаление, набор активных состояний и
 * переключение состояния.
 *
 * Оба листа показывают эффекты одинаково, поэтому логика живёт здесь одна:
 * пока она была скопирована в два компонента, правки (опознание состояния по
 * ключу, инициализация длительности) приходилось вносить дважды и они
 * расходились.
 *
 * @param options - источник эффектов и способ записи
 * @returns данные и действия вкладки эффектов
 */
export function useEntityActiveEffects(options: EntityActiveEffectsOptions) {
  /**
   * Свои эффекты — всё, что не является стандартным состоянием: состояния
   * показывает своя сетка. Признак — опознанный ключ состояния, а не источник:
   * длящуюся нагрузку области движок тоже помечает `condition`, и по источнику
   * она пропала бы с листа совсем.
   */
  const customEffects = computed<ActiveEffect[]>(() =>
    options.effects.value.filter(
      (effect) => resolveEffectConditionKey(effect) === undefined,
    ),
  );

  /**
   * Набор активных состояний. Состояние опознаётся по `conditionKey`, а не по
   * названию: переименованный эффект («Испуг от драконьего рыка») обязан
   * оставаться Испуганным, иначе плитка не подсвечена, а клик по ней плодит
   * второе такое же состояние.
   */
  const activeConditionKeys = computed<Set<ConditionRef>>(() => {
    const keys = new Set<ConditionRef>();

    for (const effect of options.effects.value) {
      // Аура с applyToSelf=false на источника не действует — не считаем активной
      if (effect.aura && !effect.aura.applyToSelf) {
        continue;
      }

      const conditionKey = resolveEffectConditionKey(effect);

      if (conditionKey) {
        keys.add(conditionKey);
      }
    }

    return keys;
  });

  /**
   * Проверяет, активно ли состояние.
   *
   * @param key - ключ состояния
   * @returns `true`, если состояние активно
   */
  function isConditionActive(key: ConditionRef): boolean {
    return activeConditionKeys.value.has(key);
  }

  /**
   * Переключает состояние: снимает активное либо накладывает новое.
   *
   * @param key - ключ состояния
   */
  function toggleCondition(key: ConditionRef): void {
    const currentEffects = options.effects.value;

    if (isConditionActive(key)) {
      options.onChange(
        currentEffects.filter(
          (effect) => resolveEffectConditionKey(effect) !== key,
        ),
      );

      return;
    }

    // Единый источник правды: builder проставляет conditionKey,
    // conditionImmunities и динамические changes Истощения
    const newEffect = buildConditionActiveEffect(key);

    if (newEffect) {
      options.onChange([...currentEffects, newEffect]);
    }
  }

  /**
   * Сохраняет эффект: новый добавляется, существующий заменяется по id.
   *
   * @param effect - эффект из окна правки
   */
  function saveEffect(effect: ActiveEffect): void {
    const currentEffects = options.effects.value;

    // Счётчик раундов заводит движок: без него длительность «3 раунда» не
    // тикает в бою и эффект висит до ручного снятия
    const preparedEffect = withInitializedDuration(effect);

    const index = currentEffects.findIndex(
      (existing) => existing.id === preparedEffect.id,
    );

    if (index === -1) {
      options.onChange([...currentEffects, preparedEffect]);

      return;
    }

    const newEffects = [...currentEffects];

    newEffects[index] = preparedEffect;
    options.onChange(newEffects);
  }

  /**
   * Удаляет эффект по идентификатору.
   *
   * @param effectId - идентификатор эффекта
   */
  function deleteEffect(effectId: string): void {
    options.onChange(
      options.effects.value.filter((effect) => effect.id !== effectId),
    );
  }

  /**
   * Включает или отключает эффект, не удаляя его.
   *
   * @param effect - переключаемый эффект
   */
  function toggleEffectStatus(effect: ActiveEffect): void {
    saveEffect({ ...effect, disabled: !effect.disabled });
  }

  return {
    customEffects,
    activeConditionKeys,
    isConditionActive,
    toggleCondition,
    saveEffect,
    deleteEffect,
    toggleEffectStatus,
  };
}
