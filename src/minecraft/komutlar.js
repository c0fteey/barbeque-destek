import {ApplicationCommandOptionType, MessageFlags, Routes} from 'discord.js';
import {createAccounts} from './hesaplar.js';
import {fetchAvatar, renderCard} from './kart.js';
import {fetchSkin, findAccount, NICK_PATTERN} from './mojang.js';
import {readSkin} from './render3d.js';

/**
 * Minecraft komutları:
 *   /account nick:<ad>      Minecraft adını kaydeder (Mojang'da var mı diye bakılır).
 *   /profil [kullanici]     Kaydedilen hesabın 3D skinli kartını kanala atar.
 */
export const COMMANDS = [
  {
    name: 'account',
    description: 'Minecraft hesabını kaydet',
    options: [{type: ApplicationCommandOptionType.String, name: 'nick', description: 'Minecraft kullanıcı adın', required: true, min_length: 3, max_length: 16}],
  },
  {
    name: 'profil',
    description: 'Minecraft skinli profil kartını göster',
    options: [{type: ApplicationCommandOptionType.User, name: 'kullanici', description: 'Kimin profili (boş bırakırsan seninki)', required: false}],
  },
];

const whisper = (content) => ({content, flags: MessageFlags.Ephemeral, allowedMentions: {parse: []}});

export function createMinecraft({levels}) {
  const accounts = createAccounts();
  // Micup aynı etkileşimi iki kez gönderebiliyor; ikincisi yok sayılır.
  const seen = new Set();

  async function account(interaction) {
    const nick = interaction.options.getString('nick', true).trim();
    if (!NICK_PATTERN.test(nick)) {
      await interaction.reply(whisper('Minecraft adı 3-16 karakter olmalı ve yalnızca harf, rakam ve alt çizgi (_) içermeli.'));
      return;
    }
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    let found;
    try {
      found = await findAccount(nick);
    } catch (error) {
      console.warn(`Minecraft hesabı aranamadı (${nick}): ${error.message}`);
      await interaction.editReply('Mojang şu an yanıt vermiyor. Birkaç dakika sonra tekrar dene.');
      return;
    }
    if (!found) {
      await interaction.editReply(`**${nick}** adında bir Minecraft hesabı bulunamadı. Adı doğru yazdığından emin ol.`);
      return;
    }
    accounts.set(interaction.user.id, found);
    await interaction.editReply(`Minecraft hesabın kaydedildi: **${found.nick}**. Kartını görmek için \`/profil\` yaz.`);
  }

  async function profile(interaction) {
    const user = interaction.options.getUser('kullanici') ?? interaction.user;
    const saved = accounts.get(user.id);
    if (!saved) {
      await interaction.reply(
        whisper(user.id === interaction.user.id ? 'Önce `/account` ile Minecraft adını kaydet.' : 'Bu kişi henüz Minecraft hesabını kaydetmemiş.'),
      );
      return;
    }
    await interaction.deferReply();
    let skinData;
    try {
      skinData = await fetchSkin(saved.uuid);
    } catch (error) {
      console.warn(`Skin alınamadı (${saved.nick}): ${error.message}`);
      await interaction.editReply('Skin Mojang\'dan alınamadı. Birkaç dakika sonra tekrar dene.');
      return;
    }
    const member = interaction.options.getMember('kullanici') ?? (user.id === interaction.user.id ? interaction.member : null);
    const name = member?.displayName ?? user.globalName ?? user.username;
    // Minecraft adı değiştiyse kartta yenisi görünür.
    const account = {...saved, nick: skinData.nick ?? saved.nick};
    const png = await renderCard({
      name,
      username: user.username,
      avatar: await fetchAvatar(user.displayAvatarURL?.({extension: 'png', size: 256})),
      account,
      stats: levels.get(user.id),
      skin: await readSkin(skinData.png),
      slim: skinData.slim,
    });
    await interaction.editReply({
      files: [{attachment: png, name: 'profil.png', description: `${name} - Minecraft: ${account.nick}`}],
      allowedMentions: {parse: []},
    });
  }

  return {
    /** Komutları Micup'a kaydeder (bot her açıldığında). */
    async register(client) {
      try {
        await client.rest.put(Routes.applicationCommands(client.application.id), {body: COMMANDS});
        console.log(`Slash komutları kaydedildi: ${COMMANDS.map((c) => `/${c.name}`).join(', ')}.`);
      } catch (error) {
        console.error('Slash komutları kaydedilemedi:', error.message);
      }
    },

    async handle(interaction) {
      if (!interaction.isChatInputCommand?.()) return;
      if (seen.has(interaction.id)) return;
      seen.add(interaction.id);
      if (seen.size > 2_000) seen.delete(seen.values().next().value);
      try {
        if (interaction.commandName === 'account') await account(interaction);
        else if (interaction.commandName === 'profil') await profile(interaction);
      } catch (error) {
        console.error(`/${interaction.commandName} çalışmadı:`, error);
        const reply = {content: 'Bir şeyler ters gitti. Birazdan tekrar dene.', files: [], allowedMentions: {parse: []}};
        if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
        else await interaction.reply({...reply, flags: MessageFlags.Ephemeral}).catch(() => {});
      }
    },
  };
}
