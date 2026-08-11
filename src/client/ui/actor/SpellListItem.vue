<script setup lang="ts">
  import type { DnDGameItem, Spell } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import { ContextMenuDangerItem } from '@/shared_ui/components';
  import FieldGroupReset from '@/shared_ui/components/FieldGroupReset.vue';
  import { SPELL_USES_RECOVERY_LABELS } from '@vtt/shared/system/dnd.js';

  import {
    SHEET_ROW_MENU_LABELS,
    SPELL_MENU_LABELS,
    SPELL_MIME,
  } from './constants';
  import { extractSpellFromGameItem } from './utils/extractSpellFromGameItem';
  import { formatSpellDamageDisplay } from './utils/formatSpellDamageDisplay';

  defineOptions({ inheritAttrs: false });

  const props = defineProps<{
    /** Данные заклинания или предмет-заклинание */
    item: Spell | DnDGameItem;
    /** Показывать «Скопировать» в контекстном меню */
    showCopy?: boolean;
    /** Показывать «Редактировать» в контекстном меню */
    showEdit?: boolean;
    /** Показывать «Удалить» в контекстном меню */
    showDelete?: boolean;
    /** Показывать «Применить» в контекстном меню */
    showCast?: boolean;
    /**
     * ID существа-владельца. Если задан — перетаскивание на хотбар создаёт
     * макрос `creature-spell` (вместо `spell-cast` актора).
     */
    creatureId?: string;
    /** Проп для режима редактирования: показывает inline-иконки */
    isEditMode?: boolean;
  }>();

  const emit = defineEmits<{
    /** Клик по строке (открыть детальник) */
    click: [];
    /** Скопировать */
    copy: [];
    /** Редактировать */
    edit: [];
    /** Удалить */
    delete: [];
    /** Применить */
    cast: [];
    /** Отправить в чат */
    share: [];
  }>();

  const spellObject = computed<Spell>(() => {
    if (
      'type' in props.item
      && props.item.type === 'spell'
      && 'spellData' in props.item
      && props.item.spellData
    ) {
      return extractSpellFromGameItem(props.item as DnDGameItem);
    }

    return props.item as Spell;
  });

  /**
   * Формула урона для отображения — общая со строкой листа. Владельца строка не
   * знает (её показывают панель предметов и лист существа), поэтому от формулы
   * остаются одни кости, без подстановки характеристик.
   */
  const damageFormulaDisplay = computed(() =>
    formatSpellDamageDisplay(spellObject.value),
  );

  /**
   * Начинает перетаскивание заклинания на хотбар.
   *
   * @param event - событие dragstart
   */
  function handleDragStart(event: DragEvent): void {
    const spell = spellObject.value;

    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(SPELL_MIME, JSON.stringify(spell));

    if (props.creatureId) {
      startHotbarDrag(event, {
        id: `${props.creatureId}-spell-${spell.id}`,
        type: 'creature-spell',
        label: spell.name,
        icon: 'tabler:wand',
        ref: spell.id,
        actorId: props.creatureId,
      });

      return;
    }

    startHotbarDrag(event, {
      id: spell.id,
      type: 'spell-cast',
      label: spell.name,
      icon: 'tabler:wand',
      ref: spell.id,
    });
  }

  /** Заряды заклинания для отображения (current/max + способ отката) */
  const usesBadge = computed<{ text: string; title: string } | null>(() => {
    const uses = spellObject.value.uses;

    if (!uses || uses.recovery === 'atWill') {
      return null;
    }

    return {
      text: `${uses.current}/${uses.max}`,
      title: SPELL_USES_RECOVERY_LABELS[uses.recovery],
    };
  });

  // --- Контекстное меню ---
  const isMenuOpen = ref(false);
  const menuX = ref(0);
  const menuY = ref(0);

  /** Есть ли пункты для контекстного меню */
  const hasContextMenu = computed(
    () =>
      props.showCopy || props.showEdit || props.showDelete || props.showCast,
  );

  /**
   * Показывает контекстное меню
   *
   * @param event - событие contextmenu
   */
  function openContextMenu(event: MouseEvent): void {
    if (!hasContextMenu.value) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    menuX.value = event.clientX;
    menuY.value = event.clientY;
    isMenuOpen.value = true;
  }

  /**
   * Обработчик выбора пункта меню
   *
   * @param action - действие
   */
  function handleAction(
    action: 'copy' | 'edit' | 'delete' | 'cast' | 'share',
  ): void {
    isMenuOpen.value = false;

    if (action === 'copy') {
      emit('copy');
    } else if (action === 'edit') {
      emit('edit');
    } else if (action === 'delete') {
      emit('delete');
    } else if (action === 'cast') {
      emit('cast');
    } else if (action === 'share') {
      emit('share');
    }
  }

  /** Закрывает меню при клике снаружи */
  function closeMenu(): void {
    isMenuOpen.value = false;
  }
