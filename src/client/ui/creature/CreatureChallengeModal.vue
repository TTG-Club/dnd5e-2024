<script setup lang="ts">
  /**
   * Окно уровня опасности существа.
   *
   * Список выбора стоял прямо в шапке и в режиме правки подменял собой число;
   * теперь число остаётся на месте, а правится этим окном. Бонус мастерства
   * лист пересчитывает по выбранному уровню сам.
   */
  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { CR_OPTIONS } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS } from '../actor/constants';
  import { CREATURE_CHALLENGE_LABELS } from './constants';

  interface Props {
    open: boolean;
    /** Показатель опасности существа: «5», «1/2», «—» */
    challengeRating: string;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [challengeRating: string];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftChallengeRating = ref(props.challengeRating);

  /**
   * Заводит черновик по данным листа. Окно живёт в шапке постоянно, поэтому
   * черновик собирается на каждом открытии — иначе оно показывало бы то
   * существо, с которым его открыли впервые.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      draftChallengeRating.value = props.challengeRating;
    },
  );

  /** Отдаёт уровень опасности на лист и закрывает окно */
  function applyChallengeRating(): void {
    emit('apply', draftChallengeRating.value);

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="400"
    :min-height="220"
    :title="CREATURE_CHALLENGE_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField :label="CREATURE_CHALLENGE_LABELS.title">
          <USelect
            v-model="draftChallengeRating"
            :items="CR_OPTIONS"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-full"
          />
        </UFormField>

        <p class="text-xs leading-relaxed text-dimmed">
          {{ CREATURE_CHALLENGE_LABELS.hint }}
        </p>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applyChallengeRating"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
