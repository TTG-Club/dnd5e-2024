<script setup lang="ts">
  import type {
    DnDActor,
    FeatChoice,
    FeatChoiceOption,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { ChoicePickerOption } from '../ChoicePickerModal.vue';

  import { computed } from 'vue';

  import {
    clearSpellChoicesOfClass,
    FEAT_CHOICE_TYPE_LABELS,
    getVisibleFeatChoices,
    isAppliedChoiceType,
    resolveFeatChoiceCount,
    resolveFeatChoicePool,
  } from '@vtt/shared/system/dnd.js';

  import { useFeatChoiceWeapons } from '../../../composables/useFeatChoiceWeapons';
  import ChoicePickerField from '../ChoicePickerField.vue';
  import { FEAT_CHOICES_LABELS } from '../constants';
  import { spellCircleLabel } from '../utils/spellCircleLabel';

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
   *
   * Отвечают на них общей строкой выбора ({@link ChoicePickerField}): плашки
   * взятого и кнопка, открывающая окно. Длина пула на вид строки не влияет —
   * раньше короткий пул показывался кнопками, длинный селектом, и один и тот же
   * вопрос выглядел то так, то этак.
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

  /** Виды оружия мира — пул выбора оружия и оружейного приёма */
  const { weaponOptions } = useFeatChoiceWeapons();

  /**
   * Заклинания каталога по идентификатору. Значение выбора заклинания — это и
   * есть id записи компендиума, и по нему строка выбора достаёт круг для плашки
   * и саму запись для карточки: по одному названию игрок не решит, брать ли
   * заклинание, а два одноимённых из разных паков и вовсе неразличимы.
   */
  const spellById = computed(
    () => new Map((props.spells ?? []).map((spell) => [spell.id, spell])),
  );

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
        weapons: weaponOptions.value,
      });

      return {
        choice,
        // Пустой пул объясняется по-разному: «уже владеет всем» верно только
        // там, где выбор сузили флагом владения. Иначе вариантов нет вовсе —
        // справочник не загрузился либо запись их не назвала
        emptyText:
          choice.onlyIfProficient || choice.onlyIfNotProficient
            ? FEAT_CHOICES_LABELS.emptyPool
            : FEAT_CHOICES_LABELS.emptyPoolNoOptions,
        // Подпись у значения есть не всегда: у оружия и заклинаний её задаёт
        // сама черта, а у ключа словаря — справочник
        options: pool.map<ChoicePickerOption>((option) =>
          toPickerOption(option, spellById.value.get(option.value)),
        ),
        max: resolveFeatChoiceCount(choice, props.proficiencyBonus),
        // Предупреждение о ручной механике не для выбора списка класса: он
        // ничего и не должен применять — он лишь сужает следующий вопрос
        manual:
          !isAppliedChoiceType(choice.type) && choice.type !== 'spellList',
      };
    }),
  );

  /**
   * Вариант выбора для окна. У заклинания к названию добавляются английское,
   * круг плашкой и сама запись: по ней окно открывает карточку.
   *
   * @param option - значение пула
   * @param spell - запись заклинания, если значение оказалось его id
   */
  function toPickerOption(
    option: FeatChoiceOption,
    spell: Spell | undefined,
  ): ChoicePickerOption {
    const name = option.name ?? option.value;

    if (!spell) {
      return { value: option.value, name };
    }

    return {
      value: option.value,
      name,
      nameEn: spell.nameEn,
      badge: spellCircleLabel(spell.level),
      spell,
    };
  }

  /** Заголовок выбора: своя подпись черты, иначе название типа */
  function title(choice: FeatChoice): string {
    return choice.label ?? FEAT_CHOICE_TYPE_LABELS[choice.type];
  }

  function chosen(key: string): string[] {
    return selections.value[key] ?? [];
  }

  /**
   * Записывает ответ. Смена списка класса вдобавок стирает выбранные из
   * прежнего списка заклинания: в новом пуле их нет, и оставленный ответ выдал
   * бы персонажу заклинание, которого черта уже не даёт.
   *
   * Лишнее сверх предела отбрасывается: окно выбора его и не наберёт, но предел
   * зависит от бонуса мастерства и мог опуститься уже после ответа.
   *
   * @param choice - выбор, на который отвечают
   * @param values - выбранные значения
   * @param max - сколько значений выбирают
   */
  function setValues(choice: FeatChoice, values: string[], max: number): void {
    const answered = {
      ...selections.value,
      [choice.key]: values.slice(0, max),
    };

    selections.value =
      choice.type === 'spellList'
        ? clearSpellChoicesOfClass(props.choices, answered, choice.key)
        : answered;
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <ChoicePickerField
      v-for="entry in resolved"
      :key="entry.choice.key"
      class="rounded-xl border border-default/50 bg-elevated/30 p-3"
      :label="title(entry.choice)"
      :options="entry.options"
      :selected="chosen(entry.choice.key)"
      :max="entry.max"
      :empty-text="entry.emptyText"
      @update:selected="setValues(entry.choice, $event, entry.max)"
    >
      <template #badges>
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
      </template>

      <template
        v-if="entry.manual"
        #hint
      >
        <p class="text-xs text-warning">
          {{ FEAT_CHOICES_LABELS.manualType }}
        </p>
      </template>
    </ChoicePickerField>
  </div>
</template>
