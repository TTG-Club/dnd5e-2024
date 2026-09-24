<script setup lang="ts">
  import type { DamagePart } from '@vtt/shared';

  import type { DamagePreviewRow } from './utils/buildDamagePreviewRows';

  import { computed } from 'vue';

  import { previewDamagePart } from '@vtt/shared/system/dnd.js';

  import { DAMAGE_PART_LABELS } from './constants';
  import { buildDamagePreviewRows } from './utils/buildDamagePreviewRows';

  const props = defineProps<{
    /** Часть урона/лечения, чей итог показывается */
    part: DamagePart;
    /** Опции типов урона: по ним ключ типа становится названием мира */
    damageTypeOptions: Array<{ label: string; value: string }>;
  }>();

  const preview = computed(() => previewDamagePart(props.part));

  /** Названия типов урона мира по ключу */
  const typeLabels = computed<ReadonlyMap<string, string>>(
    () =>
      new Map(
        props.damageTypeOptions.map((option) => [option.value, option.label]),
      ),
  );

  const rows = computed<DamagePreviewRow[]>(() =>
    buildDamagePreviewRows(preview.value, typeLabels.value),
  );

  const unknownTokensLabel = computed<string>(() =>
    preview.value.unknownTokens.join(', '),
  );

  const isVisible = computed<boolean>(
    () => rows.value.length > 0 || unknownTokensLabel.value.length > 0,
  );
</script>

<template>
  <div
    v-if="isVisible"
    class="flex items-start gap-2 rounded-md bg-elevated/40 px-2.5 py-1.5 text-xs"
  >
    <div class="flex shrink-0 items-center gap-1 pt-0.5 text-dimmed">
      <span>{{ DAMAGE_PART_LABELS.previewTitle }}</span>

      <UTooltip :ui="{ content: 'h-auto max-w-72 py-1.5' }">
        <UIcon
          name="tabler:info-circle-filled"
          class="size-3.5 shrink-0 cursor-help transition-colors hover:text-default"
        />

        <template #content>
          <span class="whitespace-normal">
            {{ DAMAGE_PART_LABELS.previewHint }}
          </span>
        </template>
      </UTooltip>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div
        v-for="row in rows"
        :key="row.key"
        class="flex flex-wrap items-center gap-x-1.5 gap-y-1"
      >
        <span
          v-if="row.condition"
          class="text-muted"
        >
          {{ row.condition }}:
        </span>

        <template
          v-for="(segment, segmentIndex) in row.segments"
          :key="segmentIndex"
        >
          <span
            v-if="segmentIndex > 0"
            class="text-dimmed"
          >
            +
          </span>

          <span class="font-medium text-highlighted">
            {{ segment.formula }}
          </span>

          <UBadge
            v-for="badge in segment.badges"
            :key="badge.label"
            :label="badge.label"
            :color="badge.color"
            variant="subtle"
            size="sm"
          />
        </template>
      </div>

      <p
        v-if="unknownTokensLabel"
        class="text-error"
      >
        {{ DAMAGE_PART_LABELS.previewUnknown }}{{ unknownTokensLabel }}
      </p>
    </div>
  </div>
</template>
