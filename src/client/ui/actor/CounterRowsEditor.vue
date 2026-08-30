<script setup lang="ts">
  /**
   * Редактор ресурсов — один на класс, его умение, подкласс, черту и вид.
   *
   * Максимум задаётся либо источником ({@link CounterMaxField}: бонус
   * мастерства, модификатор характеристики, уровень), либо ступенями по
   * уровням. Ступени старше формулы, поэтому пока они есть, поле максимума
   * уступает им место: ряд «на 3-м два, на 7-м три» формулой не пишется.
   *
   * Уровень появления есть только у счётчика класса и подкласса: ресурс умения
   * появляется вместе с самим умением, своего уровня у него нет. А колонкой
   * таблицы просится и он — таблица одна на класс, и ресурс умения показывается
   * в ней наравне с классовым (`withFeatureCounters`).
   */
  import type { EditableResourceCounter } from './counterEditorTypes';

  import { COUNTER_RECOVERY_OPTIONS, FEAT_GRANTS_LABELS } from './constants';
  import {
    createProgressionEntry,
    createResourceCounter,
  } from './counterEditorTypes';
  import CounterMaxField from './CounterMaxField.vue';
  import FieldHint from './FieldHint.vue';

  const counters = defineModel<EditableResourceCounter[]>({ required: true });

  withDefaults(
    defineProps<{
      /** Показывать уровень появления: он есть у класса и подкласса */
      withStartLevel?: boolean;
      /** Показывать галочку колонки: есть у всего, что попадает в таблицу класса */
      withTableColumn?: boolean;
    }>(),
    { withStartLevel: false, withTableColumn: false },
  );

  function addCounter(): void {
    counters.value = [
      ...counters.value,
      createResourceCounter(new Set(counters.value.map((entry) => entry.key))),
    ];
  }

  function removeCounter(index: number): void {
    counters.value = counters.value.filter(
      (_, counterIndex) => counterIndex !== index,
    );
  }

  /** Добавляет ступень; с первой же ступени максимум считается по ним. */
  function addStep(counter: EditableResourceCounter): void {
    counter.progression.push(createProgressionEntry(counter));
  }

  /** Убирает ступень; убрали последнюю — максимум снова считается формулой. */
  function removeStep(counter: EditableResourceCounter, index: number): void {
    counter.progression.splice(index, 1);
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
      class="flex flex-col gap-2 rounded-lg bg-elevated/40 p-2"
    >
      <div class="flex flex-wrap items-end gap-2">
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

        <UFormField
          v-if="withStartLevel"
          :label="FEAT_GRANTS_LABELS.counterStartLevel"
          class="w-30"
        >
          <UInputNumber
            v-model="counter.startLevel"
            :min="1"
            :max="20"
            size="sm"
            class="w-full"
          />
        </UFormField>

        <!-- Пока есть ступени, максимум задают они: поле формулы уступает им
          место, чтобы не показывать значение, которое ни на что не влияет -->
        <CounterMaxField
          v-if="counter.progression.length === 0"
          v-model="counter.max"
          v-model:minimum="counter.min"
          dense
        />

        <UFormField
          :label="FEAT_GRANTS_LABELS.counterRecovery"
          class="w-64"
        >
          <USelect
            v-model="counter.recovery"
            :items="COUNTER_RECOVERY_OPTIONS"
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

      <!-- Ступени и колонка таблицы — второй строкой: в первой они не помещались
        и разрывали ряд полей на каждом ресурсе -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          v-for="(entry, entryIndex) in counter.progression"
          :key="entry.uid"
          class="flex items-center gap-1.5"
        >
          <span class="text-xs text-muted">
            {{ FEAT_GRANTS_LABELS.counterStepLevel }}
          </span>

          <UInputNumber
            v-model="entry.level"
            :min="1"
            :max="20"
            size="sm"
            class="w-22.5"
          />

          <span class="text-xs text-muted">
            {{ FEAT_GRANTS_LABELS.counterStepArrow }}
          </span>

          <UInputNumber
            v-model="entry.value"
            :min="0"
            :max="999"
            size="sm"
            class="w-25"
          />

          <UButton
            icon="tabler:trash"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="FEAT_GRANTS_LABELS.counterStepRemove"
            @click.left.exact.prevent="removeStep(counter, entryIndex)"
          />
        </div>

        <div class="flex items-center gap-1.5">
          <UButton
            icon="tabler:plus"
            :label="FEAT_GRANTS_LABELS.counterStepAdd"
            color="neutral"
            variant="soft"
            size="xs"
            @click.left.exact.prevent="addStep(counter)"
          />

          <FieldHint :text="FEAT_GRANTS_LABELS.counterStepsHint" />
        </div>

        <!-- Ряд по уровням у ресурса уже задан ступенями либо формулой: колонка
          книги собирается из него, второй раз его не набирают -->
        <UTooltip
          v-if="withTableColumn"
          :delay-duration="300"
          :text="FEAT_GRANTS_LABELS.counterShowInTableHint"
        >
          <UCheckbox
            v-model="counter.showInTable"
            :label="FEAT_GRANTS_LABELS.counterShowInTable"
          />
        </UTooltip>
      </div>
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
