# D&D 5e System — Архитектура расчётов

Движок правил D&D 5e: типы, расчёты, боевой пайплайн, справочные данные.
Живёт в `packages/shared/src/system/dnd/`, точка входа — `index.ts`.

## Границы: ядро не знает D&D

D&D-кластер **приватен для системы dnd5e**. Ядро (клиентское/серверное `core`,
сторы, сокеты, hooks, транспорт) работает только с нейтральными типами и с
контрактом `VttSystem` — про содержимое D&D-правил оно не знает ничего.

### Импорт только через субпуть

Кластер **не** реэкспортируется из корневого barrel `@vtt/shared`. Он доступен
отдельным экспортом в `packages/shared/package.json`:

```jsonc
"./system/dnd.js": {
  "types": "./src/system/dnd/index.ts",
  "default": "./dist/src/system/dnd/index.js"
}
```

Код системы импортит его так:

```ts
import { calculateWeaponAttackModifier, dnd5eSystemInstance } from '@vtt/shared/system/dnd.js';
```

### Нейтральное ↔ D&D-форма

| Слой | Где | Что знает |
|------|-----|-----------|
| Нейтральные типы | `types/index.ts`, `types/base.ts` | `BaseActor`, `BaseCreature`, `BaseGameItem`, `SceneEntity`, `CompendiumEntry`. Поле `system: Record<string, unknown>` — «чёрный ящик» |
| Нейтральные контракты | `system/contracts/**` | `BaseActiveEffect`, `EffectOrigin`, `EffectDuration`, `EffectAura` — кросс-катные VTT-концепты (зрение, ауры, состояния) |
| Контракт системы | `system/vttSystem.ts` | Интерфейс `VttSystem` — единственная дверь, через которую ядро зовёт правила |
| D&D-форма | `system/dnd/dndEntities.ts` | `DnDActor`, `DnDCreature`, `DnDGameItem`, `Spell` — сужения нейтральных баз |
| D&D-правила | остальной `system/dnd/**` | расчёты, эффекты, урон, отдых, справочники |

**`shared/types` развязан от `system/dnd`.** Из `types/index.ts` есть ровно один
импорт в сторону системы — нейтральный контракт
`system/contracts/activeEffect.js` (`BaseActiveEffect`). Ссылок на `system/dnd`
нет: `base.ts` — примитивный leaf, тянуть в него `system/dnd` нельзя (цикл).

### Носитель инвентаря — свойство записи, а не сорт сущности

Обмен предметами не спрашивает, кто перед ним. `entityGuards.ts` объявляет тип
`DnDInventoryEntity` (сущность сцены с массивом `equipment`) и структурный гвард
`hasInventory`; правило переноса живёт отдельным модулем `itemTransfer.ts` и
знает только этот тип.

Следствие: появится третий носитель предметов — сундук, транспорт, фамильяр —
он вступит в обмен, как только заведёт у себя `equipment`. Править правила
переноса при этом не придётся. Метод контракта
`Dnd5eVttSystem.transferItemBetweenEntities` — тонкая обёртка над
`transferItem`, чтобы у ядра и у листа был один расчёт, а не две копии.

### `dndEntities.ts` — D&D-сущности верхнего уровня

Определения `DnDActor`/`DnDCreature`/`DnDGameItem`/`Spell` **переехали сюда из
`types/index.ts`** — именно этот переезд и развязал ядро типов от движка правил.

Каждая сущность наследует нейтральную базу и добавляет D&D-форму:

```mermaid
graph LR
  BA[BaseActor] --> DA[DnDActor]
  BC[BaseCreature] --> DC[DnDCreature]
  BG[BaseGameItem] --> DG[DnDGameItem]
  BAE[BaseActiveEffect<br/>system/contracts] --> AE[ActiveEffect<br/>system/dnd]
```

Там же — deprecated-алиасы обратной совместимости:
`Actor = DnDActor`, `Creature = DnDCreature`, `GameItem = DnDGameItem`.
В новом коде: `DnD*` — для D&D-специфичного, `Base*` — для generic/core.

### Страж: `no-system-dnd-value-outside-systems`

Правило dependency-cruiser (`.dependency-cruiser.cjs`) — **severity: error**:

