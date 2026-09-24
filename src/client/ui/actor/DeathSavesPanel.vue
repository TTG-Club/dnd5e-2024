<!--
  Блок спасбросков от смерти листа (PHB 2024).

  Виден, пока хиты персонажа на нуле: три отметки успехов, три — провалов и
  кнопка броска. Отметки нажимаются — так поправляют серию руками (повторное
  нажатие по последней снимает её). Стабильный и погибший не бросают.
-->
<script setup lang="ts">
  import type { DeathSavesState } from '@vtt/shared/system/dnd.js';

  import type { DeathSaveMarkKind } from './constants';

  import { computed } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';
  import { DEATH_SAVES_TO_RESOLVE } from '@vtt/shared/system/dnd.js';

  import {
    DEATH_SAVE_MARK_CLASS,
    DEATH_SAVE_MARK_KINDS,
    DEATH_SAVE_STATUS_CLASS,
    DEATH_SAVES_BLOCK_LABELS,
  } from './constants';
  import { getSheetBlockClass } from './utils/sheetBlockClass';

  interface Props {
    /** Серия */
    state: DeathSavesState;
    /** Персонаж погиб */
    isDead: boolean;
    /** Лист в режиме правки */
    isEditMode: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    /** Бросить спасбросок */
    roll: [];
    /** Серия поправлена руками */
    update: [state: DeathSavesState];
  }>();

  const MARK_INDEXES = Array.from(
    { length: DEATH_SAVES_TO_RESOLVE },
    (_, index) => index + 1,
  );

  const blockClass = computed(() =>
    getSheetBlockClass({ isEditMode: props.isEditMode }),
  );

  const canRoll = computed(
    () => !props.isDead && !props.state.stable && !props.isEditMode,
  );

  const statusClass = computed(() =>
    props.isDead ? DEATH_SAVE_STATUS_CLASS.dead : DEATH_SAVE_STATUS_CLASS.alive,
  );

  const status = computed(() => {
    if (props.isDead) {
      return DEATH_SAVES_BLOCK_LABELS.dead;
    }

    return props.state.stable
      ? DEATH_SAVES_BLOCK_LABELS.stable
      : DEATH_SAVES_BLOCK_LABELS.hint;
  });

  /**
   * Оформление отметки.
   *
   * @param kind - успехи или провалы
   * @param index - номер отметки
   * @returns классы
   */
  function markClass(kind: DeathSaveMarkKind, index: number): string {
    return index > props.state[kind]
      ? DEATH_SAVE_MARK_CLASS.empty
      : DEATH_SAVE_MARK_CLASS[kind];
  }

  /**
   * Нажатие на отметку: ставит столько отметок, повторное — на одну меньше.
   *
   * @param kind - успехи или провалы
   * @param index - номер отметки
   */
  function handleMark(kind: DeathSaveMarkKind, index: number): void {
    const count = props.state[kind] === index ? index - 1 : index;

    emit('update', {
      successes: props.state.successes,
      failures: props.state.failures,
      [kind]: count,
    });
  }
</script>

<template>
  <FieldsetLabel
    :label="DEATH_SAVES_BLOCK_LABELS.title"
    class="w-full max-w-full bg-default/20 transition-colors"
    :class="blockClass"
  >
    <div class="flex flex-col gap-2 px-2 pb-2">
      <div class="flex items-center justify-between gap-2">
        <div
          v-for="kind in DEATH_SAVE_MARK_KINDS"
          :key="kind"
          class="flex items-center gap-1"
        >
          <span
            class="text-[10px] font-bold tracking-wider text-dimmed uppercase"
          >
            {{ DEATH_SAVES_BLOCK_LABELS[kind] }}
          </span>

          <button
            v-for="index in MARK_INDEXES"
            :key="index"
            type="button"
            class="size-5 cursor-pointer rounded-full border transition-colors"
            :class="markClass(kind, index)"
            :aria-label="`${DEATH_SAVES_BLOCK_LABELS[kind]} ${index}`"
            :aria-pressed="index <= state[kind]"
            @click.left.exact.prevent="handleMark(kind, index)"
          />
        </div>
      </div>

      <div
        class="flex items-center justify-between gap-2 border-t border-default/50 pt-2"
      >
        <p
          class="text-xs"
          :class="statusClass"
        >
          {{ status }}
        </p>

        <UButton
          v-if="canRoll"
          icon="tabler:skull"
          size="xs"
          color="error"
          variant="soft"
          :label="DEATH_SAVES_BLOCK_LABELS.roll"
          @click.left.exact.prevent="emit('roll')"
        />
      </div>
    </div>
  </FieldsetLabel>
</template>