</script>

<template>
  <div class="flex items-center gap-2">
    <UFieldGroup
      size="lg"
      class="group flex min-w-0 flex-1"
    >
      <!-- Быстрое применение заклинания -->
      <UTooltip
        v-if="showCast"
        text="Применить"
      >
        <UButton
          icon="tabler:wand"
          color="primary"
          variant="soft"
          @click.left.exact.prevent.stop="emit('cast')"
        />
      </UTooltip>

      <!-- Основная часть: имя + бейджи (клик = детальник) -->
      <UButton
        color="neutral"
        variant="soft"
        class="min-w-0 flex-1 justify-start gap-2 bg-elevated/30 hover:bg-accented/40"
        draggable="true"
        @click.left.exact.prevent="emit('click')"
        @contextmenu="openContextMenu"
        @dragstart="handleDragStart($event)"
      >
        <!-- Сброс контекста группы, чтобы бейджи сохранили скругление -->
        <FieldGroupReset>
          <!-- Иконка школы (когда нет кнопки применения) -->
          <UIcon
            v-if="!showCast"
            name="tabler:wand"
            class="h-4 w-4 shrink-0 text-muted"
          />

          <!-- Название -->
          <span
            class="min-w-0 flex-1 truncate text-left text-sm font-medium text-highlighted"
          >
            {{ spellObject.name }}
          </span>

          <!-- Бейджи -->
          <UBadge
            v-if="spellObject.concentration"
            color="warning"
            variant="subtle"
            size="xs"
          >
            К
          </UBadge>

          <UBadge
            v-if="spellObject.ritual"
            color="info"
            variant="subtle"
            size="xs"
          >
            Р
          </UBadge>

          <!-- Урон -->
          <UBadge
            v-if="damageFormulaDisplay"
            color="neutral"
            variant="subtle"
            size="sm"
            class="shrink-0 font-mono"
          >
            {{ damageFormulaDisplay }}
          </UBadge>

          <!-- Заряды (current/max + способ отката) -->
          <UBadge
            v-if="usesBadge"
            :title="usesBadge.title"
            color="warning"
            variant="subtle"
            size="sm"
            class="shrink-0 font-mono"
          >
            {{ usesBadge.text }}
          </UBadge>
        </FieldGroupReset>
      </UButton>

      <!-- Кнопки редактирования (видны только в режиме редактирования) -->
      <template v-if="isEditMode">
        <UTooltip text="Редактировать">
          <UButton
            icon="tabler:edit"
            color="neutral"
            variant="soft"
            @click.left.exact.prevent.stop="emit('edit')"
          />
        </UTooltip>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="soft"
          @click.left.exact.prevent.stop="emit('delete')"
        />
      </template>
    </UFieldGroup>
  </div>

  <!-- Контекстное меню -->
  <Teleport to="body">
    <div
      v-if="isMenuOpen"
      class="fixed inset-0 z-10000"
      @click.left.exact.prevent="closeMenu"
      @contextmenu.prevent="closeMenu"
    >
      <div
        class="absolute min-w-45 rounded-lg border border-default bg-default py-1 shadow-xl"
        :style="{ left: `${menuX}px`, top: `${menuY}px` }"
        @click.stop
      >
        <!-- Применить -->
        <button
          v-if="showCast"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="handleAction('cast')"
        >
          <UIcon
            name="tabler:wand"
            class="h-4 w-4 text-muted"
          />
          {{ SPELL_MENU_LABELS.cast }}
        </button>

        <!-- Скопировать -->
        <button
          v-if="showCopy"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="handleAction('copy')"
        >
          <UIcon
            name="tabler:copy"
            class="h-4 w-4 text-muted"
          />
          Скопировать
        </button>

        <!-- Редактировать -->
        <button
          v-if="showEdit"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="handleAction('edit')"
        >
          <UIcon
            name="tabler:edit"
            class="h-4 w-4 text-muted"
          />
          Редактировать
        </button>

        <!-- Разделитель -->
        <div
          v-if="showCopy || showEdit || showCast"
          class="mx-2 my-1 border-t border-default/50"
        />

        <!-- Поделиться в чат -->
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="handleAction('share')"
        >
          <UIcon
            name="tabler:message-share"
            class="h-4 w-4 text-muted"
          />
          Поделиться в чат
        </button>

        <!-- Удалить -->
        <ContextMenuDangerItem
          v-if="showDelete"
          icon="tabler:trash"
          @click="handleAction('delete')"
        >
          {{ SHEET_ROW_MENU_LABELS.remove }}
        </ContextMenuDangerItem>
      </div>
    </div>
  </Teleport>
</template>
