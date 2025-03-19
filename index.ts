// index.ts
import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ActivityType,
  Guild,
  Message,
  VoiceState,
  ChatInputCommandInteraction,
  ButtonInteraction,
  Interaction,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import 'libsodium-wrappers';
import {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { ensureConversationTables } from './database';

dotenv.config();

const TOKEN = process.env.TOKEN!;
const PREFIX = process.env.PREFIX!;
const DB_HOST = process.env.DB_HOST!;
const DB_USER = process.env.DB_USER!;
const DB_PASSWORD = process.env.DB_PASSWORD!;
const DB_NAME = process.env.DB_NAME!;
const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : undefined;

const ffmpegPath = 'ffmpeg';

interface ICommand {
  data?: {
    name: string;
    toJSON: () => any;
  };
  name?: string;
  aliases?: string[];
  execute: (interactionOrMessage: Interaction | Message, args?: string[]) => Promise<void>;
}

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, ICommand>;
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.commands = new Collection<string, ICommand>();

export const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: DB_PORT,
});

async function ensureDatabaseTables(): Promise<void> {
  try {
    const createUsersTableQuery = `
      CREATE TABLE IF NOT EXISTS users (
        user_id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255),
        status ENUM('đồng ý', 'từ chối') NOT NULL
      )
    `;
    await pool.execute(createUsersTableQuery);
    console.log('Table `users` is ready.');

    const createBalanceTableQuery = `
      CREATE TABLE IF NOT EXISTS balance (
        user_id VARCHAR(255) PRIMARY KEY,
        balance INT DEFAULT 0
      )
    `;
    await pool.execute(createBalanceTableQuery);
    console.log('Table `balance` is ready.');

    const createPackagesTableQuery = `
      CREATE TABLE IF NOT EXISTS packages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(255),
        package_name VARCHAR(255),
        package_price INT
      )
    `;
    await pool.execute(createPackagesTableQuery);
    console.log('Table `packages` is ready.');

    const createUserGuildsTableQuery = `
      CREATE TABLE IF NOT EXISTS user_guilds (
        user_id VARCHAR(255) NOT NULL,
        guild_id VARCHAR(255) NOT NULL,
        PRIMARY KEY (user_id, guild_id)
      )
    `;
    await pool.execute(createUserGuildsTableQuery);
    console.log('Table `user_guilds` is ready.');

    await ensureConversationTables(pool);
  } catch (error) {
    console.error('Error ensuring database tables exist:', error);
  }
}

async function checkUserAgreement(userId: string): Promise<boolean> {
  try {
    const [rows]: any = await pool.execute('SELECT status FROM users WHERE user_id = ?', [userId]);
    return rows.length > 0 && rows[0].status === 'đồng ý';
  } catch (error) {
    console.error('Lỗi kiểm tra sự đồng ý của người dùng:', error);
    return false;
  }
}

async function setUserAgreement(userId: string, status: string): Promise<void> {
  try {
    await pool.execute(
      'INSERT INTO users (user_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = ?',
      [userId, status, status]
    );
  } catch (error) {
    console.error('Lỗi lưu sự đồng ý của người dùng:', error);
  }
}

async function setUserGuild(userId: string, guildId: string): Promise<void> {
  try {
    await pool.execute(
      'INSERT INTO user_guilds (user_id, guild_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE guild_id = ?',
      [userId, guildId, guildId]
    );
  } catch (error) {
    console.error('Error updating user_guilds table:', error);
  }
}

