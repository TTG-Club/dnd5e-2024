<script setup lang="ts">
  import type { ActiveEffect, DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import {
    ABILITY_OPTIONS,
    CURRENCY_OPTIONS,
    RARITY_OPTIONS,
  } from '@vtt/shared/system/dnd.js';

  import { useToolForm } from '../../composables/useToolForm';
  import {
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    ITEM_FORM_LABELS,
    ITEM_USES_LABELS,
    MODAL_BUTTON_LABELS,
    TOOL_FORM_LABELS,
  } from './constants';
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
    /** Редактируемый инструмент (null = создание) */
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
    toolCategory,
    baseToolType,
    toolBonus,
    toolAbility,
    toolProficiencyMode,
    weight,
    costValue,
    costCurrency,
    sourceKey,
    source,
    isSRD,
    isMagical,
    magicAttunement,
    isAttuned,
    rarity,
    activeEffects,
    toolCategoryOptions,
    toolBaseTypeOptions,
    selectedToolProperties,
    toolPropertyOptions,
    toggleToolProperty,
    buildTool,
    itemUses,
  } = useToolForm(
    () => props.item,
    () => props.open,
  );

  /** Вкладки формы */
  const tabItems = [
    {
      label: FORM_TAB_LABELS.general,
      slot: 'general' as const,
    },
    {
      label: FORM_TAB_LABELS.details,
      slot: 'details' as const,
    },
    {
      label: FORM_TAB_LABELS.effects,
      slot: 'effects' as const,
    },
  ];

  // --- Состояние модалки создания/редактирования эффекта ---
  const effectModalId = 'tool-effect-form-modal';
  const isEffectModalOpen = ref(false);
  const effectModalZIndex = ref<number | undefined>(undefined);
  const editingEffect = ref<ActiveEffect | undefined>(undefined);

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

  /** Опции настройки магического предмета */
  const attunementOptions = [
    { label: ITEM_FORM_LABELS.attunementNone, value: 'none' as const },
    { label: ITEM_FORM_LABELS.attunementRequired, value: 'required' as const },
    { label: ITEM_FORM_LABELS.attunementOptional, value: 'optional' as const },
  ];

  const proficiencyModeOptions = [
    { label: TOOL_FORM_LABELS.proficiencyAuto, value: 'auto' as const },
    { label: TOOL_FORM_LABELS.proficiencyNone, value: 'none' as const },
    { label: TOOL_FORM_LABELS.proficiencyHalf, value: 'half' as const },
    {
      label: TOOL_FORM_LABELS.proficiencyProficient,
      value: 'proficient' as const,
    },
    {
      label: TOOL_FORM_LABELS.proficiencyExpertise,
      value: 'expertise' as const,
    },
  ];

  /** Сохраняет форму */
  function handleSave(): void {
    emit('save', buildTool());
    emit('close');
  }
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="item ? TOOL_FORM_LABELS.editTitle : TOOL_FORM_LABELS.createTitle"
    :initial-width="500"
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
            <!-- Название -->
            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="FORM_FIELD_LABELS.name">
                <UInput
                  v-model="name"
                  :placeholder="TOOL_FORM_LABELS.namePlaceholder"
                  class="w-full"
                />
              </UFormField>

              <UFormField :label="FORM_FIELD_LABELS.nameEn">
                <UInput
                  v-model="nameEn"
                  :placeholder="TOOL_FORM_LABELS.nameEnPlaceholder"
                  class="w-full"
                />
              </UFormField>
            </div>

            <!-- Описание -->
            <UFormField :label="FORM_FIELD_LABELS.description">
              <RichTextEditor
                v-model="description"
                :placeholder="TOOL_FORM_LABELS.descriptionPlaceholder"
              />
            </UFormField>

            <!-- Стоимость + Вес -->
            <FormSection
              :title="ITEM_FORM_LABELS.costWeightTitle"
              icon="tabler:coins"
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

        <!-- Вкладка «Подробнее» -->
        <template #details>
          <div class="flex flex-col gap-4">
            <!-- Тип инструмента -->
            <FormSection
              :title="TOOL_FORM_LABELS.typeTitle"
              icon="tabler:tools"
              :hint="TOOL_FORM_LABELS.typeHint"
            >
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-3">
                  <span class="min-w-35 shrink-0 text-sm text-muted">
                    {{ TOOL_FORM_LABELS.category }}
                  </span>

                  <USelect
                    v-model="toolCategory"
                    :items="toolCategoryOptions"
                    value-key="value"
                    class="flex-1"
                    :portal="false"
                    @update:model-value="baseToolType = ''"
                  />
                </div>

                <div class="flex items-center gap-3">
                  <span class="min-w-35 shrink-0 text-sm text-muted">
                    {{ ITEM_FORM_LABELS.baseType }}
                  </span>

                  <USelect
                    v-model="baseToolType"
                    :items="toolBaseTypeOptions"
                    value-key="value"
                    :placeholder="TOOL_FORM_LABELS.baseTypePlaceholder"
                    class="flex-1"
                    :portal="false"
                  />
                </div>
              </div>
            </FormSection>

            <!-- Свойства инструмента -->
            <FormSection
              :title="TOOL_FORM_LABELS.propertiesTitle"
              icon="tabler:tags"
            >
              <div class="flex flex-wrap gap-2">
                <UPopover
                  v-for="prop in toolPropertyOptions"
                  :key="prop.value"
                  mode="hover"
                  :open-delay="300"
                  :ui="{ content: 'max-w-xs p-3' }"
                >
                  <UButton
                    :label="prop.label"
                    size="xs"
                    :color="
                      selectedToolProperties.includes(prop.value)
                        ? 'primary'
                        : 'neutral'
                    "
                    :variant="
                      selectedToolProperties.includes(prop.value)
                        ? 'solid'
                        : 'outline'
                    "
                    class="cursor-pointer"
                    @click.left.exact.prevent="toggleToolProperty(prop.value)"
                  />

                  <template #content>
                    <p class="text-xs leading-relaxed text-toned">
                      {{ prop.description }}
                    </p>
                  </template>
                </UPopover>
              </div>
            </FormSection>

            <!-- Проверка инструмента -->
            <FormSection
              :title="TOOL_FORM_LABELS.checkTitle"
              icon="tabler:dice"
              :hint="TOOL_FORM_LABELS.checkHint"
            >
              <div class="flex flex-col gap-3">
                <div class="flex items-center gap-3">
                  <span class="min-w-35 shrink-0 text-sm text-muted">
                    {{ TOOL_FORM_LABELS.proficiencyMode }}
                  </span>

                  <USelect
                    v-model="toolProficiencyMode"
                    :items="proficiencyModeOptions"
                    value-key="value"
                    class="flex-1"
                    :portal="false"
                  />
                </div>

                <p class="text-xs text-dimmed">
                  {{ TOOL_FORM_LABELS.proficiencyModeHelp }}
                </p>

                <div class="flex items-center gap-3">
                  <span class="min-w-35 shrink-0 text-sm text-muted">
                    {{ FORM_FIELD_LABELS.ability }}
                  </span>

                  <USelect
                    v-model="toolAbility"
                    :items="ABILITY_OPTIONS"
                    value-key="value"
                    class="flex-1"
                    :portal="false"
                  />
                </div>

                <div class="flex items-center gap-3">
                  <span class="min-w-35 shrink-0 text-sm text-muted">
                    {{ TOOL_FORM_LABELS.bonus }}
                  </span>

                  <UInput
                    v-model.number="toolBonus"
                    type="number"
                    :min="0"
                    class="w-24"
                  />
                </div>
              </div>
            </FormSection>

            <!-- Блок «Магическое» -->
            <FormSection
              v-if="isMagical"
              :title="ITEM_FORM_LABELS.magicalTitle"
              icon="tabler:sparkles"
            >
              <div class="flex flex-col gap-3">
                <div class="grid grid-cols-2 items-start gap-3">
                  <UFormField :label="ITEM_FORM_LABELS.attunement">
                    <USelect
                      v-model="magicAttunement"
                      :items="attunementOptions"
                      value-key="value"
                      class="w-full"
                      :portal="false"
                    />
                  </UFormField>

                  <UCheckbox
                    v-if="
                      magicAttunement === 'required'
                      || magicAttunement === 'optional'
                    "
                    v-model="isAttuned"
                    :label="ITEM_FORM_LABELS.attuned"
                  />
                </div>
              </div>
            </FormSection>

            <!-- Блок «Заряды» -->
            <FormSection
              v-if="isMagical"
              :title="ITEM_USES_LABELS.title"
              icon="tabler:battery-2"
            >
              <ItemUsesFields v-model="itemUses" />
            </FormSection>
          </div>
        </template>

        <!-- Вкладка «Эффекты» -->
        <template #effects>
          <FormSection
            :title="FORM_TAB_LABELS.effects"
            icon="tabler:sparkles"
            :add-label="MODAL_BUTTON_LABELS.addEffect"
            @add="createCustomEffect"
          >
            <div class="space-y-1">
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
          </FormSection>
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
          :disabled="!name.trim()"
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
