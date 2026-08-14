<script setup lang="ts">
  import type { AbilityType, DamagePart } from '@vtt/shared';
  import type {
    ActiveEffect,
    AreaEffectTrigger,
    ConditionKey,
    EffectSaveOutcome,
    EffectSaveTiming,
    EffectTurnAnchor,
    EffectTurnTiming,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
  import { generateId } from '@vtt/shared';
  import {
    ABILITY_OPTIONS,
    AREA_TRIGGER_LABELS,
    buildConditionActiveEffect,
    CONDITIONS,
    describeActiveEffect,
    EFFECT_CONDITION_SUGGESTIONS,
    EFFECT_DURATION_LABELS,
    EFFECT_FLAG_LABELS,
    EFFECT_TARGET_SUGGESTIONS,
    EFFECT_TURN_ANCHOR_LABELS,
    EFFECT_TURN_TIMING_LABELS,
    EFFECT_VALUE_SUGGESTIONS,
    isEffectFlagKey,
    isEffectTargetKey,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTIVE_EFFECT_DEFAULTS,
    ACTIVE_EFFECT_FORM_LABELS,
    ACTIVE_EFFECT_TEMPLATES_LABELS,
    EFFECT_TEMPLATES_MODAL_IDS,
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    MODAL_BUTTON_LABELS,
  } from '../constants';
  import DamagePartsEditor from '../DamagePartsEditor.vue';
  import ActiveEffectSuggestionsModal from './ActiveEffectSuggestionsModal.vue';

  interface Props {
    open: boolean;
    modalId: string;
    zIndex?: number;
    effect?: ActiveEffect; // Если не передано — создание нового
    savedPosition?: { x: number; y: number };
    savedSize?: { width: number; height: number };
    onSave?: (effect: ActiveEffect) => void;
    /** Скрыть секцию «Аура» (напр. для area-эффектов) */
    hideAura?: boolean;
    /** Показать переключатель «Цель эффекта» (Себе / Цели при атаке) */
    showEffectTarget?: boolean;
    /**
     * Кому адресован НОВЫЙ эффект. По умолчанию владельцу: эффект предмета с
     * целью `target` движок к владельцу не применяет, и «+1 КД» на плаще молча
     * не работал бы. Окна, где эффект по смыслу летит в цель (заклинания),
     * передают `target` явно.
     */
    defaultEffectTarget?: 'self' | 'target';
    /** Показать выбор триггера области (При входе / выходе / Пока внутри) */
    showAreaTrigger?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    zIndex: undefined,
    effect: undefined,
    savedPosition: undefined,
    savedSize: undefined,
    onSave: () => {},
    hideAura: false,
    showEffectTarget: false,
    defaultEffectTarget: 'self',
    showAreaTrigger: false,
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
      if (!value) {
        handleClose();
      }

      emit('update:open', value);
    },
  });

  /**
   * Необязательные поля эффекта. Их приходится стирать явно: форма живёт
   * постоянно смонтированной, а `Object.assign` ключи не удаляет — без этого
   * спасбросок и урон прошлого эффекта переезжали в следующий.
   */
  const OPTIONAL_EFFECT_KEYS = [
    'icon',
    'originId',
    'sourceActorId',
    'aura',
    'areaTrigger',
    'effectTarget',
    'conditionKey',
    'applySave',
    'applyOnSuccess',
    'applyOnSuccessOnly',
    'consumeOn',
    'damageParts',
    'recurringSave',
    'recurringDamage',
    'conditionImmunities',
  ] as const satisfies readonly (keyof ActiveEffect)[];

  /**
   * Заготовка нового эффекта: обязательные поля со значениями по умолчанию.
   */
  function createEmptyActiveEffect(): ActiveEffect {
    return {
      id: generateId('effect'),
      name: ACTIVE_EFFECT_DEFAULTS.name,
      description: '',
      icon: ACTIVE_EFFECT_DEFAULTS.icon,
      disabled: false,
      origin: 'manual',
      transfer: false,
      duration: { type: 'permanent' },
      changes: [],
      flags: [],
    };
  }

  // Локальное состояние формы
  const form = reactive<ActiveEffect>(createEmptyActiveEffect());

  const isActive = computed({
    get: () => !form.disabled,
    set: (val) => {
      form.disabled = !val;
    },
  });

  /** Сегменты «Снять эффект» (`consumeOn`) — как у «Цели эффекта». */
  const consumeOnTabs = [
    {
      value: 'none',
      label: ACTIVE_EFFECT_FORM_LABELS.consumeOnNone,
      icon: 'tabler:hourglass',
    },
    {
      value: 'carrierAttack',
      label: ACTIVE_EFFECT_FORM_LABELS.consumeOnCarrierAttack,
      icon: 'tabler:sword',
    },
    {
      value: 'attackOnCarrier',
      label: ACTIVE_EFFECT_FORM_LABELS.consumeOnAttackOnCarrier,
      icon: 'tabler:target-arrow',
    },
  ];

  /** Применяет выбор «Снять эффект»: «none» → не задано (по длительности). */
  function handleConsumeOnChange(value: string | number) {
    form.consumeOn =
      value === 'carrierAttack' || value === 'attackOnCarrier'
        ? value
        : undefined;
  }

  /**
   * Заполняет форму: сначала стирает всё, что осталось от прошлой записи, затем
   * кладёт заготовку и — при правке — поля редактируемого эффекта.
   *
   * Полный сброс обязателен: окно смонтировано постоянно и переиспользует один
   * объект формы, а выборочный сброс оставлял в новом эффекте чужой спасбросок,
   * урон при наложении и ключ состояния.
   *
   * @param effect - редактируемый эффект; без него готовится новая запись
   */
  function fillForm(effect?: ActiveEffect): void {
    for (const optionalKey of OPTIONAL_EFFECT_KEYS) {
      delete form[optionalKey];
    }

    Object.assign(form, createEmptyActiveEffect());

    if (effect) {
      Object.assign(form, JSON.parse(JSON.stringify(effect)));
    }

    form.effectTarget = effect?.effectTarget ?? props.defaultEffectTarget;
  }

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        fillForm(props.effect);
      }
    },
    { immediate: true },
  );

  /** Авто-описание, собранное из текущих настроек эффекта (для предпросмотра). */
  const generatedDescription = computed(() => describeActiveEffect(form));

  /** Заполняет поле описания авто-сгенерированным текстом. */
  function applyGeneratedDescription() {
    form.description = generatedDescription.value;
  }

  function handleClose() {
    emit('update:open', false);
  }

  function handleSave() {
    if (!form.name.trim()) {
      return;
    }

    // У области/ауры нет «кастера» — динамический DC (0 = подставить Сл кастера)
    // резолвить нечем, поэтому фиксируем минимум 1.
    if (
      (props.showAreaTrigger || form.aura)
      && form.applySave
      && form.applySave.dc < 1
    ) {
      form.applySave.dc = 1;
    }

    // Глубокая копия черновика: мелкий спред оставил бы вложенные разделы
    // общими с реактивной формой окна
    const savedEffect: ActiveEffect = JSON.parse(JSON.stringify(form));

    emit('save', savedEffect);
    handleClose();
  }

  function addChange() {
    form.changes.push({
      key: ACTIVE_EFFECT_DEFAULTS.changeKey,
      mode: 'add',
      value: ACTIVE_EFFECT_DEFAULTS.changeValue,
      condition: '',
      priority: ACTIVE_EFFECT_DEFAULTS.changePriority,
    });
  }

  function removeChange(index: number) {
    form.changes.splice(index, 1);
  }

  const modeOptions = [
    { value: 'add', label: ACTIVE_EFFECT_FORM_LABELS.modeAdd },
    { value: 'multiply', label: ACTIVE_EFFECT_FORM_LABELS.modeMultiply },
    { value: 'override', label: ACTIVE_EFFECT_FORM_LABELS.modeOverride },
    { value: 'upgrade', label: ACTIVE_EFFECT_FORM_LABELS.modeUpgrade },
    { value: 'downgrade', label: ACTIVE_EFFECT_FORM_LABELS.modeDowngrade },
    { value: 'custom', label: ACTIVE_EFFECT_FORM_LABELS.modeCustom },
  ];

  const auraTargetOptions = [
    { value: 'allies', label: ACTIVE_EFFECT_FORM_LABELS.auraTargetAllies },
    { value: 'enemies', label: ACTIVE_EFFECT_FORM_LABELS.auraTargetEnemies },
    { value: 'all', label: ACTIVE_EFFECT_FORM_LABELS.auraTargetAll },
  ];

  const effectTargetTabs = [
    {
      value: 'target',
      label: ACTIVE_EFFECT_FORM_LABELS.effectTargetOnTarget,
      icon: 'tabler:crosshair',
    },
    {
      value: 'self',
      label: ACTIVE_EFFECT_FORM_LABELS.effectTargetOnSelf,
      icon: 'tabler:user-shield',
    },
  ];

  /** Вкладки редактора эффекта */
  const tabItems = [
    { label: FORM_TAB_LABELS.main, slot: 'general' as const },
    { label: ACTIVE_EFFECT_FORM_LABELS.tabExtra, slot: 'combat' as const },
  ];

  /**
   * Применяет выбор «Цель эффекта» из сегментированного переключателя.
   * Сбрасывает ауру при выборе 'target', т.к. аура и эффект на цель —
   * взаимоисключающие режимы.
   */
  function handleEffectTargetChange(value: string | number) {
    const next = value === 'target' ? 'target' : 'self';

    form.effectTarget = next;

    if (next === 'target' && form.aura) {
      delete form.aura;
    }
  }

  /** Опции пресетов состояний для UDropdownMenu */
  const conditionPresetItems = [
    CONDITIONS.filter((condition) => condition.key !== 'exhaustion').map(
      (condition) => ({
        label: condition.nameRu,
        icon: condition.icon,
        onSelect: () => applyConditionPreset(condition.key),
      }),
    ),
  ];

  /**
   * Заполняет форму данными стандартного состояния D&D 5e.
   *
   * Состояние собирает движок: он один знает про `conditionKey`, иммунитеты к
   * состояниям и динамические изменения Истощения. Форма лишь сохраняет свой
   * идентификатор и выбранную цель эффекта.
   *
   * @param conditionKey - ключ состояния
   */
  function applyConditionPreset(conditionKey: ConditionKey) {
    const builtEffect = buildConditionActiveEffect(conditionKey);

    if (!builtEffect) {
      return;
    }

    const currentId = form.id;
    const currentEffectTarget = form.effectTarget;

    fillForm(builtEffect);

    form.id = currentId;
    form.effectTarget = currentEffectTarget;
  }

  const isTemplateModalOpen = ref(false);
  const isKeyModalOpen = ref(false);
  const isValueModalOpen = ref(false);
  const activeChangeIndex = ref<number | null>(null);

  function openTemplateModal(index: number) {
    activeChangeIndex.value = index;
    isTemplateModalOpen.value = true;
  }

  function openKeyModal(index: number) {
    activeChangeIndex.value = index;
    isKeyModalOpen.value = true;
  }

  function openValueModal(index: number) {
    activeChangeIndex.value = index;
    isValueModalOpen.value = true;
  }

  function applyConditionTemplate(value: string) {
    if (
      activeChangeIndex.value !== null
      && form.changes[activeChangeIndex.value]
    ) {
      form.changes[activeChangeIndex.value].condition = value;
    }

    isTemplateModalOpen.value = false;
    activeChangeIndex.value = null;
  }

  function applyValueTemplate(value: string) {
    if (
      activeChangeIndex.value !== null
      && form.changes[activeChangeIndex.value]
    ) {
      form.changes[activeChangeIndex.value].value = value;
    }

    isValueModalOpen.value = false;
    activeChangeIndex.value = null;
  }

  function applyKeyTemplate(value: string) {
    const change =
      activeChangeIndex.value === null
        ? undefined
        : form.changes[activeChangeIndex.value];

    // Значения приходят из закрытого списка движка `EFFECT_TARGET_SUGGESTIONS`,
    // но подборщик отдаёт их строкой — сверяем, чтобы не писать чужой ключ
    if (change && isEffectTargetKey(value)) {
      change.key = value;
    }

    isKeyModalOpen.value = false;
    activeChangeIndex.value = null;
  }

  const isFlagModalOpen = ref(false);
  const activeFlagIndex = ref<number | null>(null);

  /** Список флагов для библиотеки: подписи те же, что показывает форма */
  const flagSuggestions = Object.entries(EFFECT_FLAG_LABELS).map(
    ([flagKey, flagLabel]) => ({ value: flagKey, label: flagLabel }),
  );

  function openFlagModal(index: number) {
    activeFlagIndex.value = index;
    isFlagModalOpen.value = true;
  }

  function applyFlagTemplate(value: string) {
    const flagIndex = activeFlagIndex.value;

    // Неизвестный флаг движок отбрасывает при разборе, поэтому в форму он не
    // попадает вовсе — иначе пользователь считал бы его настроенным
    if (flagIndex !== null && isEffectFlagKey(value)) {
      form.flags[flagIndex] = value;
    }

    isFlagModalOpen.value = false;
    activeFlagIndex.value = null;
  }

  function addFlag() {
    // Дефолтное значение для удобства редактирования или пустая строка
    form.flags.push(ACTIVE_EFFECT_DEFAULTS.flag);
  }

  function removeFlag(index: number) {
    form.flags.splice(index, 1);
  }

  const durationTypes = Object.entries(EFFECT_DURATION_LABELS).map(
    ([value, label]) => ({
      value,
      label,
    }),
  );

  const hasDurationValue = computed(() =>
    ['rounds', 'minutes', 'hours', 'days'].includes(form.duration.type),
  );

  /** Точная «ходовая» длительность (до начала/конца хода носителя/источника). */
  const isTurnDuration = computed(() => form.duration.type === 'turn');

  const turnAnchorOptions = Object.entries(EFFECT_TURN_ANCHOR_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  const turnTimingOptions = Object.entries(EFFECT_TURN_TIMING_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  /** Якорь хода (носитель/источник) с дефолтом `carrier`. */
  const turnAnchorValue = computed<EffectTurnAnchor>({
    get: () => form.duration.turnAnchor ?? 'carrier',
    set: (val) => {
      form.duration.turnAnchor = val;
    },
  });

  /** Момент хода (начало/конец) с дефолтом `end`. */
  const turnTimingValue = computed<EffectTurnTiming>({
    get: () => form.duration.turnTiming ?? 'end',
    set: (val) => {
      form.duration.turnTiming = val;
    },
  });

  const durationDescription = computed(() => {
    switch (form.duration.type) {
      case 'permanent':
        return ACTIVE_EFFECT_FORM_LABELS.durationPermanentHint;
      case 'rounds':
        return ACTIVE_EFFECT_FORM_LABELS.durationRoundsHint;
      case 'turn':
        return ACTIVE_EFFECT_FORM_LABELS.durationTurnHint;
      case 'special':
        return ACTIVE_EFFECT_FORM_LABELS.durationSpecialHint;
      default:
        return ACTIVE_EFFECT_FORM_LABELS.durationDefaultHint;
    }
  });

  const effectTargetDescription = computed(() =>
    form.effectTarget === 'target'
      ? ACTIVE_EFFECT_FORM_LABELS.effectTargetOnTargetHint
      : ACTIVE_EFFECT_FORM_LABELS.effectTargetOnSelfHint,
  );

  const isAura = computed({
    get: () => !!form.aura,
    set: (val) => {
      if (val) {
        form.aura = {
          radius: 10,
          target: 'allies',
          applyToSelf: true,
          visible: true,
        };

        // Аура и effectTarget: 'target' взаимоисключающие
        form.effectTarget = 'self';
      } else {
        delete form.aura;
      }
    },
  });

  // «Цель эффекта» доступна всегда (кроме режима ауры) — единый редактор для
  // само-баффов и эффектов на цель при попадании. Проп `showEffectTarget`
  // оставлен для обратной совместимости вызывающих.
  const showEffectTargetField = computed(() => !isAura.value);

  const systemDataStore = useSystemDataStore();

  /** Опции типа урона (для DamagePartsEditor) */
  const damageTypeOptions = computed(() =>
    systemDataStore.damageTypes.map((damageTypeEntry) => ({
      label: damageTypeEntry.name,
      value: damageTypeEntry.key,
    })),
  );

  /** Эффект успешного спасброска наложения */
  const onSuccessOptions: Array<{ value: EffectSaveOutcome; label: string }> = [
    { value: 'negate', label: ACTIVE_EFFECT_FORM_LABELS.onSuccessNegate },
    { value: 'half', label: ACTIVE_EFFECT_FORM_LABELS.onSuccessHalf },
  ];

  /** Момент периодического спасброска / урона */
  const recurringTimingOptions: Array<{
    value: EffectSaveTiming;
    label: string;
  }> = [
    { value: 'endOfTurn', label: ACTIVE_EFFECT_FORM_LABELS.timingEndOfTurn },
    {
      value: 'startOfTurn',
      label: ACTIVE_EFFECT_FORM_LABELS.timingStartOfTurn,
    },
  ];

  /** Опции триггера области (При входе / При выходе / Пока внутри) */
  const areaTriggerOptions = Object.entries(AREA_TRIGGER_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  /** Триггер срабатывания эффекта области (по умолчанию «Пока внутри») */
  const areaTriggerModel = computed<AreaEffectTrigger>({
    get: () => form.areaTrigger ?? 'stay',
    set: (trigger) => {
      // `stay` — поведение по умолчанию, поле не храним для чистоты данных
      form.areaTrigger = trigger === 'stay' ? undefined : trigger;
    },
  });

  /** Подсказка под выбором триггера области/ауры */
  const areaTriggerDescription = computed(() => {
    switch (areaTriggerModel.value) {
      case 'enter':
        return ACTIVE_EFFECT_FORM_LABELS.areaTriggerEnterHint;
      case 'exit':
        return ACTIVE_EFFECT_FORM_LABELS.areaTriggerExitHint;
      default:
        return ACTIVE_EFFECT_FORM_LABELS.areaTriggerStayHint;
    }
  });

  /** Спасбросок при наложении эффекта (при попадании атакой) */
  const hasApplySave = computed({
    get: () => form.applySave !== undefined,
    set: (enabled) => {
      form.applySave = enabled
        ? { ability: 'wisdom', dc: 13, onSuccess: 'negate' }
        : undefined;
    },
  });

  const applySaveAbility = computed<AbilityType>({
    get: () => form.applySave?.ability ?? 'wisdom',
    set: (ability) => {
      if (form.applySave) {
        form.applySave.ability = ability;
      }
    },
  });

  const applySaveDc = computed<number>({
    get: () => form.applySave?.dc ?? 13,
    set: (dc) => {
      if (form.applySave) {
        form.applySave.dc = dc;
      }
    },
  });

  const applySaveOnSuccess = computed<EffectSaveOutcome>({
    get: () => form.applySave?.onSuccess ?? 'negate',
    set: (onSuccess) => {
      if (form.applySave) {
        form.applySave.onSuccess = onSuccess;
      }
    },
  });

  /** Накладывать эффект-состояние даже при успешном спасброске */
  const applyOnSuccess = computed({
    get: () => form.applyOnSuccess === true,
    set: (value) => {
      form.applyOnSuccess = value ? true : undefined;
    },
  });

  /** Урон, наносимый при наложении эффекта (v-model для DamagePartsEditor) */
  const damagePartsModel = computed<DamagePart[]>({
    get: () => form.damageParts ?? [],
    set: (parts) => {
      form.damageParts = parts.length > 0 ? parts : undefined;
    },
  });

  /** Периодический спасбросок для снятия эффекта */
  const hasRecurringSave = computed({
    get: () => form.recurringSave !== undefined,
    set: (enabled) => {
      form.recurringSave = enabled
        ? {
            ability: form.applySave?.ability ?? 'wisdom',
            dc: form.applySave?.dc ?? 13,
            timing: 'endOfTurn',
          }
        : undefined;
    },
  });

  const recurringAbility = computed<AbilityType>({
    get: () => form.recurringSave?.ability ?? 'wisdom',
    set: (ability) => {
      if (form.recurringSave) {
        form.recurringSave.ability = ability;
      }
    },
  });

  const recurringDc = computed<number>({
    get: () => form.recurringSave?.dc ?? 13,
    set: (dc) => {
      if (form.recurringSave) {
        form.recurringSave.dc = dc;
      }
    },
  });

  const recurringTiming = computed<EffectSaveTiming>({
    get: () => form.recurringSave?.timing ?? 'endOfTurn',
    set: (timing) => {
      if (form.recurringSave) {
        form.recurringSave.timing = timing;
      }
    },
  });

  /** Периодический урон (DoT) — наносится каждый ход, пока эффект активен */
  const hasRecurringDamage = computed({
    get: () => form.recurringDamage !== undefined,
    set: (enabled) => {
      form.recurringDamage = enabled
        ? { damageParts: [], timing: 'startOfTurn' }
        : undefined;
    },
  });

  /** Части периодического урона (v-model для DamagePartsEditor) */
  const recurringDamageModel = computed<DamagePart[]>({
    get: () => form.recurringDamage?.damageParts ?? [],
    set: (parts) => {
      if (form.recurringDamage) {
        form.recurringDamage.damageParts = parts;
      }
    },
  });

  const recurringDamageTiming = computed<EffectSaveTiming>({
    get: () => form.recurringDamage?.timing ?? 'startOfTurn',
    set: (timing) => {
      if (form.recurringDamage) {
        form.recurringDamage.timing = timing;
      }
    },
  });
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="true"
    :resizable="true"
    :blocking="false"
    :initial-width="900"
    :min-width="600"
    :min-height="400"
    :z-index="props.zIndex"
    :title="
      effect
        ? `${ACTIVE_EFFECT_FORM_LABELS.editTitlePrefix}${effect.name}`
        : ACTIVE_EFFECT_FORM_LABELS.createTitle
    "
    :saved-position="savedPosition"
    :saved-size="savedSize"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col gap-4 px-1 pb-1">
        <UTabs
          :items="tabItems"
          variant="pill"
          class="flex min-h-0 flex-1 flex-col"
          :ui="{
            list: 'mb-3',
            trigger: 'flex-1 justify-center',
            content: 'min-h-0 overflow-y-auto',
          }"
        >
          <!-- Вкладка «Основное» -->
          <template #general>
            <div class="space-y-4">
              <!-- Кнопка «Шаблон состояния» -->
              <div class="flex items-center gap-2">
                <UDropdownMenu
                  :items="conditionPresetItems"
                  :ui="{ content: 'max-h-75 overflow-y-auto' }"
                >
                  <UButton
                    icon="tabler:template"
                    :label="ACTIVE_EFFECT_FORM_LABELS.conditionPreset"
                    color="neutral"
                    variant="outline"
                    size="xs"
                  />
                </UDropdownMenu>

                <span class="text-xs text-dimmed italic">
                  {{ ACTIVE_EFFECT_FORM_LABELS.conditionPresetHint }}
                </span>
              </div>

              <!-- Базовые данные -->
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <UFormField
                  :label="FORM_FIELD_LABELS.name"
                  class="sm:col-span-4"
                >
                  <UInput
                    v-model="form.name"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="ACTIVE_EFFECT_FORM_LABELS.icon"
                  class="sm:col-span-4"
                >
                  <UInput
                    v-model="form.icon"
                    class="w-full"
                    :placeholder="ACTIVE_EFFECT_FORM_LABELS.iconPlaceholder"
                  />
                </UFormField>

                <UFormField
                  v-if="!props.hideAura && form.effectTarget !== 'target'"
                  :label="ACTIVE_EFFECT_FORM_LABELS.aura"
                  class="sm:col-span-2"
                >
                  <div
                    class="flex h-full min-h-8 cursor-pointer items-center justify-between rounded-md border border-default/50 bg-elevated/50 px-3 py-1"
                    @click.left.exact.prevent="isAura = !isAura"
                  >
                    <span
                      class="text-xs font-medium transition-colors"
                      :class="isAura ? 'text-magic' : 'text-muted'"
                    >
                      {{
                        isAura
                          ? ACTIVE_EFFECT_FORM_LABELS.auraOn
                          : ACTIVE_EFFECT_FORM_LABELS.auraOff
                      }}
                    </span>

                    <USwitch
                      v-model="isAura"
                      size="sm"
                      color="primary"
                      @click.stop
                    />
                  </div>
                </UFormField>

                <UFormField
                  :label="ACTIVE_EFFECT_FORM_LABELS.status"
                  class="sm:col-span-2"
                >
                  <div
                    class="flex h-full min-h-8 cursor-pointer items-center justify-between rounded-md border border-default/50 bg-elevated/50 px-3 py-1"
                    @click.left.exact.prevent="isActive = !isActive"
                  >
                    <span
                      class="text-xs font-medium transition-colors"
                      :class="isActive ? 'text-success' : 'text-muted'"
                    >
                      {{
                        isActive
                          ? ACTIVE_EFFECT_FORM_LABELS.statusActive
                          : ACTIVE_EFFECT_FORM_LABELS.statusDisabled
                      }}
                    </span>

                    <USwitch
                      v-model="isActive"
                      size="sm"
                      @click.stop
                    />
                  </div>
                </UFormField>
              </div>

              <!-- Описание + авто-генерация -->
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium text-muted">
                    {{ FORM_FIELD_LABELS.description }}
                  </span>

                  <UButton
                    icon="tabler:wand"
                    :label="ACTIVE_EFFECT_FORM_LABELS.generateDescription"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    :disabled="!generatedDescription"
                    :title="ACTIVE_EFFECT_FORM_LABELS.generateDescriptionHint"
                    @click.left.exact.prevent="applyGeneratedDescription"
                  />
                </div>

                <UTextarea
                  v-model="form.description"
                  :rows="2"
                  autoresize
                  class="w-full"
                  :placeholder="
                    ACTIVE_EFFECT_FORM_LABELS.descriptionPlaceholder
                  "
                />
              </div>

              <!-- Цель эффекта + Длительность (одной компактной строкой) -->
              <div
                class="flex flex-wrap items-start gap-x-8 gap-y-4 rounded-lg border border-muted bg-elevated/30 px-4 py-3"
              >
                <!-- Цель эффекта: сегментированный переключатель -->
                <div
                  v-if="showEffectTargetField"
                  class="flex flex-col gap-1.5"
                >
                  <span
                    class="flex items-center gap-1 text-xs font-medium text-muted"
                  >
                    {{ ACTIVE_EFFECT_FORM_LABELS.effectTarget }}

                    <UTooltip :text="effectTargetDescription">
                      <UIcon
                        name="tabler:info-circle"
                        class="size-3.5 text-dimmed transition-colors hover:text-default"
                      />
                    </UTooltip>
                  </span>

                  <UTabs
                    :model-value="form.effectTarget"
                    :items="effectTargetTabs"
                    :content="false"
                    size="xs"
                    color="primary"
                    class="w-fit"
                    @update:model-value="handleEffectTargetChange"
                  />
                </div>

                <!-- Снять эффект: сегменты (одноразовость «следующей атаки») -->
                <div class="flex flex-col gap-1.5">
                  <span
                    class="flex items-center gap-1 text-xs font-medium text-muted"
                  >
                    {{ ACTIVE_EFFECT_FORM_LABELS.consumeOn }}

                    <UTooltip :text="ACTIVE_EFFECT_FORM_LABELS.consumeOnHint">
                      <UIcon
                        name="tabler:info-circle"
                        class="size-3.5 text-dimmed transition-colors hover:text-default"
                      />
                    </UTooltip>
                  </span>

                  <UTabs
                    :model-value="form.consumeOn ?? 'none'"
                    :items="consumeOnTabs"
                    :content="false"
                    size="xs"
                    color="primary"
                    class="w-fit"
                    @update:model-value="handleConsumeOnChange"
                  />
                </div>

                <!-- Тип длительности: селект + инлайн-количество -->
                <div class="flex min-w-65 flex-1 flex-col gap-1.5">
                  <span
                    class="flex items-center gap-1 text-xs font-medium text-muted"
                  >
                    {{ ACTIVE_EFFECT_FORM_LABELS.durationType }}

                    <UTooltip :text="durationDescription">
                      <UIcon
                        name="tabler:info-circle"
                        class="size-3.5 text-dimmed transition-colors hover:text-default"
                      />
                    </UTooltip>
                  </span>

                  <div class="flex items-center gap-2">
                    <USelect
                      v-model="form.duration.type"
                      :items="durationTypes"
                      value-key="value"
                      class="flex-1"
                      :portal="false"
                    />

                    <UInput
                      v-if="hasDurationValue"
                      v-model="form.duration.value"
                      type="number"
                      :placeholder="
                        ACTIVE_EFFECT_FORM_LABELS.durationValuePlaceholder
                      "
                      class="w-28 shrink-0"
                    />
                  </div>

                  <!-- Точная «ходовая» длительность: момент + чей ход -->
                  <div
                    v-if="isTurnDuration"
                    class="flex items-center gap-2"
                  >
                    <USelect
                      v-model="turnTimingValue"
                      :items="turnTimingOptions"
                      value-key="value"
                      class="flex-1"
                      :portal="false"
                    />

                    <USelect
                      v-model="turnAnchorValue"
                      :items="turnAnchorOptions"
                      value-key="value"
                      class="flex-1"
                      :portal="false"
                    />
                  </div>
                </div>
              </div>

              <!-- Аура -->
              <div
                v-if="!props.hideAura && isAura && form.aura"
                class="mb-4"
              >
                <div
                  class="grid grid-cols-1 items-end gap-4 rounded-lg border border-magic-border/50 bg-magic-subtle/20 p-2 px-3 sm:grid-cols-12"
                >
                  <UFormField
                    :label="ACTIVE_EFFECT_FORM_LABELS.auraRadius"
                    class="sm:col-span-2"
                  >
                    <UInput
                      v-model="form.aura.radius"
                      type="number"
                      min="0"
                      step="5"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField
                    :label="ACTIVE_EFFECT_FORM_LABELS.auraTarget"
                    class="sm:col-span-4"
                  >
                    <USelect
                      v-model="form.aura.target"
                      :items="auraTargetOptions"
                      value-key="value"
                      class="w-full"
                      :portal="false"
                    />
                  </UFormField>

                  <div
                    class="flex h-8 items-center justify-start gap-4 pb-1 pl-2 sm:col-span-6"
                  >
                    <UCheckbox
                      v-model="form.aura.applyToSelf"
                      :label="ACTIVE_EFFECT_FORM_LABELS.auraApplyToSelf"
                    />

                    <UCheckbox
                      v-model="form.aura.visible"
                      :label="ACTIVE_EFFECT_FORM_LABELS.auraVisible"
                    />
                  </div>
                </div>
              </div>

              <!-- Флаги (нечисловые эффекты) -->
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium">
                    {{ ACTIVE_EFFECT_FORM_LABELS.flagsTitle }}
                  </span>

                  <UButton
                    color="primary"
                    variant="ghost"
                    size="xs"
                    icon="tabler:plus"
                    @click.left.exact.prevent="addFlag"
                  >
                    {{ MODAL_BUTTON_LABELS.add }}
                  </UButton>
                </div>

                <div
                  v-if="form.flags.length === 0"
                  class="rounded-lg border border-dashed border-default p-4 text-center text-xs text-dimmed italic"
                >
                  {{ ACTIVE_EFFECT_FORM_LABELS.flagsEmpty }}
                </div>

                <div
                  v-else
                  class="space-y-4 pb-4"
                >
                  <div
                    v-for="(_flag, idx) in form.flags"
                    :key="idx"
                    class="flex flex-col gap-2 rounded-lg border border-default bg-elevated/50 p-3"
                  >
                    <UFormField>
                      <div class="flex w-full items-center gap-2">
                        <!-- Флаг выбирается только из библиотеки: движок знает
                             закрытый набор, а произвольная строка молча не
                             работала бы и отбрасывалась при разборе -->
                        <UButton
                          color="neutral"
                          variant="soft"
                          size="sm"
                          icon="tabler:flag"
                          class="flex-1 justify-start font-mono text-xs"
                          @click.left.exact.prevent="openFlagModal(idx)"
                        >
                          {{
                            form.flags[idx]
                            || ACTIVE_EFFECT_FORM_LABELS.flagPlaceholder
                          }}
                        </UButton>

                        <UButton
                          color="error"
                          variant="soft"
                          icon="tabler:trash"
                          size="sm"
                          :title="ACTIVE_EFFECT_FORM_LABELS.flagRemove"
                          @click.left.exact.prevent="removeFlag(idx)"
                        />
                      </div>
                    </UFormField>

                    <div class="text-xs text-muted italic">
                      {{ EFFECT_FLAG_LABELS[form.flags[idx]] }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Список изменений -->
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium">
                    {{ ACTIVE_EFFECT_FORM_LABELS.changesTitle }}
                  </span>

                  <UButton
                    color="primary"
                    variant="ghost"
                    size="xs"
                    icon="tabler:plus"
                    @click.left.exact.prevent="addChange"
                  >
                    {{ MODAL_BUTTON_LABELS.add }}
                  </UButton>
                </div>

                <div
                  v-if="form.changes.length === 0"
                  class="rounded-lg border border-dashed border-default p-4 text-center text-xs text-dimmed italic"
                >
                  {{ ACTIVE_EFFECT_FORM_LABELS.changesEmpty }}
                </div>

                <div
                  v-else
                  class="space-y-2 pb-4"
                >
                  <div
                    v-for="(change, idx) in form.changes"
                    :key="idx"
                    class="grid grid-cols-1 items-end gap-2 rounded-lg border border-default bg-elevated/50 p-2 px-3 sm:grid-cols-[200px_140px_1.5fr_2.5fr_70px_auto]"
                  >
                    <UFormField :label="ACTIVE_EFFECT_FORM_LABELS.changeKey">
                      <div class="flex w-full gap-1">
                        <UInput
                          v-model="change.key"
                          :placeholder="
                            ACTIVE_EFFECT_FORM_LABELS.changeKeyPlaceholder
                          "
                          size="sm"
                          class="flex-1 font-mono text-xs"
                        />

                        <UButton
                          color="neutral"
                          variant="soft"
                          icon="tabler:target"
                          size="sm"
                          :title="ACTIVE_EFFECT_FORM_LABELS.keyLibrary"
                          @click.left.exact.prevent="openKeyModal(idx)"
                        />
                      </div>
                    </UFormField>

                    <UFormField :label="ACTIVE_EFFECT_FORM_LABELS.changeMode">
                      <USelect
                        v-model="change.mode"
                        :items="modeOptions"
                        value-key="value"
                        size="sm"
                        class="w-full"
                        :portal="false"
                      />
                    </UFormField>

                    <UFormField :label="ACTIVE_EFFECT_FORM_LABELS.changeValue">
                      <div class="flex w-full gap-1">
                        <UInput
                          v-model="change.value"
                          :placeholder="
                            ACTIVE_EFFECT_FORM_LABELS.changeValuePlaceholder
                          "
                          size="sm"
                          class="flex-1 font-mono text-xs"
                        />

                        <UButton
                          color="neutral"
                          variant="soft"
                          icon="tabler:bulb"
                          size="sm"
                          :title="ACTIVE_EFFECT_FORM_LABELS.valueLibrary"
                          @click.left.exact.prevent="openValueModal(idx)"
                        />
                      </div>
                    </UFormField>

                    <UFormField
                      :label="ACTIVE_EFFECT_FORM_LABELS.changeCondition"
                    >
                      <div class="flex w-full gap-1">
                        <UInput
                          v-model="change.condition"
                          :placeholder="
                            ACTIVE_EFFECT_FORM_LABELS.changeConditionPlaceholder
                          "
                          size="sm"
                          class="flex-1 font-mono text-xs"
                        />

                        <UButton
                          color="neutral"
                          variant="soft"
                          icon="tabler:bulb"
                          size="sm"
                          :title="ACTIVE_EFFECT_FORM_LABELS.conditionTemplates"
                          @click.left.exact.prevent="openTemplateModal(idx)"
                        />
                      </div>
                    </UFormField>

                    <UTooltip
                      :text="ACTIVE_EFFECT_FORM_LABELS.changePriorityHint"
                    >
                      <UFormField
                        :label="ACTIVE_EFFECT_FORM_LABELS.changePriority"
                      >
                        <UInput
                          v-model="change.priority"
                          type="number"
                          :placeholder="
                            ACTIVE_EFFECT_FORM_LABELS.changePriorityPlaceholder
                          "
                          size="sm"
                          class="w-full px-1 text-center"
                        />
                      </UFormField>
                    </UTooltip>

                    <div class="flex h-8 items-center justify-end pb-0.5">
                      <UButton
                        color="error"
                        variant="soft"
                        icon="tabler:trash"
                        size="sm"
                        :title="ACTIVE_EFFECT_FORM_LABELS.changeRemove"
                        @click.left.exact.prevent="removeChange(idx)"
                      />
                    </div>

                    <div
                      v-if="String(change.key).startsWith('damage.')"
                      class="text-xs text-muted italic sm:col-span-6"
                    >
                      {{ ACTIVE_EFFECT_FORM_LABELS.damageFormulaHint }}
                    </div>
                  </div>
                </div>

                <!-- Блок с ключами эффектов (целями) удалён согласно UI паттерну -->
              </div>
            </div>
          </template>

          <!-- Вкладка «Дополнительная» -->
          <template #combat>
            <div class="space-y-3">
              <!-- Триггер области/ауры (в редакторе областей или для аур) -->
              <div
                v-if="props.showAreaTrigger || isAura"
                class="rounded-lg border border-muted bg-elevated/30 p-3"
              >
                <UFormField :label="ACTIVE_EFFECT_FORM_LABELS.areaTrigger">
                  <USelect
                    v-model="areaTriggerModel"
                    :items="areaTriggerOptions"
                    value-key="value"
                    class="w-full"
                    :portal="false"
                  />
                </UFormField>

                <p class="mt-1.5 text-xs text-muted">
                  {{ areaTriggerDescription }}
                </p>
              </div>

              <p class="text-xs text-dimmed italic">
                {{ ACTIVE_EFFECT_FORM_LABELS.applyHint }}
              </p>

              <!-- Спасбросок при наложении -->
              <div class="rounded-lg border border-muted bg-elevated/30 p-3">
                <UCheckbox
                  v-model="hasApplySave"
                  :ui="{ label: 'font-medium' }"
                  :label="ACTIVE_EFFECT_FORM_LABELS.applySave"
                />

                <p class="mt-1.5 text-xs text-muted">
                  {{ ACTIVE_EFFECT_FORM_LABELS.applySaveHint }}
                </p>

                <div
                  v-if="hasApplySave"
                  class="mt-3 grid grid-cols-3 gap-3 border-t border-default/40 pt-3"
                >
                  <UFormField :label="FORM_FIELD_LABELS.ability">
                    <USelect
                      v-model="applySaveAbility"
                      :items="ABILITY_OPTIONS"
                      value-key="value"
                      class="w-full"
                      :portal="false"
                    />
                  </UFormField>

                  <UFormField :label="FORM_FIELD_LABELS.saveDc">
                    <UInput
                      v-model.number="applySaveDc"
                      type="number"
                      :min="1"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="FORM_FIELD_LABELS.saveEffect">
                    <USelect
                      v-model="applySaveOnSuccess"
                      :items="onSuccessOptions"
                      value-key="value"
                      class="w-full"
                      :portal="false"
                    />
                  </UFormField>
                </div>

                <div class="mt-3 border-t border-default/40 pt-3">
                  <UCheckbox
                    v-model="applyOnSuccess"
                    :label="ACTIVE_EFFECT_FORM_LABELS.applyOnSuccess"
                  />

                  <p class="mt-1.5 text-xs text-muted">
                    {{ ACTIVE_EFFECT_FORM_LABELS.applyOnSuccessHint }}
                  </p>
                </div>
              </div>

              <!-- Урон при наложении -->
              <div
                class="space-y-2 rounded-lg border border-muted bg-elevated/30 p-3"
              >
                <div class="flex items-center gap-2">
                  <UIcon
                    name="tabler:flame"
                    class="size-4 text-warning"
                  />

                  <span class="text-sm font-medium">
                    {{ ACTIVE_EFFECT_FORM_LABELS.damageTitle }}
                  </span>
                </div>

                <p class="text-xs text-muted">
                  {{ ACTIVE_EFFECT_FORM_LABELS.damageHint }}
                </p>

                <DamagePartsEditor
                  v-model="damagePartsModel"
                  :damage-type-options="damageTypeOptions"
                  :include-spell-modifier="false"
                  :hide-modifiers="true"
                  :hide-healing="true"
                  :hide-conditions="true"
                  :allow-empty="true"
                  :add-label="ACTIVE_EFFECT_FORM_LABELS.addDamage"
                />
              </div>

              <!-- Периодический спасбросок -->
              <div class="rounded-lg border border-muted bg-elevated/30 p-3">
                <UCheckbox
                  v-model="hasRecurringSave"
                  :ui="{ label: 'font-medium' }"
                  :label="ACTIVE_EFFECT_FORM_LABELS.recurringSave"
                />

                <p class="mt-1.5 text-xs text-muted">
                  {{ ACTIVE_EFFECT_FORM_LABELS.recurringSaveHint }}
                </p>

                <div
                  v-if="hasRecurringSave"
                  class="mt-3 grid grid-cols-3 gap-3 border-t border-default/40 pt-3"
                >
                  <UFormField :label="FORM_FIELD_LABELS.ability">
                    <USelect
                      v-model="recurringAbility"
                      :items="ABILITY_OPTIONS"
                      value-key="value"
                      class="w-full"
                      :portal="false"
                    />
                  </UFormField>

                  <UFormField :label="FORM_FIELD_LABELS.saveDc">
                    <UInput
                      v-model.number="recurringDc"
                      type="number"
                      :min="1"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField :label="ACTIVE_EFFECT_FORM_LABELS.recurringWhen">
                    <USelect
                      v-model="recurringTiming"
                      :items="recurringTimingOptions"
                      value-key="value"
                      class="w-full"
                      :portal="false"
                    />
                  </UFormField>
                </div>
              </div>

              <!-- Периодический урон (DoT) -->
              <div class="rounded-lg border border-muted bg-elevated/30 p-3">
                <UCheckbox
                  v-model="hasRecurringDamage"
                  :ui="{ label: 'font-medium' }"
                  :label="ACTIVE_EFFECT_FORM_LABELS.recurringDamage"
                />

                <p class="mt-1.5 text-xs text-muted">
                  {{ ACTIVE_EFFECT_FORM_LABELS.recurringDamageHint }}
                </p>

                <div
                  v-if="hasRecurringDamage"
                  class="mt-3 space-y-3 border-t border-default/40 pt-3"
                >
                  <UFormField
                    :label="ACTIVE_EFFECT_FORM_LABELS.recurringDamageWhen"
                  >
                    <USelect
                      v-model="recurringDamageTiming"
                      :items="recurringTimingOptions"
                      value-key="value"
                      class="w-full"
                      :portal="false"
                    />
                  </UFormField>

                  <DamagePartsEditor
                    v-model="recurringDamageModel"
                    :damage-type-options="damageTypeOptions"
                    :include-spell-modifier="false"
                    :hide-modifiers="true"
                    :hide-healing="true"
                    :hide-conditions="true"
                    :allow-empty="true"
                    :add-label="ACTIVE_EFFECT_FORM_LABELS.addDamage"
                  />
                </div>
              </div>
            </div>
          </template>
        </UTabs>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-3">
        <UButton
          variant="ghost"
          color="neutral"
          @click.left.exact.prevent="handleClose"
          >{{ MODAL_BUTTON_LABELS.cancel }}</UButton
        >

        <UButton
          color="primary"
          :disabled="!form.name.trim()"
          @click.left.exact.prevent="handleSave"
          >{{ MODAL_BUTTON_LABELS.save }}</UButton
        >
      </div>
    </template>
  </UDraggableModal>

  <!-- Библиотека шаблонов условий -->
  <ActiveEffectSuggestionsModal
    v-model:open="isTemplateModalOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.conditionTitle"
    :search-placeholder="
      ACTIVE_EFFECT_TEMPLATES_LABELS.conditionSearchPlaceholder
    "
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.conditionEmpty"
    :items="EFFECT_CONDITION_SUGGESTIONS"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.condition"
    @select="applyConditionTemplate"
  />

  <!-- Библиотека ключей атрибутов -->
  <ActiveEffectSuggestionsModal
    v-model:open="isKeyModalOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.keyTitle"
    :search-placeholder="ACTIVE_EFFECT_TEMPLATES_LABELS.keySearchPlaceholder"
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.keyEmpty"
    :items="EFFECT_TARGET_SUGGESTIONS"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.key"
    @select="applyKeyTemplate"
  />

  <!-- Библиотека флагов -->
  <ActiveEffectSuggestionsModal
    v-model:open="isFlagModalOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.flagTitle"
    :search-placeholder="ACTIVE_EFFECT_TEMPLATES_LABELS.flagSearchPlaceholder"
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.flagEmpty"
    :items="flagSuggestions"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.flag"
    @select="applyFlagTemplate"
  />

  <!-- Библиотека значений и формул -->
  <ActiveEffectSuggestionsModal
    v-model:open="isValueModalOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.valueTitle"
    :search-placeholder="ACTIVE_EFFECT_TEMPLATES_LABELS.valueSearchPlaceholder"
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.valueEmpty"
    :items="EFFECT_VALUE_SUGGESTIONS"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.value"
    @select="applyValueTemplate"
  />
</template>