async function sendTermsAndConditions(interactionOrMessage: Interaction | Message): Promise<void> {
  const termsEmbed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('Điều khoản và Điều kiện Sử dụng Bot')
    .setDescription(
      'Vui lòng đồng ý với các điều khoản và điều kiện sau trước khi sử dụng bot:\n\n' +
      '1. Bot này chỉ được sử dụng cho mục đích giải trí.\n' +
      '2. Không sử dụng bot để gửi nội dung không phù hợp.\n' +
      '3. Bot không chịu trách nhiệm về việc sử dụng sai mục đích.\n\n' +
      'Bằng cách nhấp vào "Đồng ý", bạn chấp nhận các điều khoản và điều kiện này.'
    )
    .setFooter({ text: 'Cảm ơn bạn đã sử dụng bot của chúng tôi!' });

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('agree').setLabel('Đồng ý').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('decline').setLabel('Từ chối').setStyle(ButtonStyle.Danger)
  );

  if (interactionOrMessage instanceof Message) {
    await interactionOrMessage.reply({ embeds: [termsEmbed], components: [buttons] });
  } else {
    await (interactionOrMessage as ChatInputCommandInteraction).reply({
      embeds: [termsEmbed],
      components: [buttons],
    });
  }
}

async function registerCommands(guildId: string): Promise<void> {
  const commands = client.commands.map((command) => (command.data ? command.data.toJSON() : {}));
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(client.user!.id, guildId), { body: commands });
  } catch (error) {
    console.error(`Lỗi đăng ký lệnh cho guild ID ${guildId}:`, error);
  }
}

async function synchronizeCommandsForGuilds(guilds: Collection<string, Guild>): Promise<void> {
  let syncedGuildsCount = 0;
  for (const guild of guilds.values()) {
    try {
      await registerCommands(guild.id);
      syncedGuildsCount++;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`Hoàn thành đăng ký lệnh slash cho ${syncedGuildsCount} guilds`);
    } catch (error) {
      console.error(`Lỗi đồng bộ lệnh cho guild ${guild.id}:`, error);
    }
  }
  console.log();
}

async function updateBotPresence(): Promise<void> {
  try {
    const guilds = (await client.guilds.fetch()) as unknown as Collection<string, Guild>;
    let totalMembers = 0;
    for (const guild of guilds.values()) {
      const fetchedGuild = await guild.fetch();
      totalMembers += fetchedGuild.memberCount;
    }
    client.user?.setActivity(`Với ${totalMembers} Thành Viên`, { type: ActivityType.Playing });
  } catch (error) {
    console.error('Lỗi khi cập nhật trạng thái bot:', error);
  }
}

async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
  const connection = getVoiceConnection(newState.guild.id);
  if (
    connection &&
    newState.channelId === null &&
    oldState.channelId !== null &&
    oldState.channel?.members.size === 1
  ) {
    setTimeout(() => {
      const currentConnection = getVoiceConnection(oldState.guild.id);
      if (currentConnection && oldState.channel?.members.size === 1) {
        currentConnection.destroy();
      }
    }, 30000);
  }
}

const commandsPath = path.join(__dirname, 'commands');
const commandCategories = ['musics', 'system', 'games'];
for (const category of commandCategories) {
  const categoryPath = path.join(commandsPath, category);
  if (!fs.existsSync(categoryPath)) continue;
  const commandFiles = fs
    .readdirSync(categoryPath)
    .filter((file) => file.endsWith('.js') || file.endsWith('.ts'));
  for (const file of commandFiles) {
    const filePath = path.join(categoryPath, file);
    const commandModule = require(filePath);
    const command: ICommand = commandModule.default || commandModule;
    const commandName = command.data ? command.data.name : command.name;
    if (!commandName) {
      console.error(`Lệnh không có tên tại ${filePath}`);
      continue;
    }
    console.log(`Đang tải lệnh: ${commandName}`);
    client.commands.set(commandName, command);
  }
}

client.once('ready', async () => {
  console.log('Bot đã sẵn sàng!');
  try {
    await ensureDatabaseTables();
    const guilds = (await client.guilds.fetch()) as unknown as Collection<string, Guild>;
    await synchronizeCommandsForGuilds(guilds);
    await updateBotPresence();
    console.log(`Tên của bot là: ${client.user?.username}`);
  } catch (error) {
    console.error('Lỗi khi lấy guilds hoặc cập nhật trạng thái:', error);
  }
});

