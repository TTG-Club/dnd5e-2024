/**
 * Поля зарядов предмета для форм снаряжения, оружия и инструмента.
 *
 * Блок зарядов одинаков во всех трёх формах (`useEquipmentForm`,
 * `useWeaponForm`, `useToolForm`), поэтому живёт здесь одной копией: они
 * подмешивают `itemUses` в свой возврат и зовут `loadItemUses`/`buildItemUses`
 * рядом со своими полями магии, а рисует его общий `ItemUsesFields.vue`.
 *
 * @module systems/dnd5e/composables/useItemUsesForm
 */

import type { ItemUses, ItemUsesRecovery } from '@vtt/shared/system/dnd.js';

import { ref } from 'vue';

/**
 * Черновик зарядов в форме. Плоский объект, а не {@link ItemUses}: у него есть
 * флаг «заряды вообще есть» и всегда заполненные поля — так их привязывает
 * `defineModel`, не подставляя `undefined` в `USelect` и `UInput`.
 */
export interface EditableItemUses {
  /** Есть ли у предмета заряды — снятый флаг убирает `uses` из предмета */
  enabled: boolean;
  max: number;
  /**
   * Остаток. В форме не показывается — им управляет карточка предмета на листе;
   * форма его только переносит и подрезает под изменённый максимум.
   */
  current: number;
  recovery: ItemUsesRecovery;
  /** Формула возврата («1к6+4»); пустая строка — восстанавливать до максимума */
  formula: string;
  cost: number;
}

/** Вариант отката для выпадающего списка формы. */
export interface ItemUsesRecoveryOption {
  value: ItemUsesRecovery;
  label: string;
}

/**
 * Способы отката зарядов в порядке частоты у магических предметов.
 * Подписи описывают варианты доменного типа, поэтому живут рядом с ним, а не
 * среди подписей конкретного окна.
 */
export const ITEM_USES_RECOVERY_OPTIONS: readonly ItemUsesRecoveryOption[] = [
  { value: 'dawn', label: 'На рассвете' },
  { value: 'longRest', label: 'После продолжительного отдыха' },
  { value: 'shortRest', label: 'После короткого отдыха' },
  { value: 'manual', label: 'Только вручную' },
];

/** Черновик «зарядов нет» — состояние блока при создании предмета. */
function emptyItemUses(): EditableItemUses {
  return {
    enabled: false,
    max: 1,
    current: 1,
    recovery: 'dawn',
    formula: '',
    cost: 1,
  };
}

/** Черновик блока зарядов и его преобразования в обе стороны. */
export function useItemUsesForm() {
  const itemUses = ref<EditableItemUses>(emptyItemUses());

  /** Сбрасывает блок к состоянию «зарядов нет» (создание предмета). */
  function resetItemUses(): void {
    itemUses.value = emptyItemUses();
  }

  /**
   * Заполняет черновик из предмета.
   *
   * @param uses - заряды редактируемого предмета
   */
  function loadItemUses(uses: ItemUses | undefined): void {
    itemUses.value = uses
      ? {
          enabled: true,
          max: uses.max,
          current: uses.current,
          recovery: uses.recovery,
          formula: uses.formula ?? '',
          cost: uses.cost ?? 1,
        }
      : emptyItemUses();
  }

  /**
   * Собирает заряды для сохраняемого предмета.
   *
   * @returns заряды или `undefined`, если у предмета их нет
   */
  function buildItemUses(): ItemUses | undefined {
    const draft = itemUses.value;

    if (!draft.enabled) {
      return undefined;
    }

    const max = Math.max(1, Math.round(draft.max || 1));
    const cost = Math.max(1, Math.round(draft.cost || 1));
    const formula = draft.formula.trim();

    return {
      max,
      current: Math.max(0, Math.min(max, draft.current)),
      recovery: draft.recovery,
      formula: formula || undefined,
      cost: cost > 1 ? cost : undefined,
    };
  }

  return { itemUses, resetItemUses, loadItemUses, buildItemUses };
}
