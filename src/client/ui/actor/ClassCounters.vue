<!--
  Компонент отображения счётчиков классовых ресурсов (очки чародейства,
  кости превосходства, очки духа, ярость и т.д.).

  Показывает для каждого счётчика:
  - Иконку и название
  - Текущее / максимальное значение
  - Кнопки +/- для ручного управления
  - Тип восстановления (короткий / продолжительный отдых)
-->
<script setup lang="ts">
  import type {
    ActorCounterState,
    ClassCounterDefinition,
    CounterRestKey,
    DnDActor,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';
  import {
    buildCounterFormulaContext,
    COUNTER_REST_KEYS,
    getCounterRecoveryRules,
    resolveCounterMaxIn,
  } from '@vtt/shared/system/dnd.js';

  import ClassCountersModal from './ClassCountersModal.vue';
  import {
    CLASS_COUNTERS_BLOCK_LABELS,
    COUNTER_RESOURCE_LABELS,
    COUNTER_REST_FIELDS,
  } from './constants';
  import SheetSettingsGear from './SheetSettingsGear.vue';
  import {
    counterIdentity,
    findCounterDefinition,
    isSameCounter,
  } from './utils/classCounters';
  import { getSheetBlockClass } from './utils/sheetBlockClass';

  defineOptions({ inheritAttrs: false });

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
  }>();

  const isSettingsOpen = ref(false);

  interface Props {
    actor: DnDActor;
    /** Определения счётчиков из компендиума (для получения name, icon, recovery) */
    counterDefinitions: ClassCounterDefinition[];
    isEditMode: boolean;
  }

  /** Оформление блока: настройка живёт в шестерёнке, сам блок не нажимается */
  const blockClass = computed(() =>
    getSheetBlockClass({ isEditMode: props.isEditMode }),
  );

  // ── Состояния счётчиков ────────────────────────────────────────

  const counters = computed<ActorCounterState[]>(() => {
    return props.actor.system.classCounters ?? [];
  });

  /**
   * Подписи счётчика: своё название главнее определения компендиума.
   *
   * Восстановление сюда не входит — оно показано пометками отдыха
   * ({@link recoveryBadges}), а не одним значком по слову из определения.
   */
  function getDisplayDefinition(
    counter: ActorCounterState,
    baseDef: ReturnType<typeof findCounterDefinition>,
  ) {
    if (baseDef) {
      return {
        ...baseDef,
        ...counter,
      };
    }

    if (counter.name?.trim()) {
      return { name: counter.name, shortName: counter.shortName };
    }

    return undefined;
  }

  /** Контекст формул листа: собирается один раз на весь список счётчиков. */
  const formulaContext = computed(() =>
    buildCounterFormulaContext(props.actor),
  );

  /** Пометка восстановления в строке ресурса. */
  interface RecoveryBadge {
    key: CounterRestKey;
    icon: string;
    /** Подсказка целиком: «Короткий отдых: 1» */
    hint: string;
    /** Подпись рядом со значком: «все» либо число зарядов */
    text: string;
  }

  /**
   * Пометки восстановления: по одной на вид отдыха, который возвращает заряды.
   * Пусто — ресурс отдыхом не восстанавливается, и значка у него нет.
   *
   * @param counter - состояние счётчика
   * @returns пометки в порядке «короткий, продолжительный»
   */
  function recoveryBadges(counter: ActorCounterState): RecoveryBadge[] {
    const rules = getCounterRecoveryRules(counter);

    return COUNTER_REST_KEYS.filter((key) => rules[key].mode !== 'none').map(
      (key) => {
        const amount =
          rules[key].mode === 'all'
            ? COUNTER_RESOURCE_LABELS.allShort
            : String(rules[key].amount);

        return {
          key,
          icon: COUNTER_REST_FIELDS[key].icon,
          hint: `${COUNTER_REST_FIELDS[key].label}: ${amount}`,
          text: amount,
        };
      },
    );
  }

  const displayCounters = computed(() => {
    return counters.value.map((counter) => ({
      counter,
      // Максимум считается при чтении: с формулой он растёт вместе с бонусом
      // мастерства и характеристиками, а записанное число — снимок расчёта
      max: resolveCounterMaxIn(formulaContext.value, counter),
      badges: recoveryBadges(counter),
      definition: getDisplayDefinition(
        counter,
        findCounterDefinition(counter, props.counterDefinitions),
      ),
    }));
  });

  // ── Вспомогательные функции ────────────────────────────────────

  /**
   * Увеличить текущее значение счётчика.
   *
   * @param counter - состояние счётчика
   * @param max - посчитанный максимум (записанный мог отстать от листа)
   */
  function incrementCounter(counter: ActorCounterState, max: number): void {
    if (counter.current >= max) {
      return;
    }

    const updatedCounters = counters.value.map((entry) =>
      isSameCounter(entry, counter)
        ? { ...entry, current: entry.current + 1 }
        : entry,
    );

    emit('update:actor', {
      system: {
        ...props.actor.system,
        classCounters: updatedCounters,
      },
    });
  }

  /** Уменьшить текущее значение счётчика */
  function decrementCounter(counter: ActorCounterState): void {
    if (counter.current <= 0) {
      return;
    }

    const updatedCounters = counters.value.map((entry) =>
      isSameCounter(entry, counter)
        ? { ...entry, current: entry.current - 1 }
        : entry,
    );

    emit('update:actor', {
      system: {
        ...props.actor.system,
        classCounters: updatedCounters,
      },
    });
  }

  /** Применить список счётчиков из модалки настройки */
  function applyCounters(updatedCounters: ActorCounterState[]): void {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        classCounters: updatedCounters,
      },
    });
  }
