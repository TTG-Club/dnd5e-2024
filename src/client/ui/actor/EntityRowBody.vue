<script setup lang="ts">
  /**
   * Тело строки списка: значок, название с английским второй строкой и бейдж
   * источника, прижатый к правому краю.
   *
   * Одно на все списки — компендиум, окна выбора, справочники. Строка везде
   * означает одно и то же, и различать их по виду не за чем: показатели самой
   * записи (урон, стоимость, вес) в списке не нужны — за ними открывают
   * карточку. В списке важно опознать запись и увидеть, из какой она книги.
   *
   * Пометки, которые всё-таки нужны рядом с названием (концентрация и ритуал у
   * заклинания, повторяемость у черты), кладутся в слот `badges`: их немного, и
   * они меняют смысл записи, а не уточняют числа.
   */

  import type { SourceDefinition } from '@vtt/shared';

  import SourceBadge from './SourceBadge.vue';

  defineProps<{
    /** Значок типа записи; пусто — строка без значка */
    icon?: string;
    /**
     * Картинка записи — вместо значка: у существа это морда токена, и она
     * различает строки лучше любого значка. Пусто — показывается {@link icon}.
     */
    imageUrl?: string;
    name: string;
    /** Английское название — второй строкой */
    nameEn?: string;
    /** Ключ источника-книги */
    sourceKey?: string;
    /** Определение источника, вписанное вместе с записью */
    source?: SourceDefinition;
  }>();
</script>

<template>
  <img
    v-if="imageUrl"
    :src="imageUrl"
    :alt="name"
    loading="lazy"
    class="h-8 w-8 shrink-0 rounded-full border border-default/50 object-cover"
  />

  <UIcon
    v-else-if="icon"
    :name="icon"
    class="h-4 w-4 shrink-0 text-muted"
  />

  <span class="min-w-0 flex-1">
    <span class="block truncate text-sm font-medium text-highlighted">
      {{ name }}
    </span>

    <span
      v-if="nameEn"
      class="block truncate text-xs text-dimmed"
    >
      {{ nameEn }}
    </span>
  </span>

  <!-- Пометки записи — между названием и источником -->
  <slot name="badges" />

  <!-- Источник прижат к правому краю: по нему различают одноимённые записи
    разных книг, и взгляд ищет его всегда в одном месте -->
  <SourceBadge
    :source-key="sourceKey"
    :source="source"
    class="shrink-0"
  />
</template>
