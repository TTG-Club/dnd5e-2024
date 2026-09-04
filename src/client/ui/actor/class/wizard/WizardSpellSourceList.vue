<script setup lang="ts">
  /**
   * Список заклинаний шага, разложенный по записям-источникам.
   *
   * Раньше источник был приписан к каждой плашке, и у «Таинственного арканума»
   * десять заклинаний несли десять одинаковых подписей: половину ширины строки
   * занимал повтор, а сами названия ужимались. Теперь источник назван один раз
   * заголовком, а под ним идут его заклинания.
   *
   * Группы идут в порядке первого появления, а не по алфавиту: он совпадает с
   * порядком, в котором записи легли на лист, и игрок читает их сверху вниз так
   * же, как получал.
   */

  import type { ResolvedGrantedSpell, Spell } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import { WIZARD_SPELLCASTING_LABELS } from '../../constants';
  import EditorNestedSection from '../../EditorNestedSection.vue';
  import WizardSpellChip from './WizardSpellChip.vue';

  /** Заклинания одной записи-источника. */
  interface SpellsByFeature {
    featureName: string;
    spells: ResolvedGrantedSpell[];
  }

  const props = withDefaults(
    defineProps<{
      /** Заклинания с записью-источником у каждого */
      spells: ReadonlyArray<ResolvedGrantedSpell>;
      /** Цвет плашек: выданное умением или доступное сверх списка класса */
      tone: 'granted' | 'expanded';
      /** Заклинание выдано и снять его нельзя — значок замка на плашке */
      locked?: boolean;
    }>(),
    { locked: false },
  );

  const emit = defineEmits<{
    /** Открыть карточку заклинания */
    open: [spell: Spell];
  }>();

  /**
   * Заголовок группы: запись, открывшая эти заклинания.
   *
   * @param featureName - название записи-источника
   */
  function groupTitle(featureName: string): string {
    return `${WIZARD_SPELLCASTING_LABELS.featurePrefix}${featureName}`;
  }

  /** Заклинания по записям-источникам в порядке первого появления. */
  const groups = computed<SpellsByFeature[]>(() => {
    const byFeature = new Map<string, SpellsByFeature>();

    for (const entry of props.spells) {
      const existing = byFeature.get(entry.featureName);

      if (existing) {
        existing.spells.push(entry);

        continue;
      }

      byFeature.set(entry.featureName, {
        featureName: entry.featureName,
        spells: [entry],
      });
    }

    return [...byFeature.values()];
  });
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Раздел с дорожкой — тот же, каким устроены разделы внутри записи: группа
      заклинаний принадлежит своей записи так же, как поля принадлежат объекту -->
    <EditorNestedSection
      v-for="group in groups"
      :key="group.featureName"
      :title="groupTitle(group.featureName)"
      :count="group.spells.length"
      :collapsible="false"
    >
      <div class="flex flex-wrap gap-1.5">
        <WizardSpellChip
          v-for="entry in group.spells"
          :key="entry.spell.id"
          :spell="entry.spell"
          :locked="locked"
          :tone="tone"
          @open="emit('open', entry.spell)"
        />
      </div>
    </EditorNestedSection>
  </div>
</template>
