# Почта между игроками

Сервер принимает сообщения сообщества ВКонтакте через Callback API и пересылает письма между зарегистрированными игроками. 
Для каждого отправителя учитываются текущий ход и количество отправленных писем.

## Endpoint Next.js 14: `/api/vk`

Основной обработчик перенесён в [`app/api/vk/route.ts`](../app/api/vk/route.ts).
Он работает в Node.js runtime вместе с приложением Next.js, без отдельного процесса и порта 5001.
Бизнес-логика сохранена: пересылка писем, лимит на ход, список игроков и команды клавиатуры.
Переключать ход теперь может только отправитель из `VK_ADMIN_IDS` в `route.ts`.

1. Скопируйте [`.env.local.example`](../.env.local.example) в `.env.local` в корне проекта
   и укажите `VK_API_CONFIRMATION_TOKEN` и `VK_API_ACCESS_TOKEN`. Next.js не загружает `mail/.env` автоматически.
   Если в настройках Callback API задан секретный ключ, укажите его в `VK_API_SECRET`.
   Не используйте префикс `NEXT_PUBLIC_` для этих переменных.
2. Подготовьте `mail/players.json` и `mail/settings.conf` в описанном ниже формате.
   Можно задать `MAIL_DATA_DIR` — абсолютный путь к постоянному каталогу с обоими файлами.
   Копии настроек в `app/api/vk/` обработчик не использует.
3. Запустите `npm run dev`, либо `npm run build` и `npm start` для production.
4. В VK Callback API укажите `https://example.com/api/vk`.
   Если настроен `basePath`, добавьте его перед `/api/vk`.
   Nginx должен проксировать этот адрес на Next.js; отдельный прокси на 5001 не требуется.

Подтверждение возвращается как `text/plain; charset=utf-8`, без JSON-кавычек.
Остальные события получают строку `ok`; неизвестные типы событий игнорируются.
Некорректный JSON или сообщение возвращают 400, неверный секрет — 403,
ошибки конфигурации, файлов и сети — 500. Ошибки команд и писем отправляются пользователю через VK API.
Логи пишутся в stdout/stderr, без записи `server.log`.

В Next.js 14 обработчик дожидается запросов к VK API и сохранения данных **перед** ответом `ok`.
У каждого запроса к VK API таймаут 10 секунд. Медленная обработка может привести к повторному callback от VK.
Дедупликация событий и гарантия однократной отправки не реализованы; если требуется быстрый ответ
и надёжная обработка после него, нужна сохраняемая очередь задач.

### JSON-база и размещение

Файловое хранилище рассчитано на **один процесс Next.js** с постоянным доступным для записи диском.
Сообщения обрабатываются последовательно внутри процесса, а файлы заменяются через временный файл и rename.
Это предотвращает потерю изменений между параллельными обработчиками в этом процессе,
но не обеспечивает блокировки между несколькими процессами/репликами.
Не запускайте старый `mail/server.ts` одновременно с новым endpoint на одних файлах.
В production храните данные вне каталога, заменяемого при deploy, и делайте резервные копии.

**GitHub Pages не запускает Node.js и POST endpoints:** он раздаёт только статические файлы.
На нём нельзя ни принять callback, ни изменить JSON-базу. Workflow `.github/workflows/nextjs.yml`
исключает `route.ts` только на время сборки для Pages, сохраняя статический интерфейс.
Для callback разместите Next.js на отдельном сервере с Node.js и постоянным диском,
а в VK укажите адрес этого сервера. Если нужны несколько реплик или serverless,
замените файловое хранилище общей базой данных с транзакциями.

Проверки endpoint без обращения к VK и без изменения рабочей базы:

```sh
npm run test:vk
```

## Отдельный сервер: прежний вариант

Инструкция ниже относится к сохранённому `mail/server.ts` и командам `npm run server*`.
Для нового endpoint Next.js используйте инструкцию выше.

## Быстрый запуск

Все команды выполняются **из корня проекта**, где находится `package.json`: пути к настройкам и базе игроков вычисляются относительно текущего рабочего каталога.

Понадобится Node.js с поддержкой `--env-file` (20.6.0 +);

### 1. Установка зависимостей:
```sh
npm ci
```

### 2. Подключение ВКонтакте

`VK_API_ACCESS_TOKEN` создаётся в настройках сообщества `https://vk.ru/XXX?act=tokens`
`Callback API` включается в настройках сообщества `https://vk.ru/XXX?act=api`, где нужно задать адрес сервера `https://example.com/vk/callback` и там взять `VK_API_CONFIRMATION_TOKEN`

Переменные заполняются в  `mail/.env`  по образцу [`mail/.env.example`](.env.example):
```dotenv
VK_API_CONFIRMATION_TOKEN=код_подтверждения_сервера
VK_API_ACCESS_TOKEN=ключ_доступа_сообщества
```

### 3. Заполните [`settings.conf`](settings.conf) и [`players.json`](players.json), как описано ниже.

Файл [`mail/settings.conf`](settings.conf):

```ini
CURRENT_TURN=1
LETTERS_PER_TURN=5
```

| Параметр | Значение |
| --- | --- |
| `CURRENT_TURN` | Номер текущего хода. |
| `LETTERS_PER_TURN` | Лимит отправленных писем на одного игрока за ход. |

