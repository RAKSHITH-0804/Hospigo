export const MESSAGE_PROVIDER = Symbol('MESSAGE_PROVIDER');

export type MessageChannel = 'WHATSAPP' | 'SMS';

export interface MessageProvider {
  send(channel: MessageChannel, phoneE164: string, text: string): Promise<void>;
}
