<script setup lang="ts">
  import type { SourceDefinition, TypedWebSocketClient } from '@vtt/shared';
  import type {
    ActiveEffect,
    DnDGameItem,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { EditableFeatGrants } from './feat/featEditorTypes';
  import type { SpellOption } from './grantedSpellsEditorTypes';

  import { computed, ref, useTemplateRef, watch } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import {
    buildSpellLinkIndex,
    findSpellInPacks,
    linkGrantedSpellGroups,
    loadSpellPacks,
  } from '@/systems/dnd5e/composables/spellCompendium';

  import {
    FEAT_FORM_LABELS,
    FEAT_GRANTS_LABELS,
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    GRANT_SECTION_LABELS,
    GRANTED_SPELL_GROUPS_LABELS,
    GRANTED_SPELLS_LABELS,
    MODAL_BUTTON_LABELS,
    SPELL_CHOICE_LABELS,
    SPELL_LIST_LABELS,
  } from './constants';
  import CounterRowsEditor from './CounterRowsEditor.vue';
  import EntityEffectsEditor from './EntityEffectsEditor.vue';
  import {
    buildFeatData,
    createEmptyFeatGrants,
    featDataToGrants,
    usedChoiceKeys,
  } from './feat/featEditorTypes';
  import FeatSpellcastingFields from './feat/FeatSpellcastingFields.vue';
  import FeatSpellListEditor from './feat/FeatSpellListEditor.vue';
  import GrantRowsEditor from './feat/GrantRowsEditor.vue';
  import ModifierAddMenu from './feat/ModifierAddMenu.vue';
  import ModifierRowsEditor from './feat/ModifierRowsEditor.vue';
  import PrerequisiteAddMenu from './feat/PrerequisiteAddMenu.vue';
  import PrerequisiteRowsEditor from './feat/PrerequisiteRowsEditor.vue';
  import SpellChoiceRowsEditor from './feat/SpellChoiceRowsEditor.vue';
  import FormSection from './FormSection.vue';
  import GrantedSpellGroupsEditor from './GrantedSpellGroupsEditor.vue';
  import SourceField from './SourceField.vue';

  const props = defineProps<{
    /** Открыто ли модальное окно */
    open: boolean;
    /** Скрытые пропсы от useModalManager чтобы не было ворнингов */
    allowMultiple?: boolean;
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
    /** Редактируемая черта (null = создание) */
    feat: DnDGameItem | null;
    /** Сокет — для загрузки заклинаний компендиума (подсказки связывания). */
    socket?: TypedWebSocketClient | null;
    /** Z-index (управляется родителем для bring-to-front) */
    zIndex?: number;
    /** Смещение позиции для каскадного расположения */
    positionOffset?: number;
  }>();

  const emit = defineEmits<{
    'close': [];
    'save': [feat: DnDGameItem];
    'bring-to-front': [];
  }>();

  const initialPosition = computed(() =>
    props.positionOffset
      ? { x: props.positionOffset, y: props.positionOffset }
      : undefined,
  );

  const { openModal } = useModalManager();

  const tabItems = [
    { label: FORM_TAB_LABELS.main, slot: 'basic' as const },
    { label: GRANT_SECTION_LABELS.proficiencies, slot: 'grants' as const },
    { label: GRANT_SECTION_LABELS.spells, slot: 'spells' as const },
    { label: FORM_TAB_LABELS.automation, slot: 'automation' as const },
    { label: FORM_TAB_LABELS.prerequisites, slot: 'prerequisites' as const },
    { label: FORM_TAB_LABELS.effects, slot: 'effects' as const },
  ];

  // ── Состояние формы ──────────────────────────────────────────
  const name = ref('');
  const nameEn = ref('');
  const description = ref('');
  const sourceKey = ref<string | undefined>(undefined);
  const source = ref<SourceDefinition | undefined>(undefined);
  const isSRD = ref(false);
  const repeatable = ref(false);
  const repeatableText = ref('');

  /** Активные эффекты черты. */
  const effects = ref<ActiveEffect[]>([]);

  /** Механика черты: дары, выборы, модификаторы, требования, ресурсы. */
  const grants = ref<EditableFeatGrants>(createEmptyFeatGrants());

  /**
   * Ключи всех выборов черты: они лежат в одном списке блоба, поэтому новый
   * ключ на любой вкладке обязан не совпасть с занятым на другой.
   */
  const takenChoiceKeys = computed(() => [...usedChoiceKeys(grants.value)]);

  /** Заклинания компендиума по пакам (имя, источник, пак) — для подсказок. */
  const availableSpells = ref<SpellOption[]>([]);

  /** Полные заклинания по пакам — для просмотра по клику. */
  const spellPacks = ref<
    { packId: string; packName: string; spells: Spell[] }[]
  >([]);

  const canSave = computed(() => name.value.trim().length > 0);

  // ── Редактор активных эффектов ───────────────────────────────

  // ── Инициализация при открытии ───────────────────────────────
  function resetForm(): void {
    name.value = '';
    nameEn.value = '';
    description.value = '';
    sourceKey.value = undefined;
    source.value = undefined;
    isSRD.value = false;
    repeatable.value = false;
    repeatableText.value = '';
    effects.value = [];
    grants.value = createEmptyFeatGrants();
  }

  function hydrateFromFeat(feat: DnDGameItem): void {
    name.value = feat.name || '';
    nameEn.value = feat.nameEn || '';
    description.value = feat.description || '';
    sourceKey.value = feat.sourceKey;
    source.value = feat.source;
    isSRD.value = feat.isSRD || false;
    repeatable.value = feat.repeatable || false;
    repeatableText.value = feat.repeatableText || '';

    effects.value = (feat.activeEffects ?? []).map((effect) => ({
      ...effect,
    }));

    grants.value = featDataToGrants(feat.featData);
  }

  /**
   * Загружает заклинания компендиума ПО ПАКАМ — для подсказок связывания,
   * выбора пака и просмотра. Без сокета — пусто (имена вводить всё равно можно).
   */
  async function loadAvailableSpells(): Promise<void> {
    if (!props.socket) {
      availableSpells.value = [];
      spellPacks.value = [];

      return;
    }

    const { packs, options } = await loadSpellPacks(props.socket);

    spellPacks.value = packs;
    availableSpells.value = options;

    linkGrantedSpellGroups(
      grants.value.grantedSpellGroups,
      buildSpellLinkIndex(options),
    );
  }

  /**
   * Открывает детальный просмотр заклинания. Предпочитает указанный пак, иначе
   * берёт первый пак, где это заклинание есть.
   *
   * @param spellId - id заклинания компендиума
   * @param packId - предпочтённый пак (опционально)
   */
  function openSpellDetail(spellId: string, packId?: string): void {
    const spell = findSpellInPacks(spellPacks.value, spellId, packId);

    if (spell) {
      openModal('SpellDetailModal', { spell });
    }
  }

  watch(
    () => props.open,
    (isOpen) => {
      if (!isOpen) {
        return;
      }

      resetForm();

      if (props.feat) {
        hydrateFromFeat(props.feat);
      }

      void loadAvailableSpells();
    },
    { immediate: true },
  );

  /** Сохраняет форму. */
  function handleSave(): void {
    if (!canSave.value) {
      return;
    }

    const featData = buildFeatData(grants.value);

    const item: DnDGameItem = {
      id: props.feat?.id || '',
      type: 'feat',
      name: name.value.trim(),
      nameEn: nameEn.value.trim() || undefined,
      description: description.value.trim(),
      sourceKey: sourceKey.value,
      source: source.value,
      isSRD: isSRD.value,
      repeatable: repeatable.value,
      repeatableText: repeatableText.value.trim() || undefined,
      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common',
      equipped: false,
      isReadOnly: false,
      image: props.feat?.image,
      activeEffects: effects.value.length > 0 ? effects.value : undefined,
      featData,
    };

    emit('save', item);
    emit('close');
  }

  /**
   * Обрабатывает закрытие окна (крестик/клик мимо) — эмитит `close` (без
   * авто-сохранения: при много-вкладочном редактировании это рискованно).
   *
   * @param value - новое состояние открытости окна
   */
  function handleOpenChange(value: boolean): void {
    if (!value) {
      emit('close');
    }
  }

  /**
   * Списки разделов: кнопка добавления живёт в шапке раздела, а знание о том,
   * какой получается новая строка, остаётся у самого редактора.
   */
  const grantRows = useTemplateRef('grantRows');
  const counterRows = useTemplateRef('counterRows');
  const spellGroups = useTemplateRef('spellGroups');
  const spellChoiceRows = useTemplateRef('spellChoiceRows');
  const spellListGroups = useTemplateRef('spellListGroups');
  const effectRows = useTemplateRef('effectRows');
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="feat ? FEAT_FORM_LABELS.editTitle : FEAT_FORM_LABELS.createTitle"
    :subtitle="nameEn || undefined"
    :initial-width="900"
    :min-width="640"
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
                  :placeholder="FEAT_FORM_LABELS.namePlaceholder"
                  class="w-full"
                />
              </UFormField>

              <UFormField :label="FORM_FIELD_LABELS.nameEn">
                <UInput
                  v-model="nameEn"
                  placeholder="Magic Initiate"
                  class="w-full"
                />
              </UFormField>
            </div>

            <UFormField :label="FORM_FIELD_LABELS.description">
              <RichTextEditor
                v-model="description"
                :placeholder="FEAT_FORM_LABELS.descriptionPlaceholder"
              />
            </UFormField>

            <FormSection
              :title="FEAT_FORM_LABELS.repeatableTitle"
              icon="tabler:repeat"
              :hint="FEAT_FORM_LABELS.repeatableHint"
            >
              <UCheckbox
                v-model="repeatable"
                :label="FEAT_FORM_LABELS.repeatable"
              />

              <UFormField
                v-if="repeatable"
                :label="FEAT_FORM_LABELS.repeatableRules"
                class="mt-2"
              >
                <UTextarea
                  v-model="repeatableText"
                  :rows="2"
                  autoresize
                  class="w-full"
                  :placeholder="FEAT_FORM_LABELS.repeatableRulesPlaceholder"
                />
              </UFormField>
            </FormSection>

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

        <!-- ЗАКЛИНАНИЯ: выдача, её настройки, выборы и список класса -->
        <template #spells>
          <div class="flex flex-col gap-4">
            <FormSection
              :title="GRANTED_SPELLS_LABELS.title"
              icon="tabler:sparkles"
              :hint="FEAT_FORM_LABELS.spellsHint"
              :add-label="GRANTED_SPELL_GROUPS_LABELS.add"
              @add="spellGroups?.addGroup()"
            >
              <GrantedSpellGroupsEditor
                ref="spellGroups"
                v-model="grants.grantedSpellGroups"
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

            <FormSection
              :title="SPELL_CHOICE_LABELS.title"
              icon="tabler:hand-click"
              :hint="SPELL_CHOICE_LABELS.hint"
              :add-label="SPELL_CHOICE_LABELS.add"
              @add="spellChoiceRows?.addRow()"
            >
              <SpellChoiceRowsEditor
                ref="spellChoiceRows"
                v-model="grants.spellChoice"
                :taken-keys="takenChoiceKeys"
                :available-spells="availableSpells"
                :socket="socket"
                @open-spell="openSpellDetail"
              />
            </FormSection>

            <FormSection
              :title="SPELL_LIST_LABELS.title"
              icon="tabler:list-details"
              :hint="SPELL_LIST_LABELS.hint"
              :add-label="SPELL_LIST_LABELS.addGroup"
              @add="spellListGroups?.addGroup()"
            >
              <FeatSpellListEditor
                ref="spellListGroups"
                v-model="grants.spellList"
                :available-spells="availableSpells"
                :socket="socket"
                @open-spell="openSpellDetail"
              />
            </FormSection>
          </div>
        </template>

        <!-- ЭФФЕКТЫ -->
        <template #effects>
          <FormSection
            :title="FORM_TAB_LABELS.effects"
            icon="tabler:sparkles"
            :hint="FEAT_FORM_LABELS.effectsHint"
            :add-label="MODAL_BUTTON_LABELS.addEffect"
            @add="effectRows?.createEffect()"
          >
            <EntityEffectsEditor
              ref="effectRows"
              v-model="effects"
              modal-id="feat-effect-form-modal"
              hide-aura
            />
          </FormSection>
        </template>

        <!-- ВЛАДЕНИЯ -->
        <template #grants>
          <FormSection
            :title="FEAT_GRANTS_LABELS.grantsTitle"
            icon="tabler:gift"
            :hint="FEAT_GRANTS_LABELS.grantsHint"
            :add-label="FEAT_GRANTS_LABELS.addGrant"
            @add="grantRows?.addRow()"
          >
            <GrantRowsEditor
              ref="grantRows"
              v-model="grants.grantRows"
              hide-feat
              :taken-keys="takenChoiceKeys"
              :socket="props.socket"
            />
          </FormSection>
        </template>

        <!-- АВТОМАТИЗАЦИЯ: модификаторы листа и ресурсы -->
        <template #automation>
          <div class="flex flex-col gap-4">
            <FormSection
              :title="FEAT_GRANTS_LABELS.modifiersTitle"
              icon="tabler:adjustments-filled"
              :hint="FEAT_GRANTS_LABELS.modifiersHint"
            >
              <!-- Своя кнопка: вид правки выбирают меню, а не одним нажатием -->
              <template #actions>
                <ModifierAddMenu v-model="grants.modifiers" />
              </template>

              <ModifierRowsEditor v-model="grants.modifiers" />
            </FormSection>

            <FormSection
              :title="FEAT_GRANTS_LABELS.countersTitle"
              icon="tabler:battery-2"
              :hint="FEAT_GRANTS_LABELS.countersHint"
              :add-label="FEAT_GRANTS_LABELS.addCounter"
              @add="counterRows?.addCounter()"
            >
              <CounterRowsEditor
                ref="counterRows"
                v-model="grants.counters"
              />
            </FormSection>
          </div>
        </template>

        <!-- ТРЕБОВАНИЯ -->
        <template #prerequisites>
          <FormSection
            :title="FEAT_GRANTS_LABELS.prerequisitesTitle"
            icon="tabler:list-check"
            :hint="FEAT_GRANTS_LABELS.prerequisitesHint"
          >
            <!-- Своя кнопка: вид требования выбирают меню -->
            <template #actions>
              <PrerequisiteAddMenu v-model="grants.prerequisites" />
            </template>

            <PrerequisiteRowsEditor
              v-model="grants.prerequisites"
              :socket="socket"
            />
          </FormSection>
        </template>
      </UTabs>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <span
          v-if="!canSave"
          class="text-xs text-dimmed"
        >
          {{ FEAT_FORM_LABELS.saveHint }}
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
              feat ? MODAL_BUTTON_LABELS.save : MODAL_BUTTON_LABELS.create
            "
            color="primary"
            :disabled="!canSave"
            @click.left.exact.prevent="handleSave"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
