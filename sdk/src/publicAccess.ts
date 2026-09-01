/**
 * Единая модель «как приложение доступно снаружи».
 *
 * Модуль отвечает на два вопроса и больше ни на что:
 * 1. каким способом до сервера доходят игроки (`AccessMode`);
 * 2. какой у него ПУБЛИЧНЫЙ адрес, если он вообще есть (`publicOrigin`).
 *
 * Здесь живут ТОЛЬКО чистые функции и типы — источником значений на сервере
 * является `server/src/core/publicAccess.ts`, а на клиенте значение приезжает
 * с сервера (см. `client/src/core/publicAccess.ts`) и кладётся в холдер
 * {@link setPublicAccessInfo}. Клиент НИКОГДА не угадывает режим сам.
 *
 * Сегодня публичного origin не бывает: и `local`, и `upnp` работают ровно как
 * раньше — прямой доступ по `hostname:порт мира`. Поле существует ради
 * обратного туннеля, где публичный адрес — это поддомен на 443 порту, а порт
 * мира снаружи не виден вообще.
 *
 * @module publicAccess
 */

/**
 * Способ, которым игрок доходит до сервера мира.
 *
 * - `local` — прямое подключение по адресу машины ГМа (локальная сеть или
 *   белый IP с ручным пробросом порта). Историческое поведение.
 * - `upnp` — то же прямое подключение, но порт на роутере открыт автоматически.
 *   С точки зрения адресов НИЧЕМ не отличается от `local`.
 * - `tunnel` — подключение через обратный туннель: снаружи публичный поддомен
 *   на 443, локальный порт мира не виден.
 */
export type AccessMode = 'local' | 'upnp' | 'tunnel';

/**
 * Состояние подключения через сервис TTG (обратный туннель).
 *
 * ⚠️ Пока туннеля нет, сервер всегда отдаёт `unavailable`. Остальные значения
 * заведены заранее — под них свёрстан интерфейс окна «Поделиться ссылкой»,
 * и клиент туннеля начнёт их отдавать без правок клиента.
 */
export type TunnelStatus =
  /** Сборка приложения туннель не поддерживает (текущее состояние) */
  | 'unavailable'
  /** Возможность доступна по подписке, активной подписки нет */
  | 'no-subscription'
  /** Подписка есть, туннель выключен в настройках */
  | 'disabled'
  /**
   * Туннель не нужен: порт мира доступен снаружи, игроки ходят напрямую.
   *
   * Это НЕ отказ. Прямое подключение объективно лучше туннеля — один сетевой
   * прыжок вместо двух и квота сервиса не расходуется, поэтому приложение
   * выбирает его само, пока пользователь не включил туннель принудительно.
   */
  | 'direct'
  /** Туннель поднимается или переподключается */
  | 'connecting'
  /** Туннель работает, публичная ссылка выдана */
  | 'active';

/**
 * Ответ сервера на вопрос «как ты доступен снаружи».
 *
 * Отдаётся эндпоинтом `/api/public-access` и мастер-сервером, и сервером мира;
 * `originPort` различает эти два случая.
 */
export interface PublicAccessInfo {
  /** Способ подключения к ЭТОМУ серверу */
  mode: AccessMode;
  /**
   * Публичный origin этого сервера (`https://ivan-a7k2m9.play.ttg.club`) или
   * `null`, если публичного адреса нет. Всегда без завершающего слэша и без
   * порта, когда порт стандартный для схемы.
   */
  publicOrigin: string | null;
  /** Схема публичного адреса (`https` только у туннеля) */
  scheme: 'http' | 'https';
  /**
   * Локальный порт, который обслуживает `publicOrigin`: порт мира у сервера
   * мира, `null` у панели управления (она мир не обслуживает).
   */
  originPort: number | null;
  /** Состояние подключения через сервис TTG */
  tunnelStatus: TunnelStatus;
  /**
   * Карта «локальный порт мира → публичный origin», заполняемая клиентом
   * туннеля по подтверждённым нодой хостам.
   *
   * Нужна прежде всего панели управления: у неё `originPort === null`, своего
   * мира нет, а ссылки на чужие миры строить надо. Ключ — порт числом в виде
   * строки (иначе объект не переживёт JSON).
   *
   * Пустой объект — норма для локального режима и UPnP.
   */
  worldOrigins: Record<string, string>;
  /**
   * Человекочитаемое пояснение к состоянию туннеля: «квота исчерпана»,
   * «войдите в аккаунт», «нод нет». `null` — пояснять нечего.
   *
   * Существует, чтобы интерфейс не сводил разные отказы к одной фразе
   * «ошибка подключения».
   */
  tunnelMessage: string | null;
}

