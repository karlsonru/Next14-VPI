
type VKButtonAction =
  | 'text'
  | 'vkpay'
  | 'open_app'
  | 'location'
  | 'open_link'
  | 'open_photo'
  | 'callback'
  | 'intent_subscribe'
  | 'intent_unsubscribe';

export type VKMessageEventType = 
  | 'message_new'
  | 'confirmation'

export interface VKClientInfo {
  button_actions: VKButtonAction[];
  keyboard: boolean;
  inline_keyboard: boolean;
  carousel: boolean;
  lang_id: number;
}

export interface VKMessage {
  date: number;
  from_id: number;
  id: number;
  version: number;
  out: number;
  fwd_messages: unknown[];
  important: boolean;
  is_hidden: boolean;
  attachments: unknown[];
  conversation_message_id: number;
  payload?: string;
  text: string;
  peer_id: number;
  random_id: number;
}

export interface VKMessageNewObject {
  client_info: VKClientInfo;
  message: VKMessage;
}

export interface VKMessageNewEvent {
  group_id: number;
  type: VKMessageEventType;
  event_id: string;
  v: string;
  object: VKMessageNewObject;
}

export interface Letter {
  fromId: number;
  fromName: string;
  toId: number;
  toName: string;
  turn: number;
  text: string;
}

export interface VkOutgoingMessagePayload {
    peer_id: number;
    message: string;
}

export interface Player {
  isConfirmed: boolean;
  heroName: string;
  vkId: number;
  vkName: string;
  letters: Array<Pick<Letter, 'toName' | 'turn'>>
}

export class LetterProcessingError extends Error {
  constructor(message: string | undefined) {
    super(message); 
    this.name = this.constructor.name; 
    Error.captureStackTrace(this, this.constructor); 
  }
}

export class CommandProcessingError extends Error {
  constructor(message: string | undefined) {
    super(message); 
    this.name = this.constructor.name; 
    Error.captureStackTrace(this, this.constructor); 
  }
}

export interface Settings {
  CURRENT_TURN: number;
  LETTERS_PER_TURN: number;
}