| Правило | Конфиг | Кому запрещено импортить `system/dnd` как ЗНАЧЕНИЕ |
|---------|--------|---------------------------------------------------|
| `no-system-dnd-value-outside-systems` | `.dependency-cruiser.cjs` | всему `packages/(server\|shared)/src/`, кроме `server/src/systems/**` и `shared/src/system/dnd/**` |
| `no-client-system-dnd-value-outside-systems` | `.dependency-cruiser.client.cjs` | всему `packages/client/src/`, кроме `client/src/systems/**` |
| `no-core-to-dnd` | `.dependency-cruiser.cjs` | `packages/(server\|client)/src/core/` — включая type-only |
| `no-module-to-dnd` | `.dependency-cruiser.cjs` | `packages/(client\|server)/src/modules/` — включая type-only |

Ключевые детали:

- **type-only импорты разрешены в §0.5-правилах** (`no-system-dnd-value-outside-systems`
  и `no-client-system-dnd-value-outside-systems` — у обоих
  `dependencyTypesNot: ['type-only', 'type-import']`): они стираются при сборке и
  не тянут движок в рантайм-бандл. У `no-core-to-dnd` и `no-module-to-dnd` этого
  исключения **нет** — они запрещают зависимость целиком, включая type-only.
- **Оба §0.5-правила** матчат **и голый спецификатор** `@vtt/shared/system/dnd`,
  **и резолв в исходники** `^packages/shared/src/system/dnd/` — без второго
  паттерна кросс-пакетные рёбра проходили бы мимо и правило было бы мёртвым.
  У `no-core-to-dnd` и `no-module-to-dnd` `to.path` задан только голым
  спецификатором `@vtt/shared/system/dnd`.
- Остальной код обязан ходить через контракт `VttSystem`
  (`systemRegistry.getSystem()` / `getActiveSystem()`).

Проверка: `pnpm arch:check` (клиент + сервер).

### Реализация контракта

`dnd5eSystem.ts` → `class Dnd5eVttSystem implements VttSystem` и синглтон
`dnd5eSystemInstance`. Это и есть D&D-движок, который клиентский код системы
регистрирует через `api.defineSystem(dnd5eSystemInstance)`.

---

## Структура данных Actor

```mermaid
graph TD
  A[DnDActor extends BaseActor] --> B[system: DnDActorSystem]
  B --> C[abilities: DnDAbilityScores]
  B --> D[classes: ActorClassEntry - уровень считается из них]
  B --> E[proficiencies: DnDProficiencies]
  B --> F[movement, armorClass, hitPoints]
  B --> G[initiativeBonus, initiativeAbility]
  B --> K[species, background, size, currency, classCounters]
  A --> H[equipment: GameItem]
  A --> J[spells, features, activeEffects, notes]
  A --> L[BaseActor: id, entityType, name, avatar, token, ownerId]
```

### Поля в `system` (DnDActorSystem)

Всё, что определяется **правилами D&D 5e** (`types.ts`). Тип несёт
`[key: string]: unknown` — index signature для совместимости с
`BaseActor.system: Record<string, unknown>`.

| Поле | Тип | Описание |
|------|-----|----------|
| `abilities` | `DnDAbilityScores` | 6 характеристик (strength, dexterity, constitution, intelligence, wisdom, charisma) |
| `classes` | `ActorClassEntry[]` | Классы персонажа (массив — мультикласс). **Уровень отдельным полем не хранится** |
| `experience` | `number` | Опыт персонажа |
| `species` | `ActorSpeciesEntry \| null` | Вид (бывшая раса) + выборы особенностей |
| `background` | `ActorBackgroundEntry \| null` | Предыстория |
| `size` | `CreatureSize` | Размер (`tiny` … `gargantuan`) |
| `proficiencies` | `DnDProficiencies` | Владения: `armor`, `weapons`, `weaponMasteries`, `tools`, `languages`, `savingThrows`, `skills` |
| `savingThrowSettings` | `DnDSavingThrowSettings?` | Поправки расчёта спасбросков: подменённая характеристика и свои бонусы (`savingThrows.ts`). Поля нет — всё по правилам |
| `skillSettings` | `DnDSkillSettings?` | Поправки расчёта навыков: подменённая характеристика, свои бонусы, свои навыки и группировка списка (`skills.ts`). Поля нет — всё по правилам |
| `movement` | `ActorMovement` | Типы движения (walk, swim, fly, climb, burrow, hover) + `units` |
| `armorClass` | `ActorArmorClass` | КД с формулой расчёта |
| `hitPoints` | `DnDHitPoints` | Хиты: `{ current, max, temp }` |
| `initiativeBonus` | `number` | Дополнительный бонус к инициативе |
| `initiativeAbility` | `AbilityType` | Характеристика для инициативы |
| `currency` | `DnDCurrency` | Валюта (`cp`, `sp`, `ep`, `gp`, `pp`) |
| `classCounters` | `ActorCounterState[]` | Счётчики классовых ресурсов (очки чародейства, кости превосходства) |
| `spellSlotsUsed` | `number[]?` | Использованные ячейки [1–9 круг], индекс 0 = 1-й круг |
| `pactSlotsUsed` | `number?` | Использованные ячейки Pact Magic (колдун) |
| `spellcastingAbility` | `AbilityType?` | Переопределение характеристики заклинаний |
| `spellcastingSettings` | `DnDSpellcastingSettings?` | Поправки расчёта сложности спасброска и бонуса атаки заклинанием: своё число вместо расчёта по правилам и свои бонусы (`spellcastingSettings.ts`). Поля нет — оба числа по правилам |
| `inspiration` | `boolean?` | Вдохновение (даёт/забирает только ГМ) |
| `manualHitDice` | `ManualHitDieGroup[]?` | Ручные кости хитов (NPC/кастомные актёры без классов) |

