<script setup lang="ts">
  import type { Spell } from '@vtt/shared/system/dnd.js';

  import type {
    CreatureSpellBlockView,
    CreatureSpellGroupView,
  } from './creatureSpellViewTypes';

  import { computed, ref } from 'vue';

  import { FILTER_ROW_CONTROL_SIZE, SPELL_MIME } from '../actor/constants';
  import SheetStatTile from '../actor/SheetStatTile.vue';
  import {
    CREATURE_SPELL_BLOCKS_LABELS,
    CREATURE_SPELL_REF_MIME,
  } from './constants';
  import CreatureSpellRow from './CreatureSpellRow.vue';

  interface Props {
    /** Готовый к показу блок: подписи и плитки считает вкладка */
    view: CreatureSpellBlockView;
    /**
     * Блок раскрыт. Набор раскрытых держит вкладка: заведённый блок она
     * раскрывает сама, а карточка о соседях не знает.
     */
    expanded?: boolean;
    /** Пользователь правит существо: видны кнопки блока и групп */
    canEdit?: boolean;
    /**
     * Виден ли «Добавить группу». Заводят группы только в правке листа: это
     * перестройка статблока, а не игровое действие.
     */
    canAddGroup?: boolean;
    /** Только просмотр (компендиум): заклинания не применяются */
    isReadOnly?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    expanded: false,
    canEdit: false,
    canAddGroup: false,
    isReadOnly: false,
  });

  const emit = defineEmits<{
    'toggle': [];
    'edit-block': [];
    'remove-block': [];
    'add-group': [];
    'edit-group': [groupId: string];
    'remove-group': [groupId: string];
    'add-spells': [groupId: string];
    'open-spell': [spell: Spell];
    'cast-spell': [spell: Spell];
    'spell-dragstart': [
      payload: { event: DragEvent; spell: Spell; groupId: string },
    ];
    /**
     * Заклинание отпустили над блоком. `groupId` называет группу, если бросили
     * прямо на неё; без него блок сам подберёт подходящую.
     */
    'spell-drop': [payload: { event: DragEvent; groupId?: string }];
  }>();

  const toggleIcon = computed(() =>
    props.expanded ? 'tabler:chevron-up' : 'tabler:chevron-down',
  );

  /**
   * Ключ группы для `v-for`: у группы он свой, и по нему строка переживает
   * перестановку соседей.
   *
   * @param groupView - группа блока
   * @returns ключ строки
   */
  function groupKey(groupView: CreatureSpellGroupView): string {
    return groupView.group.id;
  }

  // ── Перетаскивание заклинаний ─────────────────────────────────────────────

  /** Группа под курсором; `block` — сам блок мимо групп */
  const dropTarget = ref<string | undefined>(undefined);

  /** Ключ подсветки самого блока: с ключами групп он не совпадёт */
  const BLOCK_DROP_KEY = 'block';

  /** Заклинания раскладывает тот, кто правит существо */
  const canDrop = computed(() => props.canEdit && !props.isReadOnly);

  /**
   * Тащат заклинание, а не что-то постороннее: из компендиума или из соседней
   * группы. Типы перетаскивания видны и до отпускания — по ним и решаем,
   * подсвечивать ли цель.
   *
   * @param event - событие перетаскивания
   * @returns `true` — над блоком заклинание
   */
  function isSpellDrag(event: DragEvent): boolean {
    const types = Array.from(event.dataTransfer?.types ?? []);

    return (
      types.includes(SPELL_MIME) || types.includes(CREATURE_SPELL_REF_MIME)
    );
  }

  /**
   * Подсвечивает цель под курсором.
   *
   * @param event - событие перетаскивания
   * @param key - ключ группы либо {@link BLOCK_DROP_KEY}
   */
  function handleDragOver(event: DragEvent, key: string): void {
    if (!canDrop.value || !isSpellDrag(event)) {
      return;
    }

    // Останавливаем всплытие: иначе группу подсветил бы и блок под ней, а
    // бросок поймал бы ещё и лист существа — заклинание добавилось бы дважды
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }

    dropTarget.value = key;
  }

  /**
   * Гасит подсветку, когда курсор ушёл за пределы цели. Переход на вложенный
   * элемент тоже шлёт `dragleave`, поэтому цель проверяется по тому, куда
   * курсор перешёл.
   *
   * @param event - событие перетаскивания
   * @param key - ключ группы либо {@link BLOCK_DROP_KEY}
   */
  function handleDragLeave(event: DragEvent, key: string): void {
    const target = event.currentTarget;

    if (
      target instanceof HTMLElement
      && event.relatedTarget instanceof Node
      && target.contains(event.relatedTarget)
    ) {
      return;
    }

    if (dropTarget.value === key) {
      dropTarget.value = undefined;
    }
  }

  /**
   * Отпускание заклинания над целью.
   *
   * @param event - событие перетаскивания
   * @param groupId - группа, если бросили прямо на неё
   */
  function handleDrop(event: DragEvent, groupId?: string): void {
    if (!canDrop.value || !isSpellDrag(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dropTarget.value = undefined;

    emit('spell-drop', { event, groupId });
  }

  /** Рамка цели под курсором — по ней видно, куда ляжет заклинание */
  function dropClass(key: string): string {
    return dropTarget.value === key
      ? 'ring-2 ring-primary/70 bg-primary/5'
      : '';
  }
</script>

<template>
  <div class="rounded-lg border border-default bg-elevated/20">
    <!-- Шапка блока: нажатие по всей строке сворачивает и раскрывает её, а
      кнопки правки подняты над накладкой -->
    <div
      class="relative flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-elevated/40"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left before:absolute before:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :aria-expanded="expanded"
        @click.left.exact.prevent="emit('toggle')"
      >
        <UIcon
          :name="toggleIcon"
          class="size-4 shrink-0 text-dimmed"
        />

        <span class="min-w-0 flex-1 truncate text-sm font-semibold">
          {{ view.title }}
        </span>

        <!-- Значок с числом, а не подпись: на узком листе две полные подписи
          съедали строку. Что значит число, говорит подсказка -->
        <UBadge
          v-if="view.groupCount"
          size="sm"
          color="neutral"
          variant="subtle"
          class="shrink-0 tabular-nums"
          icon="tabler:list-details"
          :title="CREATURE_SPELL_BLOCKS_LABELS.groupsBadgeHint"
        >
          {{ view.groupCount }}
        </UBadge>

        <UBadge
          v-if="view.spellCount"
          size="sm"
          color="primary"
          variant="subtle"
          class="shrink-0 tabular-nums"
          icon="tabler:sparkles"
          :title="CREATURE_SPELL_BLOCKS_LABELS.spellsBadgeHint"
        >
          {{ view.spellCount }}
        </UBadge>
      </button>

      <template v-if="canEdit">
        <UButton
          icon="tabler:settings"
          color="neutral"
          variant="ghost"
          :size="FILTER_ROW_CONTROL_SIZE"
          class="relative shrink-0"
          :aria-label="CREATURE_SPELL_BLOCKS_LABELS.editBlock"
          :title="CREATURE_SPELL_BLOCKS_LABELS.editBlock"
          @click.left.exact.prevent="emit('edit-block')"
        />

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          :size="FILTER_ROW_CONTROL_SIZE"
          class="relative shrink-0"
          :aria-label="CREATURE_SPELL_BLOCKS_LABELS.removeBlock"
          :title="CREATURE_SPELL_BLOCKS_LABELS.removeBlock"
          @click.left.exact.prevent="emit('remove-block')"
        />
      </template>
    </div>

    <!-- Тело блока — тоже цель для брошенного заклинания: мимо всех групп оно
      ложится в подходящую по своим зарядам, а нет такой — блок заводит её -->
    <div
      v-if="expanded"
      class="space-y-3 rounded-b-lg border-t border-default px-2 py-2 transition-shadow"
      :class="dropClass(BLOCK_DROP_KEY)"
      @dragover="handleDragOver($event, BLOCK_DROP_KEY)"
      @dragleave="handleDragLeave($event, BLOCK_DROP_KEY)"
      @drop="handleDrop($event)"
    >
      <!-- Числа блока плиткой: те же, по которым он кастует. «Добавить группу»
        стоит в этом же ряду — так кнопка не уезжает под список заклинаний, до
        которой у заполненного блока пришлось бы прокручивать -->
      <div class="flex flex-wrap items-center gap-2">
        <SheetStatTile
          :cells="view.cells"
          :tooltip="
            canEdit ? CREATURE_SPELL_BLOCKS_LABELS.editBlock : undefined
          "
          :aria-label="CREATURE_SPELL_BLOCKS_LABELS.editBlock"
          :clickable="canEdit"
          @click="emit('edit-block')"
        />

        <UButton
          v-if="canAddGroup"
          icon="tabler:plus"
          variant="soft"
          :size="FILTER_ROW_CONTROL_SIZE"
          class="ml-auto shrink-0"
          :aria-label="CREATURE_SPELL_BLOCKS_LABELS.addGroupAria"
          :title="CREATURE_SPELL_BLOCKS_LABELS.addGroupHint"
          @click.left.exact.prevent="emit('add-group')"
        >
          {{ CREATURE_SPELL_BLOCKS_LABELS.addGroup }}
        </UButton>
      </div>

      <p
        v-if="view.note"
        class="text-xs leading-relaxed text-toned italic"
      >
        {{ view.note }}
      </p>

      <p
        v-if="view.componentsLabel"
        class="text-xs text-dimmed"
      >
        {{ view.componentsLabel }}
      </p>

      <p
        v-if="!view.groups.length"
        class="text-sm text-dimmed"
      >
        {{ CREATURE_SPELL_BLOCKS_LABELS.blockEmpty }}
      </p>

      <div
        v-for="groupView in view.groups"
        :key="groupKey(groupView)"
        class="-m-1 space-y-1 rounded-md p-1 transition-shadow"
        :class="dropClass(groupView.group.id)"
        @dragover="handleDragOver($event, groupView.group.id)"
        @dragleave="handleDragLeave($event, groupView.group.id)"
        @drop="handleDrop($event, groupView.group.id)"
      >
        <!-- Заголовок группы: подпись слева, значки применений и перезарядки
          справа — тот же разделитель, что у кругов на листе персонажа -->
        <div class="flex items-center gap-2 px-1 pt-1 pb-0.5">
          <span
            class="shrink-0 text-xs font-semibold tracking-wider text-muted uppercase"
          >
            {{ groupView.title }}
          </span>

          <UBadge
            v-if="groupView.usesLabel"
            size="sm"
            :color="groupView.isExhausted ? 'neutral' : 'primary'"
            variant="subtle"
            class="shrink-0 tabular-nums"
            :title="
              groupView.isExhausted
                ? CREATURE_SPELL_BLOCKS_LABELS.poolEmpty
                : CREATURE_SPELL_BLOCKS_LABELS.poolUses
            "
          >
            {{ groupView.usesLabel }}
          </UBadge>

          <UBadge
            v-if="groupView.rechargeLabel"
            size="sm"
            color="warning"
            variant="subtle"
            class="shrink-0"
            icon="tabler:refresh"
            :title="groupView.rechargeHint"
          >
            {{ groupView.rechargeLabel }}
          </UBadge>

          <div class="h-px flex-1 bg-accented/50" />

          <template v-if="canEdit">
            <UButton
              icon="tabler:plus"
              color="primary"
              variant="ghost"
              :size="FILTER_ROW_CONTROL_SIZE"
              class="shrink-0"
              :aria-label="CREATURE_SPELL_BLOCKS_LABELS.addSpells"
              :title="CREATURE_SPELL_BLOCKS_LABELS.addSpells"
              @click.left.exact.prevent="emit('add-spells', groupView.group.id)"
            />

            <UButton
              icon="tabler:settings"
              color="neutral"
              variant="ghost"
              :size="FILTER_ROW_CONTROL_SIZE"
              class="shrink-0"
              :aria-label="CREATURE_SPELL_BLOCKS_LABELS.editGroup"
              :title="CREATURE_SPELL_BLOCKS_LABELS.editGroup"
              @click.left.exact.prevent="emit('edit-group', groupView.group.id)"
            />

            <UButton
              icon="tabler:trash"
              color="error"
              variant="ghost"
              :size="FILTER_ROW_CONTROL_SIZE"
              class="shrink-0"
              :aria-label="CREATURE_SPELL_BLOCKS_LABELS.removeGroup"
              :title="CREATURE_SPELL_BLOCKS_LABELS.removeGroup"
              @click.left.exact.prevent="
                emit('remove-group', groupView.group.id)
              "
            />
          </template>
        </div>

        <p
          v-if="!groupView.rows.length"
          class="px-1 text-sm text-dimmed"
        >
          {{ CREATURE_SPELL_BLOCKS_LABELS.groupEmpty }}
        </p>

        <div
          v-else
          class="flex flex-col gap-2"
        >
          <CreatureSpellRow
            v-for="row in groupView.rows"
            :key="row.spell.id"
            :spell="row.spell"
            :subtitle="row.subtitle"
            :stats="row.stats"
            :menu-items="row.menuItems"
            :can-cast="!isReadOnly && !groupView.isExhausted"
            @open="emit('open-spell', row.spell)"
            @cast="emit('cast-spell', row.spell)"
            @dragstart="
              emit('spell-dragstart', {
                event: $event,
                spell: row.spell,
                groupId: groupView.group.id,
              })
            "
          />
        </div>
      </div>
    </div>
  </div>
</template>
