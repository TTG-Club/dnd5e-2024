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

  import { useTemplateRef } from 'vue';

  import { useListImage } from '../../composables/useListImage';
  import SourceBadge from './SourceBadge.vue';

  const props = defineProps<{
    /** Значок типа записи; пусто — строка без значка */
    icon?: string;
    /**
     * Картинка записи — вместо значка: у существа это морда токена, и она
     * различает строки лучше любого значка. Пусто — показывается {@link icon}.
     */
    imageUrl?: string;
    /**
     * Строка с портретом: кругляш токена стоит всегда, даже когда картинки нет
     * или она не доехала — внутри него тогда виден {@link icon}. Без этого
     * строки без картинки шли с узким значком и разъезжались с соседями.
     */
    avatar?: boolean;
    name: string;
    /** Английское название — второй строкой */
    nameEn?: string;
    /** Ключ источника-книги */
    sourceKey?: string;
    /** Определение источника, вписанное вместе с записью */
    source?: SourceDefinition;
  }>();

  /**
   * Картинка через общую очередь: в тег она попадает уже загруженной, поэтому
   * «сломанный» значок браузера в списке не появляется даже при быстром скролле.
   */
  const avatarSlotRef = useTemplateRef<HTMLElement>('avatarSlot');

  const { imageSrc, handleImageError } = useListImage(
    () => props.imageUrl,
    avatarSlotRef,
  );
</script>

<template>
  <!-- Портрет записи: рамка держит место сама, поэтому строки с картинкой и
    без неё стоят вровень -->
  <span
    v-if="avatar || imageUrl"
    ref="avatarSlot"
    class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default/50 bg-elevated"
  >
    <img
      v-if="imageSrc"
      :src="imageSrc"
      :alt="name"
      class="h-full w-full object-cover"
      @error="handleImageError"
    />

    <UIcon
      v-else-if="icon"
      :name="icon"
      class="h-4 w-4 text-muted"
    />
  </span>

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
