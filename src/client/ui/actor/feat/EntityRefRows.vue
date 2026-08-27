<script setup lang="ts">
  import type { PackKindEntries } from '@/core/compendiumDataClient';
  import type { CompendiumEntry, TypedWebSocketClient } from '@vtt/shared';
  import type { FeatPrerequisiteRef } from '@vtt/shared/system/dnd.js';

  import type { PickedCompendiumRef } from '../CompendiumRefPickerModal.vue';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
  import { getEntityCard } from '@/core/registries';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { compendiumEntryKey, isRecord } from '@vtt/shared';

  import CompendiumRefPickerModal from '../CompendiumRefPickerModal.vue';
  import { REF_PICKER_LABELS, REF_PICKER_TITLES } from '../constants';

  /**
   * Список требуемых записей справочника: черты, классы, виды, предыстории.
   *
   * Записи только ВЫБИРАЮТСЯ — вписать название руками нельзя. Требование
   * сверяется с листом по ключу и названию записи, и набранное руками расходится
   * с справочником от одной опечатки. Своя черта или предыстория сперва
   * заводится в мире (панель «Предметы»), а потом выбирается отсюда наравне с
   * записями компендиума — мир показан в окне выбора отдельным разделом.
   */
  const refs = defineModel<FeatPrerequisiteRef[]>({ required: true });

  const props = withDefaults(
    defineProps<{
      /** Тип записей компендиума; пусто — выбирать не из чего */
      kind?: string;
      /** WebSocket-клиент: загрузка компендиума */
      socket?: TypedWebSocketClient | null;
    }>(),
    { kind: '', socket: null },
  );

  /** Запись справочника, найденная под ссылку строки. */
  interface KnownEntry {
    name: string;
    packName: string;
    raw: CompendiumEntry;
  }

  const { getNextZIndex } = useModalManager();

  const isPickerOpen = ref(false);

  /**
   * Слой окна выбора. Без него окно открылось бы ПОД формой, из которой его
   * позвали: слои раздаёт менеджер окон, а не порядок в разметке.
   */
  const pickerZIndex = ref<number | undefined>(undefined);

  /** Записи справочника по ключу — по ним строка узнаёт свою запись. */
  const knownByKey = ref(new Map<string, KnownEntry>());

  /** Можно ли открыть выбор из компендиума. */
  const canPick = computed(() => Boolean(props.kind && props.socket));

  const pickerTitle = computed(
    () => REF_PICKER_TITLES[props.kind] ?? REF_PICKER_LABELS.open,
  );

  /**
   * Запись, стоящая за ссылкой. Сверяем по ключу, а если его нет — по названию:
   * так же сверяет требование лист, и у записей, набранных до появления выбора,
   * ключа может не быть вовсе.
   *
   * @param entry - ссылка строки
   */
  function knownEntryOf(entry: FeatPrerequisiteRef): KnownEntry | undefined {
    const byKey = entry.url ? knownByKey.value.get(entry.url) : undefined;

    if (byKey) {
      return byKey;
    }

    const name = entry.name.trim().toLowerCase();

    if (!name) {
      return undefined;
    }

    return [...knownByKey.value.values()].find(
      (known) => known.name.toLowerCase() === name,
    );
  }

  /**
   * Открывает карточку записи. Окно берётся из реестра карточек сущностей —
   * того же, которым пользуются панель предметов и браузер компендиума.
   *
   * @param entry - ссылка строки
   */
  function openEntry(entry: FeatPrerequisiteRef): void {
    const known = knownEntryOf(entry);

    if (known) {
      getEntityCard(props.kind)?.openDetail?.(known.raw);
    }
  }

  /** Загружает записи выбранного типа по пакам — для подписей и просмотра. */
  async function loadKnownEntries(): Promise<void> {
    const socket = props.socket;

    if (!props.kind || !socket) {
      knownByKey.value = new Map();

      return;
    }

    const packs: PackKindEntries[] = await loadCompendiumKindByPack(
      socket,
      props.kind,
    );

    const known = new Map<string, KnownEntry>();

    for (const pack of packs) {
      for (const entry of pack.entries) {
        const key = compendiumEntryKey(entry);

        if (!key || known.has(key) || !isRecord(entry)) {
          continue;
        }

        if (typeof entry.name === 'string') {
          known.set(key, {
            name: entry.name,
            packName: pack.packName,
            raw: entry,
          });
        }
      }
    }

    knownByKey.value = known;
  }

  function openPicker(): void {
    pickerZIndex.value = getNextZIndex();
    isPickerOpen.value = true;
  }

  function removeRef(index: number): void {
    refs.value = refs.value.filter((_, rowIndex) => rowIndex !== index);
  }

  /**
   * Дописывает выбранные записи. Уже перечисленные пропускаются: повтор в
   * требовании ничего не добавляет.
   *
   * @param picked - выбранные записи
   */
  function addPicked(picked: PickedCompendiumRef[]): void {
    const taken = new Set(refs.value.map((entry) => entry.url));

    const added = picked
      .filter((entry) => !taken.has(entry.url))
      .map((entry) => ({ url: entry.url, name: entry.name }));

    if (added.length > 0) {
      refs.value = [...refs.value, ...added];
    }
  }

  watch(
    () => [props.kind, props.socket] as const,
    () => {
      void loadKnownEntries();
    },
    { immediate: true },
  );
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div
      v-for="(entry, index) in refs"
      :key="index"
      class="flex items-center gap-2 rounded-lg bg-elevated/40 py-1 pr-1 pl-2"
    >
      <UButton
        v-if="knownEntryOf(entry)"
        :label="entry.name"
        color="primary"
        variant="link"
        size="sm"
        class="min-w-0 flex-1 justify-start truncate px-0"
        :title="REF_PICKER_LABELS.openEntry"
        @click.left.exact.prevent="openEntry(entry)"
      />

      <span
        v-else
        class="min-w-0 flex-1 truncate text-sm"
      >
        {{ entry.name }}
      </span>

      <UBadge
        v-if="knownEntryOf(entry)"
        color="success"
        variant="subtle"
        size="sm"
        icon="tabler:book"
        class="shrink-0"
      >
        {{ knownEntryOf(entry)?.packName }}
      </UBadge>

      <UBadge
        v-else
        color="warning"
        variant="subtle"
        size="sm"
        icon="tabler:alert-triangle"
        class="shrink-0"
        :title="REF_PICKER_LABELS.missingHint"
      >
        {{ REF_PICKER_LABELS.missing }}
      </UBadge>

      <UButton
        icon="tabler:trash"
        color="error"
        variant="ghost"
        size="xs"
        :aria-label="entry.name"
        @click.left.exact.prevent="removeRef(index)"
      />
    </div>

    <UButton
      v-if="canPick"
      icon="tabler:books"
      :label="REF_PICKER_LABELS.open"
      color="primary"
      variant="soft"
      size="xs"
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
      v-if="canPick"
      v-model:open="isPickerOpen"
      :socket="props.socket"
      :kind="props.kind"
      :title="pickerTitle"
      :z-index="pickerZIndex"
      @select="addPicked"
    />
  </div>
</template>
