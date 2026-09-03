<script setup lang="ts">
  /**
   * Окно размера, вида и мировоззрения существа.
   *
   * Строка «Средний — Исчадие — Законное злое» в шапке в режиме правки
   * разворачивалась в три списка и сдвигала всё под собой. Теперь она остаётся
   * строкой, а правится этим окном.
   *
   * Правки копятся в черновике до «Применить»: лист узнаёт о них по кнопке.
   */
  import type {
    CreatureAlignment,
    CreatureCategory,
    CreatureSize,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    CREATURE_ALIGNMENT_OPTIONS,
    CREATURE_CATEGORY_OPTIONS,
    CREATURE_SIZE_OPTIONS,
    isCreatureAlignment,
    isCreatureCategory,
    isCreatureSize,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS } from '../actor/constants';
  import { CREATURE_HEADER_LABELS, CREATURE_KIND_LABELS } from './constants';

  /** Вид существа из окна — все три поля уходят на лист одной правкой */
  export interface CreatureKindResult {
    size: CreatureSize;
    type: CreatureCategory;
    alignment: CreatureAlignment;
  }

  interface Props {
    open: boolean;
    size: CreatureSize;
    /** Вид существа: зверь, нежить, исчадие… */
    creatureType: CreatureCategory;
    alignment: CreatureAlignment;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [result: CreatureKindResult];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftSize = ref<CreatureSize>(props.size);
  const draftType = ref<CreatureCategory>(props.creatureType);
  const draftAlignment = ref<CreatureAlignment>(props.alignment);

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

      draftSize.value = props.size;
      draftType.value = props.creatureType;
      draftAlignment.value = props.alignment;
    },
  );

  // Списки выбора отдают ключ строкой — на лист он уходит через проверки
  // движка, которыми разбираются и данные компендиумов.

  /** Запоминает выбранный размер в черновике */
  function onSizeSelect(value: string): void {
    if (isCreatureSize(value)) {
      draftSize.value = value;
    }
  }

  /** Запоминает выбранный вид в черновике */
  function onTypeSelect(value: string): void {
    if (isCreatureCategory(value)) {
      draftType.value = value;
    }
  }

  /** Запоминает выбранное мировоззрение в черновике */
  function onAlignmentSelect(value: string): void {
    if (isCreatureAlignment(value)) {
      draftAlignment.value = value;
    }
  }

  /** Отдаёт вид существа на лист и закрывает окно */
  function applyKind(): void {
    emit('apply', {
      size: draftSize.value,
      type: draftType.value,
      alignment: draftAlignment.value,
    });

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="440"
    :min-height="280"
    :title="CREATURE_KIND_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField :label="CREATURE_HEADER_LABELS.size">
          <USelect
            :model-value="draftSize"
            :items="CREATURE_SIZE_OPTIONS"
            value-key="value"
            label-key="label"
            size="md"
            class="w-full"
            @update:model-value="onSizeSelect"
          />
        </UFormField>

        <UFormField :label="CREATURE_HEADER_LABELS.type">
          <USelect
            :model-value="draftType"
            :items="CREATURE_CATEGORY_OPTIONS"
            value-key="value"
            label-key="label"
            size="md"
            class="w-full"
            @update:model-value="onTypeSelect"
          />
        </UFormField>

        <UFormField :label="CREATURE_HEADER_LABELS.alignment">
          <USelect
            :model-value="draftAlignment"
            :items="CREATURE_ALIGNMENT_OPTIONS"
            value-key="value"
            label-key="label"
            size="md"
            class="w-full"
            @update:model-value="onAlignmentSelect"
          />
        </UFormField>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
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
            @click.left.exact.prevent="applyKind"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
