import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Message,
  SlashCommandBuilder,
} from 'discord.js';
import { pool } from '../../index';
import { addChatMessageToHistory, getChatConversationHistory } from '../../database';

type AiProvider = 'openai' | 'google';

const DEFAULT_PROVIDER: AiProvider = 'google';
const DEFAULT_MODELS: Record<AiProvider, string> = {
  openai: 'gpt-5',
  google: 'gemini-2.0-flash',
};
const DISCORD_MESSAGE_LIMIT = 2000;

export default {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat với bot sử dụng OpenAI hoặc Google Gemini')
    .addStringOption(option =>
      option.setName('content').setDescription('Nội dung chat').setRequired(true)
    ),
  name: 'chat',
  aliases: ['c'],
  async execute(interactionOrMessage: ChatInputCommandInteraction | Message, args?: string[]) {
    const isSlash = interactionOrMessage instanceof ChatInputCommandInteraction;
    const userId = isSlash
      ? interactionOrMessage.user.id
      : interactionOrMessage.author.id;

    let userInput: string;
    let loadingMessage: Message;

    if (isSlash) {
      userInput = interactionOrMessage.options.getString('content', true);
      await interactionOrMessage.deferReply();
      loadingMessage = await interactionOrMessage.editReply(
        'Đợi tí xíu nghennn...'
      );
    } else {
      userInput = args?.join(' ') ?? '';
      if (!userInput) return interactionOrMessage.reply('Vui lòng nhập nội dung chat.');
      loadingMessage = await interactionOrMessage.reply(
        'Đợi tí xíu nghennn...'
      );
    }

    try {
      const limit = 10;
      const history = await getChatConversationHistory(userId, pool, limit);
      const style = process.env.STYLE ? process.env.STYLE.trim() : '';
      const promptContext = `${style}\n` +
        history
          .map(e => `${e.role === 'user' ? 'User' : 'Bot'}: ${e.message}`)
          .join('\n') +
        `\nUser: ${userInput}`;

      const replyText = await getChatResponse(promptContext);
      await addChatMessageToHistory(userId, 'user', userInput, pool);
      await addChatMessageToHistory(userId, 'bot', replyText, pool);

      const finalReply = replyText.trim() || 'Không nhận được phản hồi từ AI API.';
      const replyChunks = splitDiscordMessage(finalReply);
      if (isSlash) {
        await interactionOrMessage.editReply(replyChunks[0]);
        for (const chunk of replyChunks.slice(1)) {
          await interactionOrMessage.followUp(chunk);
        }
      } else {
        await loadingMessage.edit(replyChunks[0]);
        for (const chunk of replyChunks.slice(1)) {
          if (!loadingMessage.channel.isSendable()) {
            throw new Error('Không thể gửi phần tiếp theo của phản hồi vào kênh này.');
          }
          await loadingMessage.channel.send(chunk);
        }
      }
    } catch (error) {
      console.error('Lỗi thực thi lệnh chat:', error);
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setDescription('❌ Đã xảy ra lỗi khi gọi AI API.');
      if (isSlash) {
        await interactionOrMessage.editReply({ embeds: [embed] });
      } else {
        await loadingMessage.edit({ embeds: [embed] });
      }
    }
  },
};

function splitDiscordMessage(content: string): string[] {
  if (content.length <= DISCORD_MESSAGE_LIMIT) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > DISCORD_MESSAGE_LIMIT) {
    let splitEnd = DISCORD_MESSAGE_LIMIT;
    const newlineIndex = remaining.lastIndexOf('\n', DISCORD_MESSAGE_LIMIT - 1);

    if (newlineIndex > 0) {
      splitEnd = newlineIndex + 1;
    } else {
      for (let index = DISCORD_MESSAGE_LIMIT - 1; index > 0; index--) {
        if (/\s/.test(remaining[index])) {
          splitEnd = index + 1;
          break;
        }
      }
    }

    chunks.push(remaining.slice(0, splitEnd));
    remaining = remaining.slice(splitEnd);
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

async function getChatResponse(prompt: string): Promise<string> {
  const provider = getProvider();
  const model = process.env.AI_MODEL?.trim() || DEFAULT_MODELS[provider];

  if (provider === 'openai') {
    return getOpenAiChatResponse(prompt, model);
  }
  return getGoogleChatResponse(prompt, model);
}

function getProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER?.trim().toLowerCase() || DEFAULT_PROVIDER) as string;
  if (provider !== 'openai' && provider !== 'google') {
    throw new Error('AI_PROVIDER phải là "openai" hoặc "google".');
  }
  return provider;
}

function requireApiKey(name: 'OPENAI_API_KEY' | 'GOOGLE_API_KEY'): string {
  const key = process.env[name]?.trim();
  if (!key) {
    throw new Error(`Thiếu biến môi trường ${name}.`);
  }
  return key;
}

async function getOpenAiChatResponse(prompt: string, model: string): Promise<string> {
  const key = requireApiKey('OPENAI_API_KEY');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: prompt }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API request failed: HTTP ${response.status}`);
  }

  const data: any = await response.json();
  if (typeof data.output_text === 'string') {
    return data.output_text.trim();
  }

  return (data.output ?? [])
    .flatMap((item: any) => item.type === 'message' ? (item.content ?? []) : [])
    .filter((part: any) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('')
    .trim();
}

async function getGoogleChatResponse(prompt: string, model: string): Promise<string> {
  const key = requireApiKey('GOOGLE_API_KEY');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google Gemini API request failed: HTTP ${response.status}`);
  }

  const data: any = await response.json();
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part: any) => typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('')
    .trim();
}
