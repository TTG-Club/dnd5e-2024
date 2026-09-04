<script setup lang="ts">
  /**
   * Плашка заклинания в шаге заклинательства: название, круг и откуда оно.
   *
   * Одна на три списка шага — выданное умениями, доступное сверх списка класса
   * и уже выбранное. Списки стоят друг под другом, и разный вид одного и того
   * же заклинания читался бы как разные вещи.
   *
   * Записи-источника на плашке нет: в списках она названа один раз заголовком
   * группы ({@link WizardSpellSourceList}), а повтор у каждого заклинания
   * съедал половину строки.
   *
   * Плашка нажимается и открывает карточку заклинания: до этого игрок видел
   * только название и решал вслепую, брать его или нет. Кнопка снятия выбора —
   * соседняя, а не вложенная: кнопка внутри кнопки недопустима.
   */

  import type { Spell } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { WIZARD_SPELLCASTING_LABELS } from '../../constants';
  import { spellCircleLabel } from '../../utils/spellCircleLabel';

  const props = withDefaults(
    defineProps<{
      spell: Spell;
      /**
       * Заклинание выдано и снять его нельзя — значок замка. У выбранного
       * игроком замка нет: его как раз снимают.
       */
      locked?: boolean;
      /** Показывать кнопку снятия выбора */
      removable?: boolean;
      /** Цвет плашки: выданное, доступное сверх списка и выбранное различаются */
      tone?: 'granted' | 'expanded' | 'selected';
    }>(),
    { locked: false, removable: false, tone: 'selected' },
  );

  const emit = defineEmits<{
    /** Открыть карточку заклинания */
    open: [];
    /** Снять заклинание с выбора */
    remove: [];
  }>();

  /** Круг заклинания подписью: «заговор» или «3 кр.» */
  const circle = computed(() => spellCircleLabel(props.spell.level));

  /** Оформление плашки по её роли в шаге. */
  const toneClass = computed(() => {
    if (props.tone === 'granted') {
      return 'border-primary/40 bg-primary/10 hover:border-primary/70';
    }

    return props.tone === 'expanded'
      ? 'border-info/40 bg-info/10 hover:border-info/70'
      : 'border-default/60 bg-elevated/40 hover:border-accented/70';
  });

  /** Скругления плашки: у снимаемой справа приросла своя кнопка. */
  const roundingClass = computed(() =>
    props.removable ? 'rounded-l-md border-r-0' : 'rounded-md',
  );
</script>

<template>
  <div class="flex items-stretch">
    <button
      type="button"
      class="flex cursor-pointer items-center gap-1.5 border px-2 py-1 text-left transition-colors"
      :class="[toneClass, roundingClass]"
      :aria-label="WIZARD_SPELLCASTING_LABELS.openSpell"
      @click.left.exact.prevent="emit('open')"
    >
      <UIcon
        v-if="locked"
        name="tabler:lock"
        class="size-3.5 shrink-0 opacity-60"
      />

      <span class="text-sm text-highlighted">{{ spell.name }}</span>

      <UBadge
        color="neutral"
        variant="subtle"
        size="sm"
        class="shrink-0"
      >
        {{ circle }}
      </UBadge>
    </button>

    <button
      v-if="removable"
      type="button"
      class="flex shrink-0 cursor-pointer items-center justify-center rounded-r-md border border-default/60 bg-elevated/40 px-2 text-dimmed transition-colors hover:border-accented/70 hover:text-default"
      :aria-label="WIZARD_SPELLCASTING_LABELS.removeSpell"
      @click.left.exact.prevent="emit('remove')"
    >
      <UIcon
        name="tabler:x"
        class="size-3.5"
      />
    </button>
  </div>
</template>
