<!--
  Окно активного эффекта: одна страница по шагам с живой сводкой сверху.

  Какие шаги и поля показать, решает движок по МЕСТУ окна (`context`) и текущей
  настройке эффекта (`resolveEffectFormLayout`): у пассивной черты нет
  спасброска, у зоны «пока внутри» — урона при срабатывании, у действия
  существа — выбора «на себя». Старое ядро места не передаёт — тогда оно
  выводится из прежних пропов, а без них окно показывает всё, как раньше.

  Черновик заменяется целиком на каждое изменение: шаги получают эффект и
  отдают новый объект, ничего не меняя на месте.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    EffectFormContext,
    EffectFormStep as EffectFormStepKey,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, shallowRef, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { generateId } from '@vtt/shared';
  import {
    clearInertEffectFields,
    createEffectForContext,
    describeEffectScenario,
    listEffectFormSteps,
    listInertEffectFields,
    normalizeEffectDraft,
    resolveEffectFormContext,
    resolveEffectFormLayout,
    upgradeEffectDraft,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTIVE_EFFECT_DEFAULTS,
    MODAL_BUTTON_LABELS,
  } from '../actor/constants';
  import {
    ACTIVE_EFFECT_FORM_LABELS,
    ACTIVE_EFFECT_FORM_MODAL_SIZE,
    EFFECT_FORM_STEP_ICONS,
    EFFECT_FORM_STEP_TITLES,
    EFFECT_MODIFIERS_STEP_TITLES,
  } from './constants';
  import {
    EffectAdvancedSection,
    EffectDamageStep,
    EffectDescriptionSection,
    EffectDurationStep,
    EffectEscapeSection,
    EffectFormStep,
    EffectHeaderFields,
    EffectInertFieldsNotice,
    EffectModifiersStep,
    EffectSaveStep,
    EffectScenarioSummary,
    EffectStagesSection,
    EffectTriggersStep,
    EffectTriggerStep,
  } from './form';

  interface Props {
    open: boolean;
    modalId: string;
    zIndex?: number;
    /** Редактируемый эффект; без него окно заводит новый */
    effect?: ActiveEffect;
    savedPosition?: { x: number; y: number };
    savedSize?: { width: number; height: number };
    onSave?: (effect: ActiveEffect) => void;
    /**
     * Место окна: задаёт, какие шаги и поля показать. Не задано — выводится из
     * прежних пропов (`showAreaTrigger`, `hideConditionPreset`).
     */
    context?: EffectFormContext;
    /**
     * Прежний проп окна зоны у ядра. Раскладку теперь задаёт место окна, проп
     * оставлен, чтобы ядро без `context` не получало лишний атрибут.
     */
    hideAura?: boolean;
    /** Прежний признак окна зоны: без `context` означает место `zone` */
    showAreaTrigger?: boolean;
    /** Прежний признак окна состояния: без `context` означает место `condition` */
    hideConditionPreset?: boolean;
    /**
     * Есть ли у заклинания область — где появиться зоне на месте шаблона. Не
     * задано — доставка «зоной» не прячется.
     */
    zoneAvailable?: boolean;
    /**
     * Сл источника, которую подставит «Авто» у полей Сл: окно-владелец знает
     * заклинателя или действие и показывает число. Не задано — видна только
     * подпись «Сл заклинателя».
     */
    sourceSaveDc?: number;
  }

  const props = withDefaults(defineProps<Props>(), {
    zIndex: undefined,
    effect: undefined,
    savedPosition: undefined,
    savedSize: undefined,
    onSave: () => {},
    context: undefined,
    hideAura: false,
    showAreaTrigger: false,
    hideConditionPreset: false,
    zoneAvailable: undefined,
    sourceSaveDc: undefined,
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'save': [effect: ActiveEffect];
    'bring-to-front': [];
    'close': [];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => {
      emit('update:open', value);
    },
  });

  const context = computed(() =>
    resolveEffectFormContext(props.context, {
      showAreaTrigger: props.showAreaTrigger,
      hideConditionPreset: props.hideConditionPreset,
    }),
  );

  /**
   * Черновик для открытия окна: копия редактируемого эффекта либо новый эффект
   * с доставкой по умолчанию для места окна.
   *
   * @returns черновик
   */
  function createDraft(): ActiveEffect {
    if (props.effect) {
      // Копия отвязывает черновик от записи владельца: отмена окна не должна
      // оставлять правок в ней
      const copy: ActiveEffect = JSON.parse(JSON.stringify(props.effect));

      return upgradeEffectDraft(copy, context.value);
    }

    return {
      ...createEffectForContext(
        context.value,
        generateId('effect'),
        ACTIVE_EFFECT_DEFAULTS.name,
      ),
      icon: ACTIVE_EFFECT_DEFAULTS.icon,
    };
  }

  /** Черновик эффекта; меняется только заменой целиком */
  const draft = shallowRef<ActiveEffect>(createDraft());

  /**
   * Ключ содержимого окна. Окно смонтировано постоянно, и без нового ключа
   * раскрытые разделы и открытые библиотеки прошлого эффекта переезжали бы в
   * следующий.
   */
  const formKey = ref(0);

  /** Раскрыто ли описание: заполненное видно сразу */
  const isDescriptionOpen = ref(false);

  /** Показывать приоритет у всех модификаторов */
  const showPriorityField = ref(false);

  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      draft.value = createDraft();
      isDescriptionOpen.value = draft.value.description.trim() !== '';
      showPriorityField.value = false;
      formKey.value += 1;
    },
    { immediate: true },
  );

  const layout = computed(() =>
    resolveEffectFormLayout(context.value, draft.value, {
      zoneAvailable: props.zoneAvailable,
    }),
  );

  const steps = computed(() => listEffectFormSteps(layout.value));

  const scenario = computed(() =>
    describeEffectScenario(draft.value, context.value),
  );

  const inertFields = computed(() =>
    listInertEffectFields(draft.value, layout.value),
  );

  const modifiersTitle = computed(
    () => EFFECT_MODIFIERS_STEP_TITLES[layout.value.delivery],
  );

  const title = computed(() =>
    props.effect
      ? `${ACTIVE_EFFECT_FORM_LABELS.editTitlePrefix}${props.effect.name}`
      : ACTIVE_EFFECT_FORM_LABELS.createTitle,
  );

  const canSave = computed(() => draft.value.name.trim() !== '');

  const description = computed({
    get: () => draft.value.description,
    set: (value: string) => {
      draft.value = { ...draft.value, description: value };
    },
  });

  /**
   * Показан ли шаг.
   *
   * @param step - шаг
   * @returns `true`, если шаг есть в раскладке
   */
  function isStepShown(step: EffectFormStepKey): boolean {
    return steps.value.includes(step);
  }

  /**
   * Номер шага среди показанных.
   *
   * @param step - шаг
   * @returns номер с единицы
   */
  function stepNumber(step: EffectFormStepKey): number {
    return steps.value.indexOf(step) + 1;
  }

  /** Убирает настройки, которые в этом месте не работают */
  function clearInertFields(): void {
    draft.value = clearInertEffectFields(
      draft.value,
      inertFields.value,
      context.value,
    );
  }

  function handleClose(): void {
    emit('update:open', false);
  }

  function handleSave(): void {
    if (!canSave.value) {
      return;
    }

    // Глубокая копия: сохранённая запись не должна делить вложенные разделы с
    // черновиком окна
    const savedEffect: ActiveEffect = JSON.parse(
      JSON.stringify(normalizeEffectDraft(draft.value, layout.value)),
    );

    emit('save', savedEffect);
    handleClose();
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="true"
    :resizable="true"
    :blocking="false"
    :initial-width="ACTIVE_EFFECT_FORM_MODAL_SIZE.width"
    :min-width="ACTIVE_EFFECT_FORM_MODAL_SIZE.minWidth"
    :min-height="ACTIVE_EFFECT_FORM_MODAL_SIZE.minHeight"
    :z-index="props.zIndex"
    :title="title"
    :saved-position="savedPosition"
    :saved-size="savedSize"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div
        :key="formKey"
        class="flex flex-col gap-3 px-1 pb-1"
      >
        <EffectHeaderFields
          v-model:effect="draft"
          :show-condition-preset="layout.showConditionPreset"
          :show-status-toggle="layout.showStatusToggle"
        />

        <!-- Прокручивается тело окна целиком: сводка держится сверху, чтобы
             правка любого шага была видна в ней сразу -->
        <div class="sticky -top-2 z-10 bg-default pt-2 pb-1">
          <EffectScenarioSummary :scenario="scenario" />
        </div>

        <EffectInertFieldsNotice
          v-if="inertFields.length > 0"
          :fields="inertFields"
          @clear="clearInertFields"
        />

        <div class="flex flex-col gap-3">
          <EffectFormStep
            v-if="isStepShown('trigger')"
            :step-number="stepNumber('trigger')"
            :title="EFFECT_FORM_STEP_TITLES.trigger"
            :icon="EFFECT_FORM_STEP_ICONS.trigger"
          >
            <EffectTriggerStep
              v-model:effect="draft"
              :layout="layout"
            />
          </EffectFormStep>

          <EffectFormStep
            v-if="isStepShown('save')"
            :step-number="stepNumber('save')"
            :title="EFFECT_FORM_STEP_TITLES.save"
            :icon="EFFECT_FORM_STEP_ICONS.save"
          >
            <EffectSaveStep
              v-model:effect="draft"
              :layout="layout"
              :source-save-dc="sourceSaveDc"
            />
          </EffectFormStep>

          <EffectFormStep
            v-if="isStepShown('damage')"
            :step-number="stepNumber('damage')"
            :title="EFFECT_FORM_STEP_TITLES.damage"
            :icon="EFFECT_FORM_STEP_ICONS.damage"
          >
            <EffectDamageStep
              v-model:effect="draft"
              :layout="layout"
            />
          </EffectFormStep>

          <EffectFormStep
            v-if="isStepShown('modifiers')"
            :step-number="stepNumber('modifiers')"
            :title="modifiersTitle"
            :icon="EFFECT_FORM_STEP_ICONS.modifiers"
          >
            <EffectModifiersStep
              v-model:effect="draft"
              :layout="layout"
              :show-priority-field="showPriorityField"
            />

            <EffectStagesSection
              v-if="layout.showStages"
              v-model:effect="draft"
              :show-priority-field="showPriorityField"
            />
          </EffectFormStep>

          <EffectFormStep
            v-if="isStepShown('duration')"
            :step-number="stepNumber('duration')"
            :title="EFFECT_FORM_STEP_TITLES.duration"
            :icon="EFFECT_FORM_STEP_ICONS.duration"
          >
            <EffectDurationStep
              v-model:effect="draft"
              :layout="layout"
            />

            <EffectEscapeSection
              v-if="layout.showEscape"
              v-model:effect="draft"
              :layout="layout"
              :source-save-dc="sourceSaveDc"
            />
          </EffectFormStep>

          <EffectFormStep
            v-if="isStepShown('triggers')"
            :step-number="stepNumber('triggers')"
            :title="EFFECT_FORM_STEP_TITLES.triggers"
            :icon="EFFECT_FORM_STEP_ICONS.triggers"
          >
            <EffectTriggersStep
              v-model:effect="draft"
              :layout="layout"
              :source-save-dc="sourceSaveDc"
            />
          </EffectFormStep>

          <EffectDescriptionSection
            v-model:description="description"
            v-model:open="isDescriptionOpen"
            :scenario="scenario"
          />

          <EffectAdvancedSection
            v-model:show-priority-field="showPriorityField"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-3">
        <UButton
          variant="ghost"
          color="neutral"
          :label="MODAL_BUTTON_LABELS.cancel"
          @click.left.exact.prevent="handleClose"
        />

        <UButton
          color="primary"
          :label="MODAL_BUTTON_LABELS.save"
          :disabled="!canSave"
          @click.left.exact.prevent="handleSave"
        />
      </div>
    </template>
  </UDraggableModal>
</template>
