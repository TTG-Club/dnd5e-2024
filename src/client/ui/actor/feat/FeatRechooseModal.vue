<script setup lang="ts">
  import type { DnDActor } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    calculateProficiencyBonus,
    collectRechoosableFeats,
    getTotalLevel,
  } from '@vtt/shared/system/dnd.js';

  import {
    FEAT_CHOICES_LABELS,
    MODAL_BUTTON_LABELS,
    REST_LABELS,
  } from '../constants';
  import FeatChoicesFields from './FeatChoicesFields.vue';

  /**
   * Пересмотр выборов черт на продолжительном отдыхе: «Мастер оружия» меняет вид
   * оружия, «Дар устойчивости к энергиям» — типы урона.
   *
   * Открывается сразу после отдыха, когда такие черты есть. Уже сделанный выбор
   * подставлен: закрыть окно, ничего не трогая, — законный исход, менять выбор
   * никто не обязан.
   */
  const props = defineProps<{
    open: boolean;
    actor: DnDActor;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Новый выбор по чертам: id особенности → (ключ выбора → значения) */
    'apply': [selections: Record<string, Record<string, string[]>>];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Черты с пересматриваемыми выборами */
  const feats = computed(() => collectRechoosableFeats(props.actor));

  /** Выбор по каждой черте: id особенности → (ключ выбора → значения) */
  const selections = ref<Record<string, Record<string, string[]>>>({});

  const proficiencyBonus = computed(() =>
    calculateProficiencyBonus(getTotalLevel(props.actor.system.classes)),
  );

  /** Текущий выбор черты — с ним окно и открывается */
  function currentSelections(featureId: string): Record<string, string[]> {
    const feature = props.actor.features?.find(
      (entry) => entry.id === featureId,
    );

    return (
      (feature as { choices?: Record<string, string[]> } | undefined)?.choices
      ?? {}
    );
  }

  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      const initial: Record<string, Record<string, string[]>> = {};

      for (const entry of feats.value) {
        initial[entry.featureId] = { ...currentSelections(entry.featureId) };
      }

      selections.value = initial;
    },
    { immediate: true },
  );

  /** Двусторонняя привязка выбора одной черты для общего блока полей */
  function featSelections(featureId: string) {
    return computed({
      get: () => selections.value[featureId] ?? {},
      set: (value: Record<string, string[]>) => {
        selections.value = { ...selections.value, [featureId]: value };
      },
    });
  }

  function apply(): void {
    emit('apply', { ...selections.value });
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="420"
    :min-height="260"
    :title="FEAT_CHOICES_LABELS.rechooseTitle"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-xs text-dimmed">
          {{ FEAT_CHOICES_LABELS.rechooseHint }}
        </p>

        <div
          v-for="entry in feats"
          :key="entry.featureId"
          class="space-y-2"
        >
          <span class="text-xs font-bold tracking-wider text-primary uppercase">
            {{ entry.featureName }}
          </span>

          <FeatChoicesFields
            v-model="featSelections(entry.featureId).value"
            :choices="entry.choices"
            :actor="actor"
            :proficiency-bonus="proficiencyBonus"
          />
        </div>

        <div class="border-t border-muted" />

        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            size="md"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="md"
            @click.left.exact.prevent="apply"
          >
            {{ REST_LABELS.long }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