Указывайте положительные целые числа в формате `КЛЮЧ=ЗНАЧЕНИЕ`, без комментариев. Настройки читаются при обработке сообщений; команды переключения хода перезаписывают этот файл.

Файл [`mail/players.json`](players.json) содержит JSON-массив (используется как база данных):

```json
[
  {
    "heroName": "Мастер",
    "vkId": 12345,
    "vkName": "Имя игрока",
    "letters": []
  }
]
```

### 4. Соберите и запустите сервер:

```sh
npm run server
```

Команда компилирует TypeScript в `mail/dist`, затем запускает `mail/dist/server.js`, загружая переменные из `mail/.env`. При успешном запуске в консоли появляется `Server running on port: 5001`.

Другие команды в `package.json`:

| Команда | Что делает |
| --- | --- |
| `npm run server` | Собирает и запускает сервер с переменными из `mail/.env`. |
| `npm run server:build` | Только компилирует сервер: `tsc -p mail/tsconfig.json`. |
| `npm run server:dev` | Запускает `tsx watch` с `mail/tsconfig.json` и перезапускает сервер при изменении исходников. |

### 5. Настройка nginx

Пример рассчитан на nginx и почтовый сервер на одной машине. Добавьте блок в существующий HTTPS-блок `server` вашего домена:

```nginx
location = /vk/callback {
    include /etc/nginx/proxy_params;
    proxy_http_version 1.1;
    proxy_pass http://127.0.0.1:5001;
}
```

Проверка и перезагрузка:
```sh
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Отдельный сервис systemd на Debian/Ubuntu

Пример unit-файла — [`nextvpi.service`](nextvpi.service). Он запускает только
почтовый сервер `mail/dist/server.js` на порту 5001, автоматически запускается
при загрузке системы после включения и перезапускается при ошибке.

В примере проект размещён в `/opt/nextvpi`, Node.js — в `/usr/bin/node`,
а сервис работает от отдельного системного пользователя `nextvpi`.
Разместите весь проект в этом каталоге и подготовьте `mail/.env`,
`mail/settings.conf` и `mail/players.json` по инструкции выше.
Нужен Node.js с поддержкой `--env-file` (20.6.0+).

Создайте пользователя и соберите сервер из корня проекта:

```sh
sudo useradd --system --user-group --home-dir /opt/nextvpi --no-create-home --shell /usr/sbin/nologin nextvpi
cd /opt/nextvpi
npm ci --include=dev
npm run server:build
command -v node
```

Если пользователь уже существует, пропустите `useradd`. Если путь к проекту
или результат `command -v node` отличается от примера, исправьте
`WorkingDirectory` и абсолютные пути в `ExecStart` в unit-файле.
Systemd не загружает настройки оболочки и nvm: указывайте полный путь к Node.js,
доступному пользователю `nextvpi`.

Пользователю сервиса нужен доступ на чтение к собранному коду и на проход
ко всем родительским каталогам проекта. База, настройки и лог должны быть
доступны для записи; каталог `mail` — для создания лога:

```sh
sudo touch mail/server.log
sudo chown nextvpi:nextvpi mail mail/.env mail/players.json mail/settings.conf mail/server.log
sudo chmod 600 mail/.env
```

Установите unit в **`/etc/systemd/system/nextvpi.service`**, проверьте его
и включите автозапуск с немедленным запуском:

```sh
sudo install -m 644 mail/nextvpi.service /etc/systemd/system/nextvpi.service
sudo systemd-analyze verify /etc/systemd/system/nextvpi.service
sudo systemctl daemon-reload
sudo systemctl enable --now nextvpi.service
sudo systemctl status nextvpi.service
```

Просмотр логов и управление:

```sh
sudo journalctl -u nextvpi.service -f
sudo systemctl restart nextvpi.service
sudo systemctl stop nextvpi.service
# Отключить автозапуск и остановить сервис:
sudo systemctl disable --now nextvpi.service
```

Вывод stdout/stderr попадает в journal; сам сервер также пишет `mail/server.log`.
После обновления исходников выполните `npm run server:build` из корня проекта
и `sudo systemctl restart nextvpi.service`. При обновлении unit-файла повторите
его установку, `daemon-reload` и перезапуск сервиса.
Сохраняйте `mail/.env`, `mail/players.json` и `mail/settings.conf` при обновлении проекта.
Не запускайте второй экземпляр почтового сервера или endpoint `/api/vk`
с теми же файлами данных. Для VK используйте адрес `/vk/callback` через nginx
из предыдущего раздела.

## Как отправить письмо

Напишите сообществу сообщение в формате:

```text
Мастер|Текст письма
```

Перед `|` укажите точное имя персонажа из `heroName`. Получателю пересылается **весь исходный текст**, включая имя и разделитель. После отправки отправитель получает сообщение `Сообщение отправлено!`.
Поддерживаются разделители '|' и ';'

В клавиатуре доступна кнопка **«Список получателей»**. Для ID из массива `VK_ADMIN_IDS` в [`server.ts`](server.ts) дополнительно отображаются кнопки **«Предыдущий ход»**, **«Текущий ход»** и **«Следующий ход»**.
