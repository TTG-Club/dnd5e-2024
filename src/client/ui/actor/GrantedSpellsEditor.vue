<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  // (в Nuxt-приложении их подставляет авто-генерация `#ui`, а мы собираемся
  // обычным Vite). Берём тип из подпути компонента — он в `exports` пакета.
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { GrantedSpellRef } from '@vtt/shared/system/dnd.js';

  import type { PickedCompendiumRef } from './CompendiumRefPickerModal.vue';
  import type { SpellOption } from './grantedSpellsEditorTypes';

  import { ref } from 'vue';

  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useSourceLabels } from '@/systems/dnd5e/composables/useSourceLabel';

  import CompendiumRefPickerModal from './CompendiumRefPickerModal.vue';
  import {
    GRANTED_SPELLS_LABELS,
    REF_PICKER_LABELS,
    REF_PICKER_TITLES,
  } from './constants';

  const props = withDefaults(
    defineProps<{
      /** Заклинания компендиума по пакам — для подсказок и выбора пака. */
      availableSpells?: SpellOption[];
      /** WebSocket-клиент: выбор заклинания из компендиума окном */
      socket?: TypedWebSocketClient | null;
      /**
       * Показывать уровень, с которого заклинание доступно. Нужен только черте:
       * у вида и класса уровень стоит у самой особенности, и второе поле рядом
       * задавало бы одно и то же дважды.
       */
      withRequiredLevel?: boolean;
    }>(),
    { availableSpells: () => [], socket: null, withRequiredLevel: false },
  );

  /** Список выдаваемых заклинаний (имя + опц. связь с компендиумом/паком). */
  const spells = defineModel<GrantedSpellRef[]>({ required: true });

  /** Открыто ли окно выбора заклинания из компендиума. */
  const { getNextZIndex } = useModalManager();

  const isPickerOpen = ref(false);

  /**
   * Слой окна выбора. Без него окно открылось бы ПОД формой, из которой его
   * позвали: слои раздаёт менеджер окон, а не порядок в разметке.
   */
  const pickerZIndex = ref<number | undefined>(undefined);

  function openPicker(): void {
    pickerZIndex.value = getNextZIndex();
    isPickerOpen.value = true;
  }

  /**
   * Дописывает выбранные в компендиуме заклинания. Уже выданные пропускаются:
   * второй раз одно и то же заклинание черта не выдаёт.
   *
   * @param picked - выбранные записи компендиума
   */
  function addPickedSpells(picked: PickedCompendiumRef[]): void {
    const taken = new Set(
      spells.value
        .map((spell) => spell.spellId)
        .filter((spellId): spellId is string => Boolean(spellId)),
    );

    for (const entry of picked) {
      if (taken.has(entry.url)) {
        continue;
      }

      spells.value.push({
        name: entry.name,
        spellId: entry.url,
        packId: entry.packId,
      });
    }
  }

  const emit = defineEmits<{
    /** Открыть детальный просмотр заклинания (id + предпочтённый пак). */
    'open-spell': [spellId: string, packId?: string];
  }>();

  const { getSourceLabel } = useSourceLabels();

  /** Нормализует строку для поиска совпадений (нижний регистр + обрезка). */
  function normalizeForSearch(value: string): string {
    return value.trim().toLowerCase();
  }

  /** Варианты заклинания по пакам (по одному на пак), где есть данный id. */
  function packOptionsForId(spellId: string): SpellOption[] {
    return (props.availableSpells ?? []).filter(
      (option) => option.id === spellId,
    );
  }

  /** id заклинания при единственном точном совпадении имени (иначе undefined). */
  function findExactSpellId(name: string): string | undefined {
    const query = normalizeForSearch(name);

    if (!query) {
      return undefined;
    }

    const ids = new Set(
      (props.availableSpells ?? [])
        .filter((option) => normalizeForSearch(option.name) === query)
        .map((option) => option.id),
    );

    if (ids.size !== 1) {
      return undefined;
    }

    const [onlyId] = [...ids];

    return onlyId;
  }

  /** id заклинания, к которому сводится запись (по связи или точному имени). */
  function resolvedSpellId(spell: GrantedSpellRef): string | undefined {
    if (spell.spellId) {
      return (props.availableSpells ?? []).some(
        (option) => option.id === spell.spellId,
      )
        ? spell.spellId
        : undefined;
    }

    return findExactSpellId(spell.name);
  }

  /** Выбранный вариант заклинания: предпочтённый пак, иначе первый из найденных. */
  function resolveOption(spell: GrantedSpellRef): SpellOption | undefined {
    const spellId = resolvedSpellId(spell);

    if (!spellId) {
      return undefined;
    }

    const options = packOptionsForId(spellId);

    if (spell.packId) {
      const pinned = options.find((option) => option.packId === spell.packId);

      if (pinned) {
        return pinned;
      }
    }

    const [firstOption] = options;

    return firstOption;
  }

  /** Сколько паков содержат сведённое заклинание (0, если не сведено). */
  function packCountFor(spell: GrantedSpellRef): number {
    const spellId = resolvedSpellId(spell);

    return spellId ? packOptionsForId(spellId).length : 0;
  }

  /** Имя пака выбранного варианта (для бейджа/кнопки). */
  function packLabelFor(spell: GrantedSpellRef): string {
    return resolveOption(spell)?.packName ?? '';
  }

  /** Подпись источника записи компендиума (напр. «PHB»; иначе «Компендиум»). */
  function optionSourceLabel(option: SpellOption): string {
    return getSourceLabel(option.sourceKey) ?? GRANTED_SPELLS_LABELS.compendium;
  }

  /** Выбирает пак для заклинания (фиксирует id + предпочтённый пак). */
  function choosePack(spell: GrantedSpellRef, option: SpellOption): void {
    spell.spellId = option.id;
    spell.packId = option.packId;
  }

  /** Пункты меню выбора пака (с галочкой у текущего). */
  function packMenuItems(spell: GrantedSpellRef): DropdownMenuItem[] {
    const spellId = resolvedSpellId(spell);

    if (!spellId) {
      return [];
    }

    const currentPackId = resolveOption(spell)?.packId;

    return packOptionsForId(spellId).map((option) => ({
      label: option.packName,
      icon: option.packId === currentPackId ? 'tabler:check' : undefined,
      onSelect: () => choosePack(spell, option),
    }));
  }

  /** Удаляет заклинание по индексу. */
  function removeSpell(index: number): void {
    spells.value.splice(index, 1);
  }

  /** Связывает заклинание по выбору из подсказок (фиксирует id, имя; пак — если один). */
  function linkSpell(spell: GrantedSpellRef, option: SpellOption): void {
    spell.spellId = option.id;
    spell.name = option.name;

    const options = packOptionsForId(option.id);

    spell.packId = options.length === 1 ? option.packId : undefined;
  }

  /** Открывает просмотр заклинания, если запись сводится к компендиуму. */
  function openSpell(spell: GrantedSpellRef): void {
    const option = resolveOption(spell);

    if (option) {
      emit('open-spell', option.id, option.packId);
    }
  }

  /**
   * Подсказки связывания для НЕсведённого заклинания: записи компендиума (по
   * одной на заклинание, дедуп по id), чьё имя содержит введённое. Не больше 4.
   *
   * @param spell - редактируемая запись заклинания
   */
  function spellMatchOptions(spell: GrantedSpellRef): SpellOption[] {
    const query = normalizeForSearch(spell.name);

    if (!query) {
      return [];
    }

    const seenIds = new Set<string>();
    const result: SpellOption[] = [];

    for (const option of props.availableSpells ?? []) {
      if (seenIds.has(option.id)) {
        continue;
      }

      const matches =
        normalizeForSearch(option.name).includes(query)
        || (option.nameEn
          ? normalizeForSearch(option.nameEn).includes(query)
          : false);

      if (!matches) {
        continue;
      }

      seenIds.add(option.id);
      result.push(option);

      if (result.length >= 4) {
        break;
      }
    }

    return result;
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(spell, spellIndex) in spells"
      :key="spellIndex"
      class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated/30 p-2"
    >
      <div class="flex items-center gap-2">
        <UButton
          v-if="resolveOption(spell)"
          :label="spell.name"
          color="primary"
          variant="link"
          size="sm"
          class="min-w-0 flex-1 justify-start truncate px-0"
          :title="GRANTED_SPELLS_LABELS.open"
          @click.left.exact.prevent="openSpell(spell)"
        />

        <span
          v-else
          class="flex-1 truncate text-sm"
        >
          {{ spell.name }}
        </span>

        <!-- Несколько паков → выбор пака; один → бейдж с именем пака -->
        <UDropdownMenu
          v-if="packCountFor(spell) > 1"
          :items="packMenuItems(spell)"
        >
          <UButton
            color="neutral"
            variant="subtle"
            size="xs"
            icon="tabler:stack-2"
            trailing-icon="tabler:chevron-down"
            :label="packLabelFor(spell)"
            :title="GRANTED_SPELLS_LABELS.choosePack"
          />
        </UDropdownMenu>

        <UBadge
          v-else-if="resolveOption(spell)"
          color="success"
          variant="subtle"
          size="sm"
          icon="tabler:book"
        >
          {{ packLabelFor(spell) }}
        </UBadge>

        <UBadge
          v-else-if="spell.spellId"
          color="warning"
          variant="subtle"
          size="sm"
          icon="tabler:alert-triangle"
        >
          {{ GRANTED_SPELLS_LABELS.notFound }}
        </UBadge>

        <!-- Уровень доступа — в строку, а не полем с подписью сверху: подпись
             над каждой строкой удваивала бы её высоту, а смысл поля читается
             из подсказки раздела -->
        <div
          v-if="props.withRequiredLevel"
          class="flex shrink-0 items-center gap-1"
          :title="GRANTED_SPELLS_LABELS.requiredLevelHint"
        >
          <span class="text-[11px] whitespace-nowrap text-dimmed">
            {{ GRANTED_SPELLS_LABELS.requiredLevelShort }}
          </span>

          <UInputNumber
            v-model="spell.requiredLevel"
            :min="1"
            :max="20"
            size="xs"
            class="w-24"
            :aria-label="GRANTED_SPELLS_LABELS.requiredLevelHint"
            :placeholder="GRANTED_SPELLS_LABELS.requiredLevelAny"
          />
        </div>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="GRANTED_SPELLS_LABELS.remove"
          @click.left.exact.prevent="removeSpell(spellIndex)"
        />
      </div>

      <!-- Подсказки связывания — пока запись не сведена; у каждой показан
           источник, чтобы различить совпадения имён -->
      <div
        v-if="!resolveOption(spell) && spellMatchOptions(spell).length > 0"
        class="flex flex-wrap items-center gap-1"
      >
        <span class="text-[11px] text-dimmed">{{
          GRANTED_SPELLS_LABELS.linkPrefix
        }}</span>

        <UButton
          v-for="option in spellMatchOptions(spell)"
          :key="option.id"
          color="primary"
          variant="soft"
          size="xs"
          @click.left.exact.prevent="linkSpell(spell, option)"
        >
          {{ option.name }}
          <span class="opacity-60">· {{ optionSourceLabel(option) }}</span>
        </UButton>
      </div>
    </div>

    <UButton
      v-if="props.socket"
      icon="tabler:books"
      :label="REF_PICKER_LABELS.open"
      color="primary"
      variant="soft"
      size="sm"
      class="self-start"
      @click.left.exact.prevent="openPicker"
    />

    <p
      v-else
      class="text-xs text-dimmed italic"
    >
      {{ REF_PICKER_LABELS.noSocket }}
    </p>

    <CompendiumRefPickerModal
      v-if="props.socket"
      v-model:open="isPickerOpen"
      :socket="props.socket"
      kind="spell"
      :title="REF_PICKER_TITLES.spell"
      :z-index="pickerZIndex"
      @select="addPickedSpells"
    />

    <p class="text-[11px] text-dimmed">
      {{ GRANTED_SPELLS_LABELS.hint }}
    </p>
  </div>
</template>
