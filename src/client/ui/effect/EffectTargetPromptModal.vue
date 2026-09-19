<!--
  Плашка выбора цели: срабатывание с получателем «по выбору» спрашивает, кого
  задеть. Отмечают столько целей, сколько просят; закрытие без выбора отменяет
  срабатывание, а у добровольного выбора есть «Отказаться».
-->
<script setup lang="ts">
  import type { TargetChoiceCandidate } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import { HUD_PROMPTS_TELEPORT_TARGET } from '../actor/constants';
  import { EFFECT_TARGET_PROMPT_LABELS } from './constants';

  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    open: boolean;
    modalId: string;
    /** Из кого выбирать */
    candidates: readonly TargetChoiceCandidate[];
    /** Сколько целей просят */
    count: number;
    /** Можно отказаться от выбора */
    optional?: boolean;
    /** Чей выбор — «Аура жизни» */
    sourceName?: string;
    /** Выбор сделан: пустой список — отказ */
    onConfirm: (chosenIds: string[]) => void;
    /** Плашку закрыли, не ответив */
    onCancel: () => void;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  /** Отмеченные цели в порядке нажатия: лишнее вытесняет самое раннее */
  const chosen = ref<string[]>([]);

  const title = computed(() => {
    const { titleFallback, titleSeparator } = EFFECT_TARGET_PROMPT_LABELS;

    return props.sourceName
      ? `${props.sourceName}${titleSeparator}${titleFallback.toLowerCase()}`
      : titleFallback;
  });

  const counter = computed(() => {
    const { countPrefix, countJoiner } = EFFECT_TARGET_PROMPT_LABELS;

    return `${countPrefix}${chosen.value.length}${countJoiner}${props.count}`;
  });

  const canConfirm = computed(() => chosen.value.length > 0);

  /**
   * Подпись кандидата с хитами: по ним и выбирают, кого лечить.
   *
   * @param candidate - кандидат
   * @returns подпись строки
   */
  function candidateLabel(candidate: TargetChoiceCandidate): string {
    const { hpPrefix, hpJoiner, hpSuffix } = EFFECT_TARGET_PROMPT_LABELS;

    return candidate.hp
      ? `${candidate.name}${hpPrefix}${candidate.hp.current}${hpJoiner}${candidate.hp.max}${hpSuffix}`
      : candidate.name;
  }

  /**
   * Отмечает или снимает отметку с кандидата. Когда отмечено больше, чем
   * просят, самая ранняя отметка уходит — так не приходится снимать вручную.
   *
   * @param id - кандидат
   */
  function toggle(id: string): void {
    if (chosen.value.includes(id)) {
      chosen.value = chosen.value.filter((chosenId) => chosenId !== id);

      return;
    }

    chosen.value = [...chosen.value, id].slice(-props.count);
  }

  /** Отдаёт выбор и закрывает плашку */
  function handleConfirm(): void {
    props.onConfirm([...chosen.value]);
    emit('update:open', false);
    emit('close');
  }

  /** Добровольный отказ: срабатывание не состоится, но это не сбой */
  function handleDecline(): void {
    props.onConfirm([]);
    emit('update:open', false);
    emit('close');
  }

  /** Закрытие без ответа: срабатывание отменяется */
  function handleCancel(): void {
    props.onCancel();
    emit('update:open', false);
    emit('close');
  }
</script>

<template>
  <Teleport :to="HUD_PROMPTS_TELEPORT_TARGET">
    <Transition name="slide-up">
      <div
        v-if="open"
        class="pointer-events-auto flex w-95 max-w-full flex-col gap-3 rounded-xl border border-default/50 bg-default/90 px-4 py-3 text-highlighted shadow-xl ring-accented backdrop-blur-sm"
      >
        <div class="flex items-center gap-2 border-b border-muted/50 pb-2">
          <UIcon
            name="tabler:target"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ title }}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <UButton
            v-for="candidate in candidates"
            :key="candidate.id"
            :color="chosen.includes(candidate.id) ? 'primary' : 'neutral'"
            :variant="chosen.includes(candidate.id) ? 'solid' : 'ghost'"
            :icon="
              chosen.includes(candidate.id) ? 'tabler:check' : 'tabler:point'
            "
            size="sm"
            class="justify-start"
            @click.left.exact.prevent="toggle(candidate.id)"
          >
            {{ candidateLabel(candidate) }}
          </UButton>
        </div>

        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-toned">{{ counter }}</span>

          <div class="flex items-center gap-2">
            <UButton
              v-if="optional"
              icon="tabler:ban"
              color="neutral"
              variant="ghost"
              size="sm"
              :title="EFFECT_TARGET_PROMPT_LABELS.decline"
              @click.left.exact.prevent="handleDecline"
            />

            <UButton
              icon="tabler:check"
              color="primary"
              variant="solid"
              size="sm"
              :disabled="!canConfirm"
              :title="EFFECT_TARGET_PROMPT_LABELS.confirm"
              @click.left.exact.prevent="handleConfirm"
            />

            <UButton
              icon="tabler:x"
              color="neutral"
              variant="ghost"
              size="sm"
              :title="EFFECT_TARGET_PROMPT_LABELS.cancel"
              @click.left.exact.prevent="handleCancel"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
