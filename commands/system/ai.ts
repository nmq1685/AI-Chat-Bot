// commands/system/ai.ts
import {
  ChatInputCommandInteraction,
  Message,
  SlashCommandBuilder,
  EmbedBuilder,
  TextBasedChannel,
  Message as DiscordMessage,
} from 'discord.js';
import { pool } from '../../index';
import { addChatMessageToHistory, getChatConversationHistory } from '../../database';

// Nếu chưa gọi dotenv ở file chính, có thể uncomment dòng dưới đây:
// import 'dotenv/config';

export default {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat với bot sử dụng API từ Google')
    .addStringOption(option =>
      option.setName('content').setDescription('Nội dung chat').setRequired(true)
    ),
  name: 'chat',
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
      loadingMessage = await interactionOrMessage.editReply('<a:GTALoading:1338093657105895436> Đợi tớ xíu nghennn...');
    } else {
      userInput = args?.join(' ') ?? '';
      if (!userInput) return interactionOrMessage.reply('Vui lòng nhập nội dung chat.');
      loadingMessage = await interactionOrMessage.reply('<a:GTALoading:1338093657105895436> Đợi tớ xíu nghennn...');
    }

    try {
      const limit = 10;
      console.log('Calling getChatConversationHistory with userId:', userId, 'and limit:', limit);
      const history = await getChatConversationHistory(userId, pool, limit);

      // Lấy giá trị STYLE từ biến môi trường, mặc định là chuỗi rỗng nếu không được đặt
      const style = process.env.STYLE ? process.env.STYLE.trim() : '';
      const promptContext = `${style}\n` +
        history
          .map(e => `${e.role === 'user' ? 'User' : 'Bot'}: ${e.message}`)
          .join('\n') +
        `\nUser: ${userInput}`;

      const replyText = await getGoogleChatResponse(promptContext);
      await addChatMessageToHistory(userId, 'user', userInput, pool);
      await addChatMessageToHistory(userId, 'bot', replyText, pool);

      const finalReply = replyText.trim() || 'Không nhận được phản hồi từ API.';
      if (isSlash) {
        await interactionOrMessage.editReply(finalReply);
      } else {
        await loadingMessage.edit(finalReply);
      }
    } catch (error) {
      console.error('Lỗi thực thi lệnh chat:', error);
      const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setDescription('❌ Đã xảy ra lỗi khi gọi API từ Google.');
      if (isSlash) {
        await interactionOrMessage.editReply({ embeds: [embed] });
      } else {
        await loadingMessage.edit({ embeds: [embed] });
      }
    }
  },
};

async function getGoogleChatResponse(prompt: string): Promise<string> {
  const key = process.env.GOOGLE_API_KEY!;
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const content = data.candidates?.[0]?.content;
  if (typeof content === 'string') return content.trim();
  if (content?.parts) return content.parts.map((p: any) => p.text).join('').trim();
  return JSON.stringify(content).trim() || '';
}

function isSendable(channel: TextBasedChannel): channel is TextBasedChannel & { send(content: string): Promise<DiscordMessage> } {
  return typeof (channel as any).send === 'function';
}
