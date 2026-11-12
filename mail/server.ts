import fs from "node:fs";
import crypto from "node:crypto"; 
import http from "node:http";
import https from "node:https";
import path from 'node:path';

import {
    LetterProcessingError, 
    CommandProcessingError, 
    type Letter, 
    type VKMessage, 
    type Player, 
    type Settings, 
    type VKMessageNewEvent, 
    VkOutgoingMessagePayload,
} from './interfaces';

const VK_API_VERSION = '5.199';
const VK_API_URL = 'https://api.vk.com/method/';
const VK_API_CONFIRMATION_TOKEN = process.env.VK_API_CONFIRMATION_TOKEN;
const VK_API_ACCESS_TOKEN = process.env.VK_API_ACCESS_TOKEN;
const VK_ADMIN_IDS = [1890724, 356140335];

if (!VK_API_CONFIRMATION_TOKEN || !VK_API_ACCESS_TOKEN) {
    throw new Error(`Отсутствуют переменные окружения VK_API_ACCESS_TOKEN или VK_API_CONFIRMATION_TOKEN`);
}

const SETTINGS_FILEPATH = path.resolve(process.cwd(), 'mail/settings.conf');
const PLAYERS_BASE_FILEPATH = path.resolve(process.cwd(), 'mail/players.json');
const LOG_FILEPATH = path.resolve(process.cwd(), 'mail/server.log')


class FileHelper {
    static readFile(filepath: string): string {
        return fs.readFileSync(filepath, { encoding: 'utf-8'} );
    }

    static readJson(filepath: string): object {
        return JSON.parse(this.readFile(filepath));
    }

    static readSettings(filepath: string): object {
        const content = this.readFile(filepath);
        const settings: Record<string, string | number> = {};
        for (let line of content.split('\n')) {
            if (line.length < 3) continue;

            let [key, value] = line.split('=').map((part) => part.trim());
            settings[key] = value.replace(';', '');
        }
        return settings;
    }

    static writeSettings(settings: Settings) {
        const content = Object.entries(settings).map((obj) => `${obj[0]}=${obj[1]}`).join('\n');
        FileHelper.writeFile(SETTINGS_FILEPATH, content);
    }

    static writeFile(filepath: string, content: string, flag = 'w'): void {
        fs.writeFileSync(filepath, content, { flag: flag, encoding: 'utf-8'} );
    }

    static writeJson(filepath: string, content: object): void {
        const json = JSON.stringify(content, null, 4) + '\n';
        this.writeFile(filepath, json);
    }

    static writeLog(message: string, filepath: string = LOG_FILEPATH): void {
        const date = new Date().toISOString();
        const logMessage = `${date}: ${message}\n`;
        this.writeFile(filepath, logMessage, 'a');
        console.log(message);
    }
}

enum KeyboardCommands {
    START = 'start',
    PLAYERS_LIST = 'players_list',
    NEXT_TURN = 'next_turn',
    PREVIOUS_TURN = 'previous_turn',
    CURRENT_TURN = 'current_turn',    
}

function addButton(label: string, command: KeyboardCommands) {
    return {
        'action': {
            'type': 'text',
            'label': label,
            'payload': `{\"command\":\"${command}\"}`
        },
        'color': 'secondary'
    }
}

function createKeyboard(isAdmin: boolean = false) {
    const playerButtons = [
        [
            addButton('Список получателей', KeyboardCommands.PLAYERS_LIST),
        ]
    ];

    const adminButtons = [
        ...playerButtons,
        [
            addButton('Предыдущий ход', KeyboardCommands.PREVIOUS_TURN),
            addButton('Текущий ход', KeyboardCommands.CURRENT_TURN),
            addButton('Следующий ход', KeyboardCommands.NEXT_TURN),
        ]
    ];

    return JSON.stringify({
        'inline': false,
        'one_time': false,
        'buttons': isAdmin ? adminButtons : playerButtons,
    })
}

class CommandExecutor {
    static commandRouter(command: KeyboardCommands, from_id: number): string { 
        const router: Record<KeyboardCommands, (from_id?: number) => string | number> = {
            [KeyboardCommands.START]: CommandExecutor.confirmStart,
            [KeyboardCommands.PLAYERS_LIST]: CommandExecutor.getPlayersList,
            [KeyboardCommands.NEXT_TURN]: CommandExecutor.setNextTurn,
            [KeyboardCommands.PREVIOUS_TURN]: CommandExecutor.setPreviousTurn,
            [KeyboardCommands.CURRENT_TURN]: CommandExecutor.getCurrentTurn,
        }
        
        FileHelper.writeLog(`Executing command: ${command} from ${from_id}}`);

        const handler = router[command];
        if (typeof handler === 'function') {
            return handler(from_id).toString();
        }

        throw new CommandProcessingError('Команда не найдена');
    }

