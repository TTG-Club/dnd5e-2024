<script setup lang="ts">
  /**
   * Строка списка глоссария в браузере компендиума.
   *
   * Термин — справочный текст, а не сущность листа персонажа: строку нельзя
   * перетащить, скопировать в предметы или вызвать на ней контекстное меню.
   * Единственное действие — клик, открывающий описание.
   */

  import type { SourceDefinition } from '@vtt/shared';

  import { useListRowClass } from '../../composables/useListRowClass';
  import EntityRowBody from '../actor/EntityRowBody.vue';

  /** Поля термина, нужные для отрисовки строки */
  interface GlossaryDisplayItem {
    id: string;
    name: string;
    nameEn?: string;
    /** Раздел глоссария («Состояния», «Действия») — подпись справа */
    category?: string;
    /** Ключ источника-книги */
    sourceKey?: string;
    /** Определение источника, вписанное вместе с записью */
    source?: SourceDefinition;
  }

  const props = defineProps<{
    item: GlossaryDisplayItem;
    /**
     * Плоская строка списка: без своей плашки и скругления. Так строка встаёт в
     * список с разделителями (компендиум и окна выбора); на листе персонажа
     * строки стоят порознь, и плашка им нужна.
     */
    flat?: boolean;
  }>();

  /** Оформление строки: плоская в списке, плашкой на листе персонажа */
  const rowClass = useListRowClass(() => Boolean(props.flat));

  const emit = defineEmits<{
    /** Клик по строке (открыть описание) */
    click: [];
  }>();
</script>

<template>
  <div
    class="flex cursor-pointer items-center gap-3 py-2 transition-colors"
    :class="rowClass"
    @click.left.exact.prevent="emit('click')"
  >
    <EntityRowBody
      :name="item.name"
      :name-en="item.nameEn"
      :source-key="item.sourceKey"
      :source="item.source"
    >
      <template #badges>
        <!-- Раздел глоссария («Состояния», «Действия») -->
        <UBadge
          v-if="item.category"
          color="neutral"
          variant="subtle"
          size="sm"
          class="shrink-0"
        >
          {{ item.category }}
        </UBadge>
      </template>
    </EntityRowBody>
  </div>
</template>
