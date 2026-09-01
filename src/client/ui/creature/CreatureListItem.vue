<script setup lang="ts">
  /**
   * Элемент списка существ в компендиуме.
   * Отображает имя, подзаголовок (header) и показатель опасности.
   * Поддерживает контекстное меню (ПКМ) для копирования.
   */
  import type { SourceDefinition } from '@vtt/shared';

  import { useContextMenu } from '@/systems/dnd5e/composables/useContextMenu';
  import ContextMenuOverlay from '@/systems/dnd5e/ui/actor/ContextMenuOverlay.vue';

  import { useListRowClass } from '../../composables/useListRowClass';
  import EntityRowBody from '../actor/EntityRowBody.vue';
  import { CREATURE_LIST_ITEM_LABELS } from './constants';

  interface Props {
    /** Название существа */
    name: string;
    /** Английское название существа */
    nameEn?: string;
    /** Показатель опасности (из system.challengeRating) */
    challengeRating?: string;
    /** Показать кнопку «Скопировать» в ПКМ-меню */
    showCopy?: boolean;
    /** Картинка токена — вместо значка в строке списка */
    imageUrl?: string;
    /** Ключ источника-книги — бейджем справа в строке списка */
    sourceKey?: string;
    /** Определение источника, вписанное вместе с записью */
    source?: SourceDefinition;
    /**
     * Плоская строка списка: без своей плашки и скругления. Так строка встаёт в
     * список с разделителями (компендиум и окна выбора); на листе персонажа
     * строки стоят порознь, и плашка им нужна.
     */
    flat?: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    click: [];
    copy: [];
    edit: [];
    delete: [];
  }>();

  /** Оформление строки: плоская в списке, плашкой на листе персонажа */
  const rowClass = useListRowClass(() => Boolean(props.flat));

  const { isMenuOpen, menuX, menuY, openContextMenu, handleAction, closeMenu } =
    useContextMenu(props, emit);
</script>

<template>
  <div
    class="flex cursor-pointer items-center gap-3 py-2 transition-colors"
    :class="rowClass"
    @click.left.exact.prevent="emit('click')"
    @contextmenu="openContextMenu"
  >
    <!-- Морда токена вместо значка: одинаковый «пришелец» строки не различал.
      Токена у существа может и не быть — тогда он и остаётся -->
    <EntityRowBody
      :image-url="imageUrl"
      icon="tabler:alien"
      :name="name"
      :name-en="nameEn"
      :source-key="sourceKey"
      :source="source"
    >
      <template #badges>
        <!-- Показатель опасности — по нему существ и подбирают -->
        <UBadge
          v-if="challengeRating"
          color="neutral"
          variant="subtle"
          size="xs"
          class="shrink-0"
        >
          {{ CREATURE_LIST_ITEM_LABELS.challengeRatingPrefix
          }}{{ challengeRating }}
        </UBadge>
      </template>
    </EntityRowBody>
  </div>

  <ContextMenuOverlay
    :is-open="isMenuOpen"
    :pos-x="menuX"
    :pos-y="menuY"
    :show-copy="showCopy"
    :copy-label="CREATURE_LIST_ITEM_LABELS.copyTarget"
    @action="handleAction"
    @close="closeMenu"
  />
</template>
