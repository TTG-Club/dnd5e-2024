<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { FeatChoiceOption } from '@vtt/shared/system/dnd.js';

  import type { PickedCompendiumRef } from '../CompendiumRefPickerModal.vue';
  import type { EditableGrantRow, GrantRowKind } from './featEditorTypes';
  import type {
    PoolPickerGroup,
    PoolPickerOption,
  } from './GrantPoolPickerModal.vue';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKind } from '@/core/compendiumDataClient';
  import {
    ABILITY_LABELS,
    getFeatChoiceDefaultPool,
    isSkillType,
    SKILL_ABILITY_MAP,
    TOOL_CATEGORIES,
    TOOLS_LIST,
    WEAPON_MASTERIES,
    weaponMasteryName,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import ChoiceScalingRows from '../ChoiceScalingRows.vue';
  import { featCategoryFilterValue } from '../compendiumFilters';
  import CompendiumRefPickerModal from '../CompendiumRefPickerModal.vue';
  import {
    ARMOR_PROF_LABELS,
    CLASS_LEVEL_MAX,
    FEAT_GRANTS_LABELS,
    POOL_PICKER_LABELS,
    REF_PICKER_LABELS,
    REF_PICKER_TITLES,
    WEAPON_PROF_LABELS,
  } from '../constants';
  import FieldHint from '../FieldHint.vue';
  import FormSection from '../FormSection.vue';
  import {
    createGrantRow,
    GRANT_ROW_KIND_OPTIONS,
    hasKind,
    isMixableKind,
    primaryKind,
  } from './featEditorTypes';
  import GrantOptionRows from './GrantOptionRows.vue';
  import GrantPoolPickerModal from './GrantPoolPickerModal.vue';

  /**
   * Редактор даров черты: одна строка — одно, что черта даёт. Режим строки
   * решает, выдаётся ли всё перечисленное сразу или игрок выбирает из набора:
   * механика у этого одна, и разводить их по разным вкладкам значило бы дважды
   * описывать одно и то же.
   *
   * Наборы значений берутся из того же `getFeatChoiceDefaultPool`, которым лист
   * потом собирает пул выбора, — свои списки в окне разошлись бы с тем, что
   * увидит игрок. Виды оружия справочником правил не описаны и приходят из
   * данных мира.
   */
  const rows = defineModel<EditableGrantRow[]>({ required: true });

  const props = withDefaults(
    defineProps<{
      /**
       * Скрыть вид «Характеристика»: у предыстории повышение выдаётся
       * каноническим полем, и здесь оно применилось бы вторым.
       */
      hideAbility?: boolean;
      /** Скрыть вид «Навык» — у предыстории навыки тоже канонические. */
      hideSkill?: boolean;
      /**
       * Скрыть вид «Черта». Черту кладёт на лист мастер класса — это он знает
       * компендиум и умеет применить её со всеми её же дарами. У черты, вида и
       * предыстории такого шага нет: выданная там черта осталась бы записью,
       * которую никто не применит, — предлагать её значило бы обещать впустую.
       * Предыстория выдаёт черту своим каноническим полем.
       */
      hideFeat?: boolean;
      /**
       * Ключи выборов, уже занятые чертой (включая вкладку заклинаний): все
       * выборы лежат в одном списке блоба, и ключ обязан быть уникальным.
       */
      takenKeys?: string[];
      /**
       * WebSocket-клиент: им строка вида «Черта» открывает окно выбора записи
       * компендиума. Нет клиента — черту не выбрать, о чём форма и говорит.
       */
      socket?: TypedWebSocketClient | null;
    }>(),
    {
      hideAbility: false,
      hideSkill: false,
      hideFeat: false,
      takenKeys: () => [],
      socket: null,
    },
  );

  const systemDataStore = useSystemDataStore();

  const modeOptions = [
    { value: 'all', label: FEAT_GRANTS_LABELS.modeAll },
    { value: 'choice', label: FEAT_GRANTS_LABELS.modeChoice },
  ];

  const grantsOptions = [
    { value: 'proficiency', label: FEAT_GRANTS_LABELS.grantsProficiency },
    { value: 'expertise', label: FEAT_GRANTS_LABELS.grantsExpertise },
  ];

  /** Виды дара, доступные в этой форме. */
  const kindOptions = computed(() =>
    GRANT_ROW_KIND_OPTIONS.filter(
      (option) =>
        !(props.hideAbility && option.value === 'ability')
        && !(props.hideSkill && option.value === 'skill')
        && !(props.hideFeat && option.value === 'feat'),
    ),
  );

  /** Виды оружия мира — набор для владения оружием. */
  const weaponOptions = computed<FeatChoiceOption[]>(() =>
    systemDataStore.weaponBaseTypes.map((baseType) => ({
      value: baseType.key,
      name: baseType.name,
    })),
  );

  /**
   * То же оружие, но подписанное своим приёмом: строка выдаёт приём вместе с
   * оружием, и без подписи автор не видит, что именно достаётся персонажу.
   */
  const weaponWithMasteryOptions = computed<FeatChoiceOption[]>(() =>
    systemDataStore.weaponBaseTypes.map((baseType) => {
      const mastery = weaponMasteryName(baseType.key);

      return {
        value: baseType.key,
        name: mastery ? `${baseType.name} — ${mastery}` : baseType.name,
      };
    }),
  );

  /** Категории оружия («простое», «воинское») — ими задают владение оптом. */
  const weaponCategoryOptions: FeatChoiceOption[] = [
    { value: 'simple', name: WEAPON_PROF_LABELS.simple },
    { value: 'martial', name: WEAPON_PROF_LABELS.martial },
  ];

  const armorOptions: FeatChoiceOption[] = Object.entries(
    ARMOR_PROF_LABELS,
  ).map(([value, name]) => ({ value, name }));

  /**
   * Набор значений для вида дара. Правила знают навыки, характеристики,
   * инструменты, языки и типы урона; доспехи и оружие — данные мира.
   *
   * @param kind - вид дара
   */
  function poolFor(kind: GrantRowKind): FeatChoiceOption[] {
    if (kind === 'armor') {
      return armorOptions;
    }

    if (kind === 'weapon') {
      return [...weaponCategoryOptions, ...weaponOptions.value];
    }

    if (kind === 'weaponMastery') {
      return weaponWithMasteryOptions.value;
    }

    // Черты приезжают из компендиума — их выбирают окном, а не селектом
    if (kind === 'feat') {
      return [];
    }

    return getFeatChoiceDefaultPool(kind);
  }

  /**
   * Склеенный набор строки: у смешанной строки виды идут подряд, повторов нет.
   *
   * @param row - строка дара
   */
  function poolForRow(row: EditableGrantRow): FeatChoiceOption[] {
    const seen = new Set<string>();
    const merged: FeatChoiceOption[] = [];

    for (const kind of row.kinds) {
      for (const option of poolFor(kind)) {
        if (seen.has(option.value)) {
          continue;
        }

        seen.add(option.value);
        merged.push(option);
      }
    }

    return merged;
  }

  /** Есть ли у строки готовый набор (иначе варианты вписывают руками). */
  function hasPool(row: EditableGrantRow): boolean {
    return poolForRow(row).length > 0;
  }

  /**
   * Виды, у которых фиксированной выдачи не бывает: тип урона задаётся
   * защитой на вкладке «Автоматизация», а «вариант» без выбора смысла не имеет.
   */
  function isChoiceOnlyKind(kind: GrantRowKind): boolean {
    return kind === 'damageType' || kind === 'option';
  }

  /** Виды, дающие владение: от них зависят настройки владения у строки. */
  const PROFICIENCY_KINDS: ReadonlySet<GrantRowKind> = new Set([
    'skill',
    'savingThrow',
    'tool',
    'language',
    'weapon',
    'weaponMastery',
    'masteryProperty',
    'armor',
  ]);

  /** Даёт ли строка владение — хотя бы одним из своих видов. */
  function isProficiencyRow(row: EditableGrantRow): boolean {
    return row.kinds.some((kind) => PROFICIENCY_KINDS.has(kind));
  }

  /** Только выбор — если хотя бы один вид строки фиксированной выдачи не знает. */
  function isChoiceOnlyRow(row: EditableGrantRow): boolean {
    return row.kinds.some(isChoiceOnlyKind);
  }

  /** Отмеченные значения строки. */
  function selectedValues(row: EditableGrantRow): string[] {
    return row.options.map((option) => option.value);
  }

  // ── Окно выбора значений ────────────────────────────────────

  /**
   * Английские названия — второй строкой в окне выбора. Есть только у данных
   * мира: справочники правил (навыки, языки, типы урона) английских названий не
   * несут, и выдумывать их здесь нечего.
   */
  const nameEnByKey = computed(
    () =>
      new Map(
        systemDataStore.weaponBaseTypes.map((baseType) => [
          baseType.key,
          baseType.nameEn,
        ]),
      ),
  );

  /** Категории инструментов по ключу — фильтр набора инструментов. */
  const TOOL_CATEGORY_BY_KEY = new Map(
    TOOLS_LIST.map((tool) => [tool.key, TOOL_CATEGORIES[tool.category]]),
  );

  /**
   * Чем значение отмечается в фильтре окна. Пусто — значение под фильтр не
   * идёт: у языков и доспехов делить нечего, их и так десяток.
   *
   * @param kind - вид дара
   * @param value - значение набора
   */
  function facetOf(kind: GrantRowKind, value: string): string | undefined {
    if (kind === 'weapon') {
      // Категория целиком («Простое оружие») попадает в свой же раздел фильтра:
      // отобрав «Простое», автор видит и её, и всё простое оружие поимённо
      return value === 'simple' || value === 'martial'
        ? WEAPON_PROF_LABELS[value]
        : WEAPON_PROF_LABELS[
            systemDataStore.weaponBaseTypes.find(
              (baseType) => baseType.key === value,
            )?.category ?? ''
          ];
    }

    if (kind === 'weaponMastery') {
      return weaponMasteryName(value) ?? undefined;
    }

    if (kind === 'skill') {
      return isSkillType(value)
        ? ABILITY_LABELS[SKILL_ABILITY_MAP[value]]
        : undefined;
    }

    if (kind === 'tool') {
      return TOOL_CATEGORY_BY_KEY.get(value);
    }

    return undefined;
  }

  /** Подпись панели фильтра по основному виду строки; пусто — фильтра нет. */
  const FILTER_LABEL_BY_KIND: Partial<Record<GrantRowKind, string>> = {
    weapon: FEAT_GRANTS_LABELS.filterWeaponCategory,
    weaponMastery: FEAT_GRANTS_LABELS.filterMastery,
    skill: FEAT_GRANTS_LABELS.filterAbility,
    tool: FEAT_GRANTS_LABELS.filterToolCategory,
  };

  /** Порядок значений фильтра по основному виду; пусто — по алфавиту. */
  const FILTER_ORDER_BY_KIND: Partial<Record<GrantRowKind, string[]>> = {
    weapon: [WEAPON_PROF_LABELS.simple, WEAPON_PROF_LABELS.martial],
    weaponMastery: WEAPON_MASTERIES.map((mastery) => mastery.name.ru),
    skill: Object.values(ABILITY_LABELS),
    tool: Object.values(TOOL_CATEGORIES),
  };

  /** Строка, для которой открыто окно выбора значений; null — окно закрыто. */
  const poolPickerRowUid = ref<string | null>(null);

  /** Строка, которой принадлежит открытое окно. */
  const poolPickerRow = computed<EditableGrantRow | null>(
    () => rows.value.find((row) => row.uid === poolPickerRowUid.value) ?? null,
  );

  /** Виды строки — левая колонка окна. */
  const poolPickerGroups = computed<PoolPickerGroup[]>(() =>
    (poolPickerRow.value?.kinds ?? []).map((kind) => ({
      id: kind,
      name:
        GRANT_ROW_KIND_OPTIONS.find((option) => option.value === kind)?.label
        ?? kind,
    })),
  );

  /** Значения строки с видом и фильтром — правая колонка окна. */
  const poolPickerOptions = computed<PoolPickerOption[]>(() => {
    const row = poolPickerRow.value;

    if (!row) {
      return [];
    }

    const seen = new Set<string>();
    const merged: PoolPickerOption[] = [];

    for (const kind of row.kinds) {
      for (const option of poolFor(kind)) {
        if (seen.has(option.value)) {
          continue;
        }

        seen.add(option.value);

        merged.push({
          value: option.value,
          name: option.name ?? option.value,
          nameEn: nameEnByKey.value.get(option.value),
          group: kind,
          filter: facetOf(kind, option.value),
        });
      }
    }

    return merged;
  });

  const poolPickerFilterLabel = computed(() => {
    const row = poolPickerRow.value;

    return row ? (FILTER_LABEL_BY_KIND[primaryKind(row)] ?? '') : '';
  });

  const poolPickerFilterOrder = computed(() => {
    const row = poolPickerRow.value;

    return row ? (FILTER_ORDER_BY_KIND[primaryKind(row)] ?? []) : [];
  });

  /** Заголовок окна: он же подпись поля, из которого его открыли. */
  const poolPickerTitle = computed(() => {
    const row = poolPickerRow.value;

    if (!row) {
      return FEAT_GRANTS_LABELS.pool;
    }

    return row.mode === 'all'
      ? FEAT_GRANTS_LABELS.values
      : FEAT_GRANTS_LABELS.pool;
  });

  /**
   * Открывает окно выбора значений для строки.
   *
   * @param row - строка дара
   */
  function openPoolPicker(row: EditableGrantRow): void {
    poolPickerRowUid.value = row.uid;
  }

  /**
   * Подпись поля значений: у черты своя — «какие черты», а не «что выдаётся».
   *
   * @param row - строка дара
   */
  function valuesLabel(row: EditableGrantRow): string {
    if (isFeatRow(row)) {
      return row.mode === 'all'
        ? FEAT_GRANTS_LABELS.featValues
        : FEAT_GRANTS_LABELS.featPool;
    }

    return row.mode === 'all'
      ? FEAT_GRANTS_LABELS.values
      : FEAT_GRANTS_LABELS.pool;
  }

  /**
   * Пояснение к полю значений: у справочника без набора варианты вписывают
   * руками, и подсказка об этом другая.
   *
   * @param row - строка дара
   */
  function valuesHint(row: EditableGrantRow): string {
    if (isFeatRow(row)) {
      return FEAT_GRANTS_LABELS.featPoolHint;
    }

    return hasPool(row)
      ? FEAT_GRANTS_LABELS.poolHint
      : FEAT_GRANTS_LABELS.poolCustomHint;
  }

  /**
   * Строка «ничего не выбрано» — своя у черты и у справочника.
   *
   * @param row - строка дара
   */
  function valuesEmptyLabel(row: EditableGrantRow): string {
    return isFeatRow(row)
      ? FEAT_GRANTS_LABELS.featEmpty
      : POOL_PICKER_LABELS.empty;
  }

  /**
   * Подпись кнопки выбора: черты берут из компендиума, остальное — из окна
   * значений.
   *
   * @param row - строка дара
   */
  function valuePickerLabel(row: EditableGrantRow): string {
    return isFeatRow(row) ? REF_PICKER_LABELS.open : POOL_PICKER_LABELS.open;
  }

  /**
   * Открывает то окно выбора, которое строке подходит: черты берутся из
   * компендиума, остальное — из справочников.
   *
   * @param row - строка дара
   */
  function openValuePicker(row: EditableGrantRow): void {
    if (isFeatRow(row)) {
      openFeatPicker(row);

      return;
    }

    openPoolPicker(row);
  }

  /**
   * Записывает отметки окна в строку.
   *
   * @param values - отмеченные значения
   */
  function applyPoolPicker(values: string[]): void {
    const row = poolPickerRow.value;

    if (row) {
      setValues(row, values);
    }

    poolPickerRowUid.value = null;
  }

  /**
   * Убирает значение из набора строки — прямо со строки, без открытия окна.
   *
   * @param row - строка дара
   * @param index - номер значения в наборе
   */
  function removeOption(row: EditableGrantRow, index: number): void {
    row.options = row.options.filter((_, optionIndex) => optionIndex !== index);
  }

  // ── Строка вида «Черта» ──────────────────────────────────────

  /** Черта выбирается из компендиума, а он есть только при живом соединении. */
  const canPickFeats = computed(() => Boolean(props.socket));

  /** Строка, для которой открыто окно выбора черты; null — окно закрыто. */
  const featPickerRowUid = ref<string | null>(null);

  /**
   * Категории черт, встреченные в компендиуме. Грузятся один раз и только когда
   * в форме есть строка черты: ради формы без таких строк дёргать компендиум
   * незачем.
   */
  const featCategoryOptions = ref<string[]>([]);
  const areFeatCategoriesLoaded = ref(false);

  /** Есть ли у строки вид «Черта». */
  function isFeatRow(row: EditableGrantRow): boolean {
    return hasKind(row, 'feat');
  }

  /** Загружает категории черт из компендиума — один раз на форму. */
  async function loadFeatCategories(): Promise<void> {
    if (areFeatCategoriesLoaded.value || !props.socket) {
      return;
    }

    areFeatCategoriesLoaded.value = true;

    const entries: unknown[] = await loadCompendiumKind(props.socket, 'feat');

    const categories = new Set<string>();

    for (const entry of entries) {
      const category = featCategoryFilterValue(entry)?.trim();

      if (category) {
        categories.add(category);
      }
    }

    featCategoryOptions.value = [...categories].sort((first, second) =>
      first.localeCompare(second),
    );
  }

  watch(
    () => rows.value.some(isFeatRow),
    (hasFeatRow) => {
      if (hasFeatRow) {
        void loadFeatCategories();
      }
    },
    { immediate: true },
  );

  /**
   * Открывает окно выбора черты для строки.
   *
   * @param row - строка дара
   */
  function openFeatPicker(row: EditableGrantRow): void {
    featPickerRowUid.value = row.uid;
  }

  /**
   * Дописывает выбранные черты в набор строки. Повторы отбрасываются: одна и та
   * же черта дважды в наборе ничего не добавляет, а игроку показалась бы дважды.
   *
   * @param picked - выбранные записи компендиума
   */
  function addPickedFeats(picked: PickedCompendiumRef[]): void {
    const row = rows.value.find(
      (candidate) => candidate.uid === featPickerRowUid.value,
    );

    if (!row) {
      return;
    }

    const known = new Set(row.options.map((option) => option.value));

    row.options = [
      ...row.options,
      ...picked
        .filter((reference) => !known.has(reference.url))
        .map((reference) => ({ value: reference.url, name: reference.name })),
    ];

    featPickerRowUid.value = null;
  }

  /**
   * Записывает отмеченные значения: подпись берётся из набора, иначе на
   * кнопках игрока окажется «charisma».
   *
   * @param row - строка дара
   * @param values - отмеченные значения
   */
  function setValues(row: EditableGrantRow, values: string[]): void {
    const names = new Map(
      poolForRow(row).map((option) => [option.value, option.name]),
    );

    row.options = values.map((value) => ({ value, name: names.get(value) }));
  }

  /**
   * Смена вида сбрасывает набор: значения заданы в словаре прежнего вида и в
   * новом означали бы не то (навык «Проницательность» среди языков).
   *
   * @param row - строка дара
   * @param kind - новый вид
   */
  function setKinds(row: EditableGrantRow, kinds: GrantRowKind[]): void {
    const next = kinds.length > 0 ? kinds : [primaryKind(row)];

    // Несмешиваемый вид живёт в строке один: значения оружия и «варианта» по
    // справочнику не разложить, и в общем наборе они стали бы неразличимы
    row.kinds = next.some((kind) => !isMixableKind(kind))
      ? [next[next.length - 1]]
      : next;

    row.options = [];

    if (isChoiceOnlyRow(row)) {
      row.mode = 'choice';
    }

    if (hasKind(row, 'ability')) {
      row.abilityAmount = row.abilityAmount || 1;
      row.abilityUpto = row.abilityUpto || 20;
    } else {
      row.abilityAmount = 0;
      row.abilityUpto = 0;
    }
  }

  function addRow(): void {
    const kind = kindOptions.value[0]?.value ?? 'skill';

    rows.value = [
      ...rows.value,
      createGrantRow(kind, new Set(props.takenKeys)),
    ];
  }

  function removeRow(index: number): void {
    rows.value = rows.value.filter((_, rowIndex) => rowIndex !== index);
  }

  /**
   * Отмеченные виды одной строкой. Несколько читаются как «или»: игрок выбирает
   * из общей кучи, а не получает всё перечисленное.
   *
   * @param row - строка дара
   */
  function kindsLabel(row: EditableGrantRow): string {
    return row.kinds
      .map(
        (value) =>
          GRANT_ROW_KIND_OPTIONS.find((option) => option.value === value)?.label
          ?? value,
      )
      .join(FEAT_GRANTS_LABELS.kindSeparator);
  }

  /** Заголовок строки: что даётся и как. */
  function rowTitle(row: EditableGrantRow): string {
    const kind = row.kinds
      .map(
        (value) =>
          GRANT_ROW_KIND_OPTIONS.find((option) => option.value === value)?.label
          ?? value,
      )
      .join(FEAT_GRANTS_LABELS.kindSeparator);

    const mode =
      row.mode === 'all'
        ? FEAT_GRANTS_LABELS.modeAll
        : FEAT_GRANTS_LABELS.modeChoice;

    return `${kind} — ${mode.toLowerCase()}`;
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="flex items-center gap-1 text-xs text-dimmed">
      {{ FEAT_GRANTS_LABELS.grantsHint }}
      <FieldHint :text="FEAT_GRANTS_LABELS.grantsHintDetails" />
    </p>

    <div
      v-if="rows.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ FEAT_GRANTS_LABELS.grantsEmpty }}
    </div>

    <template
      v-for="(row, index) in rows"
      :key="row.uid"
    >
      <!-- Строки складываются: черта даёт всё перечисленное разом -->
      <div
        v-if="index > 0"
        class="flex items-center gap-2 px-1"
      >
        <span class="h-px flex-1 bg-accented/40" />

        <span class="text-xs font-semibold tracking-wider text-dimmed">
          {{ FEAT_GRANTS_LABELS.rowsAnd }}
        </span>

        <span class="h-px flex-1 bg-accented/40" />
      </div>

      <FormSection
        :title="rowTitle(row)"
        icon="tabler:gift-filled"
      >
        <template #actions>
          <UButton
            icon="tabler:trash"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="rowTitle(row)"
            @click.left.exact.prevent="removeRow(index)"
          />
        </template>

        <div class="flex flex-col gap-2">
          <!-- Поля строки в одну линию. Подсказка про второй вид вынесена ПОД
            строку: внутри ячейки она распирала её, и соседние поля съезжали
            вниз на её высоту -->
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-end gap-2">
              <UFormField class="min-w-56 flex-1">
                <template #label>
                  <span class="flex items-center gap-1">
                    {{ FEAT_GRANTS_LABELS.kind }}
                    <FieldHint :text="FEAT_GRANTS_LABELS.kindHint" />
                  </span>
                </template>

                <USelectMenu
                  :model-value="row.kinds"
                  :items="kindOptions"
                  value-key="value"
                  label-key="label"
                  multiple
                  class="w-full"
                  @update:model-value="setKinds(row, $event)"
                >
                  <!-- Отмеченные виды читаются как «или»: выбирают из общей кучи -->
                  <span class="truncate">{{ kindsLabel(row) }}</span>
                </USelectMenu>
              </UFormField>

              <UFormField class="w-40 shrink-0">
                <template #label>
                  <span class="flex items-center gap-1">
                    {{ FEAT_GRANTS_LABELS.mode }}
                    <FieldHint :text="FEAT_GRANTS_LABELS.modeHint" />
                  </span>
                </template>

                <USelect
                  v-model="row.mode"
                  :items="modeOptions"
                  value-key="value"
                  label-key="label"
                  :disabled="isChoiceOnlyRow(row)"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="row.mode === 'choice'"
                :label="FEAT_GRANTS_LABELS.count"
                class="w-24 shrink-0"
              >
                <UInputNumber
                  v-model="row.count"
                  :min="1"
                  :max="10"
                  :disabled="row.countEqualsProficiencyBonus"
                  class="w-full"
                />
              </UFormField>

              <div
                v-if="row.mode === 'choice'"
                class="mb-2 flex shrink-0 items-center gap-1"
              >
                <UCheckbox
                  v-model="row.countEqualsProficiencyBonus"
                  :label="FEAT_GRANTS_LABELS.countEqualsProficiencyBonus"
                />

                <FieldHint
                  :text="FEAT_GRANTS_LABELS.countEqualsProficiencyBonusHint"
                />
              </div>
            </div>

            <p
              v-if="row.kinds.length === 1 && isMixableKind(primaryKind(row))"
              class="text-xs text-dimmed"
            >
              {{ FEAT_GRANTS_LABELS.kindSingleHint }}
            </p>

            <!-- Два приёмных вида путают чаще всего: один называет оружие,
              другой сам приём -->
            <p
              v-if="
                hasKind(row, 'weaponMastery') || hasKind(row, 'masteryProperty')
              "
              class="text-xs text-dimmed"
            >
              {{ FEAT_GRANTS_LABELS.kindMasteryHint }}
            </p>
          </div>

          <!-- Категории черт: ими пул сужается ещё до перечня -->
          <UFormField v-if="isFeatRow(row) && row.mode === 'choice'">
            <template #label>
              <span class="flex items-center gap-1">
                {{ FEAT_GRANTS_LABELS.featCategories }}

                <FieldHint :text="FEAT_GRANTS_LABELS.featCategoriesHint" />
              </span>
            </template>

            <USelectMenu
              v-model="row.featCategories"
              :items="featCategoryOptions"
              multiple
              class="w-full"
              :placeholder="REF_PICKER_LABELS.filterFeatCategory"
            />
          </UFormField>

          <!-- Что выдаётся / из чего выбирают -->
          <UFormField>
            <template #label>
              <span class="flex items-center gap-1">
                {{ valuesLabel(row) }}

                <FieldHint :text="valuesHint(row)" />
              </span>
            </template>

            <!-- Значения выбирают окном, а не выпадающим списком: и черт, и
              оружия, и навыков там столько, что списком их не листают. Окно у
              справочников и у компендиума одно на вид: слева откуда берутся
              значения, под ними фильтр, справа поиск и отметки -->
            <div
              v-if="isFeatRow(row) || hasPool(row)"
              class="flex flex-col gap-1.5"
            >
              <p
                v-if="row.options.length === 0"
                class="text-xs text-dimmed italic"
              >
                {{ valuesEmptyLabel(row) }}
              </p>

              <div
                v-else
                class="flex flex-wrap items-center gap-1"
              >
                <span
                  v-for="(option, optionIndex) in row.options"
                  :key="option.value"
                  class="flex max-w-full items-center gap-0.5 rounded-md border border-default/60 bg-elevated/40 py-0.5 pr-0.5 pl-2 text-xs"
                >
                  <span class="truncate">
                    {{ option.name || option.value }}
                  </span>

                  <UButton
                    icon="tabler:x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-label="option.name || option.value"
                    @click.left.exact.prevent="removeOption(row, optionIndex)"
                  />
                </span>
              </div>

              <UButton
                v-if="!isFeatRow(row) || canPickFeats"
                icon="tabler:list-check"
                :label="valuePickerLabel(row)"
                color="primary"
                variant="soft"
                size="xs"
                class="self-start"
                @click.left.exact.prevent="openValuePicker(row)"
              />

              <p
                v-else
                class="text-xs text-dimmed italic"
              >
                {{ REF_PICKER_LABELS.noSocket }}
              </p>
            </div>

            <GrantOptionRows
              v-else
              v-model="row.options"
            />
          </UFormField>

          <!-- Настройки выбора -->
          <template v-if="row.mode === 'choice'">
            <UFormField :label="FEAT_GRANTS_LABELS.label">
              <UInput
                v-model="row.label"
                :placeholder="FEAT_GRANTS_LABELS.labelPlaceholder"
                class="w-full"
              />
            </UFormField>

            <div
              v-if="isProficiencyRow(row)"
              class="flex flex-wrap items-end gap-3"
            >
              <UFormField
                :label="FEAT_GRANTS_LABELS.grants"
                class="w-44"
              >
                <USelect
                  v-model="row.grants"
                  :items="grantsOptions"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>

              <UCheckbox
                v-model="row.onlyIfNotProficient"
                :label="FEAT_GRANTS_LABELS.onlyIfNotProficient"
                class="mb-2"
              />

              <UCheckbox
                v-model="row.onlyIfProficient"
                :label="FEAT_GRANTS_LABELS.onlyIfProficient"
                class="mb-2"
              />

              <UCheckbox
                v-model="row.expertiseIfProficient"
                :label="FEAT_GRANTS_LABELS.expertiseIfProficient"
                class="mb-2"
              />
            </div>

            <div class="flex flex-wrap items-end gap-4">
              <UCheckbox
                v-model="row.rechooseOnLongRest"
                :label="FEAT_GRANTS_LABELS.rechooseOnLongRest"
                class="mb-2"
              />

              <!-- Пояснение под полем разъезжалось на четыре строки в узкой
                колонке и растаскивало соседей — оно ушло под ⓘ у подписи -->
              <UFormField class="w-40">
                <template #label>
                  <span class="flex items-center gap-1">
                    {{ FEAT_GRANTS_LABELS.choiceRequiredLevel }}

                    <FieldHint
                      :text="FEAT_GRANTS_LABELS.choiceRequiredLevelHint"
                    />
                  </span>
                </template>

                <UInputNumber
                  v-model="row.requiredLevel"
                  :min="0"
                  :max="CLASS_LEVEL_MAX"
                  class="w-full"
                />
              </UFormField>
            </div>

            <!-- Рост по уровням: оружейных приёмов у воина три с 1 уровня,
              четыре с 4, пять с 10. Ступень называет, сколько всего выбрано к
              этому уровню, а не сколько добавилось -->
            <ChoiceScalingRows
              v-model="row.scaling"
              :base-count="row.count"
              :empty-text="FEAT_GRANTS_LABELS.choiceScalingEmpty"
            />

            <!-- Ряд по уровням соберётся из ступеней: колонкой его набирать не
              нужно -->
            <div
              v-if="row.scaling.length > 0"
              class="flex flex-wrap items-end gap-4"
            >
              <UCheckbox
                v-model="row.showInTable"
                :label="FEAT_GRANTS_LABELS.choiceShowInTable"
                :description="FEAT_GRANTS_LABELS.choiceShowInTableHint"
              />

              <UFormField
                v-if="row.showInTable"
                :label="FEAT_GRANTS_LABELS.choiceShortName"
                class="w-56"
              >
                <UInput
                  v-model="row.shortName"
                  :placeholder="FEAT_GRANTS_LABELS.choiceShortNamePlaceholder"
                  size="sm"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>

          <!-- Повышение характеристики: и у фиксированного дара, и у выбора -->
          <div
            v-if="hasKind(row, 'ability') || hasKind(row, 'savingThrow')"
            class="flex flex-col gap-1"
          >
            <div class="flex items-end gap-3">
              <UFormField
                :label="FEAT_GRANTS_LABELS.abilityAmount"
                class="w-28"
              >
                <UInputNumber
                  v-model="row.abilityAmount"
                  :min="0"
                  :max="5"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="row.abilityAmount > 0"
                :label="FEAT_GRANTS_LABELS.abilityUpto"
                class="w-28"
              >
                <UInputNumber
                  v-model="row.abilityUpto"
                  :min="0"
                  :max="30"
                  class="w-full"
                />
              </UFormField>
            </div>

            <p class="text-xs text-dimmed">
              {{ FEAT_GRANTS_LABELS.abilityHint }}
            </p>
          </div>
        </div>
      </FormSection>
    </template>

    <UButton
      icon="tabler:plus"
      :label="FEAT_GRANTS_LABELS.addGrant"
      color="primary"
      variant="soft"
      block
      @click.left.exact.prevent="addRow"
    />

    <!-- Окно выбора значений — одно на всю форму: открыто оно всегда для одной
      строки, и заводить его у каждой значило бы держать десяток окон впустую -->
    <GrantPoolPickerModal
      :open="poolPickerRowUid !== null"
      :title="poolPickerTitle"
      :groups="poolPickerGroups"
      :options="poolPickerOptions"
      :selected="poolPickerRow ? selectedValues(poolPickerRow) : []"
      :filter-label="poolPickerFilterLabel"
      :filter-order="poolPickerFilterOrder"
      @update:open="poolPickerRowUid = null"
      @apply="applyPoolPicker"
    />

    <!-- То же для черт, но со списком компендиума: их пул приезжает из паков -->
    <CompendiumRefPickerModal
      v-if="canPickFeats"
      :open="featPickerRowUid !== null"
      :socket="props.socket"
      kind="feat"
      :title="REF_PICKER_TITLES.feat"
      :filter-value="featCategoryFilterValue"
      :filter-label="REF_PICKER_LABELS.filterFeatCategory"
      @update:open="featPickerRowUid = null"
      @select="addPickedFeats"
    />
  </div>
</template>
