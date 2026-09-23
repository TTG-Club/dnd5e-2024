<!--
  Плашка выбора цели: срабатывание с получателем «по выбору» спрашивает, кого
  задеть. Отмечают столько целей, сколько просят; закрытие без выбора отменяет
  срабатывание, а у добровольного выбора есть «Отказаться».
-->
<script setup lang="ts">
  import type { TargetChoiceCandidate } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import { HUD_PROMPTS_TELEPORT_TARGET } from '../actor/constants';
  import {
    CHOICE_SEARCH_THRESHOLD,
    EFFECT_TARGET_PROMPT_LABELS,
    TARGET_CANDIDATE_BUTTON,
  } from './constants';
  import { formatPromptTitle } from './utils/promptTitle';

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

  /** Строка поиска: на большой сцене кандидатов бывают десятки */
  const search = ref('');

  const showSearch = computed(
    () => props.candidates.length >= CHOICE_SEARCH_THRESHOLD,
  );

  /**
   * Кандидаты после поиска. Отмеченные остаются видны всегда: иначе снять
   * лишнюю отметку было бы нечем, пока набран поиск
   */
  const visibleCandidates = computed(() => {
    const query = search.value.trim().toLowerCase();

    if (query.length === 0) {
      return props.candidates;
    }

    return props.candidates.filter(
      (candidate) =>
        chosen.value.includes(candidate.id)
        || candidate.name.toLowerCase().includes(query),
    );
  });

  /** Строки кандидатов: подпись и вид кнопки по тому, отмечен ли кандидат */
  const candidateRows = computed(() =>
    visibleCandidates.value.map((candidate) => {
      const isChosen = chosen.value.includes(candidate.id);

      return {
        id: candidate.id,
        label: candidateLabel(candidate),
        ...(isChosen
          ? TARGET_CANDIDATE_BUTTON.chosen
          : TARGET_CANDIDATE_BUTTON.idle),
      };
    }),
  );

  const title = computed(() =>
    formatPromptTitle(
      EFFECT_TARGET_PROMPT_LABELS.titleFallback,
      EFFECT_TARGET_PROMPT_LABELS.titleSeparator,
      props.sourceName,
    ),
  );

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

        <UInput
          v-if="showSearch"
          v-model="search"
          icon="tabler:search"
          size="md"
          :placeholder="EFFECT_TARGET_PROMPT_LABELS.search"
        />

        <div class="flex max-h-72 flex-col gap-1 overflow-y-auto">
          <p
            v-if="visibleCandidates.length === 0"
            class="px-1 py-2 text-center text-xs text-dimmed"
          >
            {{ EFFECT_TARGET_PROMPT_LABELS.searchEmpty }}
          </p>

          <UButton
            v-for="row in candidateRows"
            :key="row.id"
            :color="row.color"
            :variant="row.variant"
            :icon="row.icon"
            size="md"
            class="justify-start"
            @click.left.exact.prevent="toggle(row.id)"
          >
            {{ row.label }}
          </UButton>
        </div>

        <span class="text-center text-xs text-toned">{{ counter }}</span>

        <div class="flex flex-wrap items-center justify-center gap-2">
          <UButton
            :label="EFFECT_TARGET_PROMPT_LABELS.confirm"
            color="primary"
            variant="solid"
            size="md"
            :disabled="!canConfirm"
            @click.left.exact.prevent="handleConfirm"
          />

          <UButton
            v-if="optional"
            :label="EFFECT_TARGET_PROMPT_LABELS.decline"
            color="neutral"
            variant="soft"
            size="md"
            @click.left.exact.prevent="handleDecline"
          />

          <UButton
            :label="EFFECT_TARGET_PROMPT_LABELS.cancel"
            color="neutral"
            variant="soft"
            size="md"
            @click.left.exact.prevent="handleCancel"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
