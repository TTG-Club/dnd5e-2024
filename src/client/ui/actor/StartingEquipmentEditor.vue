<script setup lang="ts">
  import type { PackKindEntries } from '@/core/compendiumDataClient';
  import type { CompendiumEntry, TypedWebSocketClient } from '@vtt/shared';

  import type {
    PickedCompendiumRef,
    PickerEntryFields,
  } from './CompendiumRefPickerModal.vue';
  import type {
    EditableStartingEquipmentItem,
    EditableStartingEquipmentOption,
  } from './startingEquipmentEditorTypes';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
  import { getEntityCard } from '@/core/registries';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { isRecord } from '@vtt/shared';
  import { STARTING_EQUIPMENT_ITEM_KINDS } from '@vtt/shared/system/dnd.js';

  import {
    EQUIPMENT_TYPE_FILTER_ORDER,
    equipmentTypeFilterValue,
  } from './compendiumFilters';
  import CompendiumRefPickerModal from './CompendiumRefPickerModal.vue';
  import {
    CLASS_OPTION_KEYS,
    REF_PICKER_LABELS,
    STARTING_EQUIPMENT_EDITOR_LABELS,
  } from './constants';
  import FormSection from './FormSection.vue';
  import {
    createEquipmentItem,
    createEquipmentOption,
  } from './startingEquipmentEditorTypes';

  /**
   * Редактор вариантов стартового снаряжения: предметы варианта и золото к ним.
   * Общий для предыстории и класса — у класса вариант подписан буквой, у
   * предыстории вместо неё есть альтернатива золотом.
   *
   * Предметы ВЫБИРАЮТСЯ из компендиума: позиция несёт слаг страницы предмета
   * (`chain-mail-phb`), и только по нему мастер кладёт в инвентарь настоящий
   * предмет со своим весом, стоимостью и боевыми полями. Вписанная руками
   * позиция слага не имеет и ложится простым предметом по названию — поэтому
   * такая строка честно помечена «Своё», а не притворяется записью компендиума.
   */
  const options = defineModel<EditableStartingEquipmentOption[]>({
    required: true,
  });

  const props = withDefaults(
    defineProps<{
      /** Подписывать варианты буквами («А», «Б») — у класса */
      showKey?: boolean;
      /** Показывать альтернативу золотом — у предыстории */
      showGoldAlternative?: boolean;
      /** WebSocket-клиент: загрузка предметов компендиума */
      socket?: TypedWebSocketClient | null;
    }>(),
    { showKey: false, showGoldAlternative: false, socket: null },
  );

  /** Предмет компендиума, найденный под позицию варианта. */
  interface KnownItem {
    name: string;
    packName: string;
    /** Раздел компендиума — им открывается карточка предмета */
    kind: string;
    raw: CompendiumEntry;
  }

  const { getNextZIndex } = useModalManager();

  /** Предметы компендиума по слагу страницы-источника (в нижнем регистре) */
  const knownBySlug = ref(new Map<string, KnownItem>());

  const isPickerOpen = ref(false);

  /**
   * Слой окна выбора. Без него окно открылось бы ПОД формой, из которой его
   * позвали: слои раздаёт менеджер окон, а не порядок в разметке.
   */
  const pickerZIndex = ref<number | undefined>(undefined);

  /** Вариант, который сейчас пополняют из компендиума */
  const pickerOptionUid = ref('');

  /** Можно ли открыть выбор из компендиума */
  const canPick = computed(() => Boolean(props.socket));

  /**
   * Слаг страницы-источника записи. Позиция адресуется именно им: `id` записи в
   * каждом мире свой и в чужих паках уже ничего не найдёт.
   *
   * @param entry - запись компендиума
   */
  function entrySlug(entry: CompendiumEntry): string {
    return isRecord(entry) && typeof entry.srcUrl === 'string'
      ? entry.srcUrl.trim()
      : '';
  }

  /**
   * Готовит запись предмета к строке окна выбора. Запись без слага отброшена:
   * выбрать её было бы можно, а положить в инвентарь при выдаче — уже нет.
   *
   * @param entry - запись компендиума
   * @returns поля записи либо `null`, если в позицию она не годится
   */
  function resolvePickerEntry(
    entry: CompendiumEntry,
  ): PickerEntryFields | null {
    const slug = entrySlug(entry);

    if (!slug || !isRecord(entry) || typeof entry.name !== 'string') {
      return null;
    }

    return {
      key: slug,
      name: entry.name,
      nameEn: typeof entry.nameEn === 'string' ? entry.nameEn : '',
    };
  }

  /**
   * Предмет компендиума под позицию. Сверка идёт ТОЛЬКО по слагу и ровно так
   * же, как при выдаче (`resolveStartingEquipment`): что здесь показано
   * ссылкой, то и ляжет в инвентарь записью компендиума.
   *
   * @param item - позиция варианта
   */
  function knownItem(
    item: EditableStartingEquipmentItem,
  ): KnownItem | undefined {
    const slug = item.url.trim().toLowerCase();

    return slug ? knownBySlug.value.get(slug) : undefined;
  }

  /**
   * Открывает карточку предмета. Окно берётся из реестра карточек сущностей —
   * того же, которым пользуются панель предметов и браузер компендиума.
   *
   * @param item - позиция варианта
   */
  function openItem(item: EditableStartingEquipmentItem): void {
    const known = knownItem(item);

    if (known) {
      getEntityCard(known.kind)?.openDetail?.(known.raw);
    }
  }

  /** Загружает предметы компендиума — для подписей строк и просмотра карточек. */
  async function loadKnownItems(): Promise<void> {
    const socket = props.socket;

    if (!socket) {
      knownBySlug.value = new Map();

      return;
    }

    const known = new Map<string, KnownItem>();

    for (const kind of STARTING_EQUIPMENT_ITEM_KINDS) {
      const packs: PackKindEntries[] = await loadCompendiumKindByPack(
        socket,
        kind,
      );

      for (const pack of packs) {
        for (const entry of pack.entries) {
          const slug = entrySlug(entry).toLowerCase();

          // Первая запись с этим слагом и остаётся — то же правило, что при
          // выдаче: у раскрытых магических предметов слаг общий
          if (!slug || known.has(slug) || !isRecord(entry)) {
            continue;
          }

          if (typeof entry.name === 'string') {
            known.set(slug, {
              name: entry.name,
              packName: pack.packName,
              kind,
              raw: entry,
            });
          }
        }
      }
    }

    knownBySlug.value = known;
  }

  /** Свободная метка для нового варианта класса. */
  function nextKey(): string {
    if (!props.showKey) {
      return '';
    }

    const taken = new Set(options.value.map((option) => option.key));

    return (
      [...CLASS_OPTION_KEYS].find((key) => !taken.has(key))
      ?? String(options.value.length + 1)
    );
  }

  /** Заводит вариант. Наружу: кнопка добавления живёт в шапке раздела. */
  function addOption(): void {
    options.value = [...options.value, createEquipmentOption(nextKey())];
  }

  function removeOption(index: number): void {
    options.value = options.value.filter(
      (_, optionIndex) => optionIndex !== index,
    );
  }

  /** Заводит пустую строку — под предмет, которого в компендиуме нет. */
  function addItem(option: EditableStartingEquipmentOption): void {
    option.items = [...option.items, createEquipmentItem()];
  }

  function removeItem(
    option: EditableStartingEquipmentOption,
    index: number,
  ): void {
    option.items = option.items.filter((_, itemIndex) => itemIndex !== index);
  }

  /**
   * Открывает выбор предметов для варианта.
   *
   * @param option - вариант, который пополняют
   */
  function openPicker(option: EditableStartingEquipmentOption): void {
    pickerOptionUid.value = option.uid;
    pickerZIndex.value = getNextZIndex();
    isPickerOpen.value = true;
  }

  /**
   * Дописывает выбранные предметы в вариант. Уже перечисленный предмет
   * пропускается: количество у него задаётся полем, а не повтором строки.
   *
   * @param picked - выбранные записи компендиума
   */
  function addPicked(picked: PickedCompendiumRef[]): void {
    const option = options.value.find(
      (candidate) => candidate.uid === pickerOptionUid.value,
    );

    if (!option) {
      return;
    }

    const taken = new Set(
      option.items.map((item) => item.url.trim().toLowerCase()),
    );

    const added = picked
      .filter((entry) => !taken.has(entry.url.toLowerCase()))
      .map((entry) =>
        createEquipmentItem({ name: entry.name, url: entry.url }),
      );

    if (added.length > 0) {
      option.items = [...option.items, ...added];
    }
  }

  /** Заголовок карточки варианта: номер и метка, если она есть. */
  function optionTitle(
    option: EditableStartingEquipmentOption,
    index: number,
  ): string {
    const suffix = option.key ? ` «${option.key}»` : '';

    return `${STARTING_EQUIPMENT_EDITOR_LABELS.optionTitle} ${
      index + 1
    }${suffix}`;
  }

  watch(
    () => props.socket,
    () => {
      void loadKnownItems();
    },
    { immediate: true },
  );

  defineExpose({ addOption });
