<script setup lang="ts">
  import type { ActiveEffect, DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { DISTANCE_UNIT_OPTIONS } from '@vtt/shared';
  import {
    ABILITY_OPTIONS,
    CURRENCY_OPTIONS,
    RARITY_OPTIONS,
  } from '@vtt/shared/system/dnd.js';

  import { useWeaponForm } from '../../composables/useWeaponForm';
  import {
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    ITEM_FORM_LABELS,
    ITEM_USES_LABELS,
    MODAL_BUTTON_LABELS,
    RANGE_FIELD_LABELS,
    WEAPON_FORM_LABELS,
  } from './constants';
  import DamagePartsEditor from './DamagePartsEditor.vue';
  import FormSection from './FormSection.vue';
  import ItemUsesFields from './ItemUsesFields.vue';
  import SourceField from './SourceField.vue';
  import ActiveEffectFormModal from './tabs/ActiveEffectFormModal.vue';

  const props = defineProps<{
    /** Открыто ли модальное окно */
    open: boolean;
    /** Скрытые пропсы от useModalManager чтобы не было ворнингов */
    allowMultiple?: boolean;
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
    /** Редактируемое оружие (null = создание) */
    item: DnDGameItem | null;
    /** Z-index (управляется родителем для bring-to-front) */
    zIndex?: number;
    /** Смещение позиции для каскадного расположения */
    positionOffset?: number;
  }>();

  const emit = defineEmits<{
    'close': [];
    'save': [item: DnDGameItem];
    'bring-to-front': [];
  }>();

  /**
   * Мемоизированная начальная позиция.
   * Computed предотвращает пересоздание объекта при re-render.
   */
  const initialPosition = computed(() =>
    props.positionOffset
      ? { x: props.positionOffset, y: props.positionOffset }
      : undefined,
  );

  const { getNextZIndex } = useModalManager();

  const {
    name,
    nameEn,
    description,
    baseType,
    weaponCategory,
    rangeType,
    damageParts,
    saveType,
    saveEffect,
    selectedProperties,
    weight,
    costValue,
    costCurrency,
    reach,
    rangeNormal,
    rangeLong,
    attackAbility,
    proficiencyMode,
    attackBonus,
    special,
    ammunitionType,
    mastery,
    categoryOptions,
    damageTypeOptions,
    propertyOptions,
    baseTypeOptions,
    ammunitionTypeOptions,
    proficiencyModeOptions,
    masteryOptions,
    saveTypeOptions,
    saveEffectOptions,
    toggleProperty,
    buildWeapon,
    distanceUnit,
    sourceKey,
    source,
    isSRD,
    isMagical,
    magicAttunement,
    isAttuned,
    magicBonus,
    rarity,
    activeEffects,
    itemUses,
  } = useWeaponForm(
    () => props.item,
    () => props.open,
  );

  // --- Состояние модалки создания/редактирования эффекта ---
  const effectModalId = 'weapon-effect-form-modal';
  const isEffectModalOpen = ref(false);
  const effectModalZIndex = ref<number | undefined>(undefined);
  const editingEffect = ref<ActiveEffect | undefined>(undefined);

  /** Вкладки формы */
  const tabItems = [
    {
      label: FORM_TAB_LABELS.general,
      slot: 'general' as const,
    },
    {
      label: FORM_TAB_LABELS.combat,
      slot: 'combat' as const,
    },
    {
      label: FORM_TAB_LABELS.effects,
      slot: 'effects' as const,
    },
  ];

  /** Опции настройки магического предмета */
  const attunementOptions = [
    { label: ITEM_FORM_LABELS.attunementNone, value: 'none' as const },
    { label: ITEM_FORM_LABELS.attunementRequired, value: 'required' as const },
    { label: ITEM_FORM_LABELS.attunementOptional, value: 'optional' as const },
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

  /**
   * Формула урона невалидна: содержит `@mod.*` (у оружия мод. характеристики
   * добавляется автоматически — ручной токен дублировал бы его). Блокирует
   * сохранение.
   */
  const damageFormulaInvalid = computed(() =>
    damageParts.value.some((part) => /@mod\./i.test(part.formula)),
  );

  /** Сохраняет форму */
  function handleSave(): void {
    if (damageFormulaInvalid.value) {
      return;
    }

    emit('save', buildWeapon());
    emit('close');
  }
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="
      item ? WEAPON_FORM_LABELS.editTitle : WEAPON_FORM_LABELS.createTitle
    "
    :initial-width="720"
    :resizable="false"
    :z-index="zIndex"
    :saved-position="initialPosition"
    @update:open="
      (value: boolean) => {
        if (!value) {
          if (item) handleSave();
          else emit('close');
        }
      }
    "
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
                  :placeholder="WEAPON_FORM_LABELS.namePlaceholder"
                  class="w-full"
                />
              </UFormField>

              <UFormField :label="FORM_FIELD_LABELS.nameEn">
                <UInput
                  v-model="nameEn"
                  :placeholder="WEAPON_FORM_LABELS.nameEnPlaceholder"
                  class="w-full"
                />
              </UFormField>
            </div>

            <!-- Описание -->
            <UFormField :label="FORM_FIELD_LABELS.description">
              <RichTextEditor
                v-model="description"
                :placeholder="WEAPON_FORM_LABELS.descriptionPlaceholder"
              />
            </UFormField>

            <!-- Стоимость + Вес + Редкость -->
            <FormSection
              :title="ITEM_FORM_LABELS.costWeightTitle"
              title-color="healing"
            >
              <div class="grid grid-cols-3 gap-3">
                <UFormField :label="ITEM_FORM_LABELS.cost">
                  <div class="flex gap-1.5">
                    <UInput
                      v-model.number="costValue"
                      type="number"
                      :min="0"
                      :placeholder="ITEM_FORM_LABELS.zeroPlaceholder"
                      class="flex-1"
                    />

                    <USelect
                      v-model="costCurrency"
                      :items="CURRENCY_OPTIONS"
                      value-key="value"
                      label-key="labelShort"
                      class="w-20"
                      :portal="false"
                    />
                  </div>
                </UFormField>

                <UFormField :label="ITEM_FORM_LABELS.weight">
                  <UInput
                    v-model.number="weight"
                    type="number"
                    :min="0"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="ITEM_FORM_LABELS.rarity">
                  <USelect
                    v-model="rarity"
                    :items="RARITY_OPTIONS"
                    value-key="value"
                    :placeholder="ITEM_FORM_LABELS.rarity"
                    class="w-full"
                    :portal="false"
                  />
                </UFormField>
              </div>
            </FormSection>

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
          </div>
        </template>

        <template #combat>
          <div class="flex flex-col gap-4">
            <!-- Основное -->
            <FormSection
              :title="FORM_TAB_LABELS.main"
              title-color="arcane"
            >
              <div class="flex flex-col gap-3">
                <!-- Тип боя (toggle без заголовка, в начале) -->
                <div class="flex gap-2">
                  <UButton
                    :color="rangeType === 'melee' ? 'primary' : 'neutral'"
                    :variant="rangeType === 'melee' ? 'solid' : 'outline'"
                    size="sm"
                    class="flex-1"
                    @click.left.exact.prevent="rangeType = 'melee'"
                  >
                    {{ WEAPON_FORM_LABELS.rangeTypeMelee }}
                  </UButton>

                  <UButton
                    :color="rangeType === 'ranged' ? 'primary' : 'neutral'"
                    :variant="rangeType === 'ranged' ? 'solid' : 'outline'"
                    size="sm"
                    class="flex-1"
                    @click.left.exact.prevent="rangeType = 'ranged'"
                  >
                    {{ WEAPON_FORM_LABELS.rangeTypeRanged }}
                  </UButton>
                </div>

                <!-- Базовое оружие (inline label) -->
                <div class="flex items-center gap-3">
                  <span class="min-w-30 shrink-0 text-sm text-muted">
                    {{ WEAPON_FORM_LABELS.baseWeapon }}
                  </span>

                  <USelect
                    v-model="baseType"
                    :items="baseTypeOptions"
                    value-key="value"
                    :placeholder="ITEM_FORM_LABELS.selectTypePlaceholder"
                    class="flex-1"
                  />
                </div>

                <!-- Тип оружия (inline label) -->
                <div class="flex items-center gap-3">
                  <span class="min-w-30 shrink-0 text-sm text-muted">
                    {{ WEAPON_FORM_LABELS.weaponType }}
                  </span>

                  <USelect
                    v-model="weaponCategory"
                    :items="categoryOptions"
                    value-key="value"
                    class="flex-1"
                  />
                </div>

                <!-- Оружейный приём (inline label) -->
                <div class="flex items-center gap-3">
                  <span class="min-w-30 shrink-0 text-sm text-muted">
                    {{ WEAPON_FORM_LABELS.mastery }}
                  </span>

                  <USelect
                    v-model="mastery"
                    :items="masteryOptions"
                    value-key="value"
                    :placeholder="WEAPON_FORM_LABELS.masteryPlaceholder"
                    class="flex-1"
                  />
                </div>
              </div>
            </FormSection>
            <!-- Свойства оружия -->
            <FormSection
              :title="WEAPON_FORM_LABELS.propertiesTitle"
              title-color="info"
            >
              <div class="flex flex-wrap gap-2">
                <UPopover
                  v-for="prop in propertyOptions"
                  :key="prop.value"
                  mode="hover"
                  :open-delay="300"
                  :ui="{ content: 'max-w-xs p-3' }"
                >
                  <UButton
                    :label="prop.label"
                    size="xs"
                    :color="
                      selectedProperties.includes(prop.value)
                        ? 'primary'
                        : 'neutral'
                    "
                    :variant="
                      selectedProperties.includes(prop.value)
                        ? 'solid'
                        : 'outline'
                    "
                    class="cursor-pointer"
                    @click.left.exact.prevent="toggleProperty(prop.value)"
                  />

                  <template #content>
                    <p class="text-xs leading-relaxed text-toned">
                      {{ prop.description }}
                    </p>
                  </template>
                </UPopover>
              </div>
            </FormSection>

            <!-- Блок «Магическое» (раскрывается при нажатии badge) -->
            <FormSection
              v-if="isMagical"
              :title="ITEM_FORM_LABELS.magicalTitle"
              title-color="arcane"
            >
              <div class="flex flex-col gap-3">
                <div class="grid grid-cols-2 items-start gap-3">
                  <UFormField :label="ITEM_FORM_LABELS.attunement">
                    <USelect
                      v-model="magicAttunement"
                      :items="attunementOptions"
                      value-key="value"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="ITEM_FORM_LABELS.magicBonus">
                    <UInput
                      v-model.number="magicBonus"
                      type="number"
                      :min="0"
                      :max="10"
                      :placeholder="ITEM_FORM_LABELS.magicBonusPlaceholder"
                      class="w-full"
                    />
                  </UFormField>
                </div>

                <UCheckbox
                  v-if="
                    magicAttunement === 'required'
                    || magicAttunement === 'optional'
                  "
                  v-model="isAttuned"
                  :label="ITEM_FORM_LABELS.attuned"
                />
              </div>
            </FormSection>

            <!-- Блок «Заряды» -->
            <FormSection
              v-if="isMagical"
              :title="ITEM_USES_LABELS.title"
              title-color="arcane"
            >
              <ItemUsesFields v-model="itemUses" />
            </FormSection>
            <!-- Урон (единая со заклинаниями система частей) -->
            <FormSection
              :title="WEAPON_FORM_LABELS.damageTitle"
              title-color="warning"
            >
              <div class="flex flex-col gap-3">
                <p class="text-xs text-muted">
                  {{ WEAPON_FORM_LABELS.damageHint }}
                </p>

                <DamagePartsEditor
                  v-model="damageParts"
                  :damage-type-options="damageTypeOptions"
                  :include-spell-modifier="false"
                  :hide-modifiers="true"
                  :show-versatile="selectedProperties.includes('versatile')"
                  :allow-empty="true"
                />

                <!-- Тип боеприпаса (появляется при свойстве «Боеприпасы») -->
                <UFormField
                  v-if="selectedProperties.includes('ammunition')"
                  :label="WEAPON_FORM_LABELS.ammunitionType"
                >
                  <USelect
                    v-model="ammunitionType"
                    :items="ammunitionTypeOptions"
                    value-key="value"
                    :placeholder="ITEM_FORM_LABELS.selectTypePlaceholder"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </FormSection>

            <!-- Спасбросок (оружие, заставляющее цель совершить спасбросок) -->
            <FormSection
              :title="FORM_FIELD_LABELS.savingThrow"
              title-color="danger"
            >
              <div class="grid grid-cols-2 gap-3">
                <UFormField :label="WEAPON_FORM_LABELS.saveType">
                  <USelect
                    v-model="saveType"
                    :items="saveTypeOptions"
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
                    :items="saveEffectOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </FormSection>

            <!-- Особые правила (текстовая оговорка оружия) -->
            <FormSection
              :title="WEAPON_FORM_LABELS.specialTitle"
              title-color="arcane"
            >
              <UFormField :label="WEAPON_FORM_LABELS.special">
                <UTextarea
                  v-model="special"
                  autoresize
                  :rows="2"
                  :placeholder="WEAPON_FORM_LABELS.specialPlaceholder"
                  class="w-full"
                />
              </UFormField>

              <p class="mt-2 text-xs text-dimmed">
                {{ WEAPON_FORM_LABELS.specialHint }}
              </p>
            </FormSection>

            <!-- Дальность и досягаемость -->
            <FormSection
              :title="FORM_FIELD_LABELS.range"
              title-color="primary"
            >
              <template #actions>
                <USelect
                  v-model="distanceUnit"
                  :items="DISTANCE_UNIT_OPTIONS"
                  value-key="value"
                  size="xs"
                  class="w-36"
                />
              </template>

              <div class="grid grid-cols-3 gap-3">
                <!-- Досягаемость -->
                <UFormField :label="RANGE_FIELD_LABELS.reach">
                  <UInput
                    v-model.number="reach"
                    type="number"
                    :min="5"
                    :step="5"
                    class="w-full"
                  />
                </UFormField>

                <!-- Нормальная -->
                <UFormField :label="RANGE_FIELD_LABELS.normal">
                  <UInput
                    v-model.number="rangeNormal"
                    type="number"
                    :min="0"
                    :disabled="
                      rangeType !== 'ranged'
                      && !selectedProperties.includes('thrown')
                    "
                    class="w-full"
                  />
                </UFormField>

                <!-- Максимальная -->
                <UFormField :label="RANGE_FIELD_LABELS.long">
                  <UInput
                    v-model.number="rangeLong"
                    type="number"
                    :min="0"
                    :disabled="
                      rangeType !== 'ranged'
                      && !selectedProperties.includes('thrown')
                    "
                    class="w-full"
                  />
                </UFormField>
              </div>
            </FormSection>

            <!-- Показатель атаки -->
            <FormSection
              :title="WEAPON_FORM_LABELS.attackTitle"
              title-color="danger"
            >
              <div class="grid grid-cols-2 gap-3">
                <UFormField :label="FORM_FIELD_LABELS.ability">
                  <USelect
                    v-model="attackAbility"
                    :items="ABILITY_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="WEAPON_FORM_LABELS.attackBonus">
                  <UInput
                    v-model.number="attackBonus"
                    type="number"
                    :placeholder="ITEM_FORM_LABELS.zeroPlaceholder"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <div class="mt-3">
                <UFormField :label="WEAPON_FORM_LABELS.proficiencyMode">
                  <USelect
                    v-model="proficiencyMode"
                    :items="proficiencyModeOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
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
              {{ WEAPON_FORM_LABELS.effectsEmpty }}
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
          @click.left.exact.prevent="emit('close')"
        />

        <UButton
          :label="item ? MODAL_BUTTON_LABELS.save : MODAL_BUTTON_LABELS.create"
          color="primary"
          :disabled="!name.trim() || damageFormulaInvalid"
          @click.left.exact.prevent="handleSave"
        />
      </div>
    </template>
  </UDraggableModal>

  <ActiveEffectFormModal
    v-model:open="isEffectModalOpen"
    :modal-id="effectModalId"
    :z-index="effectModalZIndex"
    :effect="editingEffect"
    :show-effect-target="true"
    @save="saveCustomEffect"
  />
</template>