    static confirmStart(from_id?: number): string {
        const players = FileHelper.readJson(PLAYERS_BASE_FILEPATH) as Array<Player>;
        const player = players.find((player) => player.vkId == from_id);

        if (!player) {
            throw new CommandProcessingError('Игрок не найден')
        } 

        player.isConfirmed = true;
        FileHelper.writeJson(PLAYERS_BASE_FILEPATH, players)

        return 'Персонаж подтверждён';
    }

    static getPlayersList(): string {
        const players = FileHelper.readJson(PLAYERS_BASE_FILEPATH) as Array<Player>;
        return players.filter((player) => player.isConfirmed).map((player) => `${player.heroName} (${player.vkName})`).join('\n');
    }

    static getCurrentTurn(): number {
        const settings = FileHelper.readSettings(SETTINGS_FILEPATH) as Settings;
        console.log(`settings.CURRENT_TURN: ${settings.CURRENT_TURN}`)
        return settings.CURRENT_TURN;
    }

    static setPreviousTurn(): number {
        const settings = FileHelper.readSettings(SETTINGS_FILEPATH) as Settings;
        const currentTurn = settings.CURRENT_TURN;
        if (currentTurn - 1 <= 0) {
            throw new CommandProcessingError('Невозможно установить ход < 1');
        }

        settings['CURRENT_TURN'] -= 1;
        FileHelper.writeSettings(settings);
        return settings['CURRENT_TURN'];
    }

    static setNextTurn(): number {
        const settings = FileHelper.readSettings(SETTINGS_FILEPATH) as Settings;
        settings['CURRENT_TURN'] = +settings['CURRENT_TURN'] + 1;
        FileHelper.writeSettings(settings);
        return settings['CURRENT_TURN'];
    }
}


