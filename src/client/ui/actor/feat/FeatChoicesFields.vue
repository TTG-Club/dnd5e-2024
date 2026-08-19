<script setup lang="ts">
  import type { DnDActor, FeatChoice, Spell } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    FEAT_CHOICE_TYPE_LABELS,
    isAppliedChoiceType,
    resolveFeatChoiceCount,
    resolveFeatChoicePool,
  } from '@vtt/shared/system/dnd.js';

  import { FEAT_CHOICES_LABELS } from '../constants';

  /**
   * Список выборов черты с уже разрешёнными пулами вариантов.
   *
   * Компонент общий для двух окон: выдачи черты и пересмотра выборов на
   * продолжительном отдыхе — набор выборов там разный, а сама работа одна.
   */
  const props = defineProps<{
    /** Выборы, которые предстоит сделать */
    choices: FeatChoice[];
    /** Лист персонажа: по нему сужается пул и считается бонус мастерства */
    actor: DnDActor;
    /** Бонус мастерства — от него зависит количество у некоторых выборов */
    proficiencyBonus: number;
    /**
     * Заклинания компендиума — пул выбора заклинания или заговора. Каталог приходит
     * снаружи, чтобы окно и проверка готовности смотрели на один и тот же список
     * (см. `useFeatChoiceSpells`). Пусто — такой выбор остаётся без вариантов.
     */
    spells?: ReadonlyArray<Spell>;
  }>();

  /** Сделанный выбор: ключ выбора → выбранные значения */
  const selections = defineModel<Record<string, string[]>>({ required: true });

  /** Выборы с разрешённым пулом и пределом — считаем один раз, а не в шаблоне */
  const resolved = computed(() =>
    props.choices.map((choice) => ({
      choice,
      pool: resolveFeatChoicePool(choice, props.actor, {
        spells: props.spells,
        selections: selections.value,
      }),
      max: resolveFeatChoiceCount(choice, props.proficiencyBonus),
      applied: isAppliedChoiceType(choice.type),
    })),
  );

  /** Заголовок выбора: своя подпись черты, иначе название типа */
  function title(choice: FeatChoice): string {
    return choice.label ?? FEAT_CHOICE_TYPE_LABELS[choice.type];
  }

  function chosen(key: string): string[] {
    return selections.value[key] ?? [];
  }

  /** Отмечено ли значение в этом выборе */
  function isPicked(key: string, value: string): boolean {
    return chosen(key).includes(value);
  }

  /** Цвет кнопки варианта: отмеченный подсвечен */
  function optionColor(key: string, value: string): 'primary' | 'neutral' {
    return isPicked(key, value) ? 'primary' : 'neutral';
  }

  /** Вид кнопки варианта: отмеченный залит */
  function optionVariant(key: string, value: string): 'solid' | 'soft' {
    return isPicked(key, value) ? 'solid' : 'soft';
  }

  /**
   * Переключает значение с учётом предела. Выбор на одно значение заменяется
   * новым — так же, как это делает шаг навыков мастера класса.
   */
  function toggle(key: string, value: string, max: number): void {
    const current = [...chosen(key)];
    const index = current.indexOf(value);

    if (index !== -1) {
      current.splice(index, 1);
    } else if (max === 1) {
      selections.value = { ...selections.value, [key]: [value] };

      return;
    } else if (current.length < max) {
      current.push(value);
    }

    selections.value = { ...selections.value, [key]: current };
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-for="entry in resolved"
      :key="entry.choice.key"
      class="flex flex-col gap-2 rounded-xl border border-default/50 bg-elevated/30 p-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium text-highlighted">
          {{ title(entry.choice) }}
        </span>

        <span class="text-xs text-dimmed">
          {{ FEAT_CHOICES_LABELS.chosenPrefix
          }}{{ chosen(entry.choice.key).length
          }}{{ FEAT_CHOICES_LABELS.chosenMiddle }}{{ entry.max }}
        </span>

        <UBadge
          v-if="entry.choice.grants === 'expertise'"
          color="primary"
          variant="subtle"
          size="sm"
        >
          {{ FEAT_CHOICES_LABELS.expertise }}
        </UBadge>

        <UBadge
          v-if="entry.choice.rechooseOnLongRest"
          color="neutral"
          variant="subtle"
          size="sm"
        >
          {{ FEAT_CHOICES_LABELS.rechoose }}
        </UBadge>
      </div>

      <p
        v-if="!entry.applied"
        class="text-xs text-warning"
      >
        {{ FEAT_CHOICES_LABELS.manualType }}
      </p>

      <p
        v-if="entry.pool.length === 0"
        class="text-xs text-dimmed italic"
      >
        {{ FEAT_CHOICES_LABELS.emptyPool }}
      </p>

      <div
        v-else
        class="flex flex-wrap gap-2"
      >
        <UButton
          v-for="option in entry.pool"
          :key="option.value"
          size="xs"
          :color="optionColor(entry.choice.key, option.value)"
          :variant="optionVariant(entry.choice.key, option.value)"
          @click.left.exact.prevent="
            toggle(entry.choice.key, option.value, entry.max)
          "
        >
          {{ option.name ?? option.value }}
        </UButton>
      </div>
    </div>
  </div>
</template>