> **Уровня `system.level` НЕТ.** Суммарный уровень вычисляется:
> `getTotalLevel(actor.system.classes)` (`classTypes.ts`) — сумма `entry.level`
> по всем классам, минимум 1.

### Поля на корне (DnDActor)

Привязаны к конкретному актору, не к правилам:

- **Добавляет `DnDActor`:** `spells`, `equipment`, `features`, `activeEffects`, `notes`
- **Наследует от `BaseActor`:** `id`, `entityType`, `name`, `description`, `avatar`, `token`, `ownerId`, `isPublic`, `autoSaves`, `system`

**У `DnDCreature` корневые коллекции свои и все необязательные:** `spells?`,
`equipment?`, `activeEffects?`. Нейтральные базы (`BaseActor`/`BaseCreature`) о
корневых коллекциях не знают вовсе — их описывает наследник конкретной системы,
а хост хранит запись целиком (`JSON.stringify`) и ничего не вырезает.

> **Хиты на корне отсутствуют.** `currentHitPoints`/`maxHitPoints`/`tempHitPoints`
> удалены — источник истины один: `system.hitPoints.{current,max,temp}`.
> Поле `effects` тоже удалено — актуальное имя `activeEffects: ActiveEffect[]`.

## Расчёт атаки и урона оружием

Итог собирается из разбора: `describeWeapon*` отдаёт слагаемые
(`WeaponModifierPart[]`), а число — их сумма. Один источник и для бейджа на
листе, и для расшифровки в подсказке: разойтись им негде.

Владелец оружия — `DnDSceneEntity`, то есть **и персонаж, и существо**: инвентарь
есть у обоих, и весь расчёт ниже общий. Расходятся они ровно в двух точках —
владение оружием (см. ниже) и основа бонуса мастерства (`getEntityProficiencyBonus`:
у актёра от суммарного уровня классов, у существа от показателя опасности).

```
calculateWeaponAttackModifier(actor, weapon, resolvedStats?)
└─ sum(describeWeaponAttack(actor, weapon, resolvedStats))
   ├─ характеристика: модификатор по ключу
   │  └─ ключ = resolveWeaponAttackAbility(actor, weapon, resolvedStats)
   │     ├─ "finesse" → та из Силы/Ловкости, что больше   ← фехтовальное
   │     └─ иначе weapon.attackAbility ?? getDefaultWeaponAbility(rangeType)
   │        ← без явной характеристики: ranged → Ловкость, melee → Сила
   ├─ мастерство: resolveWeaponProficiency ? бонус мастерства листа : 0
   │              ← строка остаётся с нулём и пометкой «нет владения»
   ├─ weapon.attackBonus                                  ← свой бонус оружия
   ├─ weapon.magicBonus (при isMagical)                    ← магический бонус
   ├─ resolvedStats.attackBonuses[melee|ranged]            ← Active Effects
   └─ weapon.attackCustomBonuses[]                         ← свои бонусы оружия

calculateWeaponDamageModifier(actor, weapon, resolvedStats?)
└─ sum(describeWeaponDamage(actor, weapon, resolvedStats))
   ├─ характеристика: resolveWeaponDamageAbility(...)
   │  ├─ weapon.damageAbility === "none" → слагаемого нет
   │  ├─ weapon.damageAbility → она
   │  └─ поля нет → характеристика атаки
   ├─ weapon.damageBonus
   ├─ weapon.magicBonus (при isMagical)   ← входит в прибавку урона,
   │                                        отдельно её не добавляют
   ├─ resolvedStats.damageBonuses[melee|ranged]
   └─ weapon.damageCustomBonuses[]
```

