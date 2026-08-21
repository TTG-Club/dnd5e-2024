<script setup lang="ts">
  import type { DnDActor, FeatChoice, Spell } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    clearSpellChoicesOfClass,
    FEAT_CHOICE_TYPE_LABELS,
    getVisibleFeatChoices,
    isAppliedChoiceType,
    resolveFeatChoiceCount,
    resolveFeatChoicePool,
  } from '@vtt/shared/system/dnd.js';

  import { FEAT_CHOICE_BADGES_LIMIT, FEAT_CHOICES_LABELS } from '../constants';

  /**
   * Список выборов черты с уже разрешёнными пулами вариантов.
   *
   * Компонент общий для двух окон: выдачи черты и пересмотра выборов на
   * продолжительном отдыхе — набор выборов там разный, а сама работа одна.
   *
   * Выборы приходят уже разложенные по порядку (`prepareFeatChoices`): сперва
   * список класса, потом заклинания из него, потом характеристика. Спрашиваются
   * не все сразу — выбор заклинания ждёт ответа про класс, иначе пул собран не
   * из того списка.
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
    /**
     * Классы, названные источником черты: предыстория «Мудрец» выдаёт
     * «Посвящённого в магию (Волшебник)» — пул сужается до её класса.
     */
    namedClassKeys?: ReadonlyArray<string>;
  }>();

  /** Сделанный выбор: ключ выбора → выбранные значения */
  const selections = defineModel<Record<string, string[]>>({ required: true });

  /** Выборы, которые спрашиваются сейчас: остальные ждут ответа про класс */
  const visible = computed(() =>
    getVisibleFeatChoices(props.choices, selections.value),
  );

  /** Выборы с разрешённым пулом и пределом — считаем один раз, а не в шаблоне */
  const resolved = computed(() =>
    visible.value.map((choice) => {
      const pool = resolveFeatChoicePool(choice, props.actor, {
        spells: props.spells,
        selections: selections.value,
        namedClassKeys: props.namedClassKeys,
      });

      return {
        choice,
        pool,
        // Подпись у значения есть не всегда: у оружия и заклинаний её задаёт
        // сама черта, а у ключа словаря — справочник
        items: pool.map((option) => ({
          value: option.value,
          label: option.name ?? option.value,
        })),
        // Список заклинаний класса в бейджи не помещается: заговоров волшебника
        // под два десятка, и выбирать их проще списком с поиском
        searchable: pool.length > FEAT_CHOICE_BADGES_LIMIT,
        max: resolveFeatChoiceCount(choice, props.proficiencyBonus),
        // Предупреждение о ручной механике не для выбора списка класса: он
        // ничего и не должен применять — он лишь сужает следующий вопрос
        manual:
          !isAppliedChoiceType(choice.type) && choice.type !== 'spellList',
      };
    }),
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
   * Ответы после смены значения. Смена списка класса вдобавок стирает выбранные
   * из прежнего списка заклинания: в новом пуле их нет, и оставленный ответ выдал
   * бы персонажу заклинание, которого черта уже не даёт.
   *
   * @param choice - выбор, на который отвечают
   * @param values - выбранные значения
   */
  function withAnswer(
    choice: FeatChoice,
    values: string[],
  ): Record<string, string[]> {
    const answered = { ...selections.value, [choice.key]: values };

    return choice.type === 'spellList'
      ? clearSpellChoicesOfClass(props.choices, answered, choice.key)
      : answered;
  }

  /**
   * Записывает выбранное списком с поиском. Лишнее сверх предела отбрасывается:
   * список сам его не ограничивает, а предел задаёт черта.
   *
   * @param choice - выбор, на который отвечают
   * @param values - отмеченные значения
   * @param max - сколько значений выбирают
   */
  function setValues(choice: FeatChoice, values: string[], max: number): void {
    selections.value = withAnswer(choice, values.slice(0, max));
  }

  /**
   * Переключает значение с учётом предела. Выбор на одно значение заменяется
   * новым — так же, как это делает шаг навыков мастера класса.
   */
  function toggle(choice: FeatChoice, value: string, max: number): void {
    const current = [...chosen(choice.key)];
    const index = current.indexOf(value);

    if (index !== -1) {
      current.splice(index, 1);
    } else if (max === 1) {
      selections.value = withAnswer(choice, [value]);

      return;
    } else if (current.length < max) {
      current.push(value);
    }

    selections.value = withAnswer(choice, current);
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
        v-if="entry.manual"
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

      <USelectMenu
        v-else-if="entry.searchable"
        :model-value="chosen(entry.choice.key)"
        :items="entry.items"
        value-key="value"
        label-key="label"
        multiple
        :placeholder="FEAT_CHOICES_LABELS.searchPlaceholder"
        class="w-full"
        @update:model-value="setValues(entry.choice, $event, entry.max)"
      />

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
            toggle(entry.choice, option.value, entry.max)
          "
        >
          {{ option.name ?? option.value }}
        </UButton>
      </div>
    </div>
  </div>
</template>
