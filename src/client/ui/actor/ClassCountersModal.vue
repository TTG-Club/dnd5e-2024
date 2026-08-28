<script setup lang="ts">
  import type {
    ActorCounterState,
    ClassCounterDefinition,
    CounterRecoveryRule,
    DnDActor,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    buildCounterFormulaContext,
    COUNTER_COUNT_MIN,
    COUNTER_RECOVERY_AMOUNT_MIN,
    getCounterRecoveryRules,
    normalizeCounterRecoveryRule,
    resolveCounterMaxIn,
  } from '@vtt/shared/system/dnd.js';

  import {
    CLASS_COUNTERS_LABELS,
    CLASS_COUNTERS_MODAL_LABELS,
    FORM_FIELD_LABELS,
    MODAL_BUTTON_LABELS,
    SHEET_COUNTER_DEFAULTS,
  } from './constants';
  import CounterMaxField from './CounterMaxField.vue';
  import CounterRecoveryFields from './CounterRecoveryFields.vue';
  import {
    counterIdentity,
    findCounterDefinition,
  } from './utils/classCounters';

  interface Props {
    open: boolean;
    counters: ActorCounterState[];
    counterDefinitions: ClassCounterDefinition[];
    /** Лист персонажа: по нему считается максимум ресурса с формулой */
    actor: DnDActor;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [counters: ActorCounterState[]];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Счётчик в форме: правила отдыха разложены всегда, даже у записи с одним
   * легаси-словом. Иначе каждое поле формы носило бы свой запасной вариант.
   */
  type CounterDraft = ActorCounterState & {
    shortRest: CounterRecoveryRule;
    longRest: CounterRecoveryRule;
  };

  const localCounters = ref<CounterDraft[]>([]);

  /** Контекст формул листа: собирается один раз на весь список счётчиков. */
  const formulaContext = computed(() =>
    buildCounterFormulaContext(props.actor),
  );

  // Ресурс без обеих подписей стал бы на листе пустой строкой
  const hasInvalidCounters = computed(() => {
    return localCounters.value.some(
      (counter) =>
        !resolveCounterName(counter) || !resolveCounterShortName(counter),
    );
  });

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        localCounters.value = props.counters.map(toCounterDraft);
      }
    },
  );

  /**
   * Копия счётчика для формы с разложенным восстановлением.
   *
   * Правила отдыха достаются из легаси-поля `recovery` сразу, а не при
   * сохранении: иначе форма открывала бы старый счётчик с пустыми плитками
   * отдыха, и игрок читал бы «ничего не возвращается» там, где отдых работает.
   *
   * @param counter - счётчик листа
   */
  function toCounterDraft(counter: ActorCounterState): CounterDraft {
    const rules = getCounterRecoveryRules(counter);

    return {
      ...counter,
      shortRest: { ...rules.shortRest },
      longRest: { ...rules.longRest },
    };
  }

  function resolveCounterName(counter: ActorCounterState): string {
    return (
      counter.name?.trim()
      || findCounterDefinition(counter, props.counterDefinitions)?.name
      || ''
    );
  }

  function resolveCounterShortName(counter: ActorCounterState): string {
    return (
      counter.shortName?.trim()
      || findCounterDefinition(counter, props.counterDefinitions)?.shortName
      || ''
    );
  }

  /**
   * Посчитанный максимум счётчика: с формулой он считается от листа и меняется
   * прямо в форме, когда игрок правит источник.
   *
   * @param counter - счётчик формы
   */
  function counterMax(counter: ActorCounterState): number {
    return resolveCounterMaxIn(formulaContext.value, counter);
  }

  function toTextInputValue(value: string | number): string {
    return String(value);
  }

  function updateCounter(
    targetCounter: CounterDraft,
    updates: Partial<CounterDraft>,
  ): void {
    const targetCounterId = counterIdentity(targetCounter);

    localCounters.value = localCounters.value.map((counter) =>
      counterIdentity(counter) === targetCounterId
        ? { ...counter, ...updates }
        : counter,
    );
  }

  function updateCounterName(
    counter: CounterDraft,
    value: string | number,
  ): void {
    updateCounter(counter, { name: toTextInputValue(value) });
  }

  function updateCounterShortName(
    counter: CounterDraft,
    value: string | number,
  ): void {
    updateCounter(counter, { shortName: toTextInputValue(value) });
  }

  /**
   * Записывает правило короткого отдыха.
   *
   * @param counter - счётчик формы
   * @param shortRest - что возвращает короткий отдых
   */
  function updateCounterShortRest(
    counter: CounterDraft,
    shortRest: CounterRecoveryRule,
  ): void {
    updateCounter(counter, { shortRest });
  }

  /**
   * Записывает правило продолжительного отдыха.
   *
   * @param counter - счётчик формы
   * @param longRest - что возвращает продолжительный отдых
   */
  function updateCounterLongRest(
    counter: CounterDraft,
    longRest: CounterRecoveryRule,
  ): void {
    updateCounter(counter, { longRest });
  }

  /**
   * Записывает формулу максимума, приводя остаток.
   *
   * Полный ресурс остаётся полным: новый заводится полным и обязан таким и
   * сохраниться, когда игрок выберет источник максимума, — поля остатка в форме
   * нет. Начатый ресурс сохраняет потраченное: смена настройки не восполняет
   * заряды. Снижение максимума остаток подрезает — иначе осталось бы «3/2».
   *
   * @param counter - счётчик формы
   * @param maxFormula - формула максимума
   */
  function updateCounterMaxFormula(
    counter: CounterDraft,
    maxFormula: string,
  ): void {
    const wasFull = counter.current >= counterMax(counter);
    const max = counterMax({ ...counter, maxFormula });

    updateCounter(counter, {
      maxFormula,
      max,
      current: wasFull ? max : Math.min(counter.current, max),
    });
  }

  /**
   * Записывает нижнюю граница максимума, приводя остаток.
   *
   * Граница поднимает максимум так же, как это делает формула, поэтому остаток
   * подрезается по тому же правилу: полный ресурс остаётся полным, начатый
   * сохраняет потраченное.
   *
   * @param counter - счётчик формы
   * @param minimum - нижняя граница максимума; 0 — границы нет
   */
  function updateCounterMinimum(counter: CounterDraft, minimum: number): void {
    const wasFull = counter.current >= counterMax(counter);
    const max = counterMax({ ...counter, min: minimum });

    updateCounter(counter, {
      min: minimum,
      max,
      current: wasFull ? max : Math.min(counter.current, max),
    });
  }

  function createCustomCounterKey(): string {
    const existingKeys = new Set(
      localCounters.value.map((counter) => counter.counterKey),
    );

    let counterIndex = localCounters.value.length + 1;
    let counterKey = `custom-counter-${counterIndex}`;

    while (existingKeys.has(counterKey)) {
      counterIndex += 1;
      counterKey = `custom-counter-${counterIndex}`;
    }

    return counterKey;
  }

  function addCounter(): void {
    localCounters.value = [
      ...localCounters.value,
      {
        counterKey: createCustomCounterKey(),
        classKey: 'custom',
        name: SHEET_COUNTER_DEFAULTS.name,
        shortName: SHEET_COUNTER_DEFAULTS.shortName,
        // Новый ресурс — своё число: правило заводится, только если игрок сам
        // выберет источник. Восстановление по умолчанию продолжительным
        // целиком: так работает большинство счётчиков
        maxFormula: '1',
        shortRest: { mode: 'none', amount: COUNTER_RECOVERY_AMOUNT_MIN },
        longRest: { mode: 'all', amount: COUNTER_RECOVERY_AMOUNT_MIN },
        current: 1,
        max: 1,
      },
    ];
  }

  function removeCounter(targetCounter: CounterDraft): void {
    const targetCounterId = counterIdentity(targetCounter);

    localCounters.value = localCounters.value.filter(
      (counter) => counterIdentity(counter) !== targetCounterId,
    );
  }

  /**
   * Счётчик к сохранению: подписи достроены, максимум пересчитан, число зарядов
   * в правилах отдыха приведено к его границам.
   *
   * Легаси-поле `recovery` снимается: правила отдыха теперь заданы явно, и
   * оставленное слово читалось бы вместо них на листах, где правила пустые.
   *
   * @param counter - счётчик формы
   */
  function normalizeCounter(counter: CounterDraft): ActorCounterState {
    const max = counterMax(counter);

    return {
      ...counter,
      recovery: undefined,
      name: resolveCounterName(counter),
      shortName: resolveCounterShortName(counter),
      shortRest: normalizeCounterRecoveryRule(counter.shortRest, max),
      longRest: normalizeCounterRecoveryRule(counter.longRest, max),
      current: Math.min(Math.max(0, counter.current), max),
      max,
    };
  }

  function applyCounters(): void {
    emit('apply', localCounters.value.map(normalizeCounter));
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="620"
    :min-height="420"
    :title="CLASS_COUNTERS_MODAL_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted">
            {{ localCounters.length }}
            {{ CLASS_COUNTERS_MODAL_LABELS.countUnit }}
          </span>

          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="tabler:plus"
            @click.left.exact.prevent="addCounter"
          >
            {{ MODAL_BUTTON_LABELS.add }}
          </UButton>
        </div>

        <div
          v-if="localCounters.length === 0"
          class="rounded-lg border border-dashed border-muted p-4 text-center text-sm text-dimmed"
        >
          {{ CLASS_COUNTERS_MODAL_LABELS.empty }}
        </div>

        <div class="flex max-h-115 flex-col gap-2 overflow-y-auto pr-1">
          <div
            v-for="counter in localCounters"
            :key="counterIdentity(counter)"
            class="relative rounded-lg border border-default/50 bg-elevated/20 p-4 transition-all duration-200 hover:border-primary/30 hover:bg-elevated/30"
          >
            <!-- Кнопка удаления в правом верхнем углу -->
            <div class="absolute top-4 right-4 z-10">
              <UTooltip
                :delay-duration="300"
                :text="CLASS_COUNTERS_LABELS.removeCounter"
              >
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="tabler:trash"
                  class="rounded opacity-60 transition-all duration-200 hover:bg-error/10 hover:opacity-100"
                  @click.left.exact.prevent="removeCounter(counter)"
                />
              </UTooltip>
            </div>

            <!-- Контентная часть карточки с отступом справа под кнопку -->
            <div class="flex flex-col gap-3 pr-8">
              <!-- Первый ряд: Название и Краткое имя -->
              <div class="grid grid-cols-[1fr_6rem] gap-3">
                <label class="flex flex-col gap-1">
                  <span
                    class="text-[10px] font-bold tracking-wider text-toned/80 uppercase"
                  >
                    {{ FORM_FIELD_LABELS.name }}
                  </span>

                  <UInput
                    :model-value="resolveCounterName(counter)"
                    size="sm"
                    class="w-full"
                    :placeholder="CLASS_COUNTERS_MODAL_LABELS.namePlaceholder"
                    @update:model-value="updateCounterName(counter, $event)"
                  />
                </label>

                <label class="flex flex-col gap-1">
                  <span
                    class="text-[10px] font-bold tracking-wider text-toned/80 uppercase"
                  >
                    {{ CLASS_COUNTERS_MODAL_LABELS.shortName }}
                  </span>

                  <UInput
                    :model-value="resolveCounterShortName(counter)"
                    size="sm"
                    :placeholder="
                      CLASS_COUNTERS_MODAL_LABELS.shortNamePlaceholder
                    "
                    class="w-full"
                    @update:model-value="
                      updateCounterShortName(counter, $event)
                    "
                  />
                </label>
              </div>

              <!-- Второй ряд: от чего считается максимум. Остатка здесь нет:
                новый ресурс заводится полным, а тратят его кнопками на листе -->
              <CounterMaxField
                :model-value="counter.maxFormula ?? String(counter.max)"
                :minimum="counter.min ?? COUNTER_COUNT_MIN"
                :computed-max="counterMax(counter)"
                @update:model-value="updateCounterMaxFormula(counter, $event)"
                @update:minimum="updateCounterMinimum(counter, $event)"
              />

              <CounterRecoveryFields
                :short-rest="counter.shortRest"
                :long-rest="counter.longRest"
                @update:short-rest="updateCounterShortRest(counter, $event)"
                @update:long-rest="updateCounterLongRest(counter, $event)"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click.left.exact.prevent="isOpen = false"
        >
          {{ MODAL_BUTTON_LABELS.cancel }}
        </UButton>

        <UButton
          color="primary"
          :disabled="hasInvalidCounters"
          @click.left.exact.prevent="applyCounters"
        >
          {{ MODAL_BUTTON_LABELS.save }}
        </UButton>
      </div>
    </template>
  </UDraggableModal>
</template>
