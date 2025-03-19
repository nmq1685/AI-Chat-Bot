import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Message } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hiển thị danh sách các lệnh và cách sử dụng.'),

  async execute(interactionOrMessage: ChatInputCommandInteraction | Message) {
    const prefix = process.env.PREFIX ?? '!';
    const now = new Date();
    const timeString = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: true }).format(now);

    const isInteraction = interactionOrMessage instanceof ChatInputCommandInteraction;
    const user = isInteraction ? interactionOrMessage.user : interactionOrMessage.author;
    const guild = interactionOrMessage.guild;

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle('📚 Danh sách lệnh')
      .setDescription('Dưới đây là các lệnh bạn có thể sử dụng:')
      .addFields(
        { name: '🤖 Chat', value: `\`${prefix}chat\` hoặc \`/chat\` - Chat với AI`, inline: false },
        { name: '🗑️ Clear Memory (cm)', value: `\`${prefix}cm\` hoặc \`/clear_memory\` - Xóa lịch sử cuộc trò chuyện khỏi cơ sở dữ liệu`, inline: false },
        { name: '❓ Help', value: `\`${prefix}help\` hoặc \`/help\` - Hiển thị danh sách các lệnh`, inline: false }
      )
      .setFooter({ text: `${guild?.name ?? 'Server'} • Today at ${timeString}`, iconURL: guild?.iconURL() ?? undefined });

    if (isInteraction) {
      await interactionOrMessage.reply({ embeds: [embed] });
    } else {
      await interactionOrMessage.reply({ embeds: [embed] });
    }
  },
};
