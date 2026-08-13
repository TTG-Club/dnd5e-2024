<script setup lang="ts">
  import type { BackgroundEquipmentOption } from '@vtt/shared/system/dnd.js';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';

  import { BACKGROUND_WIZARD_LABELS } from '../constants';

  defineProps<{
    equipmentOptions: BackgroundEquipmentOption[];
  }>();
</script>

<template>
  <div class="space-y-6">
    <div class="space-y-2">
      <h3 class="font-serif text-xl font-medium text-highlighted">
        {{ BACKGROUND_WIZARD_LABELS.equipmentTitle }}
      </h3>

      <p class="text-sm text-muted">
        {{ BACKGROUND_WIZARD_LABELS.equipmentHint }}
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div
        v-for="(option, index) in equipmentOptions"
        :key="index"
        class="flex flex-col rounded-xl border border-default/50 bg-elevated/30 p-4"
      >
        <div
          class="mb-3 flex items-center justify-between border-b border-default/50 pb-2"
        >
          <span class="text-xs font-bold tracking-wider text-primary uppercase">
            {{
              index === 0
                ? BACKGROUND_WIZARD_LABELS.equipmentOptionA
                : BACKGROUND_WIZARD_LABELS.equipmentOptionB
            }}
          </span>

          <UIcon
            v-if="option.goldAlternative"
            name="tabler:coins"
            class="h-5 w-5 text-warning/80"
          />

          <UIcon
            v-else
            name="tabler:backpack"
            class="h-5 w-5 text-muted"
          />
        </div>

        <div class="flex-1 text-sm text-toned">
          <ItemDescriptionRenderer :content="option.description" />
        </div>

        <div
          v-if="option.goldAlternative"
          class="mt-4 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-warning"
        >
          <UIcon
            name="tabler:coin"
            class="h-5 w-5"
          />

          <span class="text-sm font-semibold"
            >{{ option.goldAlternative
            }}{{ BACKGROUND_WIZARD_LABELS.equipmentGoldSuffix }}</span
          >
        </div>
      </div>
    </div>
  </div>
</template>