client.on('guildCreate', async (guild: Guild) => {
  console.log(`Đã tham gia guild mới: ${guild.name}`);
  try {
    await registerCommands(guild.id);
    const guilds = (await client.guilds.fetch()) as unknown as Collection<string, Guild>;
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    console.log(`Hoàn thành đăng ký lệnh slash cho ${guilds.size} guilds`);
    await updateBotPresence();
  } catch (error) {
    console.error(`Lỗi đăng ký lệnh cho guild mới ${guild.id}:`, error);
  }
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift()?.toLowerCase() || '';
  let command = client.commands.get(commandName);
  if (!command) {
    command = client.commands.find((cmd) => cmd.aliases && cmd.aliases.includes(commandName));
  }
  if (!command) return;
  const senderAgreed = await checkUserAgreement(message.author.id);
  if (!senderAgreed) {
    await sendTermsAndConditions(message);
    return;
  }
  if (message.mentions && message.mentions.users && message.mentions.users.size > 0) {
    for (const [userId, user] of message.mentions.users) {
      const targetAgreed = await checkUserAgreement(userId);
      if (!targetAgreed) {
        return message.reply(`Người dùng ${user.username} chưa đồng ý với điều khoản và điều kiện. Lệnh không thể được thực hiện.`);
      }
    }
  }
  try {
    await command.execute(message, args);
  } catch (error) {
    console.error(`Lỗi thực thi lệnh ${commandName}:`, error);
    const errorEmbed = new EmbedBuilder()
      .setColor('#FF0000')
      .setDescription('❌ Đã xảy ra lỗi khi thử thực thi lệnh đó!');
    message.reply({ embeds: [errorEmbed] });
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isButton()) {
    const btnInteraction = interaction as ButtonInteraction;
    const userId = btnInteraction.user.id;
    if (btnInteraction.customId === 'agree') {
      await setUserAgreement(userId, 'đồng ý');
      if (btnInteraction.guildId) {
        await setUserGuild(userId, btnInteraction.guildId);
      }
      await btnInteraction.update({
        content: 'Bạn đã đồng ý với các điều khoản và điều kiện!',
        embeds: [],
        components: [],
      });
    } else if (btnInteraction.customId === 'decline') {
      await btnInteraction.update({
        content: 'Bạn đã từ chối các điều khoản và điều kiện. Bạn không thể sử dụng bot.',
        embeds: [],
        components: [],
      });
    }
  } else if (interaction.isChatInputCommand()) {
    const chatInteraction = interaction as ChatInputCommandInteraction;
    const command = client.commands.get(chatInteraction.commandName);
    if (!command) return;
    const senderAgreed = await checkUserAgreement(chatInteraction.user.id);
    if (!senderAgreed) {
      await sendTermsAndConditions(chatInteraction);
      return;
    }
    const targetUser = chatInteraction.options.getUser('target');
    if (targetUser) {
      const targetAgreed = await checkUserAgreement(targetUser.id);
      if (!targetAgreed) {
        return await chatInteraction.reply({
          content: `Người dùng ${targetUser.username} chưa đồng ý với điều khoản và điều kiện. Lệnh không thể được thực hiện.`,
          ephemeral: true,
        });
      }
    }
    try {
      await command.execute(chatInteraction);
    } catch (error) {
      console.error(`Lỗi thực thi lệnh ${chatInteraction.commandName}:`, error);
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setDescription('❌ Đã xảy ra lỗi khi thực thi lệnh này!');
      await chatInteraction.reply({ embeds: [errorEmbed] });
    }
  }
});

client.on('voiceStateUpdate', handleVoiceStateUpdate);

process.on('uncaughtException', (error) => {
  console.error('Lỗi không mong muốn:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Lỗi không xử lý được:', error);
});

client.login(TOKEN);
