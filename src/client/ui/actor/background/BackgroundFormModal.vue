<script setup lang="ts">
  import type {
    AbilityType,
    Feature,
    SkillType,
    SourceDefinition,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    ActiveEffect,
    BackgroundDefinition,
    DnDGameItem,
    GrantedSpellRef,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { EditableFeatGrants } from '../feat/featEditorTypes';
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableStartingEquipmentOption } from '../startingEquipmentEditorTypes';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKind } from '@/core/compendiumDataClient';
  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useItemsStore } from '@/stores/itemsStore';
  import {
    buildSpellLinkIndex,
    findSpellInPacks,
    linkGrantedSpellRefs,
    loadSpellPacks,
  } from '@/systems/dnd5e/composables/spellCompendium';
  import { generateId } from '@vtt/shared';
  import {
    ABILITY_OPTIONS,
    CLASS_KEY_OPTIONS,
    isDnDGameItem,
    resolveBackgroundFeatClassKey,
    resolveToolProficiencies,
    SKILLS_LIST,
    TOOLS_LABELS,
  } from '@vtt/shared/system/dnd.js';

  import {
    BACKGROUND_FORM_LABELS,
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    GRANT_FIELD_LABELS,
    GRANT_SECTION_LABELS,
    GRANTED_SPELLS_LABELS,
    MODAL_BUTTON_LABELS,
    NO_SELECTION,
    SPELL_CHOICE_LABELS,
  } from '../constants';
  import {
    buildFeatData,
    createEmptyFeatGrants,
    featDataToGrants,
    usedChoiceKeys,
  } from '../feat/featEditorTypes';
  import FeatSpellcastingFields from '../feat/FeatSpellcastingFields.vue';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import FieldHint from '../FieldHint.vue';
  import FormSection from '../FormSection.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';
  import SourceField from '../SourceField.vue';
  import StartingEquipmentEditor from '../StartingEquipmentEditor.vue';
  import {
    buildBackgroundEquipmentOptions,
    toEditableEquipmentOption,
  } from '../startingEquipmentEditorTypes';
  import ActiveEffectFormModal from '../tabs/ActiveEffectFormModal.vue';
  import { slugify } from '../utils/slugify';

  const props = defineProps<{
    open: boolean;
    /** Редактируемая предыстория (DnDGameItem мира). */
    item?: BackgroundDefinition | null;
    /** Совместимость: тот же объект под именем background. */
    background?: BackgroundDefinition | null;
    zIndex?: number;
    positionOffset?: number;
    allowMultiple?: boolean;
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
    /** WebSocket-клиент: загрузка черт и заклинаний компендиума. */
    socket?: TypedWebSocketClient | null;
  }>();

  const emit = defineEmits<{
    'close': [];
    'save': [background: DnDGameItem];
    'bring-to-front': [];
  }>();

  const initialPosition = computed(() =>
    props.positionOffset
      ? { x: props.positionOffset, y: props.positionOffset }
      : undefined,
  );

  const itemsStore = useItemsStore();
  const { openModal, getNextZIndex } = useModalManager();

  const abilitiesOptions = ABILITY_OPTIONS.map((ability) => ({
    value: ability.value,
    label: ability.label,
  }));

  const skillsOptions = SKILLS_LIST.map((skill) => ({
    value: skill.key,
    label: skill.label,
  }));

  const toolsOptions = Object.entries(TOOLS_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  const tabItems = [
    { label: FORM_TAB_LABELS.main, slot: 'basic' as const },
    { label: BACKGROUND_FORM_LABELS.tabParams, slot: 'params' as const },
    { label: GRANT_SECTION_LABELS.equipment, slot: 'equipment' as const },
    { label: FORM_TAB_LABELS.automation, slot: 'grants' as const },
    { label: GRANT_SECTION_LABELS.spells, slot: 'spells' as const },
    { label: FORM_TAB_LABELS.effects, slot: 'effects' as const },
  ];

  // ── Состояние формы ──────────────────────────────────────────
  const name = ref('');
  const nameEn = ref('');
  const description = ref('');
  const sourceKey = ref<string | undefined>(undefined);
  const source = ref<SourceDefinition | undefined>(undefined);
  const isSRD = ref(false);

  // Канонические дары предыстории (2024).
  const selectedAbilities = ref<AbilityType[]>([]);
  const selectedSkills = ref<SkillType[]>([]);
  const selectedFixedTools = ref<string[]>([]);
  const choicesToolsCount = ref(0);
  const selectedChoicesTools = ref<string[]>([]);

  const featSelectionType = ref<'fixed' | 'choice'>('fixed');
  const selectedFeatId = ref<string>('');
  const selectedFeatChoices = ref<string[]>([]);
  /**
   * Класс, который предыстория называет за игрока: «Мудрец» даёт «Посвящённого в
   * магию (Волшебник)». Мастер тогда не спрашивает список — он уже назван.
   */
  const selectedFeatClassKey = ref<string>(NO_SELECTION);

  /** Классы с пунктом «не назван» — им же выбор класса и снимается. */
  const featClassOptions: { value: string; label: string }[] = [
    { value: NO_SELECTION, label: BACKGROUND_FORM_LABELS.featClassNone },
    ...CLASS_KEY_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ];

  /** Варианты стартового снаряжения — строкой, позициями и монетами. */
  const equipmentOptions = ref<EditableStartingEquipmentOption[]>([]);

  // Расширенные «дары что угодно» (как у черты).
  const grants = ref<EditableFeatGrants>(createEmptyFeatGrants());

  /** Ключи занятых выборов: все они лежат в одном списке блоба. */
  const takenChoiceKeys = computed(() => [...usedChoiceKeys(grants.value)]);
  const grantedSpells = ref<GrantedSpellRef[]>([]);
  const effects = ref<ActiveEffect[]>([]);

  const existingId = ref<string | null>(null);
  const existingKey = ref<string | null>(null);

  const canSave = computed(() => name.value.trim().length > 0);

  /**
   * Генерирует уникальный машинный ключ предыстории из английского (или
   * русского) названия. При совпадении с уже существующей предысторией
   * добавляет порядковый номер: `wanderer`, `wanderer-2`, `wanderer-3`…
   * Текущая редактируемая предыстория из проверки исключается.
   */
  function generateBackgroundKey(): string {
    const base = slugify(nameEn.value || name.value) || 'background';

    const taken = new Set<string>();

    // Стор хоста отдаёт нейтральную форму (`BaseGameItem`), а `key` —
    // D&D-специфичное поле: форму подтверждает гвард, как и в остальных
    // местах на границе с хостом.
    const worldBackgrounds = itemsStore
      .itemsByType('background')
      .filter(isDnDGameItem);

    for (const background of worldBackgrounds) {
      if (
        background.id !== existingId.value
        && typeof background.key === 'string'
        && background.key.length > 0
      ) {
        taken.add(background.key);
      }
    }

    if (!taken.has(base)) {
      return base;
    }

    let counter = 2;

    while (taken.has(`${base}-${counter}`)) {
      counter += 1;
    }

    return `${base}-${counter}`;
  }

  /** Предпросмотр машинного ключа, который получит предыстория при сохранении. */
  const keyPreview = computed(
    () => existingKey.value ?? generateBackgroundKey(),
  );

  // ── Черты компендиума (для выбора черты-происхождения) ───────
  const compendiumFeats = ref<Feature[]>([]);

  function isFeature(value: unknown): value is Feature {
    return (
      typeof value === 'object'
      && value !== null
      && 'id' in value
      && 'name' in value
      && 'description' in value
    );
  }

  /** Загружает черты компендиума (бандл + скачиваемые + модули). */
  async function loadCompendiumFeats(): Promise<void> {
    if (!props.socket) {
      return;
    }

    // CompendiumEntry[] расширяем до unknown[], т.к. Feature не подтип
    // CompendiumEntry и guard иначе не сузит при filter.
    const entries: unknown[] = await loadCompendiumKind(props.socket, 'feat');

    compendiumFeats.value = entries.filter(isFeature);
  }

  /** Опции выбора черт: пользовательские из items.db + черты компендиума. */
  const featOptions = computed(() => {
    const featsMap = new Map<string, string>();

    for (const feat of itemsStore.itemsByType('feat')) {
      featsMap.set(feat.id, feat.name || feat.id);
    }

    for (const feat of compendiumFeats.value) {
      if (!featsMap.has(feat.id)) {
        featsMap.set(feat.id, feat.name || feat.id);
      }
    }

    return Array.from(featsMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  /** Находит черту по id (сначала в items.db, затем в компендиуме). */
  function findFeat(featId: string): { name: string; nameEn?: string } | null {
    return (
      itemsStore.itemsByType('feat').find((feat) => feat.id === featId)
      ?? compendiumFeats.value.find((feat) => feat.id === featId)
      ?? null
    );
  }

  // ── Заклинания компендиума (подсказки связывания + просмотр) ─
  const availableSpells = ref<SpellOption[]>([]);

  const spellPacks = ref<
    { packId: string; packName: string; spells: Spell[] }[]
  >([]);

  async function loadAvailableSpells(): Promise<void> {
    if (!props.socket) {
      availableSpells.value = [];
      spellPacks.value = [];

      return;
    }

    const { packs, options } = await loadSpellPacks(props.socket);

    spellPacks.value = packs;
    availableSpells.value = options;
    linkGrantedSpellRefs(grantedSpells.value, buildSpellLinkIndex(options));
  }

  function openSpellDetail(spellId: string, packId?: string): void {
    const spell = findSpellInPacks(spellPacks.value, spellId, packId);

    if (spell) {
      openModal('SpellDetailModal', { spell });
    }
  }

  // ── Редактор активных эффектов ───────────────────────────────
  const isEffectModalOpen = ref(false);
  const effectModalZIndex = ref<number | undefined>(undefined);
  const editingEffect = ref<ActiveEffect | undefined>(undefined);

  function createEffect(): void {
    editingEffect.value = undefined;
    effectModalZIndex.value = getNextZIndex();
    isEffectModalOpen.value = true;
  }

  function editEffect(effect: ActiveEffect): void {
    editingEffect.value = effect;
    effectModalZIndex.value = getNextZIndex();
    isEffectModalOpen.value = true;
  }

  function deleteEffect(effectId: string): void {
    effects.value = effects.value.filter((effect) => effect.id !== effectId);
  }

  function saveEffect(effect: ActiveEffect): void {
    const index = effects.value.findIndex(
      (existing) => existing.id === effect.id,
    );

    if (index !== -1) {
      const updated = [...effects.value];

      updated[index] = effect;
      effects.value = updated;
    } else {
      effects.value = [...effects.value, effect];
    }
  }

  // ── Инициализация при открытии ───────────────────────────────
  function resetForm(): void {
    name.value = '';
    nameEn.value = '';
    description.value = '';
    sourceKey.value = undefined;
    source.value = undefined;
    isSRD.value = false;
    selectedAbilities.value = [];
    selectedSkills.value = [];
    selectedFixedTools.value = [];
    choicesToolsCount.value = 0;
    selectedChoicesTools.value = [];
    featSelectionType.value = 'fixed';
    selectedFeatId.value = '';
    selectedFeatChoices.value = [];
    selectedFeatClassKey.value = NO_SELECTION;
    equipmentOptions.value = [];
    grants.value = createEmptyFeatGrants();
    grantedSpells.value = [];
    effects.value = [];
    existingId.value = null;
    existingKey.value = null;
  }

  function hydrateFromBackground(bg: BackgroundDefinition): void {
    name.value = bg.name || '';
    nameEn.value = bg.nameEn || '';
    description.value = bg.description || '';
    sourceKey.value = bg.sourceKey;
    source.value = bg.source;
    isSRD.value = bg.isSRD || false;

    selectedAbilities.value = [...(bg.abilityGrant?.abilities ?? [])];
    selectedSkills.value = [...(bg.skillGrant?.skills ?? [])];

    // Владение приходит не только ключами: компендиум пишет его текстом, а
    // сторонние источники — ссылкой разметки. Форма же работает ключами
    // словаря, поэтому разбираем позиции здесь — иначе копия предыстории
    // показывает в поле разметку и теряет владение при сохранении.
    // Позиция «на выбор» может охватывать несколько групп («ремесленника или
    // музыкальный»): форма — плоский список ключей, поэтому в неё попадают обе
    // группы. Выбор «одной из» она не выражает, и это её предел, а не потеря.
    selectedFixedTools.value = resolveToolProficiencies(
      bg.toolGrant?.items ?? [],
    ).flatMap((entry) => {
      if (entry.kind === 'unknown') {
        return entry.source;
      }

      return entry.kind === 'group' ? entry.keys : entry.key;
    });

    if (bg.toolGrant?.choices) {
      choicesToolsCount.value = bg.toolGrant.choices.count || 0;
      selectedChoicesTools.value = [...(bg.toolGrant.choices.from ?? [])];
    }

    if (bg.featGrant?.featChoices?.length) {
      featSelectionType.value = 'choice';
      selectedFeatChoices.value = [...bg.featGrant.featChoices];
    } else {
      featSelectionType.value = 'fixed';
      selectedFeatId.value = bg.featGrant?.featId ?? '';
    }

    // Уточнение приезжает из выгрузки TTG Club текстом («Волшебник»), а форма
    // хранит ключ: без приведения сохранение записало бы «выбирает игрок» и
    // компендиумная предыстория потеряла бы названный класс
    selectedFeatClassKey.value =
      resolveBackgroundFeatClassKey(bg.featGrant) ?? NO_SELECTION;

    equipmentOptions.value = (bg.equipmentOptions ?? []).map(
      toEditableEquipmentOption,
    );

    grants.value = featDataToGrants(bg.featData);

    // Копия целиком, а не по полям: у ссылки бывает уровень доступа, и поле,
    // не показанное в этой форме, всё равно не должно теряться при сохранении
    grantedSpells.value = (bg.featData?.grantedSpells ?? []).map((spell) => ({
      ...spell,
    }));

    effects.value = (bg.activeEffects ?? []).map((effect) => ({ ...effect }));

    existingId.value = 'id' in bg && typeof bg.id === 'string' ? bg.id : null;
    existingKey.value = bg.key || null;
  }

  watch(
    () => props.open,
    (isOpen) => {
      if (!isOpen) {
        return;
      }

      resetForm();

      const bg = props.item ?? props.background;

      if (bg) {
        hydrateFromBackground(bg);
      }

      if (compendiumFeats.value.length === 0) {
        void loadCompendiumFeats();
      }

      void loadAvailableSpells();
    },
    { immediate: true },
  );

  /** Резолвит выбранную черту-происхождение в имя для записи. */
  function resolveFeatNames(): { featName: string; featNameEn: string } {
    const featId =
      featSelectionType.value === 'fixed'
        ? selectedFeatId.value
        : selectedFeatChoices.value[0];

    const feat = featId ? findFeat(featId) : null;

    return {
      featName: feat?.name ?? '',
      featNameEn: feat?.nameEn ?? '',
    };
  }

  function handleSave(): void {
    if (!canSave.value) {
      return;
    }

    const { featName, featNameEn } = resolveFeatNames();

    const featData = buildFeatData(grants.value, grantedSpells.value);

    const bg: DnDGameItem = {
      id: existingId.value || `item_${generateId('bg')}`,
      key: existingKey.value ?? generateBackgroundKey(),
      type: 'background',
      name: name.value.trim(),
      nameEn: nameEn.value.trim() || undefined,
      description: description.value.trim(),
      sourceKey: sourceKey.value,
      source: source.value,
      isSRD: isSRD.value,

      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common',
      equipped: false,
      isReadOnly: false,

      abilityGrant: {
        abilities: [...selectedAbilities.value],
      },
      skillGrant: {
        skills: [...selectedSkills.value],
      },
      toolGrant: {
        items: [...selectedFixedTools.value],
        choices:
          choicesToolsCount.value > 0
            ? {
                count: choicesToolsCount.value,
                from: [...selectedChoicesTools.value],
              }
            : undefined,
      },
      featGrant: {
        featId:
          featSelectionType.value === 'fixed'
            ? selectedFeatId.value || undefined
            : undefined,
        featChoices:
          featSelectionType.value === 'choice'
            ? [...selectedFeatChoices.value]
            : undefined,
        featName,
        featNameEn,
        featClassKey:
          selectedFeatClassKey.value === NO_SELECTION
            ? undefined
            : selectedFeatClassKey.value,
      },
      equipmentOptions: buildBackgroundEquipmentOptions(equipmentOptions.value),

      activeEffects: effects.value.length > 0 ? effects.value : undefined,
      featData,
    };

    emit('save', bg);
    emit('close');
  }

  function handleOpenChange(value: boolean): void {
    if (!value) {
      emit('close');
    }
  }
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="
      item || background
        ? BACKGROUND_FORM_LABELS.editTitle
        : BACKGROUND_FORM_LABELS.createTitle
    "
    :subtitle="nameEn || undefined"
    :initial-width="720"
    :min-width="560"
    :resizable="false"
    :z-index="zIndex"
    :saved-position="initialPosition"
    @update:open="handleOpenChange"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <UTabs
        :items="tabItems"
        variant="pill"
        class="flex flex-col"
        :ui="{
          list: 'mb-3',
          trigger: 'flex-1 justify-center',
          content: 'overflow-y-auto max-h-150',
        }"
      >
        <!-- ОСНОВНОЕ -->
        <template #basic>
          <div class="flex flex-col gap-4">
            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="FORM_FIELD_LABELS.name">
                <UInput
                  v-model="name"
                  :placeholder="BACKGROUND_FORM_LABELS.namePlaceholder"
                  class="w-full"
                />
              </UFormField>

              <UFormField :label="FORM_FIELD_LABELS.nameEn">
                <UInput
                  v-model="nameEn"
                  :placeholder="BACKGROUND_FORM_LABELS.nameEnPlaceholder"
                  class="w-full"
                />
              </UFormField>
            </div>

            <p class="-mt-2 text-xs text-dimmed">
              {{ BACKGROUND_FORM_LABELS.keyPrefix }}
              <span class="font-mono text-muted">{{ keyPreview }}</span>
              {{ BACKGROUND_FORM_LABELS.keySuffix }}
            </p>

            <UFormField :label="FORM_FIELD_LABELS.descriptionMarkdown">
              <RichTextEditor v-model="description" />
            </UFormField>

            <FormSection
              :title="FORM_FIELD_LABELS.source"
              icon="tabler:book-2"
            >
              <SourceField
                v-model:source-key="sourceKey"
                v-model:source="source"
              />

              <UCheckbox
                v-model="isSRD"
                :label="FORM_FIELD_LABELS.srd"
                class="mt-2"
              />
            </FormSection>
          </div>
        </template>

        <!-- ПАРАМЕТРЫ (канонические дары 2024) -->
        <template #params>
          <div class="flex flex-col gap-4">
            <FormSection
              :title="BACKGROUND_FORM_LABELS.abilitiesTitle"
              icon="tabler:arrow-big-up-lines"
            >
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <UFormField :label="BACKGROUND_FORM_LABELS.abilities">
                  <USelectMenu
                    v-model="selectedAbilities"
                    :items="abilitiesOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="BACKGROUND_FORM_LABELS.abilitiesPlaceholder"
                  />
                </UFormField>

                <UFormField :label="BACKGROUND_FORM_LABELS.skills">
                  <USelectMenu
                    v-model="selectedSkills"
                    :items="skillsOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="BACKGROUND_FORM_LABELS.skillsPlaceholder"
                  />
                </UFormField>
              </div>

              <p class="mt-2 text-xs text-dimmed">
                {{ BACKGROUND_FORM_LABELS.abilitiesHint }}
              </p>
            </FormSection>

            <FormSection
              :title="GRANT_SECTION_LABELS.tools"
              icon="tabler:tools"
              :hint="BACKGROUND_FORM_LABELS.toolsHint"
            >
              <UFormField :label="BACKGROUND_FORM_LABELS.fixedTools">
                <USelectMenu
                  v-model="selectedFixedTools"
                  :items="toolsOptions"
                  value-key="value"
                  label-key="label"
                  multiple
                  class="w-full"
                  :placeholder="BACKGROUND_FORM_LABELS.fixedToolsPlaceholder"
                />
              </UFormField>

              <div class="mt-3 flex items-start gap-3">
                <UFormField
                  :label="GRANT_FIELD_LABELS.choiceCount"
                  class="w-1/3"
                >
                  <UInputNumber
                    v-model="choicesToolsCount"
                    :min="0"
                    :max="10"
                  />
                </UFormField>

                <UFormField
                  :label="BACKGROUND_FORM_LABELS.choiceTools"
                  class="flex-1"
                >
                  <USelectMenu
                    v-model="selectedChoicesTools"
                    :items="toolsOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    :disabled="choicesToolsCount === 0"
                    :placeholder="BACKGROUND_FORM_LABELS.choiceToolsPlaceholder"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </FormSection>

            <FormSection
              :title="BACKGROUND_FORM_LABELS.featTitle"
              icon="tabler:star"
              :hint="BACKGROUND_FORM_LABELS.featHint"
            >
              <URadioGroup
                v-model="featSelectionType"
                :items="[
                  { value: 'fixed', label: BACKGROUND_FORM_LABELS.featFixed },
                  { value: 'choice', label: BACKGROUND_FORM_LABELS.featChoice },
                ]"
                class="mb-3"
              />

              <UFormField
                v-if="featSelectionType === 'fixed'"
                :label="BACKGROUND_FORM_LABELS.feat"
              >
                <USelectMenu
                  v-model="selectedFeatId"
                  :items="featOptions"
                  value-key="value"
                  label-key="label"
                  :placeholder="BACKGROUND_FORM_LABELS.featPlaceholder"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-else
                :label="BACKGROUND_FORM_LABELS.featChoices"
              >
                <USelectMenu
                  v-model="selectedFeatChoices"
                  :items="featOptions"
                  value-key="value"
                  label-key="label"
                  multiple
                  :placeholder="BACKGROUND_FORM_LABELS.featChoicesPlaceholder"
                  class="w-full"
                />
              </UFormField>

              <UFormField class="mt-3">
                <template #label>
                  <span class="flex items-center gap-1">
                    {{ BACKGROUND_FORM_LABELS.featClass }}
                    <FieldHint :text="BACKGROUND_FORM_LABELS.featClassHint" />
                  </span>
                </template>

                <USelect
                  v-model="selectedFeatClassKey"
                  :items="featClassOptions"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
            </FormSection>
          </div>
        </template>

        <!-- СНАРЯЖЕНИЕ -->
        <template #equipment>
          <div class="flex flex-col gap-2">
            <p class="text-xs text-dimmed">
              {{ BACKGROUND_FORM_LABELS.equipmentHelp }}
            </p>

            <StartingEquipmentEditor
              v-model="equipmentOptions"
              show-gold-alternative
            />
          </div>
        </template>

        <!-- АВТОМАТИЗАЦИЯ (дары что угодно) -->
        <template #grants>
          <div class="flex flex-col gap-2">
            <p class="text-xs text-dimmed">
              {{ BACKGROUND_FORM_LABELS.grantsHint }}
            </p>

            <GrantRowsEditor
              v-model="grants.grantRows"
              hide-ability
              hide-skill
              :taken-keys="takenChoiceKeys"
            />
          </div>
        </template>

        <!-- ЗАКЛИНАНИЯ -->
        <template #spells>
          <div class="flex flex-col gap-4">
            <FormSection
              :title="GRANTED_SPELLS_LABELS.title"
              icon="tabler:sparkles"
              :hint="BACKGROUND_FORM_LABELS.spellsHint"
            >
              <GrantedSpellsEditor
                v-model="grantedSpells"
                :available-spells="availableSpells"
                :socket="socket"
                @open-spell="openSpellDetail"
              />
            </FormSection>

            <FormSection
              :title="SPELL_CHOICE_LABELS.spellcastingAbility"
              icon="tabler:wand"
              :hint="SPELL_CHOICE_LABELS.spellcastingAbilityHint"
            >
              <FeatSpellcastingFields v-model="grants" />
            </FormSection>
          </div>
        </template>

        <!-- ЭФФЕКТЫ -->
        <template #effects>
          <div class="flex flex-col gap-2">
            <p class="text-xs text-dimmed">
              {{ BACKGROUND_FORM_LABELS.effectsHint }}
            </p>

            <div
              v-if="effects.length === 0"
              class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
            >
              {{ BACKGROUND_FORM_LABELS.effectsEmpty }}
            </div>

            <div
              v-else
              class="space-y-1"
            >
              <div
                v-for="effect in effects"
                :key="effect.id"
                class="flex min-h-11 items-center gap-2 rounded-lg bg-elevated/50 p-2 transition-colors hover:bg-accented/50"
                :class="{ 'opacity-50 grayscale': effect.disabled }"
              >
                <UIcon
                  :name="effect.icon || 'tabler:bolt'"
                  class="size-5 shrink-0 text-primary"
                />

                <div class="min-w-0 flex-1">
                  <span class="truncate text-sm font-medium">
                    {{ effect.name }}
                  </span>

                  <div
                    v-if="effect.description"
                    class="mt-0.5 truncate text-[10px] text-dimmed"
                  >
                    {{ effect.description }}
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <UButton
                    icon="tabler:pencil"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click.left.exact.prevent="editEffect(effect)"
                  />

                  <UButton
                    icon="tabler:trash"
                    size="xs"
                    variant="ghost"
                    color="error"
                    @click.left.exact.prevent="deleteEffect(effect.id)"
                  />
                </div>
              </div>
            </div>

            <UButton
              size="sm"
              color="primary"
              variant="soft"
              icon="tabler:plus"
              block
              class="mt-1"
              @click.left.exact.prevent="createEffect"
            >
              {{ MODAL_BUTTON_LABELS.addEffect }}
            </UButton>
          </div>
        </template>
      </UTabs>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <span
          v-if="!canSave"
          class="text-xs text-dimmed"
        >
          {{ BACKGROUND_FORM_LABELS.saveHint }}
        </span>

        <div class="ml-auto flex gap-3">
          <UButton
            :label="MODAL_BUTTON_LABELS.cancel"
            color="neutral"
            variant="ghost"
            @click.left.exact.prevent="emit('close')"
          />

          <UButton
            :label="
              item || background
                ? MODAL_BUTTON_LABELS.save
                : MODAL_BUTTON_LABELS.create
            "
            color="primary"
            :disabled="!canSave"
            @click.left.exact.prevent="handleSave"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>

  <!-- Редактор активного эффекта -->
  <ActiveEffectFormModal
    v-model:open="isEffectModalOpen"
    modal-id="background-effect-form-modal"
    :z-index="effectModalZIndex"
    :effect="editingEffect"
    hide-aura
    @save="saveEffect"
  />
</template>
