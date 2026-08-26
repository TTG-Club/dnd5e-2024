<script setup lang="ts">
  import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

  import { ref } from 'vue';

  import { useModalManager } from '@/shared_ui/composables/useModalManager';

  import { ACTIVE_EFFECT_DEFAULTS, MODAL_BUTTON_LABELS } from './constants';
  import ActiveEffectFormModal from './tabs/ActiveEffectFormModal.vue';

  const props = defineProps<{
    /**
     * Идентификатор окна редактора эффекта. Свой у каждой формы: имена окон —
     * плоское глобальное пространство, и два редактора с одним именем открылись
     * бы одним окном на двоих.
     */
    modalId: string;

    /** Пояснение над списком: чем эффекты записи отличаются от её даров. */
    hint: string;

    /** Что показать вместо пустого списка. */
    emptyText: string;

    /**
     * Спрятать блок ауры в редакторе эффекта. Записи, которые применяются к
     * своему носителю (черта, предыстория, вид, класс), аур не транслируют.
     */
    hideAura?: boolean;
  }>();

  const effects = defineModel<ActiveEffect[]>({ required: true });

  const { getNextZIndex } = useModalManager();

  const isModalOpen = ref(false);
  const modalZIndex = ref<number | undefined>(undefined);
  const editingEffect = ref<ActiveEffect | undefined>(undefined);

  /**
   * Иконка строки: у эффекта без своей — общая иконка эффекта.
   *
   * @param effect - эффект строки
   * @returns имя иконки
   */
  function iconOf(effect: ActiveEffect): string {
    return effect.icon || ACTIVE_EFFECT_DEFAULTS.fallbackIcon;
  }

  /** Открывает редактор пустым — под новый эффект. */
  function createEffect(): void {
    editingEffect.value = undefined;
    modalZIndex.value = getNextZIndex();
    isModalOpen.value = true;
  }

  /**
   * Открывает редактор на существующем эффекте.
   *
   * @param effect - эффект строки
   */
  function editEffect(effect: ActiveEffect): void {
    editingEffect.value = effect;
    modalZIndex.value = getNextZIndex();
    isModalOpen.value = true;
  }

  /**
   * Убирает эффект из списка.
   *
   * @param effectId - идентификатор эффекта
   */
  function deleteEffect(effectId: string): void {
    effects.value = effects.value.filter((effect) => effect.id !== effectId);
  }

  /**
   * Кладёт эффект в список: правка заменяет запись по id, новый уходит в конец.
   *
   * @param effect - эффект из редактора
   */
  function saveEffect(effect: ActiveEffect): void {
    const exists = effects.value.some((existing) => existing.id === effect.id);

    if (!exists) {
      effects.value = [...effects.value, effect];

      return;
    }

    effects.value = effects.value.map((existing) =>
      existing.id === effect.id ? effect : existing,
    );
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs text-dimmed">{{ props.hint }}</p>

    <div
      v-if="effects.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ props.emptyText }}
    </div>

    <div
      v-else
      class="space-y-1"
    >
      <div
        v-for="effect in effects"
        :key="effect.id"
        class="flex min-h-11 items-center gap-2 rounded-lg bg-elevated/50 p-2 transition-colors hover:bg-accented/50"
        :class="{ 'opacity-50 grayscale': effect.disabled }"
      >
        <UIcon
          :name="iconOf(effect)"
          class="size-5 shrink-0 text-primary"
        />

        <div class="min-w-0 flex-1">
          <span class="truncate text-sm font-medium">{{ effect.name }}</span>

          <div
            v-if="effect.description"
            class="mt-0.5 truncate text-[10px] text-dimmed"
          >
            {{ effect.description }}
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <UButton
            icon="tabler:pencil"
            size="xs"
            variant="ghost"
            color="neutral"
            @click.left.exact.prevent="editEffect(effect)"
          />

          <UButton
            icon="tabler:trash"
            size="xs"
            variant="ghost"
            color="error"
            @click.left.exact.prevent="deleteEffect(effect.id)"
          />
        </div>
      </div>
    </div>

    <UButton
      size="sm"
      color="primary"
      variant="soft"
      icon="tabler:plus"
      block
      class="mt-1"
      @click.left.exact.prevent="createEffect"
    >
      {{ MODAL_BUTTON_LABELS.addEffect }}
    </UButton>
  </div>

  <ActiveEffectFormModal
    v-model:open="isModalOpen"
    :modal-id="props.modalId"
    :z-index="modalZIndex"
    :effect="editingEffect"
    :hide-aura="props.hideAura"
    @save="saveEffect"
  />
</template>
