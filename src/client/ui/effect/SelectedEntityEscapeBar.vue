<!--
  Кнопки «Вырваться» над хотбаром для выделенной фишки: схваченным нельзя
  пойти, и выход должен быть под рукой, а не на вкладке «Эффекты» листа.

  Кнопка открывает ту же плашку, что и лист (`runEffectEscape`). Показывается
  тому, кто существом управляет: ведущему — у любой фишки, игроку — у своей.
-->
<script setup lang="ts">
  import { computed } from 'vue';

  import { formatEffectEscapeLabel } from '@vtt/shared/system/dnd.js';

  import {
    formatEscapeTitle,
    runEffectEscape,
  } from '../../composables/effectEscapeAction';
  import { controlsEntityAsUser } from '../../composables/gmApprovalRequest';
  import { listSelfEscapeEffects } from '../../composables/useEntityActiveEffects';
  import { useWorldEntities } from '../../composables/useWorldEntities';
  import { HUD_PROMPTS_TELEPORT_TARGET } from '../actor/constants';
  import { EFFECT_ESCAPE_ICON } from './escapeLabels';

  const props = defineProps<{
    /** Выделенная сущность — актёр или существо */
    entityId: string;
  }>();

  const { findCurrentDndEntity } = useWorldEntities();

  /**
   * Кнопки по эффектам выделенной сущности, из которых она может вырваться
   * сама. Подпись несёт имя эффекта: захватов от разных существ может быть два.
   */
  const escapeRows = computed(() => {
    const carrier = findCurrentDndEntity(props.entityId);

    if (!carrier || !controlsEntityAsUser(carrier)) {
      return [];
    }

    return listSelfEscapeEffects(carrier.activeEffects ?? []).map((effect) => ({
      id: effect.id,
      label: formatEscapeTitle(effect),
      title: formatEffectEscapeLabel(effect),
    }));
  });

  /**
   * Открывает действие «вырваться» для эффекта выделенной сущности.
   *
   * @param effectId - эффект с блоком «вырваться»
   */
  function handleEscape(effectId: string): void {
    runEffectEscape(props.entityId, effectId);
  }
</script>

<template>
  <Teleport
    defer
    :to="HUD_PROMPTS_TELEPORT_TARGET"
  >
    <div
      v-if="escapeRows.length > 0"
      class="pointer-events-auto flex max-w-full flex-wrap justify-center gap-1.5 rounded-xl border border-default/50 bg-default/90 p-1.5 shadow-xl backdrop-blur-sm"
    >
      <UButton
        v-for="row in escapeRows"
        :key="row.id"
        :icon="EFFECT_ESCAPE_ICON"
        :label="row.label"
        :title="row.title"
        color="warning"
        variant="soft"
        size="sm"
        @click.left.exact.prevent="handleEscape(row.id)"
      />
    </div>
  </Teleport>
</template>
