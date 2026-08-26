<script setup lang="ts">
  import type {
    ActiveEffect,
    DamageDefenseKind,
    SpeciesDefinition,
    SpeciesFeatureChoice,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import {
    DAMAGE_DEFENSE_KIND_LABELS,
    DAMAGE_TYPE_LABELS,
    getConditionEntry,
  } from '@vtt/shared/system/dnd.js';

  import {
    CREATURE_SIZE_LABELS,
    CREATURE_TYPE_LABELS,
    GRANT_FIELD_LABELS,
    GRANT_SECTION_LABELS,
    LEVEL_BADGE_SUFFIX,
    SELECT_FOR_ACTOR_LABEL,
    SPECIES_DETAIL_LABELS,
    SPECIES_FORM_LABELS,
  } from '../constants';
  import ItemEffectsView from '../ItemEffectsView.vue';
  import SourceBadge from '../SourceBadge.vue';

  const props = defineProps<{
    open: boolean;
    speciesDefinition: SpeciesDefinition | null;
    zIndex?: number;
    positionOffset?: number;
    /** Показать кнопку «Выбрать» (окно открыто из выбора вида для персонажа) */
    showSelectButton?: boolean;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'bring-to-front': [];
    /** Запись выбрана для листа персонажа */
    'select': [];
  }>();

  const initialPosition = computed(() =>
    props.positionOffset
      ? { x: props.positionOffset, y: props.positionOffset }
      : undefined,
  );

  const displayType = computed(() => {
    if (!props.speciesDefinition) {
      return '';
    }

    const creatureType = props.speciesDefinition.creatureType;

    return CREATURE_TYPE_LABELS[creatureType] || creatureType;
  });

  const displaySize = computed(() => {
    if (!props.speciesDefinition) {
      return '';
    }

    return props.speciesDefinition.size
      .map((sizeValue) => CREATURE_SIZE_LABELS[sizeValue] || sizeValue)
      .join(SPECIES_DETAIL_LABELS.sizeSeparator);
  });

  const speedDisplay = computed(() => {
    if (!props.speciesDefinition) {
      return '';
    }

    const spd = props.speciesDefinition.speed;

    const parts = [
      `${SPECIES_DETAIL_LABELS.speedWalk} ${spd.walk} ${SPECIES_DETAIL_LABELS.speedUnit}`,
    ];

    if (spd.fly) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedFly} ${spd.fly} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    if (spd.swim) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedSwim} ${spd.swim} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    if (spd.climb) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedClimb} ${spd.climb} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    if (spd.burrow) {
      parts.push(
        `${SPECIES_DETAIL_LABELS.speedBurrow} ${spd.burrow} ${SPECIES_DETAIL_LABELS.speedUnit}`,
      );
    }

    return parts.join(', ');
  });

  // Информационные гранты (доп. способности)
  const infoGrants = computed(() => {
    if (!props.speciesDefinition) {
      return [];
    }

    const grants: { title: string; desc: string }[] = [];

    props.speciesDefinition.grants.forEach((grant) => {
      if (grant.type === 'darkvision') {
        grants.push({
          title: SPECIES_DETAIL_LABELS.darkvision,
          desc: `${grant.range} ${SPECIES_DETAIL_LABELS.speedUnit}`,
        });
      } else if (grant.type === 'damageDefense') {
        const typesByKind = new Map<DamageDefenseKind, string[]>();

        for (const entry of grant.entries) {
          const list = typesByKind.get(entry.kind) ?? [];

          list.push(DAMAGE_TYPE_LABELS[entry.damageType] ?? entry.damageType);
          typesByKind.set(entry.kind, list);
        }

        for (const [kind, types] of typesByKind) {
          grants.push({
            title: DAMAGE_DEFENSE_KIND_LABELS[kind],
            desc: types.join(', '),
          });
        }
      } else if (grant.type === 'conditionImmunity') {
        if (grant.conditions.length > 0) {
          grants.push({
            title: GRANT_FIELD_LABELS.conditionImmunities,
            desc: grant.conditions
              .map((key) => getConditionEntry(key)?.nameRu ?? key)
              .join(', '),
          });
        }
      } else if (
        grant.type === 'language'
        && (!grant.choices || grant.choices.count === 0)
      ) {
        if (grant.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.languages,
            desc: grant.items.join(', '),
          });
        }
      } else if (
        grant.type === 'weaponProficiency'
        && (!grant.choices || grant.choices.count === 0)
      ) {
        if (grant.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.weapons,
            desc: grant.items.join(', '),
          });
        }
      } else if (
        grant.type === 'armorProficiency'
        && (!grant.choices || grant.choices.count === 0)
      ) {
        if (grant.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.equipment,
            desc: grant.items.join(', '),
          });
        }
      } else if (
        grant.type === 'toolProficiency'
        && (!grant.choices || grant.choices.count === 0)
      ) {
        if (grant.items.length > 0) {
          grants.push({
            title: GRANT_SECTION_LABELS.tools,
            desc: grant.items.join(', '),
          });
        }
      }
    });

    return grants;
  });

  /**
   * Подвиды вида: особенности, у которых есть варианты на выбор (`choices`).
   * Каждая группа — это одна особенность-«развилка» (напр. «Наследие
   * драконорождённого») со списком своих вариантов-подвидов и тем, что они дают.
   */
  const subspeciesGroups = computed<
    Array<{ featureName: string; choices: SpeciesFeatureChoice[] }>
  >(() => {
    if (!props.speciesDefinition) {
      return [];
    }

    return props.speciesDefinition.features
      .filter((feature) => feature.choices && feature.choices.length > 0)
      .map((feature) => ({
        featureName: feature.name,
        choices: feature.choices ?? [],
      }));
  });

  const hasSubspecies = computed(() => subspeciesGroups.value.length > 0);

  /**
   * Краткие подписи защит подвида (сопротивления/иммунитеты/уязвимости и
   * иммунитеты к состояниям) — для бейджей в карточке варианта.
   *
   * @param choice - вариант (подвид)
   */
  function choiceDefenseBadges(choice: SpeciesFeatureChoice): string[] {
    const badges: string[] = [];

    for (const entry of choice.damageDefenses ?? []) {
      const damageLabel =
        DAMAGE_TYPE_LABELS[entry.damageType] ?? entry.damageType;

      badges.push(`${DAMAGE_DEFENSE_KIND_LABELS[entry.kind]}: ${damageLabel}`);
    }

    for (const conditionKey of choice.conditionImmunities ?? []) {
      const name = getConditionEntry(conditionKey)?.nameRu ?? conditionKey;

      badges.push(`${SPECIES_DETAIL_LABELS.immunityPrefix}${name}`);
    }

    return badges;
  }

  const hasFeatures = computed(
    () =>
      !!props.speciesDefinition?.features
      && props.speciesDefinition.features.length > 0,
  );

  /**
   * Эффекты вида и его умений одним списком.
   *
   * Вкладка появляется, только когда эффекты есть: у большинства видов их нет, и
   * пустая вкладка была бы шумом в каждом окне.
   */
  const effects = computed<ActiveEffect[]>(() => {
    const definition = props.speciesDefinition;

    if (!definition) {
      return [];
    }

    const collected = [...(definition.activeEffects ?? [])];

    for (const feature of definition.features ?? []) {
      collected.push(...(feature.activeEffects ?? []));
    }

    return collected;
  });

  const tabItems = computed(() => {
    const items: { label: string; slot: string }[] = [
      { label: SPECIES_DETAIL_LABELS.tabGeneral, slot: 'general' },
    ];

    if (hasFeatures.value) {
      items.push({ label: GRANT_SECTION_LABELS.features, slot: 'features' });
    }

    if (hasSubspecies.value) {
      items.push({
        label: SPECIES_DETAIL_LABELS.tabSubspecies,
        slot: 'subspecies',
      });
    }

    if (effects.value.length > 0) {
      items.push({ label: SPECIES_FORM_LABELS.tabEffects, slot: 'effects' });
    }

    return items;
  });
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="speciesDefinition?.name ?? SPECIES_DETAIL_LABELS.fallbackTitle"
    :subtitle="speciesDefinition?.nameEn || undefined"
    :initial-width="800"
    :initial-height="600"
    :min-width="400"
    :min-height="400"
    :resizable="true"
    :z-index="zIndex"
    :saved-position="initialPosition"
    :ui="{ body: 'flex flex-col overflow-hidden' }"
    @update:open="emit('update:open', $event)"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #header-actions>
      <SourceBadge
        :source-key="speciesDefinition?.sourceKey"
        :source="speciesDefinition?.source"
      />

      <UBadge
        v-if="speciesDefinition?.isSRD !== false"
        label="SRD"
        color="primary"
        variant="subtle"
        size="sm"
      />

      <UTooltip
        v-if="showSelectButton"
        :text="SELECT_FOR_ACTOR_LABEL"
      >
        <UButton
          icon="tabler:check"
          size="xs"
          color="primary"
          variant="soft"
          @click.left.exact.prevent="emit('select')"
        />
      </UTooltip>
    </template>

    <template #body>
      <UTabs
        v-if="speciesDefinition"
        :items="tabItems"
        variant="pill"
        class="flex min-h-0 flex-1 flex-col"
        :ui="{
          list: 'mb-3 shrink-0',
          trigger: 'flex-1 justify-center',
          content: 'min-h-0 flex-1 overflow-y-auto',
        }"
      >
        <!-- Основная часть -->
        <template #general>
          <div class="flex flex-col gap-4">
            <!-- Основные характеристики в виде сетки -->
            <div class="grid grid-cols-3 gap-2">
              <!-- Тип -->
              <div
                class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5 text-center"
              >
                <span
                  class="block text-[10px] font-medium tracking-wider text-dimmed uppercase"
                >
                  {{ SPECIES_DETAIL_LABELS.type }}
                </span>

                <p class="mt-0.5 text-sm font-semibold text-highlighted">
                  {{ displayType }}
                </p>
              </div>

              <!-- Размер -->
              <div
                class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5 text-center"
              >
                <span
                  class="block text-[10px] font-medium tracking-wider text-dimmed uppercase"
                >
                  {{ SPECIES_DETAIL_LABELS.size }}
                </span>

                <p class="mt-0.5 text-sm font-semibold text-highlighted">
                  {{ displaySize }}
                </p>
              </div>

              <!-- Скорость -->
              <div
                class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5 text-center"
              >
                <span
                  class="block text-[10px] font-medium tracking-wider text-dimmed uppercase"
                >
                  {{ SPECIES_DETAIL_LABELS.speed }}
                </span>

                <p class="mt-0.5 text-sm font-semibold text-highlighted">
                  {{ speedDisplay }}
                </p>
              </div>

              <!-- Гранты -->
              <div
                v-for="(grant, index) in infoGrants"
                :key="index"
                class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5 text-center"
              >
                <span
                  class="block text-[10px] font-medium tracking-wider text-dimmed uppercase"
                  >{{ grant.title }}</span
                >

                <p class="mt-0.5 text-sm font-semibold text-highlighted">
                  {{ grant.desc }}
                </p>
              </div>
            </div>

            <!-- Описание -->
            <ItemDescriptionRenderer :content="speciesDefinition.description" />
          </div>
        </template>

        <!-- Особенности -->
        <template
          v-if="hasFeatures"
          #features
        >
          <div class="flex flex-col gap-2">
            <div
              v-for="feature in speciesDefinition.features"
              :key="feature.key"
              class="rounded-lg border border-default/50 bg-elevated/30 p-3"
            >
              <div class="mb-1.5 flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-healing">{{
                  feature.name
                }}</span>

                <UBadge
                  v-if="feature.level && feature.level > 1"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  {{ feature.level }}{{ LEVEL_BADGE_SUFFIX }}
                </UBadge>
              </div>

              <ItemDescriptionRenderer :content="feature.description" />

              <div
                v-if="feature.choices && feature.choices.length > 0"
                class="mt-3 border-t border-default/50 pt-2 text-xs text-muted"
              >
                <span class="font-medium text-toned">
                  {{ SPECIES_DETAIL_LABELS.subspeciesPrefix }}
                </span>
                {{ feature.choices.map((option) => option.name).join(', ') }}
              </div>
            </div>
          </div>
        </template>

        <!-- Подвиды -->
        <template
          v-if="hasSubspecies"
          #subspecies
        >
          <div class="flex flex-col gap-5">
            <div
              v-for="group in subspeciesGroups"
              :key="group.featureName"
              class="flex flex-col gap-3"
            >
              <span
                class="block text-xs font-semibold tracking-wider text-dimmed uppercase"
              >
                {{ group.featureName }}
              </span>

              <div
                v-for="choice in group.choices"
                :key="choice.key"
                class="rounded-lg border border-default/50 bg-elevated/30 p-3"
              >
                <span class="text-sm font-medium text-primary">
                  {{ choice.name }}
                </span>

                <ItemDescriptionRenderer
                  v-if="choice.description"
                  :content="choice.description"
                  class="mt-1"
                />

                <!-- Защиты подвида (сопротивления/иммунитеты/уязвимости) -->
                <div
                  v-if="choiceDefenseBadges(choice).length > 0"
                  class="mt-2 flex flex-wrap gap-1.5"
                >
                  <UBadge
                    v-for="badge in choiceDefenseBadges(choice)"
                    :key="badge"
                    color="warning"
                    variant="subtle"
                    size="sm"
                  >
                    {{ badge }}
                  </UBadge>
                </div>

                <!-- Что даёт подвид -->
                <div
                  v-if="choice.features && choice.features.length > 0"
                  class="mt-3 flex flex-col gap-2 border-t border-default/50 pt-3"
                >
                  <div
                    v-for="subFeature in choice.features"
                    :key="subFeature.key"
                    class="rounded-md border border-default/40 bg-default/40 p-2"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-sm font-medium text-healing">
                        {{ subFeature.name }}
                      </span>

                      <UBadge
                        color="neutral"
                        variant="subtle"
                        size="sm"
                      >
                        {{ subFeature.level ?? 1 }}{{ LEVEL_BADGE_SUFFIX }}
                      </UBadge>
                    </div>

                    <ItemDescriptionRenderer
                      :content="subFeature.description"
                      class="mt-1"
                    />

                    <!-- Заклинания, выдаваемые подвидом -->
                    <div
                      v-if="
                        subFeature.grantedSpells
                        && subFeature.grantedSpells.length > 0
                      "
                      class="mt-2 flex flex-wrap gap-1.5"
                    >
                      <UBadge
                        v-for="grantedSpell in subFeature.grantedSpells"
                        :key="grantedSpell.name"
                        color="primary"
                        variant="subtle"
                        size="sm"
                        class="gap-1"
                      >
                        <UIcon
                          name="tabler:sparkles"
                          class="size-3 opacity-60"
                        />
                        {{ grantedSpell.name }}
                      </UBadge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Эффекты — только просмотр: их правит форма вида -->
        <template #effects>
          <ItemEffectsView
            :effects="effects"
            :owner-name="speciesDefinition?.name"
          />
        </template>
      </UTabs>
    </template>
  </UDraggableModal>
</template>
