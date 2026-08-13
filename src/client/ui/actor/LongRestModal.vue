<script setup lang="ts">
  import type { DnDActor, LongRestOptions } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { useDiceRollerStore } from '@/stores/diceRollerStore';
  import {
    collectItemChargeRolls,
    summarizeActorLongRest,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTOR_LEFT_PANEL_LABELS,
    LONG_REST_LABELS,
    MODAL_BUTTON_LABELS,
    REST_LABELS,
  } from './constants';

  interface Props {
    open: boolean;
    /** Актор, для которого считается предпросмотр восстановления */
    actor: DnDActor;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [options: LongRestOptions];
  }>();

  const diceRollerStore = useDiceRollerStore();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Вернуть все потраченные кости хитов (домашнее правило) */
  const recoverAllHitDice = ref(false);

  /** Итоги восстановления продолжительного отдыха */
  const preview = computed(() => summarizeActorLongRest(props.actor));

  /** Сколько костей хитов вернётся с учётом галочки «вернуть все» */
  const hitDiceToRecover = computed(() =>
    recoverAllHitDice.value
      ? preview.value.hitDice.recoverAll
      : preview.value.hitDice.recoverHalf,
  );

  /**
   * Разбор потраченных костей хитов: «(потрачено 2 из 5)». Числа стоят между
   * приставкой, связкой и хвостом, поэтому строка собирается здесь, а не в
   * шаблоне: подстановки подряд форматтер вправе разорвать переносом, и Vue
   * отодвинул бы закрывающую скобку от числа пробелом.
   */
  const hitDiceSpentLabel = computed(
    () =>
      LONG_REST_LABELS.hitDiceSpentPrefix
      + preview.value.hitDice.used
      + LONG_REST_LABELS.hitDiceSpentMiddle
      + preview.value.hitDice.total
      + LONG_REST_LABELS.hitDiceSpentSuffix,
  );

  // При открытии сбрасываем галочку к правилам по умолчанию
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        recoverAllHitDice.value = false;
      }
    },
  );

  /**
   * Бросает формулы возврата зарядов («1к6+4») у предметов, которые их задают.
   * Кости бросает клиент, движок отдыха получает уже готовые числа — так же,
   * как это сделано с костями хитов короткого отдыха.
   *
   * @returns выпавшие числа по id предмета
   */
  function rollItemCharges(): Record<string, number> {
    const rolls: Record<string, number> = {};

    for (const entry of collectItemChargeRolls(props.actor, 'long')) {
      rolls[entry.id] = Math.max(
        0,
        diceRollerStore.parseAndRoll(entry.formula).total,
      );
    }

    return rolls;
  }

  function finishRest() {
    emit('apply', {
      recoverAllHitDice: recoverAllHitDice.value,
      itemChargeRolls: rollItemCharges(),
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
    :min-height="240"
    :title="REST_LABELS.long"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-xs text-dimmed">
          {{ LONG_REST_LABELS.intro }}
        </p>

        <!-- Хиты -->
        <div
          class="flex items-center justify-between rounded-lg bg-elevated/50 p-3"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ LONG_REST_LABELS.hitPoints }}
          </span>

          <span class="font-bold text-highlighted">
            {{ preview.hitPoints.current }}
            <UIcon
              name="tabler:arrow-right"
              class="mx-1 inline h-3 w-3 text-dimmed"
            />
            {{ preview.hitPoints.max }}

            <span
              v-if="preview.hitPoints.restored > 0"
              class="ml-1 text-healing"
            >
              (+{{ preview.hitPoints.restored }})
            </span>
          </span>
        </div>

        <!-- Кости хитов -->
        <div class="rounded-lg bg-elevated/40 p-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon
                name="tabler:dice-5"
                class="h-4 w-4 text-healing"
              />

              <span class="text-xs tracking-wider text-muted uppercase">
                {{ ACTOR_LEFT_PANEL_LABELS.hitDice }}
              </span>
            </div>

            <span class="font-bold text-highlighted">
              <span class="text-healing">+{{ hitDiceToRecover }}</span>

              <span class="ml-1 text-xs text-dimmed">
                {{ hitDiceSpentLabel }}
              </span>
            </span>
          </div>

          <UCheckbox
            v-model="recoverAllHitDice"
            class="mt-3"
            :disabled="preview.hitDice.used === 0"
            :label="LONG_REST_LABELS.restoreAllHitDice"
            :ui="{ label: 'text-sm text-toned' }"
          />
        </div>

        <!-- Прочие бонусы восстановления -->
        <div class="flex flex-col gap-2">
          <div
            v-if="preview.spellSlotsRestored > 0"
            class="flex items-center justify-between rounded bg-elevated/40 p-2 text-sm"
          >
            <span class="flex items-center gap-2 text-toned">
              <UIcon
                name="tabler:sparkles"
                class="h-4 w-4 text-primary"
              />
              {{ LONG_REST_LABELS.spellSlots }}
            </span>

            <span class="font-bold text-healing">
              +{{ preview.spellSlotsRestored }}
            </span>
          </div>

          <div
            v-if="preview.countersRestored > 0"
            class="flex items-center justify-between rounded bg-elevated/40 p-2 text-sm"
          >
            <span class="flex items-center gap-2 text-toned">
              <UIcon
                name="tabler:battery-charging"
                class="h-4 w-4 text-primary"
              />
              {{ LONG_REST_LABELS.classResources }}
            </span>

            <span class="font-bold text-healing">
              {{ preview.countersRestored }}
            </span>
          </div>

          <div
            v-if="preview.spellChargesRestored > 0"
            class="flex items-center justify-between rounded bg-elevated/40 p-2 text-sm"
          >
            <span class="flex items-center gap-2 text-toned">
              <UIcon
                name="tabler:flame"
                class="h-4 w-4 text-primary"
              />
              {{ LONG_REST_LABELS.spellUses }}
            </span>

            <span class="font-bold text-healing">
              {{ preview.spellChargesRestored }}
            </span>
          </div>

          <div
            v-if="preview.itemChargesRestored > 0"
            class="flex items-center justify-between rounded bg-elevated/40 p-2 text-sm"
          >
            <span class="flex items-center gap-2 text-toned">
              <UIcon
                name="tabler:battery-vertical-charging"
                class="h-4 w-4 text-primary"
              />
              {{ LONG_REST_LABELS.itemUses }}
            </span>

            <span class="font-bold text-healing">
              {{ preview.itemChargesRestored }}
            </span>
          </div>

          <div
            v-if="preview.tempHitPointsCleared > 0"
            class="flex items-center justify-between rounded bg-elevated/40 p-2 text-sm"
          >
            <span class="flex items-center gap-2 text-toned">
              <UIcon
                name="tabler:shield-off"
                class="h-4 w-4 text-dimmed"
              />
              {{ LONG_REST_LABELS.temporaryHitPointsCleared }}
            </span>

            <span class="font-bold text-dimmed">
              −{{ preview.tempHitPointsCleared }}
            </span>
          </div>
        </div>

        <div class="border-t border-muted" />

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            size="md"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="md"
            @click.left.exact.prevent="finishRest"
          >
            <UIcon
              name="tabler:moon"
              class="mr-1 h-4 w-4"
            />
            {{ LONG_REST_LABELS.finish }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