function vkApiMessageSend(message: VkOutgoingMessagePayload): Promise<Record<string, unknown>> {
    const isAdmin = VK_ADMIN_IDS.includes(message.peer_id);
    const payload = {
        ...message,
        random_id: crypto.randomInt(1000000),
        keyboard: createKeyboard(isAdmin),
    }

    return new Promise((resolve, reject) => {
        const urlObj = new URL(VK_API_URL + 'messages.send' + '?v=' + VK_API_VERSION);
        const postData = Object.entries(payload).map((item) => item[0] + '=' + item[1]).join('&');
    
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VK_API_ACCESS_TOKEN}`,
                'Host': 'api.vk.ru',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
            }
        }
        const request = https.request(
            options,
            (response) => {
                const chunks: Array<Uint8Array> = [];
    
                response.on('data', (chunk) => chunks.push(new Uint8Array(chunk)));
    
            response.on('end', () => {
                try {
                    const body = Buffer.concat(chunks).toString();
                    const status = response.statusCode;

                    if (!status || status < 200 || status >= 300) {
                        reject(new Error(`HTTP ${status}: ${body}`));
                        return;
                    }

                    const reply = JSON.parse(body);

                    if (reply.error) {
                        const errorMessage =
                            reply.error.error_msg || 'Неизвестная ошибка VK API';

                        FileHelper.writeLog(
                            `Request to ${message.peer_id} ended with error: ${errorMessage}`
                        );

                        reject(new LetterProcessingError(errorMessage));
                        return;
                    }

                    FileHelper.writeLog(`Request was successful to ${message.peer_id}`);
                    resolve(reply);
                } catch (err: unknown) {
                    reject(err);
                }
            });
        });

        request.on('error', reject)

        // Установка таймаута
        request.setTimeout(10000, () => {
            request.destroy(new Error('Request timed out'))
        });

        // Записываем данные и завершаем запрос
        request.write(postData);
        request.end();
    });
}

interface ProcessLetterResult {
    currentTurn: number;
    currentTurnLetters: number;
}

class MessageHandler {
    async processMessage(vkMessageEvent: VKMessageNewEvent, response: http.ServerResponse) {
        if (vkMessageEvent.type === 'confirmation') {
            FileHelper.writeLog('Processing confirmation message');

            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end(VK_API_CONFIRMATION_TOKEN);

            return;
        }

        if (vkMessageEvent.type === 'message_new') {
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end('ok');

            const message = vkMessageEvent.object.message;
            // сообщение из группповых бесед - игнорируем
            if (message.peer_id >= 2000000000) {
                return;
            }

            FileHelper.writeLog(`Processing new vk message from ${message.peer_id}`);

            try {    
                // выполняем команду
                if (message.payload) {
                    const payload = JSON.parse(message.payload);
                    if (payload.command) {
                        const result = CommandExecutor.commandRouter(payload.command, message.from_id);
                        await vkApiMessageSend({
                            peer_id: message.from_id,
                            message: result,
                        });
                    }
                } else {
                    const result = await this.processLetter(message);

                    await vkApiMessageSend({
                        peer_id: message.from_id,
                        message: `Сообщение отправлено! Ход: ${result.currentTurn}, отправлено писем: ${result.currentTurnLetters}.`,
                    })
                }
            } catch (err: unknown) {
                if (err instanceof LetterProcessingError || err instanceof CommandProcessingError) {
                    await vkApiMessageSend({
                        peer_id: message.from_id,
                        message: err.message,
                    })
                }
            }   
        }
    }

    async processLetter(rawMessage: VKMessage): Promise<ProcessLetterResult> {
      const settings = FileHelper.readSettings(SETTINGS_FILEPATH) as Settings;
      const players = FileHelper.readJson(PLAYERS_BASE_FILEPATH) as Array<Player>;

      const letter = this.createLetter(rawMessage, players, settings);

      const playerSender = players.find((player) => player.vkId == letter.fromId);
      if (!playerSender) {
        throw new LetterProcessingError('Неизвестный отправитель');
      }

      const currentTurnLetters = playerSender.letters.filter((letter) => letter.turn == settings.CURRENT_TURN);
      if (currentTurnLetters.length >= settings.LETTERS_PER_TURN) {
        throw new LetterProcessingError(`Достигнут лимит писем (${settings.LETTERS_PER_TURN})`);
      }

      FileHelper.writeLog(`Sending letter from: ${letter.fromId} to ${letter.toName} (${letter.toId}) on turn ${letter.turn}: ${letter.text.slice(0, 100)}`);

      await this.sendLetter(letter);

      playerSender.letters.push({
          toName: letter.toName,
          turn: letter.turn,
      });

      FileHelper.writeJson(PLAYERS_BASE_FILEPATH, players);

      return { currentTurn: settings.CURRENT_TURN, currentTurnLetters: currentTurnLetters.length + 1 }
   }

    createLetter(rawMessage: VKMessage, players: Array<Player>, settings: Settings): Letter {
      const recepientName = rawMessage.text.split(/[|;]/, 1)[0].trim();

      if (!recepientName) {
        throw new LetterProcessingError('В письме не указан или не найден получатель');
      }

      const playerRecepient = players.find((player) => player.heroName.toLowerCase() == recepientName.toLowerCase());
      if (!playerRecepient) {
        throw new LetterProcessingError('Получатель с таким именем не найден');
      } 

      if (!playerRecepient.isConfirmed) {
        throw new LetterProcessingError('Получатель пока не может принимать письма, необходимо подтверждение игрока');
      }

      const playerSender = players.find((player) => player.vkId == rawMessage.from_id);
      if (!playerSender) {
        throw new LetterProcessingError('Неизвестный отправитель');
      }

      return {
        fromId: rawMessage.from_id,
        fromName: playerSender.heroName, 
        toId: playerRecepient.vkId,
        toName: playerRecepient.heroName,
        text: rawMessage.text,
        turn: settings.CURRENT_TURN,
      }
    }

    async sendLetter(letter: Letter) {
        const payload = {
            peer_id: letter.toId,
            message: letter.text + '\n' + letter.fromName,
            keyboard: createKeyboard(),
        }

        await vkApiMessageSend(payload);
    }
}

const messageHandler = new MessageHandler();

const server = http.createServer((request, response) => {
    if (request.url === '/vk/callback' && request.method == 'POST') {
        try {
            const body: Array<string> = [];
            request.on('data', (chunk) => body.push(chunk.toString()));
            request.on('end', async () => {
                try {
                    const payload = body.join('');
                    await messageHandler.processMessage(JSON.parse(payload), response);
                } catch (err: unknown) {
                    if (err instanceof Error) {
                        FileHelper.writeLog(`ERROR! Details: ${err.message}`);
                    }
                }
            })
        } catch (err: unknown) {
            if (err instanceof Error) {
                if ('code' in err && err.code === 'ENOENT') {
                    FileHelper.writeLog(`ERROR! File not found! Details: ${err.message}`);
                }

                FileHelper.writeLog(`ERROR! Error processing request! Details: ${err.message}`);
            }
        }   
    }
});

const PORT = 5001;
server.listen(PORT, () => {
    FileHelper.writeLog(`Server running on port: ${PORT}`);
});
