/**
 * Утилиты для работы с путями к ассетам (изображениям, аудио и т.д.)
 */

import {
  getPublicAccessInfo,
  readBrowserLocation,
  resolveServerBaseUrl,
} from './publicAccess.js';

/**
 * Максимальный размер медиафайла по любой стороне в пикселях.
 *
 * Единый лимит для клиента (предпроверка видео перед загрузкой) и сервера
 * (автоматическое сжатие изображений при загрузке).
 */
export const MEDIA_MAX_DIMENSION_PX = 8192;

/**
 * Пространство файлов, с которым работает файловый менеджер.
 *
 * - `world` — папка конкретного мира. Файлы видны только этому миру.
 * - `shared` — общая папка установки (`<папка данных>/shared`). Файлы видны
 *   ВСЕМ мирам и переезжают вместе с папкой данных.
 */
export type AssetSpaceId = 'world' | 'shared';

/**
 * Префиксы статической раздачи по пространствам — КОНТРАКТ СЕРВЕРА.
 *
 * Сервер строит `url` записи листинга как `<префикс><относительный путь>`,
 * клиент разбирает обратно через {@link resolveAssetRelativePath}. Менять
 * только вместе с маршрутами в `staticFiles.ts`.
 */
export const ASSET_SPACE_URL_PREFIXES: Record<AssetSpaceId, string> = {
  world: '/world/',
  shared: '/shared-assets/',
};

/**
 * Имя ОБЩЕЙ папки внутри папки данных приложения (`<папка данных>/shared`).
 *
 * Единый источник правды для трёх мест: маршрутов файлового менеджера,
 * статической раздачи `/shared-assets/*` и списка переносимых элементов при
 * смене папки данных (`dataMigration`).
 */
export const SHARED_ASSETS_DIR_NAME = 'shared';

/**
 * Расширения (с точкой), которые файловый менеджер показывает в листинге и
 * которые разрешено раздавать из ОБЩЕЙ папки.
 *
 * Единый источник правды для трёх мест: фильтра листинга, белого списка
 * загрузки в общее пространство и белого списка раздачи `/shared-assets/*`.
 * Раздача общей папки обязана быть ограничена этим списком: туда пишут ГМы
 * разных миров, и загруженный `.html`/`.js` не должен отдаваться браузеру.
 */
export const BROWSABLE_ASSET_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.mkv',
  '.m4v',
  '.mp3',
  '.wav',
  '.ogg',
] as const;

/** Множество {@link BROWSABLE_ASSET_EXTENSIONS} для проверки членства строки. */
const BROWSABLE_ASSET_EXTENSIONS_SET = new Set<string>(
  BROWSABLE_ASSET_EXTENSIONS,
);

/**
 * Классы MIME, допустимые при загрузке медиа. Единый источник правды для
 * клиентской предпроверки (перетаскивание из ОС) и серверного гейта загрузки в
 * ОБЩУЮ папку.
 */
export const UPLOADABLE_MEDIA_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
] as const;

/**
 * Типы, которые не принимаются, даже если подходят под префикс выше.
 *
 * SVG — это документ со скриптами, а не картинка: открытый по прямой ссылке,
 * он исполняет свой код в origin мира. Поддержки у него и не было — расширения
 * `.svg` нет в {@link BROWSABLE_ASSET_EXTENSIONS}, то есть отдавать такой файл
 * никто не собирался. Наружу он пролезал ровно через широкий префикс `image/`.
 */
const BLOCKED_UPLOAD_MIME_TYPES = new Set(['image/svg+xml', 'image/svg']);

/** Что показать пользователю, когда файл отклонён по типу */
export const SVG_UPLOAD_REJECTED_MESSAGE =
  'SVG не поддерживается, используйте PNG или WebP';

/**
 * Проверяет, что MIME-тип относится к загружаемому медиа.
 *
 * @param mimeType - значение заголовка `Content-Type` части формы или `File.type`
 * @returns true, если тип начинается с одного из {@link UPLOADABLE_MEDIA_MIME_PREFIXES}
 *   и не входит в список запрещённых
 */
