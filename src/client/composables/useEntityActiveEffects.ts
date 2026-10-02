import type { ComputedRef, Ref } from 'vue';

import type { ActiveEffect, ConditionRef } from '@vtt/shared/system/dnd.js';

import { computed } from 'vue';

import { emitEntityCombatState } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import {
  buildConditionActiveEffect,
  isEffectDormant,
  resolveEffectConditionKey,
  withInitializedDuration,
} from '@vtt/shared/system/dnd.js';

import { useWorldEntities } from './useWorldEntities';

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
 * Свой ли это эффект для листа — со строкой в списке, а не плиткой состояния.
 * Признак — опознанный ключ состояния, а не источник: длящуюся нагрузку
 * области движок тоже помечает `condition`, и по источнику она пропала бы с
 * листа совсем. Эффект с применением или включением — всегда свой, даже с
 * состоянием внутри: у него кнопка или переключатель.
 *
 * @param effect - эффект сущности
 * @returns `true`, если эффект показывают строкой
 */
function isCustomEffect(effect: ActiveEffect): boolean {
  return (
    effect.activation !== undefined
    || resolveEffectConditionKey(effect) === undefined
  );
}

/**
 * Эффекты-состояния с действием «вырваться». Строки у них нет — их показывает
 * плитка состояния, — а кнопка нужна: «Схваченный» от щупальца снимают
 * проверкой, и без кнопки носителю нечем её начать.
 *
 * @param effects - эффекты сущности
 * @returns действующие эффекты-состояния с блоком «вырваться»
 */
export function listConditionEscapeEffects(
  effects: readonly ActiveEffect[],
): ActiveEffect[] {
  return effects.filter(
    (effect) =>
      effect.escape !== undefined
      && !effect.disabled
      && !isCustomEffect(effect),
  );
}

/**
 * Список эффектов без наложенного состояния. Шаблоны применения и включения с
 * этим состоянием — не наложенное состояние, плитка их не снимает.
 *
 * @param effects - эффекты сущности
 * @param key - ключ снимаемого состояния
 * @returns эффекты, которые остаются
 */
export function dropConditionEffects(
  effects: readonly ActiveEffect[],
  key: ConditionRef,
): ActiveEffect[] {
  return effects.filter(
    (effect) =>
      effect.activation !== undefined
      || resolveEffectConditionKey(effect) !== key,
  );
}

/**
 * Снимает состояние с сущности мира боевым каналом — тем же, каким его
 * снимает «вырваться»: сервер видит, какое состояние ушло, и будит
 * срабатывания «когда состояние снимается» («Ошеломлённый» иллитида уходит
 * вместе с захватом). Простое сохранение листа их не разбудило бы.
 *
 * @param entityId - сущность
 * @param key - ключ снимаемого состояния
 * @returns `true`, если снятие ушло; нет соединения или сущности — `false`
 */
export function removeEntityCondition(
  entityId: string,
  key: ConditionRef,
): boolean {
  const socket = useChatStore().getSocket();
  const entity = useWorldEntities().findCurrentDndEntity(entityId);

  if (!socket || !entity) {
    return false;
  }

  emitEntityCombatState(socket, {
    ...entity,
    activeEffects: dropConditionEffects(entity.activeEffects ?? [], key),
  });

  return true;
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
   * показывает своя сетка.
   */
  const customEffects = computed<ActiveEffect[]>(() =>
    options.effects.value.filter(isCustomEffect),
  );

  /** Эффекты-состояния, из которых можно вырваться: кнопки над сеткой */
  const conditionEscapeEffects = computed<ActiveEffect[]>(() =>
    listConditionEscapeEffects(options.effects.value),
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
      // Аура с applyToSelf=false на источника не действует — не считаем
      // активной; спящий шаблон применения или включения — тоже
      const dormantTemplate =
        effect.activation !== undefined && isEffectDormant(effect);

      if ((effect.aura && !effect.aura.applyToSelf) || dormantTemplate) {
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
      options.onChange(dropConditionEffects(currentEffects, key));

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
    conditionEscapeEffects,
    activeConditionKeys,
    isConditionActive,
    toggleCondition,
    saveEffect,
    deleteEffect,
    toggleEffectStatus,
  };
}
