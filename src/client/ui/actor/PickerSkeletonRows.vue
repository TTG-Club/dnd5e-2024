<script setup lang="ts">
  /**
   * Заглушка списка окна выбора, пока записи компендиума грузятся: окно
   * открывается сразу, а на месте строк видны их очертания — название,
   * английское название под ним и пометка справа, как у настоящей строки.
   */

  import {
    PICKER_SKELETON_NAME_WIDTH_CLASSES,
    PICKER_SKELETON_ROW_COUNT,
  } from './constants';

  const rows = [
    ...Array.from({ length: PICKER_SKELETON_ROW_COUNT }).keys(),
  ].map((index) => ({
    id: index,
    nameWidthClass:
      PICKER_SKELETON_NAME_WIDTH_CLASSES[
        index % PICKER_SKELETON_NAME_WIDTH_CLASSES.length
      ],
  }));
</script>

<template>
  <div
    class="flex flex-col divide-y divide-accented/25"
    aria-busy="true"
  >
    <div
      v-for="row in rows"
      :key="row.id"
      class="flex items-center gap-3 px-2 py-2"
    >
      <USkeleton class="size-4 shrink-0 rounded" />

      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <USkeleton
          class="h-3.5"
          :class="row.nameWidthClass"
        />

        <USkeleton class="h-2.5 w-1/4" />
      </div>

      <USkeleton class="h-4 w-10 shrink-0 rounded-full" />
    </div>
  </div>
</template>
