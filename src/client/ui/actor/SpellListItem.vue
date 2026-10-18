<script setup lang="ts">
  import type { DnDGameItem, Spell } from '@vtt/shared/system/dnd.js';

  import type { ContextMenuAction } from '../../composables/useContextMenu';

  import { computed, ref } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import FieldGroupReset from '@/shared_ui/components/FieldGroupReset.vue';
  import {
    isSpell,
    SPELL_USES_RECOVERY_LABELS,
  } from '@vtt/shared/system/dnd.js';

  import {
    SHEET_ROW_MENU_LABELS,
    SPELL_BADGE_LABELS,
    SPELL_MENU_LABELS,
    SPELL_MIME,
  } from './constants';
  import ContextMenuOverlay from './ContextMenuOverlay.vue';
  import EntityRowBody from './EntityRowBody.vue';
  import { extractSpellFromGameItem } from './utils/extractSpellFromGameItem';
  import { formatSpellDamageDisplay } from './utils/formatSpellDamageDisplay';

  /**
   * Атрибуты вызывающего компонент переносит на строку САМ (`v-bind="$attrs"` на
   * обоих корнях шаблона): корней у него два — сама строка и портал
   * контекстного меню, — а таким Vue `class` и `style` автоматически не отдаёт.
   * Без этого до строки не доезжали ни `flex-1` из компендиума (строка не
   * растягивалась во всю ширину, и бейджи липли к названию), ни приглушение уже
   * изученного заклинания.
   *
   * Обработчики в `$attrs` не попадают: все события объявлены в `defineEmits`, а
   * объявленные Vue оттуда исключает.
   */
  defineOptions({ inheritAttrs: false });

  const props = defineProps<{
    /** Данные заклинания или предмет-заклинание */
    item: Spell | DnDGameItem;
    /** Показывать «Скопировать в предметы» в контекстном меню */
    showCopy?: boolean;
    /** Показывать «Редактировать» в контекстном меню */
    showEdit?: boolean;
    /** Показывать «Удалить» в контекстном меню */
    showDelete?: boolean;
    /** Показывать «Применить» в контекстном меню */
    showCast?: boolean;
    /** Показывать «В компендиум» в контекстном меню (ставит ядро в «Мастерской») */
    showAddToCompendium?: boolean;
    /**
     * ID существа-владельца. Если задан — перетаскивание на хотбар создаёт
     * макрос `creature-spell` (вместо `spell-cast` актора).
     */
    creatureId?: string;
    /** Проп для режима редактирования: показывает inline-иконки */
    isEditMode?: boolean;
    /**
     * Плоская строка списка: без своей плашки и скругления. Так строка встаёт в
     * список с разделителями (компендиум и окна выбора); на листе персонажа
     * строки стоят порознь, и плашка им нужна.
     */
    flat?: boolean;
  }>();

  const emit = defineEmits<{
    /** Клик по строке (открыть детальник) */
    click: [];
    /** Скопировать в предметы */
    copy: [];
    /** Редактировать */
    edit: [];
    /** Удалить */
    delete: [];
    /** Применить */
    cast: [];
    /** Отправить в чат */
    share: [];
    /** Положить запись в компендиум мира */
    addToCompendium: [];
  }>();

  /**
   * Заклинание строки. Запись компендиума уже плоская — её узнаёт гвард
   * заклинания; предмет-обёртка мира несёт заклинание во вложенном
   * `spellData`, откуда оно и разворачивается.
   */
  const spellObject = computed<Spell | null>(() => {
    if (isSpell(props.item)) {
      return props.item;
    }

    return extractSpellFromGameItem(props.item);
  });

  /**
   * Формула урона для отображения — общая со строкой листа. Владельца строка не
   * знает (её показывают панель предметов и лист существа), поэтому от формулы
   * остаются одни кости, без подстановки характеристик.
   */
  const damageFormulaDisplay = computed(() =>
    spellObject.value ? formatSpellDamageDisplay(spellObject.value) : '',
  );

  /**
   * Источник записи: у заклинания компендиума он на самом заклинании, у
   * предмета-заклинания — на предмете. Показывается бейджем в строке списка.
   */
  const sourceKey = computed<string | undefined>(
    () => spellObject.value?.sourceKey ?? props.item.sourceKey,
  );

  /**
   * Начинает перетаскивание заклинания на хотбар.
   *
   * @param event - событие dragstart
   */
  function handleDragStart(event: DragEvent): void {
    const spell = spellObject.value;

    if (!spell || !event.dataTransfer) {
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
    const uses = spellObject.value?.uses;

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
      props.showCopy
      || props.showEdit
      || props.showDelete
      || props.showCast
      || props.showAddToCompendium,
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
  function handleAction(action: ContextMenuAction): void {
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
    } else if (action === 'add-to-compendium') {
      emit('addToCompendium');
    }
  }

  /** Закрывает меню при клике снаружи */
  function closeMenu(): void {
    isMenuOpen.value = false;
  }
</script>

<template>
  <!-- Строка списка: простой ряд, а не группа кнопок, — подсветка тогда идёт во
    всю строку, а не по кнопке внутри неё -->
  <div
    v-if="flat"
    v-bind="$attrs"
    draggable="true"
    class="flex cursor-grab items-center gap-3 px-2 py-2 transition-colors hover:bg-primary/10 active:cursor-grabbing"
    @click.left.exact.prevent="emit('click')"
    @contextmenu="openContextMenu"
    @dragstart="handleDragStart($event)"
  >
    <!-- Значка в списке нет: он одинаков у всех строк и только съедает место.
      На листе персонажа палочка остаётся — там строка стоит среди других -->
    <EntityRowBody
      :name="spellObject?.name ?? ''"
      :name-en="spellObject?.nameEn"
      :source-key="sourceKey"
      :source="item.source"
    >
      <template #badges>
        <UBadge
          v-if="spellObject?.concentration"
          color="warning"
          variant="subtle"
          size="xs"
          class="shrink-0"
        >
          {{ SPELL_BADGE_LABELS.concentration }}
        </UBadge>

        <UBadge
          v-if="spellObject?.ritual"
          color="info"
          variant="subtle"
          size="xs"
          class="shrink-0"
        >
          {{ SPELL_BADGE_LABELS.ritual }}
        </UBadge>
      </template>
    </EntityRowBody>
  </div>

  <div
    v-else
    v-bind="$attrs"
    class="flex items-center gap-2"
  >
    <UFieldGroup
      size="lg"
      class="group flex min-w-0 flex-1"
    >
      <!-- Быстрое применение заклинания -->
      <UTooltip
        v-if="showCast"
        :text="SPELL_MENU_LABELS.cast"
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
            {{ spellObject?.name }}
          </span>

          <!-- Бейджи -->
          <UBadge
            v-if="spellObject?.concentration"
            color="warning"
            variant="subtle"
            size="xs"
          >
            {{ SPELL_BADGE_LABELS.concentration }}
          </UBadge>

          <UBadge
            v-if="spellObject?.ritual"
            color="info"
            variant="subtle"
            size="xs"
          >
            {{ SPELL_BADGE_LABELS.ritual }}
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
        <UTooltip :text="SHEET_ROW_MENU_LABELS.edit">
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

  <ContextMenuOverlay
    :is-open="isMenuOpen"
    :pos-x="menuX"
    :pos-y="menuY"
    :show-cast="showCast"
    :show-copy="showCopy"
    :show-edit="showEdit"
    :show-add-to-compendium="showAddToCompendium"
    show-share
    :show-delete="showDelete"
    @action="handleAction"
    @close="closeMenu"
  />
</template>
