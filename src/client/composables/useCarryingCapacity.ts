import type { Ref } from 'vue';

import type {
  DnDCarryingCapacity,
  DnDSceneEntity,
  ResolvedActorStats,
} from '@vtt/shared/system/dnd.js';

import { computed } from 'vue';

import {
  DEFAULT_CARRYING_CAPACITY,
  DEFAULT_CREATURE_SIZE,
  formatWeight,
  getCarryingCapacityBreakdown,
  isDndCreature,
} from '@vtt/shared/system/dnd.js';

/** Значение Силы, когда её нет ни в эффектах, ни в данных актёра */
const FALLBACK_STRENGTH = 10;

/**
 * Переносимый вес листа: сумма веса инвентаря и предел грузоподъёмности с
 * учётом настройки. Считает оба листа одним кодом — расчёт предела зависит
 * только от Силы и размера, а они есть и у существа.
 *
 * Статы принимаются готовыми, а не разрешаются внутри: оба вызывающих компонента
 * уже держат `useResolvedStats`, и повторное разрешение эффектов было бы лишним.
 *
 * @param actorRef - актёр или существо листа
 * @param resolvedStatsRef - итоговые статы листа (с учётом эффектов)
 */
export function useCarryingCapacity(
  actorRef: Ref<DnDSceneEntity>,
  resolvedStatsRef: Ref<ResolvedActorStats | undefined>,
) {
  /**
   * Суммарный вес всех предметов в инвентаре. Список читается со страховкой:
   * у существа поле необязательное, и у записи старого мира его нет вовсе.
   */
  const totalWeight = computed(() =>
    (actorRef.value.equipment ?? []).reduce(
      (sum, item) => sum + (item.weight ?? 0) * (item.quantity ?? 1),
      0,
    ),
  );

  /**
   * Настройка предела переносимого веса. Её нет ни у существа (там предел
   * всегда по правилам — от Силы и размера), ни у актёров старых миров.
   *
   * Лист различается гвардом, а не чтением поля по союзу: у `CreatureSystem`
   * есть индексная сигнатура, и по союзу настройка вычиталась бы как `unknown`.
   */
  const capacitySettings = computed<DnDCarryingCapacity>(() => {
    const entity = actorRef.value;

    if (isDndCreature(entity)) {
      return DEFAULT_CARRYING_CAPACITY;
    }

    return entity.system?.carryingCapacity ?? DEFAULT_CARRYING_CAPACITY;
  });

  /** Итоговая Сила: из эффектов, иначе из данных актёра */
  const strength = computed(
    () =>
      resolvedStatsRef.value?.abilities.strength
      ?? actorRef.value.system?.abilities?.strength
      ?? FALLBACK_STRENGTH,
  );

  /** Разбор предела: расчёт по правилам, своё значение и бонус */
  const breakdown = computed(() =>
    getCarryingCapacityBreakdown({
      strength: strength.value,
      size: actorRef.value.system?.size ?? DEFAULT_CREATURE_SIZE,
      capacity: capacitySettings.value,
    }),
  );

  /** Предел переносимого веса в фунтах */
  const carryingCapacity = computed(() => breakdown.value.value);

  /** Перегрузка: текущий вес превышает предел */
  const isOverweight = computed(
    () => totalWeight.value > carryingCapacity.value,
  );

  /** Подпись для листа: «37.6 / 300 фнт.» */
  const weightLabel = computed(
    () =>
      `${formatWeight(totalWeight.value)} / ${formatWeight(carryingCapacity.value)} фнт.`,
  );

  return {
    totalWeight,
    capacitySettings,
    strength,
    breakdown,
    carryingCapacity,
    isOverweight,
    weightLabel,
  };
}