export function isUploadableMediaMime(
  mimeType: string | null | undefined,
): boolean {
  if (!mimeType) {
    return false;
  }

  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

  if (BLOCKED_UPLOAD_MIME_TYPES.has(normalized)) {
    return false;
  }

  return UPLOADABLE_MEDIA_MIME_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

/**
 * Является ли файл векторной картинкой, которую мы не принимаем.
 *
 * Проверка по имени нужна отдельно от MIME: браузер и `multipart` вправе
 * прислать `application/octet-stream` для любого файла, и тогда тип ни о чём
 * не говорит.
 *
 * @param fileName - имя файла с расширением
 * @returns true, если это `.svg`
 */
export function isBlockedVectorFile(
  fileName: string | null | undefined,
): boolean {
  return (
    typeof fileName === 'string' && fileName.toLowerCase().endsWith('.svg')
  );
}

/**
 * Проверяет, что расширение файла разрешено к показу и раздаче.
 *
 * @param fileName - имя файла или путь (регистр расширения не важен)
 * @returns true, если расширение входит в {@link BROWSABLE_ASSET_EXTENSIONS}
 */
export function isBrowsableAssetFile(
  fileName: string | null | undefined,
): boolean {
  if (!fileName) {
    return false;
  }

  const lastDot = fileName.lastIndexOf('.');

  if (lastDot === -1) {
    return false;
  }

  return BROWSABLE_ASSET_EXTENSIONS_SET.has(
    fileName.slice(lastDot).toLowerCase(),
  );
}

/**
 * Максимальный размер файла, загружаемого в папку мира (300 МБ).
 *
 * Один лимит на клиент (предпроверка в файловом менеджере) и сервер (гейт
 * загрузки). Значение историческое — менять только вместе с обеими сторонами.
 */
export const MAX_FILE_SIZE = 300 * 1024 * 1024;

/**
 * Максимальный размер изображения, загружаемого как фон мира (100 МБ).
 *
 * Тот же принцип: одно значение на предпроверку в окне настроек мира и на
 * серверный гейт загрузки фона.
 */
export const MAX_IMAGE_SIZE = 100 * 1024 * 1024;

/**
 * Максимальный размер файла, загружаемого в ОБЩУЮ папку установки.
 *
 * Лимит строже, чем у папки мира: сюда пишут ГМы разных миров, а место на
 * диске одно на всю установку.
 */
export const MAX_SHARED_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Проверяет, является ли путь системным для файлового менеджера мира
 * (создание, переименование, перемещение и удаление запрещены).
 *
 * - `data`, `data/actors`, `data/creatures` — системные.
 * - `data/actors/<actorId>` и глубже — НЕ системные (папка ассетов актёра).
 * - `data/creatures/<creatureId>` и глубже — НЕ системные (папка ассетов существа).
 *
 * @param assetPath - путь относительно корня папки мира (любой разделитель)
 * @returns true, если путь системный и менять его нельзя
 */
export function isSystemAssetPath(
  assetPath: string | null | undefined,
): boolean {
  if (!assetPath) {
    return false;
  }

  const normalized = assetPath.replace(/\\/g, '/');

  if (!normalized.startsWith('data')) {
    return false;
  }

  if (normalized === 'data') {
    return true;
  }

  const segments = normalized.split('/');

  if (segments[0] !== 'data') {
    return false;
  }

  // data/actors/<actorId> (3+ сегмента) — папка сущности, изменения разрешены
  if (
    (segments[1] === 'actors' || segments[1] === 'creatures')
    && segments.length >= 3
  ) {
    return false;
  }

  // Все остальные пути внутри data — системные
  return true;
}

/**
 * Расширения видеофайлов (без точки), общие для клиента и сервера.
 * Единый источник правды, чтобы не дублировать список mp4/webm/... по коду.
 */
export const VIDEO_FILE_EXTENSIONS = ['mp4', 'webm', 'mkv', 'm4v'] as const;

/**
 * Множество видеорасширений для проверки членства произвольной строки.
 * `Set<string>.has` принимает любую строку — в отличие от
 * `VIDEO_FILE_EXTENSIONS.includes`, которому нужен литеральный тип.
 */
const VIDEO_FILE_EXTENSIONS_SET = new Set<string>(VIDEO_FILE_EXTENSIONS);

/**
 * Определяет, является ли путь/URL видеофайлом по расширению.
 * Единый хелпер вместо локальных дубликатов списка mp4/webm/... по компонентам.
 *
 * @param path - путь или URL файла (допускаются query/hash)
 * @returns true, если расширение входит в {@link VIDEO_FILE_EXTENSIONS}
 */
export function isVideoPath(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }

  // Отбрасываем query/hash перед проверкой расширения
  const queryIndex = path.search(/[?#]/);
  const basePart = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const lastDot = basePart.lastIndexOf('.');

  if (lastDot === -1) {
    return false;
  }

  const ext = basePart.slice(lastDot + 1).toLowerCase();

  return VIDEO_FILE_EXTENSIONS_SET.has(ext);
}

/**
 * Расширения аудиофайлов (без точки), общие для клиента и сервера.
 * Пара к {@link VIDEO_FILE_EXTENSIONS} — единый источник правды вместо
 * локальных списков mp3/wav/ogg по коду.
 */
export const AUDIO_FILE_EXTENSIONS = ['mp3', 'wav', 'ogg'] as const;

/** Множество аудиорасширений для проверки членства произвольной строки. */
const AUDIO_FILE_EXTENSIONS_SET = new Set<string>(AUDIO_FILE_EXTENSIONS);

/**
 * Определяет, является ли путь/URL аудиофайлом по расширению.
 *
 * @param path - путь или URL файла (допускаются query/hash)
 * @returns true, если расширение входит в {@link AUDIO_FILE_EXTENSIONS}
 */
export function isAudioPath(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }

  // Отбрасываем query/hash перед проверкой расширения
  const queryIndex = path.search(/[?#]/);
  const basePart = queryIndex === -1 ? path : path.slice(0, queryIndex);
  const lastDot = basePart.lastIndexOf('.');

  if (lastDot === -1) {
    return false;
  }

  return AUDIO_FILE_EXTENSIONS_SET.has(
    basePart.slice(lastDot + 1).toLowerCase(),
  );
}

/**
 * Суффикс файла статического постера, который сервер генерирует рядом с
 * видео-фоном при загрузке (первый кадр в WebP). Единый источник правды для
 * клиента (запрос постера) и сервера (генерация файла).
 */
export const VIDEO_POSTER_SUFFIX = '.poster.webp';

/**
 * Преобразует путь или URL видеофайла в путь/URL его статического постера.
 *
 * Постер лежит рядом с видео с тем же базовым именем: расширение видео
 * заменяется целиком на {@link VIDEO_POSTER_SUFFIX}
 * (`scenes/bg.mp4` → `scenes/bg.poster.webp`). Корректно сохраняет query/hash,
 * если они есть в URL.
 *
 * @param videoPath - путь или URL видеофайла
 * @returns путь/URL постера или `null`, если расширение не распознано как видео
 */
export function getVideoPosterPath(
  videoPath: string | null | undefined,
): string | null {
  if (!videoPath) {
    return null;
  }

  // Отделяем query/hash, чтобы замена расширения их не затронула
  const queryIndex = videoPath.search(/[?#]/);

  const basePart =
    queryIndex === -1 ? videoPath : videoPath.slice(0, queryIndex);

  const suffixPart = queryIndex === -1 ? '' : videoPath.slice(queryIndex);

  const lastDot = basePart.lastIndexOf('.');

  if (lastDot === -1) {
    return null;
  }

  const ext = basePart.slice(lastDot + 1).toLowerCase();

  if (
    !VIDEO_FILE_EXTENSIONS.includes(
      ext as (typeof VIDEO_FILE_EXTENSIONS)[number],
    )
  ) {
    return null;
  }

  return `${basePart.slice(0, lastDot)}${VIDEO_POSTER_SUFFIX}${suffixPart}`;
}

/**
 * Получает базовый URL сервера мира.
 *
 * Вся логика — в чистой {@link resolveServerBaseUrl}; здесь только подстановка
 * источников: что сервер сообщил о публичном доступе и что в адресной строке.
 *
 * @param worldPort - порт сервера мира. Если не передан, возвращает пустую строку (относительный URL).
 * @returns Базовый URL (например, "http://vds.example.com:30001") или пустую строку
 */
export function getServerBaseUrl(worldPort?: number): string {
  return resolveServerBaseUrl(
    worldPort,
    getPublicAccessInfo(),
    readBrowserLocation(),
  );
}

const TOKEN_FRAMES_REGEX = /^\/?(public\/)(token-frames\/)/;

/**
 * Преобразует относительный путь ассета в абсолютный URL в зависимости от среды
 *
 * @param path Относительный путь (например, "/uploads/images/token.png")
 * @param worldPort Порт сервера (обязателен для Electron)
 * @returns Полный URL до ассета
 */
export function getAssetUrl(
  path: string | null | undefined,
  worldPort?: number,
): string | null {
  if (!path) {
    return null;
  }

  // Если путь уже абсолютный, возвращаем как есть
  if (
    path.startsWith('http://')
    || path.startsWith('https://')
    || path.startsWith('data:')
  ) {
    return path;
  }

  // Обратная совместимость: public/token-frames/ → assets/token-frames/
  // (старые актёры хранят frameUrl как 'public/token-frames/0.png',
  //  но файл реально в packages/client/public/assets/token-frames/)
  // Нормализация обратных слэшей (Windows path.join создаёт 'public\\file.png')
  let normalizedPath = path.replace(/\\/g, '/');

  if (
    normalizedPath.startsWith('public/token-frames/')
    || normalizedPath.startsWith('/public/token-frames/')
  ) {
    normalizedPath = normalizedPath.replace(TOKEN_FRAMES_REGEX, 'assets/$2');
  }

  // Убеждаемся, что путь начинается со слэша
  normalizedPath = normalizedPath.startsWith('/')
    ? normalizedPath
    : `/${normalizedPath}`;

  // Кодируем каждый сегмент пути отдельно, чтобы кириллица и пробелы
  // не вызывали InvalidStateError при загрузке через PixiJS / браузер.
  // encodeURIComponent кодирует всё кроме [A-Za-z0-9_.!~*'()-],
  // поэтому применяем его к каждому сегменту, сохраняя разделители '/'.
  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => {
      if (!segment) {
        return segment;
      }

      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        // Невалидный percent-encoding (например, '%E0%A4%A') — кодируем как есть
        return encodeURIComponent(segment);
      }
    })
    .join('/');

  // Получаем базовый URL
  const baseUrl = getServerBaseUrl(worldPort);

  return `${baseUrl}${encodedPath}`;
}

/**
 * Декодирует percent-encoding в каждом сегменте пути, не трогая разделители `/`.
 *
 * Безопасно для уже «сырых» путей: сегмент без `%` остаётся как есть, а
 * некорректный percent-encoding (например, `100%cool`) возвращается без
 * изменений вместо исключения.
 *
 * @param encodedPath - путь с разделителями `/`
 * @returns путь с декодированными сегментами
 */
function decodeAssetPathSegments(encodedPath: string): string {
  return encodedPath
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

/**
 * Приводит сохранённую ссылку на ассет к относительному пути файлового
 * менеджера (обратная операция к {@link getAssetUrl} и серверному контракту
 * `url = <префикс пространства><relativePath>`, см. сборку записей в
 * `assetsRoutes`).
 *
 * Понимает все формы хранения ассета в проекте:
 * - URL пространства (`/world/maps/bg.png`, `/shared-assets/sounds/hit.mp3`,
 *   в том числе абсолютный `http://host:port/...`) — снимает префикс,
 *   отбрасывает query/hash и декодирует сегменты;
 * - готовый относительный путь (`maps/bg.png`) — возвращает как есть;
 * - внешняя ссылка (`https://…`, `data:`, `blob:`) — возвращает `null`.
 *
 * @param reference - сохранённая ссылка на ассет (URL, относительный путь или внешняя ссылка)
 * @param space - пространство файлов (по умолчанию `world`)
 * @returns относительный путь внутри пространства или `null` для внешней/пустой ссылки
 */
export function resolveAssetRelativePath(
  reference: string | null | undefined,
  space: AssetSpaceId = 'world',
): string | null {
  if (!reference) {
    return null;
  }

  const normalized = reference.replace(/\\/g, '/');
  const urlPrefix = ASSET_SPACE_URL_PREFIXES[space];
  const prefixIndex = normalized.indexOf(urlPrefix);

  // URL пространства — берём всё после префикса, отбрасываем query/hash
  if (prefixIndex !== -1) {
    const pathAfterPrefix =
      normalized.slice(prefixIndex + urlPrefix.length).split(/[?#]/)[0] ?? '';

    return decodeAssetPathSegments(pathAfterPrefix);
  }

  // Внешняя ссылка без префикса пространства — относительного пути нет
  if (/^(?:https?:|data:|blob:)/i.test(normalized)) {
    return null;
  }

  // Уже относительный путь
  return normalized;
}

/**
 * {@link resolveAssetRelativePath} для пространства мира.
 *
 * Оставлена ради множества существующих вызовов — новый код может звать
 * `resolveAssetRelativePath` напрямую.
 *
 * @param reference - сохранённая ссылка на ассет мира
 * @returns относительный путь мира или `null` для внешней/пустой ссылки
 */
export function resolveWorldAssetRelativePath(
  reference: string | null | undefined,
): string | null {
  return resolveAssetRelativePath(reference, 'world');
}
