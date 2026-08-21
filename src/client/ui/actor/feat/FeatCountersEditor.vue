<script setup lang="ts">
  import type { EditableFeatCounter } from './featEditorTypes';

  import { FEAT_GRANTS_LABELS } from '../constants';
  import CounterMaxField from '../CounterMaxField.vue';
  import FieldHint from '../FieldHint.vue';
  import { createFeatCounter } from './featEditorTypes';

  /**
   * Редактор ресурсов черты: счётчик с максимумом-формулой и откатом от отдыха.
   * Максимум формулой, а не числом, потому что у большинства таких ресурсов он
   * привязан к бонусу мастерства и обязан расти вместе с ним («Удачливый»).
   * Формулу автор не набирает — источник выбирается списком
   * ({@link CounterMaxField}), она лишь остаётся форматом хранения.
   */
  const counters = defineModel<EditableFeatCounter[]>({ required: true });

  const recoveryOptions = [
    { value: 'short', label: FEAT_GRANTS_LABELS.recoveryShort },
    { value: 'long', label: FEAT_GRANTS_LABELS.recoveryLong },
  ];

  function addCounter(): void {
    counters.value = [
      ...counters.value,
      createFeatCounter(new Set(counters.value.map((entry) => entry.key))),
    ];
  }

  function removeCounter(index: number): void {
    counters.value = counters.value.filter(
      (_, counterIndex) => counterIndex !== index,
    );
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="flex items-center gap-1 text-xs text-dimmed">
      {{ FEAT_GRANTS_LABELS.countersHint }}
      <FieldHint :text="FEAT_GRANTS_LABELS.countersHintDetails" />
    </p>

    <div
      v-if="counters.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ FEAT_GRANTS_LABELS.countersEmpty }}
    </div>

    <div
      v-for="(counter, index) in counters"
      :key="counter.uid"
      class="flex flex-wrap items-end gap-2 rounded-lg bg-elevated/40 p-2"
    >
      <UFormField
        :label="FEAT_GRANTS_LABELS.counterName"
        class="flex-1"
      >
        <UInput
          v-model="counter.name"
          :placeholder="FEAT_GRANTS_LABELS.counterNamePlaceholder"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UFormField
        :label="FEAT_GRANTS_LABELS.counterShortName"
        class="w-24"
      >
        <UInput
          v-model="counter.shortName"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <CounterMaxField
        v-model="counter.max"
        dense
      />

      <UFormField
        :label="FEAT_GRANTS_LABELS.counterRecovery"
        class="w-52"
      >
        <USelect
          v-model="counter.recovery"
          :items="recoveryOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-full"
        />
      </UFormField>

      <UButton
        icon="tabler:trash"
        color="error"
        variant="ghost"
        size="xs"
        class="mb-1"
        :aria-label="counter.name || FEAT_GRANTS_LABELS.countersTitle"
        @click.left.exact.prevent="removeCounter(index)"
      />
    </div>

    <UButton
      icon="tabler:plus"
      :label="FEAT_GRANTS_LABELS.addCounter"
      color="primary"
      variant="soft"
      block
      @click.left.exact.prevent="addCounter"
    />
  </div>
</template>