/**
 * Значение по умолчанию — ровно сегодняшнее поведение без публичного адреса.
 *
 * Используется как фоллбэк, когда сервер старый (эндпоинта нет) или ответ не
 * разобрался: приложение обязано работать как раньше, а не падать.
 */
export const DEFAULT_PUBLIC_ACCESS: PublicAccessInfo = {
  mode: 'local',
  publicOrigin: null,
  scheme: 'http',
  originPort: null,
  tunnelStatus: 'unavailable',
  worldOrigins: {},
  tunnelMessage: null,
};

/** Origin вида `http(s)://host[:port]` без пути, запроса и хвостового слэша. */
const PUBLIC_ORIGIN_REGEX = /^https?:\/\/[^/?#\s]+$/;

/** Хвостовые слэши в конце строки. */
const TRAILING_SLASHES_REGEX = /\/+$/;

/**
 * Приводит публичный origin к каноничному виду и отбраковывает мусор.
 *
 * Принимает только абсолютный `http`/`https` origin без пути: всё остальное
 * (относительный путь, адрес с `/api`, пустая строка) — не origin, и молча
 * склеивать его с путями ассетов нельзя.
 *
 * @param raw - значение из конфигурации или ответа сервера
 * @returns origin без завершающего слэша либо null
 */
export function normalizePublicOrigin(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim().replace(TRAILING_SLASHES_REGEX, '');

  if (!trimmed || !PUBLIC_ORIGIN_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
}

// ── Холдер значения на клиенте ──────────────────────────────────────────────

/**
 * Что сервер сообщил о своей публичной доступности. `null` — ответа ещё нет
 * (или сервер старый): потребители обязаны вести себя как в локальном режиме.
 */
let currentPublicAccess: PublicAccessInfo | null = null;

/**
 * Кладёт в холдер данные, полученные С СЕРВЕРА.
 *
 * Единственный писатель — бутстрап клиента. Ничто в приложении не должно
 * вычислять эти значения из `window.location` самостоятельно.
 *
 * @param info - ответ сервера либо null для сброса
 */
export function setPublicAccessInfo(info: PublicAccessInfo | null): void {
  currentPublicAccess = info;
}

/**
 * Возвращает известные данные о публичной доступности сервера.
 *
 * @returns данные сервера либо null, если ответа ещё не было
 */
export function getPublicAccessInfo(): PublicAccessInfo | null {
  return currentPublicAccess;
}

/**
 * Возвращает публичный origin, по которому снаружи доступен КОНКРЕТНЫЙ порт.
 *
 * Источников два, в порядке доверия:
 * 1. карта `worldOrigins` — её заполняет клиент туннеля по хостам, которые
 *    ПОДТВЕРДИЛА нода; она знает про все запущенные миры, а не только про свой,
 *    поэтому по ней панель управления (`originPort === null`) строит ссылки;
 * 2. собственный `publicOrigin` сервера — на случай, если карта до клиента ещё
 *    не доехала, а про себя сервер ответил.
 *
 * `null` — публичного адреса нет. Это НОРМА для локального режима и UPnP: там
 * игроки ходят напрямую по `hostname:порт`, и подменять адрес нечем.
 *
 * @param access - данные сервера о публичном доступе
 * @param port - интересующий локальный порт (порт мира)
 * @returns публичный origin для этого порта либо null
 */
export function resolvePublicOriginForPort(
  access: PublicAccessInfo | null | undefined,
  port: number,
): string | null {
  if (!access) {
    return null;
  }

  const mapped = normalizePublicOrigin(access.worldOrigins?.[String(port)]);

  if (mapped) {
    return mapped;
  }

  if (!access.publicOrigin || access.originPort === null) {
    return null;
  }

  return access.originPort === port ? access.publicOrigin : null;
}

/**
 * Адресная строка в объёме, нужном для сборки адресов.
 *
 * Отдельный тип вместо `Location` — чтобы функции оставались чистыми и
 * тестируемыми, а серверный код мог их звать вообще без `window`.
 */
export interface BrowserLocationParts {
  /** Схема с двоеточием, как у `window.location.protocol` (`https:`) */
  protocol: string;
  /**
   * Хост без порта, как у `window.location.hostname`. У IPv6 браузер отдаёт
   * его УЖЕ в скобках (`[::1]`) — оборачивать повторно нельзя.
   */
  hostname: string;
  /** Хост с портом, как у `window.location.host` (порт по умолчанию опущен) */
  host: string;
}

/**
 * Открыта ли текущая страница через указанный публичный origin.
 *
 * @param origin - публичный origin вида `https://ivan.play.ttg.club`
 * @param location - части адресной строки
 * @returns true, если страница пришла именно с этого хоста
 */
function isSameHost(origin: string, location: BrowserLocationParts): boolean {
  const separator = origin.indexOf('://');

  if (separator === -1) {
    return false;
  }

  return (
    origin.slice(separator + 3).toLowerCase() === location.host.toLowerCase()
  );
}

/**
 * Пришла ли текущая страница через сервис TTG (по любому публичному адресу).
 *
 * Проверяются оба вида публичных хостов: собственный `publicOrigin` сервера
 * (у панели управления это хост аккаунта) и все поддомены миров из карты.
 * Совпадение хоть с одним означает, что браузер СНАРУЖИ: до машины ГМа он
 * дошёл через ноду, и прямые адреса `hostname:порт` ему не видны.
 *
 * @param access - данные сервера о публичном доступе
 * @param location - части адресной строки
 * @returns true, если страница открыта по публичному адресу сервиса
 */
function isPublicAccessHost(
  access: PublicAccessInfo | null | undefined,
  location: BrowserLocationParts,
): boolean {
  if (!access) {
    return false;
  }

  const ownOrigin = normalizePublicOrigin(access.publicOrigin);

  if (ownOrigin && isSameHost(ownOrigin, location)) {
    return true;
  }

  for (const rawWorldOrigin of Object.values(access.worldOrigins)) {
    const worldOrigin = normalizePublicOrigin(rawWorldOrigin);

    if (worldOrigin && isSameHost(worldOrigin, location)) {
      return true;
    }
  }

  return false;
}

/**
 * Собирает адрес, по которому мир ОТКРЫВАЕТСЯ из панели управления.
 *
 * Решает ровно один вопрос: вести человека напрямую или через сервис TTG.
 * Ответ даёт не наличие туннеля, а то, откуда открыта сама панель:
 *
 * 1. панель открыта НЕ по публичному адресу сервиса (настольное приложение —
 *    это всегда `localhost`, плюс любой заход из локальной сети) — значит
 *    браузер уже дотянулся до машины ГМа напрямую, и мир на том же хосте
 *    доступен тем же путём. Гнать этот трафик через ноду незачем: лишний
 *    сетевой прыжок, лишняя задержка и расход квоты сервиса на ровном месте;
 * 2. панель открыта по публичному адресу — браузер снаружи, прямой адрес ему
 *    не виден, ведём в мир по его публичному поддомену;
 * 3. публичного адреса у мира ещё нет (нода не подтвердила хост) — вести
 *    некуда: `публичный-хост-панели:порт мира` наружу не отвечает. Возвращаем
 *    `null`, чтобы интерфейс сказал об этом, а не открыл мёртвую вкладку.
 *
 * Это тот же принцип, что и в {@link resolveServerBaseUrl}: публичный адрес
 * применяется только к тем, кто реально пришёл снаружи.
 *
 * @param worldPort - локальный порт сервера мира
 * @param access - данные сервера о публичном доступе
 * @param location - части адресной строки (null вне браузера)
 * @returns origin мира без завершающего слэша либо null, если адреса нет
 */
export function resolveWorldEntryOrigin(
  worldPort: number,
  access: PublicAccessInfo | null | undefined,
  location: BrowserLocationParts | null,
): string | null {
  if (!location) {
    return `http://localhost:${worldPort}`;
  }

  if (!isPublicAccessHost(access, location)) {
    // Схема ПРИБИТА к http, и наследовать её из адресной строки нельзя.
    // Наши серверы TLS не терминируют никогда: панель отвечает по https
    // только за чужим обратным прокси, а тот фронтит её порт — не порты
    // миров. `https://хост:<порт мира>` в такой раскладке мёртв: рукопожатие
    // обрывается на первом же байте, вкладка остаётся пустой, и человек видит
    // адрес корня вместо сцены. Понижение схемы браузер не блокирует: это
    // переход верхнего уровня, а не подгрузка ассета.
    //
    // В {@link resolveServerBaseUrl} наоборот — там схему берут со страницы
    // САМОГО мира, и она уже говорит правду о том, как до мира дошли.
    return `http://${location.hostname}:${worldPort}`;
  }

  return resolvePublicOriginForPort(access, worldPort);
}

/**
 * Считывает нужные части адресной строки браузера.
 *
 * @returns части адресной строки либо null вне браузера (SSR, тесты, сервер)
 */
export function readBrowserLocation(): BrowserLocationParts | null {
  if (typeof window === 'undefined' || !window.location) {
    return null;
  }

  const { protocol, hostname, host } = window.location;

  return { protocol, hostname, host };
}

/**
 * Собирает базовый URL сервера мира.
 *
 * Порядок решений:
 * 1. страница ОТКРЫТА через публичный адрес этого порта (игрок пришёл по
 *    туннелю) — отдаём публичный origin БЕЗ порта: снаружи мир живёт на 443,
 *    локальный порт наружу не торчит;
 * 2. есть адресная строка — `схема из адресной строки` + hostname + порт мира,
 *    то есть историческое поведение, но без прибитого `http:` (иначе за
 *    HTTPS-прокси браузер режет ассеты как mixed content);
 * 3. браузера нет (SSR, тесты) — `http://localhost:<порт>`.
 *
 * Сверка с адресной строкой в пункте 1 обязательна: у ГМа, открывшего мир
 * локально, публичный адрес тоже известен, но гнать его карты и звук через
 * ноду незачем — это чужой трафик, чужая задержка и чужая квота.
 *
 * @param worldPort - порт сервера мира; 0/undefined → относительный URL
 * @param access - данные сервера о публичном доступе
 * @param location - части адресной строки (null вне браузера)
 * @returns базовый URL без завершающего слэша либо пустая строка
 */
export function resolveServerBaseUrl(
  worldPort: number | undefined,
  access: PublicAccessInfo | null | undefined,
  location: BrowserLocationParts | null,
): string {
  if (!worldPort) {
    return '';
  }

  const publicOrigin = resolvePublicOriginForPort(access, worldPort);

  if (
    publicOrigin
    && (location === null || isSameHost(publicOrigin, location))
  ) {
    return publicOrigin;
  }

  if (location) {
    // Схему наследуем из адресной строки: страница по https обязана тянуть
    // ассеты по https, иначе браузер их просто заблокирует.
    const scheme = location.protocol === 'https:' ? 'https:' : 'http:';

    return `${scheme}//${location.hostname}:${worldPort}`;
  }

  return `http://localhost:${worldPort}`;
}

/**
 * Собирает `host:port` для WebSocket-подключения к серверу мира.
 *
 * За туннелем порт добавлять НЕЛЬЗЯ: снаружи мир доступен на 443 по поддомену,
 * и `hostname:30000` там никуда не ведёт. В локальном режиме поведение
 * прежнее — hostname из адресной строки плюс порт мира.
 *
 * @param worldPort - порт сервера мира
 * @param access - данные сервера о публичном доступе
 * @param location - части адресной строки
 * @returns строка вида `host` (туннель) либо `hostname:port` (локально)
 */
export function resolveWebSocketTarget(
  worldPort: number,
  access: PublicAccessInfo | null | undefined,
  location: BrowserLocationParts,
): string {
  if (resolvePublicOriginForPort(access, worldPort)) {
    return location.host;
  }

  return `${location.hostname}:${worldPort}`;
}
