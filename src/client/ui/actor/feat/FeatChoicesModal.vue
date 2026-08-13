<script setup lang="ts">
  import type { DnDActor, FeatChoice } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    calculateProficiencyBonus,
    getTotalLevel,
    resolveFeatChoiceCount,
    resolveFeatChoicePool,
  } from '@vtt/shared/system/dnd.js';

  import { FEAT_CHOICES_LABELS, MODAL_BUTTON_LABELS } from '../constants';
  import FeatChoicesFields from './FeatChoicesFields.vue';

  /**
   * Окно выбора при взятии черты: «Умелый» просит три навыка, «Мастер оружия» —
   * вид оружия. Открывается перед применением черты и отдаёт сделанный выбор
   * наверх; лист применяет черту уже вместе с ним.
   *
   * Пустой пул не блокирует: у черты вроде «Знатока» подходящих навыков может не
   * оказаться вовсе, и запрещать взять её из-за этого неправильно — мастер
   * разберётся.
   */
  const props = defineProps<{
    open: boolean;
    /** Название черты — в заголовке окна */
    featName: string;
    /** Выборы, которые предстоит сделать */
    choices: FeatChoice[];
    /** Лист персонажа */
    actor: DnDActor;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Выбор сделан: ключ выбора → выбранные значения */
    'apply': [selections: Record<string, string[]>];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const selections = ref<Record<string, string[]>>({});

  const proficiencyBonus = computed(() =>
    calculateProficiencyBonus(getTotalLevel(props.actor.system.classes)),
  );

  /**
   * Все обязательные выборы сделаны. Выбор с пустым пулом не считается
   * незавершённым: выбирать в нём нечего.
   */
  const isComplete = computed(() =>
    props.choices.every((choice) => {
      const pool = resolveFeatChoicePool(choice, props.actor);

      if (pool.length === 0) {
        return true;
      }

      const max = resolveFeatChoiceCount(choice, proficiencyBonus.value);
      const chosen = selections.value[choice.key]?.length ?? 0;

      return chosen >= Math.min(max, pool.length);
    }),
  );

  // Открытие — это новая черта: старый выбор к ней отношения не имеет
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        selections.value = {};
      }
    },
  );

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
    :title="`${FEAT_CHOICES_LABELS.title}: ${featName}`"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <FeatChoicesFields
          v-model="selections"
          :choices="choices"
          :actor="actor"
          :proficiency-bonus="proficiencyBonus"
        />

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
            :disabled="!isComplete"
            @click.left.exact.prevent="apply"
          >
            {{ FEAT_CHOICES_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
