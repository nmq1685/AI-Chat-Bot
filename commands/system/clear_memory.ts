// commands/system/clear_memory.ts
import {
    ChatInputCommandInteraction,
    Message,
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    Guild,
  } from 'discord.js';
  import { pool } from '../../index';
  
  export default {
    data: new SlashCommandBuilder()
      .setName('clear_memory')
      .setDescription('🗑️ Xóa lịch sử trò chuyện của bạn khỏi cơ sở dữ liệu'),
    name: 'clear_memory',
    aliases: ['cm'],
    async execute(interactionOrMessage: ChatInputCommandInteraction | Message, args?: string[]) {
      const isSlash = interactionOrMessage instanceof ChatInputCommandInteraction;
      const user = isSlash ? interactionOrMessage.user : interactionOrMessage.author;
      const guild = (interactionOrMessage as any).guild as Guild | null;
      const guildName = guild?.name || 'Server';
      const guildIcon = guild?.iconURL() || '';
      const currentTime = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      });
  
      // Embed xác nhận
      const confirmEmbed = new EmbedBuilder()
        .setAuthor({ name: `${user.username} 🛡️`, iconURL: user.displayAvatarURL() })
        .setTitle('⚠️ Xác nhận xóa lịch sử')
        .setDescription('Bạn có chắc chắn muốn xóa toàn bộ lịch sử trò chuyện của bạn khỏi cơ sở dữ liệu không?')
        .setFooter({ text: `${guildName} • Today at ${currentTime}`, iconURL: guildIcon })
        .setColor('#0099ff');
  
      const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_clear')
        .setLabel('✅ Có')
        .setStyle(ButtonStyle.Success);
      const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_clear')
        .setLabel('❌ Không')
        .setStyle(ButtonStyle.Danger);
  
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);
  
      let confirmationMessage: Message;
      try {
        if (isSlash) {
          await interactionOrMessage.reply({ embeds: [confirmEmbed], components: [row], ephemeral: false });
          confirmationMessage = (await interactionOrMessage.fetchReply()) as Message;
        } else {
          confirmationMessage = await interactionOrMessage.reply({ embeds: [confirmEmbed], components: [row] });
        }
      } catch (error) {
        console.error('Lỗi khi gửi thông báo xác nhận:', error);
        return;
      }
  
      try {
        const filter = (i: any) => i.user.id === user.id;
        const collector = confirmationMessage.createMessageComponentCollector({ filter, max: 1, time: 15000 });
  
        collector.on('collect', async (i) => {
          if (i.customId === 'confirm_clear') {
            try {
              await clearChatHistory(user.id);
              const successEmbed = new EmbedBuilder()
                .setAuthor({ name: `${user.username} 🛡️`, iconURL: user.displayAvatarURL() })
                .setTitle('🗑️ Đã xóa lịch sử!')
                .setDescription('Lịch sử trò chuyện của bạn đã được xóa khỏi cơ sở dữ liệu.')
                .setFooter({
                  text: `${guildName} • Today at ${new Date().toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true,
                  })}`,
                  iconURL: guildIcon,
                })
                .setColor('#00ff00');
              await i.update({ embeds: [successEmbed], components: [] });
            } catch (error) {
              console.error('Lỗi khi xóa lịch sử trò chuyện:', error);
              const errorEmbed = new EmbedBuilder()
                .setAuthor({ name: `${user.username} 🛡️`, iconURL: user.displayAvatarURL() })
                .setTitle('❌ Lỗi!')
                .setDescription('Đã xảy ra lỗi khi xóa lịch sử trò chuyện.')
                .setFooter({
                  text: `${guildName} • Today at ${new Date().toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true,
                  })}`,
                  iconURL: guildIcon,
                })
                .setColor('#ff0000');
              await i.update({ embeds: [errorEmbed], components: [] });
            }
          } else if (i.customId === 'cancel_clear') {
            const cancelEmbed = new EmbedBuilder()
              .setAuthor({ name: `${user.username} 🛡️`, iconURL: user.displayAvatarURL() })
              .setTitle('🚫 Hủy xóa lịch sử')
              .setDescription('Bạn đã hủy việc xóa lịch sử trò chuyện.')
              .setFooter({
                text: `${guildName} • Today at ${new Date().toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: 'numeric',
                  hour12: true,
                })}`,
                iconURL: guildIcon,
              })
              .setColor('#ffa500');
            await i.update({ embeds: [cancelEmbed], components: [] });
          }
        });
  
        collector.on('end', async (collected, reason) => {
          if (reason === 'time' && collected.size === 0) {
            const timeoutEmbed = new EmbedBuilder()
              .setAuthor({ name: `${user.username} 🛡️`, iconURL: user.displayAvatarURL() })
              .setTitle('⌛ Hết thời gian')
              .setDescription('Hết thời gian xác nhận. Lệnh bị hủy.')
              .setFooter({
                text: `${guildName} • Today at ${new Date().toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: 'numeric',
                  hour12: true,
                })}`,
                iconURL: guildIcon,
              })
              .setColor('#808080');
            if (isSlash) {
              await interactionOrMessage.editReply({ embeds: [timeoutEmbed], components: [] });
            } else {
              await confirmationMessage.edit({ embeds: [timeoutEmbed], components: [] });
            }
          }
        });
      } catch (error) {
        console.error('Lỗi khi xử lý xác nhận lệnh clear_memory:', error);
        const errorEmbed = new EmbedBuilder()
          .setAuthor({ name: `${user.username} 🛡️`, iconURL: user.displayAvatarURL() })
          .setTitle('❌ Lỗi!')
          .setDescription('Đã xảy ra lỗi khi xác nhận lệnh.')
          .setFooter({
            text: `${guildName} • Today at ${new Date().toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: 'numeric',
              hour12: true,
            })}`,
            iconURL: guildIcon,
          })
          .setColor('#ff0000');
        if (isSlash) {
          await interactionOrMessage.editReply({ embeds: [errorEmbed], components: [] });
        } else {
          await confirmationMessage.edit({ embeds: [errorEmbed], components: [] });
        }
      }
    },
  };
  
  async function clearChatHistory(userId: string): Promise<void> {
    await pool.execute('DELETE FROM conversation_history WHERE user_id = ?', [userId]);
  }
  