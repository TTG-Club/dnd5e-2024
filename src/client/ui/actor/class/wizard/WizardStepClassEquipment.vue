<script setup lang="ts">
  /**
   * Шаг мастера: стартовое снаряжение класса.
   *
   * Показывается один раз — при взятии класса на 1 уровне. Вариант с позициями
   * выбирается и уезжает в инвентарь; вариант без позиций (старые паки, свои
   * классы) только показывается строкой.
   */
  import type { ClassStartingEquipmentOption } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { hasGrantableEquipment } from '@vtt/shared/system/dnd.js';

  import { CLASS_EQUIPMENT_STEP_LABELS } from '../../constants';

  const props = defineProps<{
    options: ClassStartingEquipmentOption[];
  }>();

  const selectedIndex = defineModel<number | null>('selectedIndex', {
    default: null,
  });

  /** Есть ли хоть у одного варианта что выдать — иначе выбор не показываем. */
  const isSelectable = computed(() =>
    props.options.some(hasGrantableEquipment),
  );

  function selectOption(index: number): void {
    selectedIndex.value = selectedIndex.value === index ? null : index;
  }
</script>

<template>
  <div class="space-y-3">
    <span class="mb-2 block text-sm font-medium text-toned">
      {{
        isSelectable
          ? CLASS_EQUIPMENT_STEP_LABELS.chooseHint
          : CLASS_EQUIPMENT_STEP_LABELS.textOnlyHint
      }}
    </span>

    <div class="grid gap-3 sm:grid-cols-2">
      <component
        :is="isSelectable ? 'button' : 'div'"
        v-for="(option, index) in options"
        :key="option.key"
        :type="isSelectable ? 'button' : undefined"
        class="flex flex-col rounded-xl border p-3 text-left"
        :class="
          selectedIndex === index
            ? 'border-primary bg-primary/10'
            : 'border-default/50 bg-elevated/30'
        "
        @click.left.exact.prevent="isSelectable && selectOption(index)"
      >
        <span
          class="mb-2 text-xs font-bold tracking-wider text-primary uppercase"
        >
          {{ CLASS_EQUIPMENT_STEP_LABELS.optionPrefix }}{{ option.key }}
        </span>

        <div class="flex-1 text-sm text-toned">
          <ItemDescriptionRenderer :content="option.description" />
        </div>

        <div
          v-if="option.coins"
          class="mt-3 flex items-center gap-2 text-sm text-warning"
        >
          <UIcon
            name="tabler:coin"
            class="h-4 w-4"
          />

          {{ option.coins }}
        </div>
      </component>
    </div>
  </div>
</template>