</script>

<template>
  <FieldsetLabel
    :label="CLASS_COUNTERS_BLOCK_LABELS.title"
    class="class-counters-fieldset w-full max-w-full bg-default/20 transition-colors"
    :class="blockClass"
  >
    <!-- Шестерёнка стоит в подписи рамки, как у прочих блоков листа: в углу
      содержимого она читалась бы как кнопка первого счётчика -->
    <template
      v-if="isEditMode"
      #actions
    >
      <SheetSettingsGear
        :label="CLASS_COUNTERS_BLOCK_LABELS.settings"
        @open="isSettingsOpen = true"
      />
    </template>

    <div class="flex max-w-full min-w-0 flex-col gap-1 px-2 pb-2">
      <div
        v-if="counters.length === 0"
        class="px-1.5 py-1 text-sm text-dimmed"
      >
        {{ CLASS_COUNTERS_BLOCK_LABELS.empty }}
      </div>

      <div
        v-for="{ counter, definition, max, badges } in displayCounters"
        :key="counterIdentity(counter)"
        class="flex max-w-full min-w-0 items-center gap-2 rounded p-1.5"
      >
        <!-- Название -->
        <UTooltip
          :delay-duration="300"
          :text="definition?.name ?? counter.counterKey"
        >
          <span
            class="w-8 shrink-0 truncate text-center text-sm font-bold tracking-wider text-toned"
          >
            {{
              definition?.shortName ?? definition?.name ?? counter.counterKey
            }}
          </span>
        </UTooltip>

        <!-- Значение -->
        <div class="flex shrink-0 items-center gap-1">
          <!-- Кнопка минус -->
          <button
            class="hover:border-toned flex h-6 w-6 items-center justify-center rounded border border-muted bg-elevated/60 text-sm font-extrabold text-highlighted transition-all hover:scale-105 hover:bg-elevated active:scale-95 disabled:pointer-events-none disabled:opacity-20"
            :disabled="counter.current <= 0"
            @click.left.exact.prevent="decrementCounter(counter)"
          >
            −
          </button>

          <!-- Текущее / Макс -->
          <span class="min-w-12 text-center text-sm font-bold tabular-nums">
            <span
              class="text-highlighted"
              :class="counter.current === 0 ? 'text-dimmed' : ''"
            >
              {{ counter.current }}
            </span>

            <span class="font-light text-dimmed">/{{ max }}</span>
          </span>

          <!-- Кнопка плюс -->
          <button
            class="hover:border-toned flex h-6 w-6 items-center justify-center rounded border border-muted bg-elevated/60 text-sm font-extrabold text-highlighted transition-all hover:scale-105 hover:bg-elevated active:scale-95 disabled:pointer-events-none disabled:opacity-20"
            :disabled="counter.current >= max"
            @click.left.exact.prevent="incrementCounter(counter, max)"
          >
            +
          </button>
        </div>

        <!-- Пометки восстановления: по одной на отдых, что возвращает заряды.
          Прижаты к правому краю: иначе строка обрывалась бы пустотой -->
        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <UTooltip
            v-for="badge in badges"
            :key="badge.key"
            :delay-duration="300"
            :text="badge.hint"
          >
            <span
              class="flex items-center gap-0.5 text-dimmed transition-colors hover:text-highlighted"
            >
              <UIcon
                :name="badge.icon"
                class="h-5.5 w-5.5 shrink-0"
              />

              <span class="text-[10px] leading-none font-bold">
                {{ badge.text }}
              </span>
            </span>
          </UTooltip>
        </div>
      </div>
    </div>
  </FieldsetLabel>

  <ClassCountersModal
    v-model:open="isSettingsOpen"
    :actor="actor"
    :counters="counters"
    :counter-definitions="counterDefinitions"
    @apply="applyCounters"
  />
</template>

<style scoped>
  .class-counters-fieldset {
    min-inline-size: 0;
  }
</style>
