<!--
  Плашка выбора круга до каста: круг нужен раньше окна броска — от него растёт
  область или считается цена. Список кругов тот же, что в окне броска и в окне
  выбора целей; выбранный круг дальше закреплён. Закрытие плашки отменяет каст.
-->
<script setup lang="ts">
  import type { CastLevelPromptItem } from '../../composables/castLevelPrompt';

  import { computed, ref } from 'vue';

  import { HUD_PROMPT_TITLE_ATTR } from '@/shared_ui/consts';

  import {
    ACTOR_SPELLS_TAB_LABELS,
    HUD_PROMPT_PANEL_CLASS,
    HUD_PROMPTS_TELEPORT_TARGET,
    SPELL_CAST_LEVEL_PROMPT_LABELS,
  } from './constants';

  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    open: boolean;
    modalId: string;
    /** Заклинание, которое накладывают */
    sourceName: string;
    /** Вопрос и почему круг нужен заранее */
    question: string;
    /** Круги, которыми можно наложить; плашку открывают, когда их больше одного */
    levelItems: readonly CastLevelPromptItem[];
    /** Круг выбран — каст продолжается им */
    onConfirm: (castLevel: number) => void;
  }>();

  /**
   * Заголовок плашки. Его же читает напоминание хоста о плашке, которую окно
   * закрыло целиком, — чтобы назвать, какой вопрос ждёт ответа
   */
  const promptTitle = computed(
    () =>
      `${ACTOR_SPELLS_TAB_LABELS.castConfirmPrefix}${props.sourceName}${ACTOR_SPELLS_TAB_LABELS.castConfirmSuffix}`,
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  /** Наименьший круг — первым: так же открываются остальные списки кругов */
  const selectedLevel = ref(props.levelItems[0]?.value ?? 0);

  /** Закрывает плашку */
  function closePrompt(): void {
    emit('update:open', false);
    emit('close');
  }

  /** Отдаёт выбранный круг и закрывает плашку */
  function handleConfirm(): void {
    props.onConfirm(selectedLevel.value);
    closePrompt();
  }
</script>

<template>
  <Teleport :to="HUD_PROMPTS_TELEPORT_TARGET">
    <Transition name="slide-up">
      <div
        v-if="open"
        :class="HUD_PROMPT_PANEL_CLASS"
        :[HUD_PROMPT_TITLE_ATTR]="promptTitle"
      >
        <div class="flex items-center gap-2 border-b border-muted/50 pb-2">
          <UIcon
            name="tabler:wand"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ promptTitle }}
          </span>
        </div>

        <p class="text-sm break-words text-toned">
          {{ question }}
        </p>

        <div class="flex items-center justify-between gap-4">
          <USelect
            v-model.number="selectedLevel"
            :items="levelItems"
            value-key="value"
            label-key="label"
            class="min-w-32"
            size="sm"
            color="neutral"
            variant="outline"
          />

          <div class="flex items-center gap-2">
            <UButton
              icon="tabler:check"
              color="primary"
              variant="solid"
              size="sm"
              :title="SPELL_CAST_LEVEL_PROMPT_LABELS.confirm"
              @click.left.exact.prevent="handleConfirm"
            />

            <UButton
              icon="tabler:x"
              color="neutral"
              variant="ghost"
              size="sm"
              :title="SPELL_CAST_LEVEL_PROMPT_LABELS.cancel"
              @click.left.exact.prevent="closePrompt"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
