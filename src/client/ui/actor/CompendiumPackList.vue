<script setup lang="ts">
  /**
   * Список компендиумов в левой колонке окон выбора: «Все компендиумы» и каждый
   * пак с числом записей. Один на все такие окна — строка компендиума везде
   * означает одно и то же, и разный вид сбивал бы: по этим окнам ходят подряд.
   */

  import {
    ALL_PACKS_ID,
    COMPENDIUM_PACK_BUTTON_CLASS,
    COMPENDIUM_PACK_BUTTON_IDLE_CLASS,
    COMPENDIUM_PACK_BUTTON_SELECTED_CLASS,
    COMPENDIUM_PICKER_LABELS,
  } from './constants';

  /** Компендиум строки: чем он адресуется, как назван и что в нём лежит */
  interface PackListEntry {
    packId: string;
    packName: string;
    entries: ReadonlyArray<unknown>;
  }

  defineProps<{
    /** Компендиумы по порядку показа */
    packs: ReadonlyArray<PackListEntry>;
  }>();

  /** Выбранный компендиум или псевдо-пак «все» */
  const selectedPackId = defineModel<string>({ required: true });

  /**
   * Оформление строки: выбранная подсвечена, прочие теплеют только под
   * курсором.
   *
   * @param packId - идентификатор пака
   */
  function packButtonClass(packId: string): string {
    const stateClass =
      selectedPackId.value === packId
        ? COMPENDIUM_PACK_BUTTON_SELECTED_CLASS
        : COMPENDIUM_PACK_BUTTON_IDLE_CLASS;

    return `${COMPENDIUM_PACK_BUTTON_CLASS} ${stateClass}`;
  }

  /**
   * Выбирает компендиум.
   *
   * @param packId - идентификатор пака или псевдо-пака «все»
   */
  function selectPack(packId: string): void {
    selectedPackId.value = packId;
  }
</script>

<template>
  <div class="flex flex-col gap-1">
    <button
      type="button"
      :class="packButtonClass(ALL_PACKS_ID)"
      @click.left.exact.prevent="selectPack(ALL_PACKS_ID)"
    >
      <span class="truncate">
        {{ COMPENDIUM_PICKER_LABELS.allPacks }}
      </span>
    </button>

    <button
      v-for="pack in packs"
      :key="pack.packId"
      type="button"
      :class="packButtonClass(pack.packId)"
      @click.left.exact.prevent="selectPack(pack.packId)"
    >
      <span class="truncate">{{ pack.packName }}</span>

      <span class="shrink-0 text-xs text-dimmed">
        {{ pack.entries.length }}
      </span>
    </button>
  </div>
</template>
