<!--
  Раздел «Ступени»: у эффекта с нарастающей бедой («Проклятие гибельного
  старения») каждая ступень несёт свои модификаторы и флаги. Переводит на
  следующую человек — кнопкой на листе или действием срабатывания.

  Первая ступень действует сразу: её модификаторы и флаги переписывают строки
  эффекта при наложении, поэтому раздел заменяет собой обычные строки, а не
  добавляется к ним.
-->
<script setup lang="ts">
  import type { ActiveEffect, EffectStage } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    MAX_EFFECT_STAGES,
    resolveEffectStageIndex,
  } from '@vtt/shared/system/dnd.js';

  import { EFFECT_STAGES_SECTION_LABELS } from '../constants';
  import EffectChangeRows from './EffectChangeRows.vue';
  import EffectFlagRows from './EffectFlagRows.vue';

  defineProps<{
    /** Показывать приоритет у всех модификаторов */
    showPriorityField: boolean;
  }>();

  const effect = defineModel<ActiveEffect>('effect', { required: true });

  const stages = computed<EffectStage[]>(() => effect.value.stages ?? []);

  /** Заголовки ступеней по номерам: «Ступень 1», «Ступень 2» */
  const stageTitles = computed(() =>
    stages.value.map(
      (_stage, index) =>
        `${EFFECT_STAGES_SECTION_LABELS.stagePrefix}${index + 1}`,
    ),
  );

  const canAddStage = computed(() => stages.value.length < MAX_EFFECT_STAGES);

  /**
   * Записывает список ступеней. Пустой список убирает ступени совсем — эффект
   * снова живёт своими строками. Номер действующей приводится к новому списку:
   * после удаления последней ступени он показывал бы в пустоту.
   *
   * @param next - новый список ступеней
   */
  function writeStages(next: EffectStage[]): void {
    effect.value = {
      ...effect.value,
      stages: next.length > 0 ? next : undefined,
      stageIndex:
        next.length > 0
          ? resolveEffectStageIndex({
              stages: next,
              stageIndex: effect.value.stageIndex,
            })
          : undefined,
    };
  }

  /**
   * Заменяет одну ступень.
   *
   * @param index - номер ступени
   * @param patch - новые поля ступени
   */
  function updateStage(index: number, patch: Partial<EffectStage>): void {
    writeStages(
      stages.value.map((stage, stageIndex) =>
        stageIndex === index ? { ...stage, ...patch } : stage,
      ),
    );
  }

  /**
   * Меняет подпись ступени. Пустая подпись не записывается: без неё ступень
   * не сохранится схемой.
   *
   * @param index - номер ступени
   * @param value - новая подпись
   */
  function updateStageLabel(index: number, value: string | number): void {
    const label = String(value).trim();

    if (label) {
      updateStage(index, { label });
    }
  }

  /** Добавляет ступень: первая забирает строки самого эффекта */
  function addStage(): void {
    const isFirst = stages.value.length === 0;

    writeStages([
      ...stages.value,
      {
        label: `${EFFECT_STAGES_SECTION_LABELS.stagePrefix}${stages.value.length + 1}`,
        changes: isFirst ? [...effect.value.changes] : [],
        flags: isFirst ? [...effect.value.flags] : [],
      },
    ]);
  }

  /**
   * Убирает ступень.
   *
   * @param index - номер ступени
   */
  function removeStage(index: number): void {
    writeStages(
      stages.value.filter((_stage, stageIndex) => stageIndex !== index),
    );
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div>
      <span class="text-xs font-medium text-default">
        {{ EFFECT_STAGES_SECTION_LABELS.title }}
      </span>

      <p class="text-xs text-muted">
        {{ EFFECT_STAGES_SECTION_LABELS.hint }}
      </p>
    </div>

    <div
      v-for="(stage, index) in stages"
      :key="index"
      class="flex flex-col gap-2 rounded-md border border-default p-2"
    >
      <div class="flex items-end gap-2">
        <UFormField
          :label="stageTitles[index]"
          class="flex-1"
        >
          <UInput
            :model-value="stage.label"
            size="sm"
            class="w-full"
            @update:model-value="updateStageLabel(index, $event)"
          />
        </UFormField>

        <UButton
          color="error"
          variant="ghost"
          size="xs"
          icon="tabler:x"
          :title="EFFECT_STAGES_SECTION_LABELS.remove"
          @click.left.exact.prevent="removeStage(index)"
        />
      </div>

      <EffectChangeRows
        :changes="stage.changes"
        :show-priority-field="showPriorityField"
        @update:changes="updateStage(index, { changes: $event })"
      />

      <EffectFlagRows
        :flags="stage.flags"
        @update:flags="updateStage(index, { flags: $event })"
      />
    </div>

    <UButton
      v-if="canAddStage"
      color="primary"
      variant="soft"
      size="xs"
      icon="tabler:plus"
      class="w-fit"
      :label="EFFECT_STAGES_SECTION_LABELS.add"
      @click.left.exact.prevent="addStage"
    />
  </div>
</template>
