import {EmbedBuilder} from 'discord.js';

/**
 * Barbeque bir sunucuya eklenince ya da çıkarılınca bbq-deploy ajanı bilgisini IPC ile gönderir
 * ({type: 'guild-event', event: 'join' | 'leave', guild, bot, totalGuilds}); bu bot panelde seçilen kanala yazar.
 * Kanallar: JOIN_CHANNEL_ID (eklendi), LEAVE_CHANNEL_ID (çıkarıldı); boşsa o bildirim yazılmaz.
 * Metinler src/mesajlar.json > sunucu.
 */
export function createGuildNotices({client, text, fill}) {
  const channels = {
    join: (process.env.JOIN_CHANNEL_ID || '').trim() || null,
    leave: (process.env.LEAVE_CHANNEL_ID || '').trim() || null,
  };
  const t = text.sunucu ?? {};
  const isUrl = (value) => typeof value === 'string' && /^https?:\/\//.test(value);
  const date = (ms) => (Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:D>` : '—');
  const clip = (value, max) => String(value ?? '').slice(0, max);

  function build(message) {
    const g = message.guild ?? {};
    const kind = message.event === 'leave' ? 'leave' : 'join';
    const values = {
      bot: message.bot?.name ?? 'Barbeque',
      sunucu: clip(g.name || '?', 200),
      id: g.id ?? '?',
      uye: Number.isFinite(g.memberCount) ? g.memberCount.toLocaleString('tr-TR') : '?',
      sahip: g.ownerId ? `<@${g.ownerId}>${g.ownerName ? ` (${clip(g.ownerName, 80)})` : ''}` : '—',
      sahipId: g.ownerId ?? '—',
      kurulus: date(g.createdAt),
      toplam: Number.isFinite(message.totalGuilds) ? message.totalGuilds.toLocaleString('tr-TR') : '?',
    };
    const embed = new EmbedBuilder()
      .setColor(kind === 'join' ? 0x2ecc71 : 0xe8262b)
      .setTitle(clip(fill(t[kind]?.baslik, values), 256) || kind)
      .setDescription(clip(fill(t[kind]?.aciklama, values), 4000) || null)
      .addFields(
        {name: t.alan?.ad ?? 'Sunucu', value: values.sunucu, inline: true},
        {name: t.alan?.id ?? 'ID', value: `\`${values.id}\``, inline: true},
        {name: t.alan?.uye ?? 'Üye', value: values.uye, inline: true},
        {name: t.alan?.sahip ?? 'Sahip', value: values.sahip, inline: true},
        {name: t.alan?.kurulus ?? 'Kuruluş', value: values.kurulus, inline: true},
        {name: t.alan?.toplam ?? 'Toplam sunucu', value: values.toplam, inline: true},
      )
      .setTimestamp(Number.isFinite(message.at) ? message.at : Date.now());
    if (g.description) embed.addFields({name: t.alan?.aciklama ?? 'Açıklama', value: clip(g.description, 1000)});
    if (isUrl(g.icon)) embed.setThumbnail(g.icon);
    if (isUrl(g.banner)) embed.setImage(g.banner);
    return embed;
  }

  async function handle(message) {
    const kind = message.event === 'leave' ? 'leave' : 'join';
    const id = channels[kind];
    console.log(`${message.bot?.name ?? 'Barbeque'} ${kind === 'join' ? 'sunucuya eklendi' : 'sunucudan çıkarıldı'}: ${message.guild?.name} (${message.guild?.id})`);
    if (!id) return;
    const channel = client.channels.cache.get(id) ?? (await client.channels.fetch(id).catch(() => null));
    if (!channel?.send) {
      console.warn(`Sunucu bildirimi kanalı bulunamadı (${id}); panelde kanal ID'sini ve botun o kanalı görebildiğini kontrol et.`);
      return;
    }
    await channel.send({embeds: [build(message)], allowedMentions: {parse: []}}).catch(async (error) => {
      // Micup resimli embed'i reddederse resimsiz yeniden denenir.
      console.warn(`Sunucu bildirimi gönderilemedi (#${id}): ${error.message}`);
      const plain = build({...message, guild: {...message.guild, icon: null, banner: null}});
      await channel.send({embeds: [plain], allowedMentions: {parse: []}}).catch(() => {});
    });
  }

  console.log(`Sunucu bildirimi: eklendi ${channels.join ?? 'kapalı'}, çıkarıldı ${channels.leave ?? 'kapalı'}.`);
  return {handle};
}