</script>

<template>
  <div class="flex flex-col gap-3">
    <FormSection
      v-for="(option, index) in options"
      :key="option.uid"
      :title="optionTitle(option, index)"
      icon="tabler:backpack"
    >
      <template #actions>
        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="`${
            STARTING_EQUIPMENT_EDITOR_LABELS.optionRemove
          }: ${optionTitle(option, index)}`"
          @click.left.exact.prevent="removeOption(index)"
        />
      </template>

      <div class="flex flex-col gap-2">
        <div
          v-if="option.items.length === 0"
          class="text-xs text-dimmed italic"
        >
          {{ STARTING_EQUIPMENT_EDITOR_LABELS.itemsEmpty }}
        </div>

        <div
          v-for="(item, itemIndex) in option.items"
          :key="item.uid"
          class="flex items-center gap-2 rounded-lg bg-elevated/40 py-1 pr-1 pl-2"
        >
          <UButton
            v-if="knownItem(item)"
            :label="item.name"
            color="primary"
            variant="link"
            size="sm"
            class="min-w-0 flex-1 justify-start truncate px-0"
            :title="REF_PICKER_LABELS.openEntry"
            @click.left.exact.prevent="openItem(item)"
          />

          <UInput
            v-else
            v-model="item.name"
            :placeholder="STARTING_EQUIPMENT_EDITOR_LABELS.itemName"
            size="sm"
            class="min-w-0 flex-1"
          />

          <UBadge
            v-if="knownItem(item)"
            color="success"
            variant="subtle"
            size="sm"
            icon="tabler:book"
            class="max-w-40 shrink-0 truncate"
          >
            {{ knownItem(item)?.packName }}
          </UBadge>

          <UBadge
            v-else
            color="warning"
            variant="subtle"
            size="sm"
            icon="tabler:pencil"
            class="shrink-0"
            :title="STARTING_EQUIPMENT_EDITOR_LABELS.missingHint"
          >
            {{ STARTING_EQUIPMENT_EDITOR_LABELS.missing }}
          </UBadge>

          <UInputNumber
            v-model="item.quantity"
            :min="1"
            :max="999"
            size="sm"
            class="w-28 shrink-0"
            :aria-label="STARTING_EQUIPMENT_EDITOR_LABELS.itemQuantity"
          />

          <UInput
            v-model="item.note"
            :placeholder="STARTING_EQUIPMENT_EDITOR_LABELS.itemNote"
            size="sm"
            class="w-40 shrink-0"
          />

          <UButton
            icon="tabler:trash"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="`${STARTING_EQUIPMENT_EDITOR_LABELS.itemRemove}: ${item.name}`"
            @click.left.exact.prevent="removeItem(option, itemIndex)"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UButton
            v-if="canPick"
            icon="tabler:books"
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.itemPick"
            color="primary"
            variant="soft"
            size="xs"
            @click.left.exact.prevent="openPicker(option)"
          />

          <UButton
            icon="tabler:plus"
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.itemAdd"
            color="neutral"
            variant="subtle"
            size="xs"
            @click.left.exact.prevent="addItem(option)"
          />

          <span
            v-if="!canPick"
            class="text-xs text-dimmed italic"
          >
            {{ REF_PICKER_LABELS.noSocket }}
          </span>
        </div>

        <div class="flex items-end gap-2">
          <UFormField
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.coins"
            class="w-40"
          >
            <UInputNumber
              v-model="option.coins"
              :min="0"
              :max="9999"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="props.showGoldAlternative"
            :label="STARTING_EQUIPMENT_EDITOR_LABELS.goldAlternative"
            class="w-56"
          >
            <UInputNumber
              v-model="option.goldAlternative"
              :min="0"
              :max="9999"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>
    </FormSection>

    <CompendiumRefPickerModal
      v-if="canPick"
      v-model:open="isPickerOpen"
      :socket="props.socket"
      :kind="STARTING_EQUIPMENT_ITEM_KINDS"
      :title="STARTING_EQUIPMENT_EDITOR_LABELS.pickerTitle"
      :z-index="pickerZIndex"
      :resolve-entry="resolvePickerEntry"
      :filter-value="equipmentTypeFilterValue"
      :filter-label="STARTING_EQUIPMENT_EDITOR_LABELS.filterItemType"
      :filter-order="EQUIPMENT_TYPE_FILTER_ORDER"
      @select="addPicked"
    />
  </div>
</template>
