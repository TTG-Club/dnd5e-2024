<script setup lang="ts">
  import type {
    ActorClassEntry,
    ManualHitDieGroup,
    MaxHitPointsSource,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    getHitDiceGroups,
    isHitDie,
    MAX_HIT_POINTS_SOURCE_KIND,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTOR_LEFT_PANEL_LABELS,
    HIT_DIE_LETTER,
    HIT_DIE_SELECT_OPTIONS,
    HIT_POINTS_LABELS,
    MODAL_BUTTON_LABELS,
  } from './constants';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface HitPointsData {
    current: number;
    max: number;
    temp: number;
    classes?: ActorClassEntry[];
    manualHitDice?: ManualHitDieGroup[];
  }

  interface Props {
    open: boolean;
    currentHitPoints: number;
    /**
     * ЗАПИСЬ ЛИСТА, а не итог плитки: этим числом окно максимум не только
     * показывает, но и ПРАВИТ. Передать сюда итог с эффектами — и «Применить»
     * запишет его в запас листа, а эффект прибавит своё поверх ещё раз: у
     * чародея с «Драконьей устойчивостью» максимум так рос на уровень с каждого
     * лечения. Прибавка эффектов приходит отдельным числом —
     * {@link resolvedMaxHitPoints}.
     */
    maxHitPoints: number;
    tempHitPoints: number;
    classes?: ActorClassEntry[];
    manualHitDice?: ManualHitDieGroup[];
    /**
     * Итоговый максимум листа — то же число, что стоит в плитке хитов (запас
     * листа с прибавкой эффектов). Окно его только показывает. Нет — окно
     * считает, что эффекты максимум не трогают.
     */
    resolvedMaxHitPoints?: number;
    /**
     * Из чего сложилась прибавка к максимуму: по этому списку окно называет
     * каждый источник и его число
     */
    maxHitPointsSources?: readonly MaxHitPointsSource[];
  }

  const props = withDefaults(defineProps<Props>(), {
    classes: () => [],
    manualHitDice: () => [],
    maxHitPointsSources: () => [],
    // Итога может не быть: лист его считает не всегда, и тогда сверять не с чем
    resolvedMaxHitPoints: undefined,
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [data: HitPointsData];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const editHp = reactive<HitPointsData>({
    current: 0,
    max: 1,
    temp: 0,
  });

  const editClasses = ref<ActorClassEntry[]>([]);
  const editManualHitDice = ref<ManualHitDieGroup[]>([]);

  /** Есть ли классы с костями хитов у актора */
  const hasClassHitDice = computed(() =>
    editClasses.value.some((cls) => Boolean(cls.hitDie)),
  );

  // При открытии — подставляем текущие значения
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        editHp.current = props.currentHitPoints;
        editHp.max = props.maxHitPoints;
        editHp.temp = props.tempHitPoints;
        editClasses.value = JSON.parse(JSON.stringify(props.classes ?? []));

        editManualHitDice.value = JSON.parse(
          JSON.stringify(props.manualHitDice ?? []),
        );
      }
    },
  );

  /**
   * Прибавка эффектов к максимуму — разница итога плитки и записи листа.
   *
   * Именно разницей, а не своим проходом по эффектам: окно не повторяет расчёт
   * пайплайна (условия, режимы «заменить» и «повысить до») и потому не может
   * разойтись с плиткой.
   */
  const effectsMaxBonus = computed(() =>
    props.resolvedMaxHitPoints === undefined
      ? 0
      : props.resolvedMaxHitPoints - props.maxHitPoints,
  );

  /** Итог листа показывается, только когда эффекты и правда двигают максимум */
  const hasSheetTotal = computed(() => effectsMaxBonus.value !== 0);

  /**
   * Итог листа для ПРАВЯЩЕГОСЯ числа: прибавка эффектов ложится на то, что
   * набрано в поле, — иначе подпись отставала бы от ввода на одну правку.
   */
  const sheetMaxTotal = computed(() => editHp.max + effectsMaxBonus.value);

  /** Подпись поля максимума: с эффектами в нём не итог, а запас листа */
  const maxFieldLabel = computed(() =>
    hasSheetTotal.value
      ? HIT_POINTS_LABELS.totalWithoutEffects
      : HIT_POINTS_LABELS.total,
  );

  /**
   * Текущие хиты в границах итогового максимума (с эффектами) — рукой их выше
   * не поднять, как и лечением: сверх максимума бывают только временные хиты,
   * у них своё поле.
   */
  const boundedCurrentHitPoints = computed(() =>
    Math.min(Math.max(0, editHp.current), Math.max(0, sheetMaxTotal.value)),
  );

  /**
   * Правка текущих хитов. Срез до максимума — при уходе из поля и при
   * «Применить», а не на каждой цифре: набирая «87», человек проходит через
   * «8», и срез на лету не давал бы набрать число больше одной цифры.
   */
  function handleCurrentInput(value: unknown): void {
    editHp.current = Number(value);
  }

  /** Уход из поля текущих хитов: набранное сверх максимума срезается */
  function handleCurrentBlur(): void {
    editHp.current = boundedCurrentHitPoints.value;
  }

  /**
   * Разбор итога строками: кто и на сколько двигает максимум хитов. Виден сразу,
   * а не в подсказке по наведению — её не находили и спрашивали, откуда число.
   */
  const sheetTotalSources = computed(() =>
    props.maxHitPointsSources.map((source) => ({
      label:
        source.kind === MAX_HIT_POINTS_SOURCE_KIND.effect
          ? source.name
          : HIT_POINTS_LABELS.constitutionSource,
      value: formatSignedNumber(source.delta),
    })),
  );

  // Группируем только классовые кости — ручные показываются отдельным блоком
  const hitDiceGroups = computed(() => getHitDiceGroups(editClasses.value));

  /** Запись кости хитов группы: «к8» */
  function formatHitDie(die: number): string {
    return `${HIT_DIE_LETTER}${die}`;
  }

  function adjustHitDieUsed(die: number, delta: number) {
    let remainingDelta = Math.abs(delta);

    const targetClasses = editClasses.value.filter((cls) => cls.hitDie === die);

    if (delta > 0) {
      // Тратим кость
      for (const cls of targetClasses) {
        const available = cls.level - (cls.hitDiceUsed ?? 0);

        if (available > 0) {
          const spend = Math.min(available, remainingDelta);

          cls.hitDiceUsed = (cls.hitDiceUsed ?? 0) + spend;
          remainingDelta -= spend;

          if (remainingDelta <= 0) {
            break;
          }
        }
      }
    } else {
      // Восстанавливаем кость
      for (const cls of targetClasses) {
        const used = cls.hitDiceUsed ?? 0;

        if (used > 0) {
          const restore = Math.min(used, remainingDelta);

          cls.hitDiceUsed = used - restore;
          remainingDelta -= restore;

          if (remainingDelta <= 0) {
            break;
          }
        }
      }
    }
  }

  /**
   * Меняет кость хитов группы: селектор отдаёт значение свободной формы,
   * поэтому число сверяется со списком костей системы.
   *
   * @param group - группа ручных костей хитов
   * @param value - значение из селектора
   */
  function handleGroupDieChange(
    group: ManualHitDieGroup,
    value: unknown,
  ): void {
    const die = Number(value);

    if (isHitDie(die)) {
      group.die = die;
    }
  }

  /** Добавляет новую группу ручных костей хитов */
  function addManualHitDieGroup() {
    editManualHitDice.value.push({ die: 8, total: 1, used: 0 });
  }

  /** Удаляет группу ручных костей хитов по индексу */
  function removeManualHitDieGroup(index: number) {
    editManualHitDice.value.splice(index, 1);
  }

  /** Применяет изменения очков здоровья и костей хитов */
  function applyHitPoints() {
    // Максимум могли опустить уже после текущих хитов — срез и здесь
    emit('apply', {
      current: boundedCurrentHitPoints.value,
      max: editHp.max,
      temp: editHp.temp,
      classes: editClasses.value,
      manualHitDice: editManualHitDice.value,
    });

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="380"
    :min-height="250"
    :title="HIT_POINTS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Текущие / Максимум -->
        <div class="flex items-center gap-4">
          <div class="flex flex-1 flex-col gap-1">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ HIT_POINTS_LABELS.current }}
            </span>

            <UInput
              :model-value="editHp.current"
              type="number"
              :min="0"
              :max="sheetMaxTotal"
              size="lg"
              @update:model-value="handleCurrentInput"
              @blur="handleCurrentBlur"
            />
          </div>

          <span class="mt-5 text-2xl font-light text-dimmed">/</span>

          <div class="flex flex-1 flex-col gap-1">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ maxFieldLabel }}
            </span>

            <UInput
              :model-value="editHp.max"
              type="number"
              :min="1"
              size="lg"
              @update:model-value="editHp.max = Number($event)"
            />
          </div>

          <div class="flex flex-1 flex-col gap-1">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ HIT_POINTS_LABELS.temporary }}
            </span>

            <UInput
              :model-value="editHp.temp"
              type="number"
              :min="0"
              size="lg"
              @update:model-value="editHp.temp = Math.max(0, Number($event))"
            />
          </div>
        </div>

        <!-- Итог листа: появляется, когда максимум двигают эффекты -->
        <div
          v-if="hasSheetTotal"
          class="flex flex-col gap-1 rounded bg-elevated/40 p-2 text-xs"
        >
          <UTooltip :text="HIT_POINTS_LABELS.sheetTotalHint">
            <p class="flex justify-between font-medium text-toned">
              <span>{{ HIT_POINTS_LABELS.sheetTotal }}</span>

              <span class="font-bold text-highlighted">{{
                sheetMaxTotal
              }}</span>
            </p>
          </UTooltip>

          <p
            v-for="(source, sourceIndex) in sheetTotalSources"
            :key="sourceIndex"
            class="flex justify-between gap-2 text-muted"
          >
            <span class="min-w-0 truncate">{{ source.label }}</span>

            <span class="shrink-0">{{ source.value }}</span>
          </p>
        </div>

        <div class="border-t border-muted" />

        <!-- Кости хитов (из классов) -->
        <div
          v-if="hasClassHitDice"
          class="flex flex-col gap-2"
        >
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ HIT_POINTS_LABELS.classHitDice }}
          </span>

          <div
            v-for="group in hitDiceGroups"
            :key="group.die"
            class="flex items-center justify-between rounded bg-elevated/40 p-2"
          >
            <div class="flex items-center gap-2">
              <UIcon
                name="tabler:dice-5"
                class="h-4 w-4 text-healing"
              />

              <span class="font-bold text-highlighted">{{
                formatHitDie(group.die)
              }}</span>
            </div>

            <div class="flex items-center gap-3">
              <span class="text-sm">
                {{ HIT_POINTS_LABELS.availablePrefix }}
                <span class="font-bold text-highlighted">{{
                  group.available
                }}</span>

                <span class="text-dimmed"> / {{ group.total }}</span>
              </span>

              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="tabler:minus"
                  :disabled="group.used === 0"
                  @click.left.exact.prevent="adjustHitDieUsed(group.die, -1)"
                />

                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="tabler:plus"
                  :disabled="group.available === 0"
                  @click.left.exact.prevent="adjustHitDieUsed(group.die, 1)"
                />
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="hasClassHitDice && editManualHitDice.length > 0"
          class="border-t border-muted"
        />

        <!-- Кости хитов (ручной ввод) -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{
                hasClassHitDice
                  ? HIT_POINTS_LABELS.extraHitDice
                  : ACTOR_LEFT_PANEL_LABELS.hitDice
              }}
            </span>

            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="tabler:plus"
              @click.left.exact.prevent="addManualHitDieGroup"
            >
              {{ MODAL_BUTTON_LABELS.add }}
            </UButton>
          </div>

          <div
            v-if="editManualHitDice.length === 0 && !hasClassHitDice"
            class="text-sm text-dimmed"
          >
            {{ HIT_POINTS_LABELS.hitDiceEmpty }}
          </div>

          <div
            v-for="(group, groupIndex) in editManualHitDice"
            :key="groupIndex"
            class="flex items-center gap-2 rounded bg-elevated/40 p-2"
          >
            <!-- Сейчас (доступно) -->
            <div class="flex flex-col gap-0.5">
              <span
                class="text-[9px] font-medium tracking-wider text-dimmed uppercase"
              >
                {{ HIT_POINTS_LABELS.current }}
              </span>

              <UInput
                :model-value="group.total - group.used"
                type="number"
                :min="0"
                :max="group.total"
                size="sm"
                class="w-16"
                @update:model-value="
                  group.used =
                    group.total
                    - Math.max(0, Math.min(group.total, Number($event)))
                "
              />
            </div>

            <span class="mt-4 font-light text-dimmed">/</span>

            <!-- Всего -->
            <div class="flex flex-col gap-0.5">
              <span
                class="text-[9px] font-medium tracking-wider text-dimmed uppercase"
              >
                {{ HIT_POINTS_LABELS.total }}
              </span>

              <UInput
                :model-value="group.total"
                type="number"
                :min="1"
                size="sm"
                class="w-16"
                @update:model-value="
                  group.total = Math.max(1, Number($event));
                  group.used = Math.min(group.used, group.total);
                "
              />
            </div>

            <!-- Размер кости -->
            <div class="flex flex-1 flex-col gap-0.5">
              <span
                class="text-[9px] font-medium tracking-wider text-dimmed uppercase"
              >
                {{ HIT_POINTS_LABELS.die }}
              </span>

              <USelect
                :model-value="group.die"
                :items="HIT_DIE_SELECT_OPTIONS"
                size="sm"
                @update:model-value="handleGroupDieChange(group, $event)"
              />
            </div>

            <!-- Удалить -->
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="tabler:trash"
              class="mt-4"
              @click.left.exact.prevent="removeManualHitDieGroup(groupIndex)"
            />
          </div>
        </div>

        <div class="border-t border-muted" />

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applyHitPoints"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
