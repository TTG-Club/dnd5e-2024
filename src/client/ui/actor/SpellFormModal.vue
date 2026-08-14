<script setup lang="ts">
  import type {
    ActiveEffect,
    DnDGameItem,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { DISTANCE_UNIT_OPTIONS } from '@vtt/shared';
  import {
    ABILITY_OPTIONS,
    areaShapeUsesHeight,
    areaShapeUsesWidth,
    getAreaSizeLabel,
    SPELL_USES_RECOVERY_OPTIONS,
  } from '@vtt/shared/system/dnd.js';

  import { useSpellForm } from '../../composables/useSpellForm';
  import {
    AREA_FIELD_LABELS,
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    MODAL_BUTTON_LABELS,
    SPELL_FORM_LABELS,
    UNSAVED_CHANGES_LABELS,
  } from './constants';
  import DamagePartRow from './DamagePartRow.vue';
  import DamagePartsEditor from './DamagePartsEditor.vue';
  import FormSection from './FormSection.vue';
  import SourceField from './SourceField.vue';
  import ActiveEffectFormModal from './tabs/ActiveEffectFormModal.vue';
  import { extractSpellFromGameItem } from './utils/extractSpellFromGameItem';

  defineOptions({ inheritAttrs: false });

  const props = defineProps<{
    /** Открыто ли модальное окно */
    open: boolean;
    /** Скрытые пропсы от useModalManager чтобы не было ворнингов */
    allowMultiple?: boolean;
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
    /** Редактируемое заклинание (при открытии из листа персонажа) */
    spell?: Spell | null;
    /** Редактируемый предмет (при открытии из ItemsPanel) */
    item?: DnDGameItem | null;
    actorId?: string;
    /** Z-index (управляется родителем для bring-to-front) */
    zIndex?: number;
    /** Смещение позиции для каскадного расположения */
    positionOffset?: number;
  }>();

  const emit = defineEmits<{
    'close': [];
    'save': [spell: Spell];
    'bring-to-front': [];
  }>();

  /**
   * Вычисляет целевое заклинание из props.spell или props.item.spellData
   */
  const targetSpell = computed<Spell | null>(() => {
    if (props.spell) {
      return props.spell;
    }

    if (props.item && props.item.type === 'spell') {
      return extractSpellFromGameItem(props.item);
    }

    return null;
  });

  /**
   * Мемоизированная начальная позиция.
   * Computed предотвращает пересоздание объекта при re-render.
   */
  const initialPosition = computed(() =>
    props.positionOffset
      ? { x: props.positionOffset, y: props.positionOffset }
      : undefined,
  );

  const isEditing = computed(() => !!targetSpell.value);

  const { getNextZIndex } = useModalManager();

  const {
    name,
    nameEn,
    level,
    school,
    castingTimeValue,
    castingTimeUnit,
    reactionTrigger,
    verbal,
    somatic,
    material,
    materialDescription,
    materialCost,
    materialConsumed,
    range,
    rangeUnit,
    rangeSpecial,
    durationValue,
    durationUnit,
    concentration,
    ritual,
    areaShape,
    areaSize,
    areaWidth,
    areaHeight,
    areaUnit,
    areaResizable,
    targetType,
    targetCount,
    deliveryType,
    damageParts,
    autoHit,
    saveType,
    saveEffect,
    attackAbility,
    attackBonus,
    hasProjectiles,
    projectileCount,
    projectilePerSlotLevel,
    projectileTargetDistribution,
    projectileTiers,
    addProjectileTier,
    removeProjectileTier,
    hasScaling,
    scalingAdditionalDice,
    scalingAdditionalTargets,
    scalingDescription,
    cantripScalingTiers,
    addCantripTier,
    removeCantripTier,
    addCantripTierPart,
    removeCantripTierPart,
    description,
    higherLevelDescription,
    hasUses,
    usesMax,
    usesCurrent,
    usesRecovery,
    sourceKey,
    source,
    isSRD,
    classKeys,
    activeEffects,
    SPELL_SCHOOL_OPTIONS,
    CASTING_TIME_OPTIONS,
    CLASS_KEY_OPTIONS,
    DURATION_UNIT_OPTIONS,
    TARGET_TYPE_OPTIONS,
    AREA_SHAPE_OPTIONS,
    DELIVERY_TYPE_OPTIONS,
    PROJECTILE_DISTRIBUTION_OPTIONS,
    SAVE_TYPE_OPTIONS,
    SAVE_EFFECT_OPTIONS,
    SPELL_LEVEL_OPTIONS,
    damageTypeOptions,
    buildSpell,
  } = useSpellForm(
    () => targetSpell.value,
    () => props.open,
  );

  /**
   * Тип атаки «На себя»: атаковать себя не нужно — автоматически проставляем
   * «Автопопадание», если оно ещё не включено. Чекбокс не блокируем — игрок
   * при желании может снять галочку вручную.
   */
  watch(deliveryType, (newDeliveryType) => {
    if (newDeliveryType === 'self' && !autoHit.value) {
      autoHit.value = true;
    }
  });

  /**
   * Подсказка секции «Снаряды»: нужен ли бросок атаки на каждый снаряд,
   * не настраивается отдельно — выводится из «Тип атаки»/«Автопопадание»,
   * поэтому противоречивую комбинацию задать нельзя.
   */
  const projectileHintText = computed(() => {
    if (autoHit.value) {
      return SPELL_FORM_LABELS.projectileHintAuto;
    }

    if (['melee', 'ranged'].includes(deliveryType.value)) {
      return SPELL_FORM_LABELS.projectileHintAttack;
    }

    return SPELL_FORM_LABELS.projectileHintSpread;
  });

  /** Подпись поля основного размера области (радиус либо размер стороны) */
  const areaSizeLabel = computed(() => getAreaSizeLabel(areaShape.value));

  /** Нужно ли поле ширины для текущей формы области */
  const showAreaWidth = computed(() => areaShapeUsesWidth(areaShape.value));

  /** Нужно ли поле высоты для текущей формы области */
  const showAreaHeight = computed(() => areaShapeUsesHeight(areaShape.value));

  /** Классы сетки полей размеров области (доп. колонка при ширине/высоте) */
  const areaSizeGridClass = computed(() =>
    showAreaWidth.value || showAreaHeight.value
      ? 'grid-cols-[1fr_1fr_80px]'
      : 'grid-cols-[1fr_80px]',
  );

  // --- Эффекты ---
  const effectModalId = 'spell-effect-form-modal';
  const isEffectModalOpen = ref(false);
  const effectModalZIndex = ref<number | undefined>(undefined);
  const editingEffect = ref<ActiveEffect | undefined>(undefined);

  /** Вкладки формы */
  const tabItems = [
    { label: FORM_TAB_LABELS.general, slot: 'general' as const },
    { label: FORM_TAB_LABELS.details, slot: 'details' as const },
    { label: FORM_TAB_LABELS.combat, slot: 'combat' as const },
    { label: FORM_TAB_LABELS.effects, slot: 'effects' as const },
  ];

  function createCustomEffect() {
    editingEffect.value = undefined;
    isEffectModalOpen.value = true;
    effectModalZIndex.value = getNextZIndex();
  }

  function editCustomEffect(effect: ActiveEffect) {
    editingEffect.value = effect;
    isEffectModalOpen.value = true;
    effectModalZIndex.value = getNextZIndex();
  }

  function deleteCustomEffect(effectId: string) {
    activeEffects.value = activeEffects.value.filter(
      (effect) => effect.id !== effectId,
    );
  }

  function toggleCustomEffect(effectId: string) {
    const effect = activeEffects.value.find(
      (existing) => existing.id === effectId,
    );

    if (effect) {
      effect.disabled = !effect.disabled;
    }
  }

  function saveCustomEffect(newEffect: ActiveEffect) {
    const index = activeEffects.value.findIndex(
      (existing) => existing.id === newEffect.id,
    );

    if (index !== -1) {
      activeEffects.value[index] = newEffect;
    } else {
      activeEffects.value.push(newEffect);
    }
  }

  /** Сохраняет форму */
  function handleSave(): void {
    emit('save', buildSpell());
    emit('close');
  }

  // --- Несохранённые изменения ---

  /** Снапшот состояния формы на момент открытия (для определения «грязности») */
  const initialFormSnapshot = ref('');

  /** Открыт ли диалог подтверждения закрытия с несохранёнными изменениями */
  const isDiscardConfirmOpen = ref(false);

  /** Z-index диалога подтверждения (поверх формы заклинания) */
  const discardConfirmZIndex = ref<number | undefined>(undefined);

  /**
   * Сериализует текущее состояние формы для сравнения с начальным снапшотом.
   * `id` обнуляется: для нового заклинания buildSpell генерирует его заново
   * при каждом вызове, что давало бы ложную «грязность».
   */
  function serializeFormState(): string {
    return JSON.stringify({ ...buildSpell(), id: '' });
  }

  // Снапшот формы при каждом открытии. Watcher объявлен ПОСЛЕ useSpellForm,
  // поэтому по порядку регистрации срабатывает после инициализации полей формы.
  watch(
    () => props.open,
    (isModalOpen) => {
      if (isModalOpen) {
        initialFormSnapshot.value = serializeFormState();
      }
    },
    { immediate: true },
  );

  /**
   * Закрывает форму («Отмена», крестик, клик мимо окна): при несохранённых
   * изменениях сначала показывает диалог подтверждения — раньше «Отмена»
   * молча теряла правки, а крестик молча сохранял.
   */
  function handleCancel(): void {
    if (serializeFormState() === initialFormSnapshot.value) {
      emit('close');

      return;
    }

    discardConfirmZIndex.value = getNextZIndex();
    isDiscardConfirmOpen.value = true;
  }

  /**
   * Обрабатывает закрытие окна (крестик/клик мимо) — как «Отмена».
   *
   * @param isModalOpen - новое состояние открытости окна
   */
  function handleOpenChange(isModalOpen: boolean): void {
    if (!isModalOpen) {
      handleCancel();
    }
  }

  /** Возвращает к редактированию (кнопка «Назад» в диалоге подтверждения) */
  function closeDiscardConfirm(): void {
    isDiscardConfirmOpen.value = false;
  }

  /** Закрывает форму без сохранения (кнопка «Отменить изменения») */
  function confirmDiscard(): void {
    isDiscardConfirmOpen.value = false;
    emit('close');
  }

  /** Сохраняет и закрывает форму (кнопка «Сохранить» в диалоге) */
  function confirmSave(): void {
    isDiscardConfirmOpen.value = false;
    handleSave();
  }
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="
      isEditing ? SPELL_FORM_LABELS.editTitle : SPELL_FORM_LABELS.createTitle
    "
    :initial-width="700"
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
        <!-- Вкладка «Общие» -->
        <template #general>
          <div class="flex flex-col gap-4">
            <!-- Название и Английское название -->
            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="FORM_FIELD_LABELS.name">
                <UInput
                  v-model="name"
                  :placeholder="SPELL_FORM_LABELS.namePlaceholder"
                  class="w-full"
                />
              </UFormField>

              <UFormField :label="FORM_FIELD_LABELS.nameEn">
                <UInput
                  v-model="nameEn"
                  :placeholder="SPELL_FORM_LABELS.nameEnPlaceholder"
                  class="w-full"
                />
              </UFormField>
            </div>

            <!-- Описание -->
            <UFormField :label="FORM_FIELD_LABELS.description">
              <RichTextEditor
                v-model="description"
                :placeholder="SPELL_FORM_LABELS.descriptionPlaceholder"
              />
            </UFormField>

            <!-- Описание на высших кругах -->
            <UFormField :label="SPELL_FORM_LABELS.higherLevels">
              <RichTextEditor
                v-model="higherLevelDescription"
                :placeholder="SPELL_FORM_LABELS.higherLevelsPlaceholder"
              />
            </UFormField>

            <!-- Источник -->
            <FormSection
              :title="FORM_FIELD_LABELS.source"
              title-color="source"
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

            <!-- Доступность классов -->
            <FormSection
              :title="SPELL_FORM_LABELS.classAvailabilityTitle"
              title-color="arcane"
            >
              <UFormField :label="SPELL_FORM_LABELS.classKeys">
                <USelectMenu
                  v-model="classKeys"
                  :items="CLASS_KEY_OPTIONS"
                  value-key="value"
                  label-key="label"
                  multiple
                  :placeholder="SPELL_FORM_LABELS.classKeysPlaceholder"
                  class="w-full"
                />
              </UFormField>

              <p class="mt-2 text-xs text-dimmed">
                {{ SPELL_FORM_LABELS.classKeysHint }}
              </p>
            </FormSection>
          </div>
        </template>

        <!-- Вкладка «Подробнее» -->
        <template #details>
          <div class="flex flex-col gap-4">
            <!-- Круг и Школа -->
            <FormSection
              :title="SPELL_FORM_LABELS.characteristicTitle"
              title-color="arcane"
            >
              <div class="grid grid-cols-2 gap-3">
                <UFormField :label="SPELL_FORM_LABELS.level">
                  <USelect
                    v-model="level"
                    :items="SPELL_LEVEL_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="SPELL_FORM_LABELS.school">
                  <USelect
                    v-model="school"
                    :items="SPELL_SCHOOL_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </FormSection>

            <!-- Заряды использования (врождённые/расовые, заклинания существ) -->
            <FormSection
              :title="SPELL_FORM_LABELS.usesTitle"
              title-color="warning"
            >
              <UCheckbox
                v-model="hasUses"
                :label="SPELL_FORM_LABELS.hasUses"
              />

              <div
                v-if="hasUses"
                class="mt-3 grid grid-cols-3 gap-3"
              >
                <UFormField :label="FORM_FIELD_LABELS.max">
                  <UInput
                    v-model.number="usesMax"
                    type="number"
                    :min="1"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="SPELL_FORM_LABELS.usesCurrent">
                  <UInput
                    v-model.number="usesCurrent"
                    type="number"
                    :min="0"
                    :max="usesMax"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="FORM_FIELD_LABELS.recovery">
                  <USelect
                    v-model="usesRecovery"
                    :items="[...SPELL_USES_RECOVERY_OPTIONS]"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </FormSection>

            <!-- Компоненты -->
            <FormSection
              :title="SPELL_FORM_LABELS.componentsTitle"
              title-color="info"
            >
              <div
                class="flex flex-wrap gap-4"
                :class="{ 'mb-3': material }"
              >
                <UCheckbox
                  v-model="verbal"
                  :label="SPELL_FORM_LABELS.verbal"
                />

                <UCheckbox
                  v-model="somatic"
                  :label="SPELL_FORM_LABELS.somatic"
                />

                <UCheckbox
                  v-model="material"
                  :label="SPELL_FORM_LABELS.material"
                />
              </div>

              <template v-if="material">
                <div class="rounded bg-elevated/30 p-3">
                  <div class="flex w-full items-start gap-3">
                    <UFormField
                      :label="SPELL_FORM_LABELS.materialDescription"
                      class="flex-1"
                    >
                      <UTextarea
                        v-model="materialDescription"
                        autoresize
                        :rows="1"
                        class="w-full"
                      />
                    </UFormField>

                    <UFormField
                      :label="SPELL_FORM_LABELS.materialCost"
                      class="w-30 shrink-0"
                    >
                      <UInput
                        v-model.number="materialCost"
                        type="number"
                        class="w-full"
                      />
                    </UFormField>

                    <div class="flex h-8 shrink-0 items-center self-end pb-0.5">
                      <UCheckbox
                        v-model="materialConsumed"
                        :label="SPELL_FORM_LABELS.materialConsumed"
                      />
                    </div>
                  </div>
                </div>
              </template>
            </FormSection>

            <div class="grid grid-cols-2 gap-4">
              <!-- Время сотворения -->
              <FormSection
                :title="SPELL_FORM_LABELS.castingTitle"
                title-color="healing"
              >
                <template #actions>
                  <UCheckbox
                    v-model="ritual"
                    :label="SPELL_FORM_LABELS.ritual"
                    indicator="end"
                    :ui="{
                      label: 'text-xs font-semibold tracking-wide text-dimmed',
                    }"
                  />
                </template>

                <div class="grid grid-cols-[100px_1fr] gap-3">
                  <UFormField :label="FORM_FIELD_LABELS.amount">
                    <UInput
                      v-model.number="castingTimeValue"
                      type="number"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField
                    :label="SPELL_FORM_LABELS.unit"
                    class="min-w-0"
                  >
                    <USelect
                      v-model="castingTimeUnit"
                      :items="CASTING_TIME_OPTIONS"
                      value-key="value"
                      class="w-full min-w-0"
                      :ui="{ base: 'min-w-0', value: 'truncate min-w-0' }"
                    >
                      <template #item-label="{ item: option }">
                        <UTooltip
                          :text="option.label"
                          :delay-duration="0"
                        >
                          <span class="block truncate">{{ option.label }}</span>
                        </UTooltip>
                      </template>
                    </USelect>
                  </UFormField>
                </div>

                <UFormField
                  v-if="castingTimeUnit === 'reaction'"
                  :label="SPELL_FORM_LABELS.reactionTrigger"
                  class="mt-3"
                >
                  <UInput
                    v-model="reactionTrigger"
                    class="w-full"
                  />
                </UFormField>
              </FormSection>

              <!-- Длительность -->
              <FormSection
                :title="SPELL_FORM_LABELS.durationTitle"
                title-color="primary"
              >
                <template #actions>
                  <UCheckbox
                    v-model="concentration"
                    :label="SPELL_FORM_LABELS.concentration"
                    indicator="end"
                    :ui="{
                      label: 'text-xs font-semibold tracking-wide text-dimmed',
                    }"
                  />
                </template>

                <div class="grid grid-cols-[100px_1fr] gap-3">
                  <UFormField :label="FORM_FIELD_LABELS.amount">
                    <UInput
                      v-model.number="durationValue"
                      type="number"
                      :disabled="
                        [
                          'instantaneous',
                          'special',
                          'until-dispelled',
                        ].includes(durationUnit)
                      "
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="SPELL_FORM_LABELS.unit">
                    <USelect
                      v-model="durationUnit"
                      :items="DURATION_UNIT_OPTIONS"
                      value-key="value"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </FormSection>
            </div>

            <!-- Дистанция и Цели -->
            <FormSection
              :title="SPELL_FORM_LABELS.rangeTitle"
              title-color="warning"
            >
              <div class="grid grid-cols-3 gap-3">
                <div class="grid grid-cols-[1fr_90px] gap-2">
                  <UFormField :label="FORM_FIELD_LABELS.range">
                    <UInput
                      v-model.number="range"
                      type="number"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="FORM_FIELD_LABELS.unitShort">
                    <USelect
                      v-model="rangeUnit"
                      :items="DISTANCE_UNIT_OPTIONS"
                      value-key="value"
                      class="w-full"
                    />
                  </UFormField>
                </div>

                <UFormField :label="SPELL_FORM_LABELS.rangeSpecial">
                  <UInput
                    v-model="rangeSpecial"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="SPELL_FORM_LABELS.targetType">
                  <USelect
                    v-model="targetType"
                    :items="TARGET_TYPE_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <!-- Цели: обычное заклинание — число целей под общий бросок;
                   снаряды — свой бросок на каждый + режим распределения -->
              <div
                v-if="['creature', 'object'].includes(targetType)"
                class="mt-3 flex flex-col gap-3"
              >
                <div
                  v-if="!hasProjectiles"
                  class="grid grid-cols-3 gap-3"
                >
                  <UFormField :label="SPELL_FORM_LABELS.targetCount">
                    <UInput
                      v-model.number="targetCount"
                      type="number"
                      :min="1"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField
                    v-if="level > 0"
                    :label="SPELL_FORM_LABELS.scalingTargets"
                  >
                    <UInput
                      v-model.number="scalingAdditionalTargets"
                      type="number"
                      :min="0"
                      class="w-full"
                    />
                  </UFormField>
                </div>

                <div class="border-t border-default/50 pt-3">
                  <UCheckbox
                    v-model="hasProjectiles"
                    :label="SPELL_FORM_LABELS.hasProjectiles"
                    :ui="{
                      label: 'text-xs font-semibold tracking-wide text-primary',
                    }"
                  />
                </div>

                <div
                  v-if="hasProjectiles"
                  class="flex flex-col gap-3"
                >
                  <p class="text-xs text-dimmed">
                    {{ projectileHintText }}
                  </p>

                  <div class="grid grid-cols-2 gap-3">
                    <UFormField :label="SPELL_FORM_LABELS.projectileCount">
                      <UInput
                        v-model.number="projectileCount"
                        type="number"
                        :min="1"
                        class="w-full"
                      />
                    </UFormField>

                    <UFormField
                      v-if="level > 0"
                      :label="SPELL_FORM_LABELS.projectilePerSlotLevel"
                    >
                      <UInput
                        v-model.number="projectilePerSlotLevel"
                        type="number"
                        :min="0"
                        class="w-full"
                      />
                    </UFormField>
                  </div>

                  <UFormField :label="SPELL_FORM_LABELS.projectileDistribution">
                    <URadioGroup
                      v-model="projectileTargetDistribution"
                      :items="[...PROJECTILE_DISTRIBUTION_OPTIONS]"
                      value-key="value"
                    />
                  </UFormField>

                  <!-- Пороги уровня персонажа (заговоры) -->
                  <template v-if="level === 0">
                    <p class="text-xs text-dimmed">
                      {{ SPELL_FORM_LABELS.projectileTiersHint }}
                    </p>

                    <div
                      v-for="(tier, tierIndex) in projectileTiers"
                      :key="tierIndex"
                      class="grid grid-cols-[1fr_1fr_auto] items-end gap-3"
                    >
                      <UFormField
                        :label="SPELL_FORM_LABELS.projectileTierLevel"
                      >
                        <UInput
                          v-model.number="tier.level"
                          type="number"
                          :min="1"
                          :max="20"
                          class="w-full"
                        />
                      </UFormField>

                      <UFormField
                        :label="SPELL_FORM_LABELS.projectileTierCount"
                      >
                        <UInput
                          v-model.number="tier.count"
                          type="number"
                          :min="1"
                          class="w-full"
                        />
                      </UFormField>

                      <UButton
                        icon="tabler:trash"
                        color="error"
                        variant="ghost"
                        size="xs"
                        :aria-label="SPELL_FORM_LABELS.projectileTierRemove"
                        class="mb-1"
                        @click.left.exact.prevent="
                          removeProjectileTier(tierIndex)
                        "
                      />
                    </div>

                    <UButton
                      icon="tabler:plus"
                      variant="soft"
                      size="sm"
                      class="self-start"
                      @click.left.exact.prevent="addProjectileTier"
                    >
                      {{ SPELL_FORM_LABELS.projectileTierAdd }}
                    </UButton>
                  </template>
                </div>
              </div>
            </FormSection>

            <!-- Область действия (Шаблон) -->
            <FormSection
              v-if="targetType === 'area'"
              :title="SPELL_FORM_LABELS.areaTitle"
              title-color="info"
              class="transition-all duration-200"
            >
              <div class="grid grid-cols-3 gap-3">
                <UFormField
                  :label="AREA_FIELD_LABELS.shape"
                  class="col-span-1"
                >
                  <USelect
                    v-model="areaShape"
                    :items="AREA_SHAPE_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <div
                  class="col-span-2 grid gap-2"
                  :class="areaSizeGridClass"
                >
                  <UFormField :label="areaSizeLabel">
                    <UInput
                      v-model.number="areaSize"
                      type="number"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField
                    v-if="showAreaWidth"
                    :label="AREA_FIELD_LABELS.width"
                  >
                    <UInput
                      v-model.number="areaWidth"
                      type="number"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField
                    v-if="showAreaHeight"
                    :label="AREA_FIELD_LABELS.height"
                  >
                    <UInput
                      v-model.number="areaHeight"
                      type="number"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="FORM_FIELD_LABELS.unitShort">
                    <USelect
                      v-model="areaUnit"
                      :items="DISTANCE_UNIT_OPTIONS"
                      value-key="value"
                      class="w-full"
                    />
                  </UFormField>
                </div>

                <div class="col-span-3 mt-2">
                  <UCheckbox
                    v-model="areaResizable"
                    :label="AREA_FIELD_LABELS.resizable"
                    :help="SPELL_FORM_LABELS.areaResizableHelp"
                  />
                </div>
              </div>
            </FormSection>
          </div>
        </template>

        <!-- Вкладка «Бой» -->
        <template #combat>
          <div class="flex flex-col gap-4">
            <!-- Эффект (части урона / лечения) -->
            <DamagePartsEditor
              v-model="damageParts"
              :damage-type-options="damageTypeOptions"
              :allow-empty="true"
            >
              <template #actions>
                <UCheckbox
                  v-model="autoHit"
                  :label="SPELL_FORM_LABELS.autoHit"
                />
              </template>
            </DamagePartsEditor>

            <!-- Точность (Атака и Спасбросок) -->
            <FormSection
              :title="SPELL_FORM_LABELS.accuracyTitle"
              title-color="danger"
            >
              <div class="grid grid-cols-2 gap-3">
                <UFormField :label="FORM_FIELD_LABELS.attackType">
                  <USelect
                    v-model="deliveryType"
                    :items="DELIVERY_TYPE_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <div
                  v-if="['ranged', 'melee'].includes(deliveryType)"
                  class="grid grid-cols-2 gap-3"
                >
                  <UFormField :label="FORM_FIELD_LABELS.ability">
                    <USelect
                      v-model="attackAbility"
                      :items="ABILITY_OPTIONS"
                      value-key="value"
                      :placeholder="SPELL_FORM_LABELS.attackAbilityPlaceholder"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="SPELL_FORM_LABELS.attackBonus">
                    <UInput
                      v-model.number="attackBonus"
                      type="number"
                      class="w-full"
                    >
                      <template #trailing>
                        <UTooltip :text="SPELL_FORM_LABELS.attackBonusHint">
                          <UIcon
                            name="tabler:help-circle-filled"
                            class="size-4.5 cursor-help text-dimmed transition-colors hover:text-default"
                          />
                        </UTooltip>
                      </template>
                    </UInput>
                  </UFormField>
                </div>
              </div>

              <div
                class="mt-3 grid grid-cols-2 gap-3 border-t border-default/50 pt-3"
              >
                <UFormField :label="FORM_FIELD_LABELS.savingThrow">
                  <USelect
                    v-model="saveType"
                    :items="SAVE_TYPE_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  v-if="saveType !== 'none'"
                  :label="FORM_FIELD_LABELS.saveEffect"
                >
                  <USelect
                    v-model="saveEffect"
                    :items="SAVE_EFFECT_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </FormSection>

            <!-- Масштабирование -->
            <FormSection
              class="transition-all duration-200"
              :title="
                level === 0 ? SPELL_FORM_LABELS.cantripScalingTitle : undefined
              "
              :title-color="level === 0 ? 'arcane' : undefined"
              :has-content="level === 0 ? true : hasScaling"
            >
              <!-- Заголовок для заклинаний уровня > 0 -->
              <template
                v-if="level > 0"
                #header
              >
                <UCheckbox
                  v-model="hasScaling"
                  :label="SPELL_FORM_LABELS.hasScaling"
                  :ui="{
                    label: 'text-xs font-semibold tracking-wide text-arcane',
                  }"
                />
              </template>

              <!-- Для заклинаний уровня > 0 -->
              <div
                v-if="level > 0"
                class="w-full"
              >
                <div
                  v-if="hasScaling"
                  class="flex flex-col gap-3"
                >
                  <UFormField :label="SPELL_FORM_LABELS.scalingDice">
                    <UInput
                      v-model="scalingAdditionalDice"
                      :placeholder="SPELL_FORM_LABELS.scalingDicePlaceholder"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="SPELL_FORM_LABELS.scalingDescription">
                    <UInput
                      v-model="scalingDescription"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </div>

              <!-- Для заговоров (уровень 0) -->
              <div
                v-else
                class="flex flex-col gap-3"
              >
                <p class="text-xs text-dimmed">
                  {{ SPELL_FORM_LABELS.cantripTiersHint }}
                </p>

                <!-- Тиры масштабирования -->
                <div
                  v-for="(tier, tierIndex) in cantripScalingTiers"
                  :key="tierIndex"
                  class="flex flex-col gap-3 rounded-lg border border-default p-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <UFormField
                      :label="SPELL_FORM_LABELS.cantripTierLevel"
                      class="flex-1"
                    >
                      <UInput
                        v-model.number="tier.level"
                        type="number"
                        :min="1"
                        :max="20"
                        :placeholder="
                          SPELL_FORM_LABELS.cantripTierLevelPlaceholder
                        "
                        class="w-full"
                      />
                    </UFormField>

                    <UButton
                      icon="tabler:trash"
                      color="error"
                      variant="ghost"
                      size="xs"
                      :aria-label="SPELL_FORM_LABELS.cantripTierRemove"
                      class="mt-5 shrink-0"
                      @click.left.exact.prevent="removeCantripTier(tierIndex)"
                    />
                  </div>

                  <DamagePartRow
                    v-for="(_part, partIndex) in tier.parts"
                    :key="partIndex"
                    v-model="tier.parts[partIndex]"
                    :index="partIndex"
                    :damage-type-options="damageTypeOptions"
                    :can-remove="tier.parts.length > 1"
                    @remove="removeCantripTierPart(tierIndex, partIndex)"
                  />

                  <UButton
                    icon="tabler:plus"
                    variant="soft"
                    size="sm"
                    class="self-start"
                    @click.left.exact.prevent="addCantripTierPart(tierIndex)"
                  >
                    {{ SPELL_FORM_LABELS.cantripTierAddPart }}
                  </UButton>
                </div>

                <UButton
                  icon="tabler:plus"
                  variant="soft"
                  size="sm"
                  class="self-start"
                  @click.left.exact.prevent="addCantripTier"
                >
                  {{ SPELL_FORM_LABELS.cantripTierAdd }}
                </UButton>
              </div>
            </FormSection>
          </div>
        </template>

        <!-- Вкладка «Эффекты» -->
        <template #effects>
          <div class="flex flex-col gap-4">
            <div
              v-if="activeEffects.length === 0"
              class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
            >
              {{ SPELL_FORM_LABELS.effectsEmpty }}
            </div>

            <div
              v-else
              class="space-y-1"
            >
              <div
                v-for="effect in activeEffects"
                :key="effect.id"
                class="group flex min-h-11 items-center gap-2 rounded-lg bg-elevated/50 p-2 transition-colors hover:bg-accented/50"
                :class="{ 'opacity-50 grayscale': effect.disabled }"
              >
                <UIcon
                  :name="effect.icon || 'tabler:bolt'"
                  class="size-5 shrink-0"
                  :class="effect.disabled ? 'text-dimmed' : 'text-primary'"
                />

                <div class="min-w-0 flex-1">
                  <div
                    class="flex items-center gap-2 text-sm leading-none font-medium"
                  >
                    <span class="truncate">{{ effect.name }}</span>
                  </div>

                  <div
                    v-if="effect.description"
                    class="mt-0.5 truncate text-[10px] text-dimmed"
                  >
                    {{ effect.description }}
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-1.5">
                  <USwitch
                    :model-value="!effect.disabled"
                    size="sm"
                    checked-icon="tabler:check"
                    unchecked-icon="tabler:x"
                    @update:model-value="toggleCustomEffect(effect.id)"
                  />

                  <div class="ml-1 flex gap-1">
                    <UButton
                      icon="tabler:pencil"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      class="px-1.5"
                      @click.left.exact.prevent="editCustomEffect(effect)"
                    />

                    <UButton
                      icon="tabler:trash"
                      size="xs"
                      variant="ghost"
                      color="error"
                      class="px-1.5"
                      @click.left.exact.prevent="deleteCustomEffect(effect.id)"
                    />
                  </div>
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
              @click.left.exact.prevent="createCustomEffect"
            >
              {{ MODAL_BUTTON_LABELS.addEffect }}
            </UButton>
          </div>
        </template>
      </UTabs>
    </template>

    <template #footer>
      <div class="flex justify-end gap-3">
        <UButton
          :label="MODAL_BUTTON_LABELS.cancel"
          color="neutral"
          variant="ghost"
          @click.left.exact.prevent="handleCancel"
        />

        <UButton
          :label="
            isEditing ? MODAL_BUTTON_LABELS.save : MODAL_BUTTON_LABELS.create
          "
          color="primary"
          :disabled="!name.trim()"
          @click.left.exact.prevent="handleSave"
        />
      </div>
    </template>
  </UDraggableModal>

  <!-- Подтверждение закрытия с несохранёнными изменениями -->
  <UDraggableModal
    v-model:open="isDiscardConfirmOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="400"
    :min-height="160"
    :z-index="discardConfirmZIndex"
    :title="UNSAVED_CHANGES_LABELS.title"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-toned">
          {{ SPELL_FORM_LABELS.discardQuestion }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="closeDiscardConfirm"
          >
            {{ MODAL_BUTTON_LABELS.back }}
          </UButton>

          <UButton
            variant="ghost"
            color="error"
            size="sm"
            @click.left.exact.prevent="confirmDiscard"
          >
            {{ UNSAVED_CHANGES_LABELS.discard }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            :disabled="!name.trim()"
            @click.left.exact.prevent="confirmSave"
          >
            {{ MODAL_BUTTON_LABELS.save }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>

  <ActiveEffectFormModal
    v-model:open="isEffectModalOpen"
    :modal-id="effectModalId"
    :z-index="effectModalZIndex"
    :effect="editingEffect"
    :show-effect-target="true"
    default-effect-target="target"
    @save="saveCustomEffect"
  />
</template>
