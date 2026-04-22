import { ChatService } from '@thinkcoffee/core';
import { z } from 'zod';

export function registerChatEndpoints(server: any) {
  const chatService = new ChatService('default');

  server.tool(
    'get_chat_history',
    'Retrieve chat history with an optional limit.',
    { limit: z.number().optional().describe('Maximum number of messages to retrieve') },
    async ({ limit }) => {
      const history = chatService.getHistory(limit);
      return { content: [{ type: 'json', data: history }] };
    }
  );

  server.tool(
    'backup_chat',
    'Create a backup of the current chat history.',
    {},
    async () => {
      chatService.backup();
      return { content: [{ type: 'text', text: 'Chat history backed up successfully.' }] };
    }
  );

  server.tool(
    'restore_chat',
    'Restore chat history from the latest backup.',
    {},
    async () => {
      chatService.restore();
      return { content: [{ type: 'text', text: 'Chat history restored from backup.' }] };
    }
  );

  server.tool(
    'clear_chat',
    'Clear all chat history.',
    {},
    async () => {
      chatService.clear();
      return { content: [{ type: 'text', text: 'Chat history cleared.' }] };
    }
  );
}