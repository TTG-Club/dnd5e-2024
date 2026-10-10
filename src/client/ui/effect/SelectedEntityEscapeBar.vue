<!--
  Кнопки «Вырваться» в панели выделенной фишки: схваченным нельзя пойти, и
  выход должен быть под рукой, а не на вкладке «Эффекты» листа.

  Стоит в слоте системы `selectedEntityActions` (VTTG 0.9.645): ядро монтирует
  компонент внутри панели, пока фишка выделена, и передаёт `entityId`. Нет
  эффектов, из которых можно вырваться, — компонент ничего не рисует, и слот
  места не занимает.

  Кнопка открывает ту же плашку, что и лист (`runEffectEscape`). Показывается
  тому, кто существом управляет: ведущему — у любой фишки, игроку — у своей.
-->
<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import { computed } from 'vue';

  import { formatEffectEscapeLabel } from '@vtt/shared/system/dnd.js';

  import {
    formatEscapeTitle,
    runEffectEscape,
  } from '../../composables/effectEscapeAction';
  import { controlsEntityAsUser } from '../../composables/gmApprovalRequest';
  import { listSelfEscapeEffects } from '../../composables/useEntityActiveEffects';
  import { useWorldEntities } from '../../composables/useWorldEntities';
  import { EFFECT_ESCAPE_ICON } from './escapeLabels';

  const props = defineProps<{
    /** Выделенная сущность — актёр или существо */
    entityId: string;
    /** Мир выделенной сущности — проп слота ядра, кнопкам не нужен */
    worldId?: string;
    /** Сокет мира — проп слота ядра, кнопкам не нужен */
    socket?: TypedWebSocketClient | null;
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
  <UButton
    v-for="row in escapeRows"
    :key="row.id"
    :icon="EFFECT_ESCAPE_ICON"
    :label="row.label"
    :title="row.title"
    color="warning"
    variant="soft"
    size="xs"
    @click.left.exact.prevent="handleEscape(row.id)"
  />
</template>
