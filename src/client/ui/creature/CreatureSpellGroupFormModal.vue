<script setup lang="ts">
  import type {
    CreatureRecharge,
    CreatureSpellGroup,
    CreatureSpellRestKind,
    CreatureSpellUsageMode,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    DEFAULT_CREATURE_SPELL_REST,
    isCreatureSpellCountMode,
    isCreatureSpellRestMode,
    MIN_CREATURE_SPELL_COUNT,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS } from '../actor/constants';
  import {
    CREATURE_RECHARGE_OPTIONS,
    CREATURE_SPELL_GROUP_FORM_LABELS,
    CREATURE_SPELL_REST_OPTIONS,
    CREATURE_SPELL_USAGE_MODE_OPTIONS,
  } from './constants';

  interface Props {
    open: boolean;
    /** Правимая группа; без неё окно ничего не показывает */
    group?: CreatureSpellGroup;
  }

  const props = withDefaults(defineProps<Props>(), { group: undefined });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [group: CreatureSpellGroup];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Значение «перезарядка не выбрана» в списке выбора */
  const RECHARGE_NONE = 'none';

  /**
   * Правка идёт по копии: до «Применить» группа существа не меняется — окно
   * закрывают и «Отменой».
   */
  const form = reactive<{
    mode: CreatureSpellUsageMode;
    count: number;
    rest: CreatureSpellRestKind;
    recharge: CreatureRecharge | typeof RECHARGE_NONE;
    label: string;
  }>({
    mode: 'atWill',
    count: MIN_CREATURE_SPELL_COUNT,
    rest: DEFAULT_CREATURE_SPELL_REST,
    recharge: RECHARGE_NONE,
    label: '',
  });

  watch(
    () => [props.open, props.group] as const,
    ([opened, group]) => {
      if (!opened || !group) {
        return;
      }

      form.mode = group.mode;
      form.count = group.count ?? MIN_CREATURE_SPELL_COUNT;
      form.rest = group.rest ?? DEFAULT_CREATURE_SPELL_REST;
      form.recharge = group.recharge ?? RECHARGE_NONE;
      form.label = group.label ?? '';
    },
    { immediate: true },
  );

  const isCountShown = computed(() => isCreatureSpellCountMode(form.mode));

  const isRestShown = computed(() => isCreatureSpellRestMode(form.mode));

  const isRechargeShown = computed(() => form.mode === 'recharge');

  /**
   * Пояснение к числу применений: у «каждого» и «на весь список» одно и то же
   * число значит разное, и без подсказки их путают.
   */
  const countHint = computed(() =>
    form.mode === 'perDayEach' || form.mode === 'perRestEach'
      ? CREATURE_SPELL_GROUP_FORM_LABELS.countEachHint
      : CREATURE_SPELL_GROUP_FORM_LABELS.countPoolHint,
  );

  /** Список перезарядки вместе со значением «не выбрана» */
  const rechargeOptions = [
    { value: RECHARGE_NONE, label: 'Не выбрана' },
    ...CREATURE_RECHARGE_OPTIONS,
  ];

  /**
   * Собирает группу из формы. Поля, не относящиеся к выбранному ограничению,
   * снимаются: иначе у группы «по желанию» осталось бы количество от прежнего
   * режима и уехало бы таким в запись существа.
   */
  function applyGroup(): void {
    if (!props.group) {
      return;
    }

    const label = form.label.trim();

    emit('apply', {
      ...props.group,
      mode: form.mode,
      count: isCountShown.value
        ? Math.max(MIN_CREATURE_SPELL_COUNT, Math.round(form.count))
        : undefined,
      rest: isRestShown.value ? form.rest : undefined,
      recharge:
        isRechargeShown.value && form.recharge !== RECHARGE_NONE
          ? form.recharge
          : undefined,
      label: label || undefined,
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
    :min-width="440"
    :min-height="320"
    :title="CREATURE_SPELL_GROUP_FORM_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ CREATURE_SPELL_GROUP_FORM_LABELS.hint }}
        </p>

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-toned">
            {{ CREATURE_SPELL_GROUP_FORM_LABELS.mode }}
          </span>

          <USelect
            v-model="form.mode"
            :items="CREATURE_SPELL_USAGE_MODE_OPTIONS"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-64 shrink-0"
          />
        </div>

        <!-- Поля лишних режимов прячутся, а не гаснут: пустое «Перезарядка» у
          группы «По желанию» — вопрос, на который нет ответа -->
        <div
          v-if="isCountShown"
          class="space-y-1"
        >
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_GROUP_FORM_LABELS.count }}
            </span>

            <UInputNumber
              v-model="form.count"
              :min="MIN_CREATURE_SPELL_COUNT"
              size="sm"
              class="w-64 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">{{ countHint }}</p>
        </div>

        <div
          v-if="isRestShown"
          class="flex items-center justify-between gap-4"
        >
          <span class="text-sm text-toned">
            {{ CREATURE_SPELL_GROUP_FORM_LABELS.rest }}
          </span>

          <USelect
            v-model="form.rest"
            :items="CREATURE_SPELL_REST_OPTIONS"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-64 shrink-0"
          />
        </div>

        <div
          v-if="isRechargeShown"
          class="space-y-1"
        >
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_GROUP_FORM_LABELS.recharge }}
            </span>

            <USelect
              v-model="form.recharge"
              :items="rechargeOptions"
              value-key="value"
              label-key="label"
              size="sm"
              class="w-64 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_GROUP_FORM_LABELS.rechargeHint }}
          </p>
        </div>

        <div class="border-t border-muted" />

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_GROUP_FORM_LABELS.label }}
            </span>

            <UInput
              v-model="form.label"
              :placeholder="CREATURE_SPELL_GROUP_FORM_LABELS.labelPlaceholder"
              size="sm"
              class="w-64 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_GROUP_FORM_LABELS.labelHint }}
          </p>
        </div>

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
            @click.left.exact.prevent="applyGroup"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
