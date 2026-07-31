<script setup lang="ts">
  /**
   * Шаг мастера предыстории: инструменты.
   *
   * Два независимых источника владения. Первый — выбор из своего списка
   * (`toolGrant.choices`), так предыстории заводят в панели «Предметы»: там
   * варианты сразу лежат ключами словаря. Второй — `toolGrant.items`, куда
   * компендиум TTG Club кладёт владение человекочитаемым текстом; его разбирает
   * общий блок выдачи, он же предлагает завести неузнанный инструмент.
   */
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { BackgroundDefinition } from '@vtt/shared/system/dnd.js';

  import { toolProficiencyLabel } from '@vtt/shared/system/dnd.js';
  import { computed } from 'vue';

  import ToolProficiencyGrant from '../ToolProficiencyGrant.vue';

  const props = defineProps<{
    backgroundDefinition: BackgroundDefinition;
    socket: TypedWebSocketClient | null;
  }>();

  /** Выбранное из собственного списка предыстории */
  const choiceSelections = defineModel<string[]>('choiceSelections', {
    default: () => [],
  });

  /** Ключи, разобранные из текстового владения компендиума */
  const grantedTools = defineModel<string[]>('grantedTools', {
    default: () => [],
  });

  const emit = defineEmits<{
    /** Текстовое владение разобрано полностью (все выборы сделаны) */
    'update:grantComplete': [value: boolean];
  }>();

  const neededSelectionsCount = computed(
    () => props.backgroundDefinition.toolGrant.choices?.count || 0,
  );

  const options = computed(
    () => props.backgroundDefinition.toolGrant.choices?.from || [],
  );

  const toolSources = computed(
    () => props.backgroundDefinition.toolGrant.items ?? [],
  );

  function toggleTool(tool: string) {
    const index = choiceSelections.value.indexOf(tool);

    if (index !== -1) {
      choiceSelections.value = choiceSelections.value.filter(
        (entry) => entry !== tool,
      );

      return;
    }

    if (neededSelectionsCount.value === 1) {
      choiceSelections.value = [tool];

      return;
    }

    if (choiceSelections.value.length < neededSelectionsCount.value) {
      choiceSelections.value = [...choiceSelections.value, tool];
    }
  }

  function isSelected(tool: string) {
    return choiceSelections.value.includes(tool);
  }
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <h3 class="text-lg font-medium text-highlighted">Инструменты</h3>
    </div>

    <!-- Владение из компендиума: текст сопоставляется со словарём -->
    <ToolProficiencyGrant
      v-if="toolSources.length > 0"
      v-model:selected="grantedTools"
      :sources="toolSources"
      :socket="socket"
      @update:complete="emit('update:grantComplete', $event)"
    />

    <!-- Выбор из собственного списка предыстории -->
    <div
      v-if="neededSelectionsCount > 0"
      class="space-y-3"
    >
      <p class="text-center text-sm text-muted">
        Выберите дополнительно инструментов:
        <span class="font-bold text-primary-400">{{
          neededSelectionsCount
        }}</span>
        (выбрано: {{ choiceSelections.length }})
      </p>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          v-for="tool in options"
          :key="tool"
          class="flex flex-col items-center justify-center gap-2 rounded-lg border p-4 transition-all"
          :class="[
            isSelected(tool)
              ? 'border-primary-500 bg-primary-500/10 text-primary-400 shadow-[0_0_15px_rgba(var(--color-primary-500),0.15)] ring-1 ring-primary-500'
              : 'border-default text-muted hover:border-accented hover:bg-elevated/50',
          ]"
          @click.left.exact.prevent="toggleTool(tool)"
        >
          <span class="text-center text-sm font-medium">
            {{ toolProficiencyLabel(tool) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