Реализация — `calculations.ts`.

### resolveWeaponProficiency

Проверяет три режима (`weapon.proficiencyMode ?? 'auto'`):

1. **always** — бонус всегда добавляется
2. **never** — бонус никогда не добавляется
3. **auto** — сверяет `weapon.baseType` и `weapon.weaponCategory` со списком
   `actor.system.proficiencies.weapons[]`. Без `baseType` → `false`

**У существа список владений не заводится.** По статблокам 2024-й монстр умеет
то, чем вооружён, поэтому в режиме `auto` он владеет любым своим оружием, и
бонус мастерства по показателю опасности идёт в атаку всегда. Снять его точечно
можно режимом `never` на самом предмете — он проверяется раньше.

⚠️ Заводить существу `system.proficiencies` **нельзя**: ветка `system.savingThrows`
существа стоит в `effectPipeline` третьим `else if` и перехватывается ЛЮБЫМ
объектом `proficiencies` — владения спасбросками погаснут безусловно. Навыки
переживут (у них есть запасная ветка по `system.skills`) и погаснут, только если
завести в `proficiencies` ещё и `skills`.

Профициенции хранятся **по английским ключам**:
- Конкретные: `"longsword"`, `"shortbow"`, `"handaxe"`
- Категории: `"simple"`, `"martial"`

## Критически важные поля для расчётов

| Расчёт | Поле актёра | Поле оружия |
|--------|-------------|-------------|
| Модификатор атаки | `system.abilities[attackAbility]` | `attackAbility` (по умолчанию — от `rangeType`), `weaponProperties` (finesse) |
| Прибавка к урону | `system.abilities[damageAbility]` | `damageAbility` (нет поля — как у атаки, `none` — без характеристики) |
| Бонус мастерства | `system.classes` (через `getTotalLevel`) | `proficiencyMode` |
| Владение оружием | `system.proficiencies.weapons[]` | `baseType`, `weaponCategory` |
| Бонус к атаке и урону | — | `attackBonus`, `damageBonus` |
| Магический бонус | — | `isMagical`, `magicBonus` |
| Бонусы от эффектов | `ResolvedActorStats.attackBonuses` / `damageBonuses` | `rangeType` (melee/ranged) |
| Свои бонусы оружия | `ResolvedActorStats.abilityBonusContext` | `attackCustomBonuses`, `damageCustomBonuses` |

## Единицы измерения расстояния

Конфигурация единиц вынесена в `packages/shared/src/utils/unitConverter.ts`.

> Модуль **нейтральный** — лежит вне `system/dnd` и доступен из корневого barrel
> `@vtt/shared`. Им пользуются ядро и любая игровая система, не только D&D.

### Поддерживаемые единицы (`DistanceUnit`)

| Ключ | Название | Коэффициент к метрам |
|------|----------|---------------------|
| `ft` | Футы | 0.3048 |
| `m` | Метры | 1 |
| `mi` | Мили | 1609.344 |
| `km` | Километры | 1000 |

### API

- `convertDistance(value, fromUnit, toUnit)` — конвертация между единицами
- `formatDistance(value, unit)` — форматирование с локализованной меткой (`30 фт`)
- `isDistanceUnit(value)` — type guard
- `DISTANCE_UNIT_OPTIONS` — опции для `USelectMenu`
- `DISTANCE_UNIT_LABELS` — полные названия (`Футы (ft)`)
- `DISTANCE_UNIT_SHORT` — короткие метки (`фт`, `м`, `мили`, `км`)
- `CONVERSION_TO_METERS` — **редактируемый конфиг** коэффициентов

### Где используется

| Поле | Где объявлено | Слой |
|------|---------------|------|
| `Scene.gridSettings.units` | `types/base.ts` | нейтральное (default `ft`) |
| `ActorMovement.units` | `types/base.ts` | нейтральное |
| `DnDGameItem.distanceUnit` | `system/dnd/dndEntities.ts` | D&D-форма — reach/range оружия (default `ft`) |
| `CreatureAction.distanceUnit` | `system/dnd/creatureTypes.ts` | D&D-форма — досягаемость действия существа |
| `SystemManifest.defaultDistanceUnit` | `types/module.ts` | манифест системы (`'ft' \| 'm'`) — единица по умолчанию для системы |
