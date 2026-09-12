import type { ComputedRef, Ref } from 'vue';

import type { BaseActor, EntityOwnership } from '@vtt/shared';

import { computed, ref, watch } from 'vue';

import { getEntityOwnerIds } from '@vtt/shared';

interface OwnershipSettings {
  selectedOwnerIds: Ref<string[]>;
  ownersChanged: ComputedRef<boolean>;
  ensureOwnershipCurrent: () => boolean;
  ownershipUpdates: ComputedRef<Pick<BaseActor, 'ownerId' | 'ownerIds'>>;
  resetOwnership: () => void;
}

/** Сравнивает состав управляющих независимо от порядка выбора. */
function sameOwners(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length
    && first.every((ownerId) => second.includes(ownerId))
  );
}

/** Хранит черновик прав отдельно от сущности и замечает конкурентное изменение доступа. */
export function useEntityOwnershipSettings(
  entity: () => EntityOwnership | null,
  onConflict: () => void,
): OwnershipSettings {
  const selectedOwnerIds = ref<string[]>([]);
  const initialOwnerIds = ref<string[]>([]);
  const currentOwnerIds = computed(() => getEntityOwnerIds(entity()));

  const ownersChanged = computed(
    () => !sameOwners(selectedOwnerIds.value, initialOwnerIds.value),
  );

  const ownersConflict = computed(
    () =>
      ownersChanged.value
      && !sameOwners(currentOwnerIds.value, initialOwnerIds.value),
  );

  const ownershipUpdates = computed<Pick<BaseActor, 'ownerId' | 'ownerIds'>>(
    () =>
      ownersChanged.value
        ? {
            ownerIds: [...selectedOwnerIds.value],
            ownerId: selectedOwnerIds.value[0],
          }
        : {},
  );

  /** Снимает новый снимок прав, сохраняя независимость локального массива. */
  function resetOwnership(): void {
    initialOwnerIds.value = [...currentOwnerIds.value];
    selectedOwnerIds.value = [...currentOwnerIds.value];
  }

  /** При конфликте обновляет черновик и сообщает вызывающему окну, что сохранение нужно остановить. */
  function ensureOwnershipCurrent(): boolean {
    if (!ownersConflict.value) {
      return true;
    }

    resetOwnership();
    onConflict();

    return false;
  }

  watch(currentOwnerIds, () => {
    // Пока пользователь не редактировал права, серверный список всегда актуальнее черновика.
    if (!ownersChanged.value) {
      resetOwnership();
    }
  });

  return {
    selectedOwnerIds,
    ownersChanged,
    ensureOwnershipCurrent,
    ownershipUpdates,
    resetOwnership,
  };
}
