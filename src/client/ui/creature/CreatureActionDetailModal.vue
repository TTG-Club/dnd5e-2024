<script setup lang="ts">
  import type {
    CreatureAction,
    CreatureDamageAlternative,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { DISTANCE_UNIT_SHORT } from '@vtt/shared';
  import {
    AREA_SHAPE_LABELS,
    creatureActionHasSave,
    DEFAULT_REACH_FEET,
    describeCreatureDamageCondition,
    getActionDescriptionMarkdown,
    listCreatureDamageAlternatives,
    readAlternativeShownParts,
    SAVE_EFFECT_OPTIONS,
    SAVE_TYPE_LABELS,
  } from '@vtt/shared/system/dnd.js';

  import { FORM_FIELD_LABELS, SPELL_DETAIL_LABELS } from '../actor/constants';
  import DamagePartsSummary from '../actor/DamagePartsSummary.vue';
  import ItemDetailModalShell from '../actor/ItemDetailModalShell.vue';
  import ItemDetailTabs from '../actor/ItemDetailTabs.vue';
  import ItemEffectsView from '../actor/ItemEffectsView.vue';
  import {
    CREATURE_ACTION_DETAIL_LABELS,
    CREATURE_ACTION_MENU_LABELS,
    CREATURE_DAMAGE_CHOICE_LABELS,
    CREATURE_RECHARGE_HINTS,
  } from './constants';

  type ActionMode = 'trait' | 'action';

  const props = defineProps<{
    /** Открыто ли модальное окно */
    open: boolean;
    /** Действие/черта существа для отображения */
    action: CreatureAction | null;
    /** Режим: черта или действие (влияет на подпись карточки в чат) */
    mode?: ActionMode;
    /** Z-index модалки (управляется родителем) */
    zIndex?: number;
    /** Смещение позиции для каскадного расположения */
    positionOffset?: number;
    /** Показывать кнопку «Атаковать» (только когда действие можно применить) */
    showAttackButton?: boolean;
    /**
     * Подпись кнопки применения: «Атаковать» у атаки, «Использовать» у
     * спасброска и действия без броска («Ловкий побег»)
     */
    attackButtonLabel?: string;
  }>();

  const attackTooltip = computed(
    () => props.attackButtonLabel ?? CREATURE_ACTION_MENU_LABELS.attack,
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Запросить применение действия (бросок) */
    'attack': [];
    /** Поднять модалку наверх */
    'bring-to-front': [];
  }>();

  /** Единица расстояния действия в коротком виде */
  const distanceUnitLabel = computed(
    () => DISTANCE_UNIT_SHORT[props.action?.distanceUnit ?? 'ft'],
  );

  /** Досягаемость ближнего боя действия (по умолчанию — стандартная) */
  const reachValue = computed(() => props.action?.reach ?? DEFAULT_REACH_FEET);

  /** Части урона/лечения действия (для общего DamagePartsSummary) */
  const damageParts = computed(() => props.action?.damageParts ?? []);

  /**
   * Подпись над вариантом урона: «или, если у атакующего: Окровавленный». Своя
   * подпись варианта встаёт перед условием.
   *
   * @param alternative - вариант урона
   * @returns подпись варианта
   */
  function formatAlternativeCaption(
    alternative: CreatureDamageAlternative,
  ): string {
    const head = CREATURE_DAMAGE_CHOICE_LABELS.orPrefix.trim();

    const ownLabel = alternative.label
      ? `${CREATURE_DAMAGE_CHOICE_LABELS.labelOpen}${alternative.label}${CREATURE_DAMAGE_CHOICE_LABELS.labelClose}`
      : '';

    return `${head}${ownLabel}${CREATURE_DAMAGE_CHOICE_LABELS.conditionSeparator}${describeCreatureDamageCondition(
      alternative,
    )}`;
  }

  /**
   * Урон «или» для показа: подпись с условием и части без состояний — условие
   * уже названо в подписи.
   */
  const damageAlternatives = computed(() =>
    (props.action ? listCreatureDamageAlternatives(props.action) : []).map(
      (alternative) => ({
        caption: formatAlternativeCaption(alternative),
        shownParts: readAlternativeShownParts(alternative),
      }),
    ),
  );

  /** Подпись типа броска (ближний, дальний или любой из двух) */
  const attackTypeLabel = computed(() => {
    const rangeType = props.action?.rangeType;

    if (rangeType === 'meleeOrRanged') {
      return CREATURE_ACTION_DETAIL_LABELS.attackMeleeOrRanged;
    }

    return rangeType === 'ranged'
      ? SPELL_DETAIL_LABELS.attackRanged
      : SPELL_DETAIL_LABELS.attackMelee;
  });

  /** Показывать досягаемость: рукопашная и «рукопашная или дальнобойная» */
  const showReach = computed(
    () =>
      props.action?.rangeType === 'melee'
      || props.action?.rangeType === 'meleeOrRanged',
  );

  /** Дистанция: у дальнобойной и «рукопашной или дальнобойной» */
  const shownRange = computed(() =>
    props.action?.rangeType === 'ranged'
    || props.action?.rangeType === 'meleeOrRanged'
      ? props.action.range
      : undefined,
  );

  /** Бонус к попаданию со знаком (напр. «+5», «−1»), пусто если не задан */
  const attackBonusLabel = computed(() => {
    const bonus = props.action?.attackBonus;

    if (bonus === undefined) {
      return '';
    }

    return bonus >= 0 ? `+${bonus}` : String(bonus);
  });

  /** Есть ли у действия спасбросок (заменяет бросок попадания) */
  const hasSave = computed(
    () => !!props.action && creatureActionHasSave(props.action),
  );

  /** Локализованная подпись характеристики спасброска */
  const saveTypeLabel = computed(() => {
    const saveType = props.action?.saveType;

    return saveType ? SAVE_TYPE_LABELS[saveType] : '';
  });

  /** Локализованная подпись эффекта при успешном спасброске */
  const saveEffectLabel = computed(() => {
    if (!props.action?.saveEffect) {
      return '';
    }

    return (
      SAVE_EFFECT_OPTIONS.find((opt) => opt.value === props.action?.saveEffect)
        ?.label ?? props.action.saveEffect
    );
  });

  /** Эффекты действия — показываются все, отключённый помечен в самой строке */
  const actionEffects = computed(() => props.action?.activeEffects ?? []);

  /** Markdown-описание действия */
  const descriptionMarkdown = computed(() =>
    props.action ? getActionDescriptionMarkdown(props.action) : '',
  );

  /** JSON-payload карточки «Поделиться в чат» */
  const chatPayload = computed(() => {
    if (!props.action) {
      return '';
    }

    return JSON.stringify({
      name: props.action.name,
      description: descriptionMarkdown.value,
      featureType: props.mode === 'trait' ? 'feat' : 'feature',
    });
  });
</script>

<template>
  <ItemDetailModalShell
    :open="open"
    :title="action?.name ?? CREATURE_ACTION_DETAIL_LABELS.fallbackTitle"
    :subtitle="action?.nameEn || undefined"
    card-type="feature"
    :chat-payload="chatPayload"
    :z-index="zIndex"
    :position-offset="positionOffset"
    :show-cast-button="false"
    @update:open="emit('update:open', $event)"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #header-extra>
      <UTooltip
        v-if="showAttackButton"
        :text="attackTooltip"
      >
        <UButton
          icon="tabler:swords"
          size="xs"
          color="error"
          variant="soft"
          @click.left.exact.prevent="emit('attack')"
        />
      </UTooltip>
    </template>

    <template #body>
      <ItemDetailTabs v-if="action">
        <!-- Вкладка «Основное» — боевые параметры, дистанция и описание -->
        <template #general>
          <div class="flex flex-col gap-4">
            <!-- Боевые параметры -->
            <div
              v-if="
                action.attackBonus !== undefined
                || hasSave
                || damageParts.length > 0
                || damageAlternatives.length > 0
              "
              class="rounded-lg border border-default/50 bg-elevated/30 p-3"
            >
              <div class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <!-- Тип броска / бонус к попаданию -->
                <div v-if="action.attackBonus !== undefined && !hasSave">
                  <span class="block text-xs text-dimmed">{{
                    attackTypeLabel
                  }}</span>

                  <p class="font-mono font-semibold text-highlighted">
                    {{ attackBonusLabel }}
                  </p>
                </div>

                <!-- Спасбросок -->
                <div v-if="hasSave">
                  <span class="block text-xs text-dimmed">
                    {{ FORM_FIELD_LABELS.savingThrow }}
                  </span>

                  <p
                    class="mt-0.5 text-xs font-semibold tracking-wider text-highlighted uppercase"
                  >
                    {{ saveTypeLabel }}
                    {{ action.saveDC ?? '?'
                    }}<span
                      v-if="saveEffectLabel"
                      class="ml-1 font-normal tracking-normal text-muted normal-case"
                      >({{ saveEffectLabel }})</span
                    >
                  </p>
                </div>

                <!-- Урон / Лечение -->
                <DamagePartsSummary :parts="damageParts" />

                <!-- Урон «или»: каждый вариант со своим условием -->
                <div
                  v-for="(alternative, alternativeIndex) in damageAlternatives"
                  :key="alternativeIndex"
                  class="flex flex-col gap-1"
                >
                  <span class="text-xs text-dimmed">
                    {{ alternative.caption }}
                  </span>

                  <DamagePartsSummary :parts="alternative.shownParts" />
                </div>
              </div>
            </div>

            <!-- Перезарядка: условие есть и у особенности, поэтому стоит
              отдельной строкой, а не в ряду боевых чисел -->
            <div
              v-if="action.recharge"
              class="text-sm"
            >
              <span class="text-xs text-dimmed"
                >{{ CREATURE_ACTION_DETAIL_LABELS.rechargePrefix }}
              </span>

              <span class="text-highlighted">
                {{ CREATURE_RECHARGE_HINTS[action.recharge] }}
              </span>
            </div>

            <!-- Дистанция / Область -->
            <div
              v-if="action.areaOfEffect || action.rangeType"
              class="flex flex-wrap gap-x-6 gap-y-1 text-sm"
            >
              <div v-if="action.areaOfEffect">
                <span class="text-xs text-dimmed"
                  >{{ CREATURE_ACTION_DETAIL_LABELS.areaPrefix }}
                </span>

                <span class="text-highlighted">
                  {{
                    AREA_SHAPE_LABELS[action.areaOfEffect.shape]
                    ?? action.areaOfEffect.shape
                  }}
                  {{ action.areaOfEffect.size }} {{ distanceUnitLabel }}
                </span>
              </div>

              <template v-else>
                <div v-if="showReach">
                  <span class="text-xs text-dimmed"
                    >{{ CREATURE_ACTION_DETAIL_LABELS.reachPrefix }}
                  </span>

                  <span class="text-highlighted">
                    {{ reachValue }} {{ distanceUnitLabel }}
                  </span>
                </div>

                <div v-if="shownRange">
                  <span class="text-xs text-dimmed"
                    >{{ CREATURE_ACTION_DETAIL_LABELS.rangePrefix }}
                  </span>

                  <span class="text-highlighted">
                    {{ shownRange.normal
                    }}<template v-if="shownRange.long"
                      >/{{ shownRange.long }}</template
                    >
                    {{ distanceUnitLabel }}
                  </span>
                </div>
              </template>
            </div>

            <!-- Описание -->
            <div v-if="descriptionMarkdown">
              <ItemDescriptionRenderer :content="descriptionMarkdown" />
            </div>
          </div>
        </template>

        <!-- Вкладка «Эффекты» — только просмотр. Вкладка стоит всегда, даже
          пустая: действие эффекты носит, и по отсутствию вкладки нельзя было бы
          понять, их нет или их тут не показывают. Строка эффекта открывает
          карточку с разбором -->
        <template #effects>
          <ItemEffectsView
            :effects="actionEffects"
            :owner-name="action.name"
          />
        </template>
      </ItemDetailTabs>
    </template>
  </ItemDetailModalShell>
</template>
