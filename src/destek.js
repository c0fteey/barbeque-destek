import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import {renderBanner} from './destekBanner.js';

/**
 * Destek (ticket) sistemi.
 *
 * Kurulum (Sunucuyu Yönet izni olanlar):
 *   /destek-kur kategori kategori:<kategori>   ticket kanallarının açılacağı kategori
 *   /destek-kur yetkili-ekle rol:<rol>          ticketları görecek yetkili rol (birden çok olabilir)
 *   /destek-kur yetkili-cikar rol:<rol>
 *   /destek-kur log kanal:<kanal>               kapanan ticketların dökümünün gideceği kanal
 *   /destek-kur limit sayi:<1-10>               kişi başı aynı anda açık ticket sayısı (vars. 1)
 *   /destek-kur panel kanal:<kanal>             "Destek Talebi Aç" butonlu paneli o kanala atar
 *   /destek-kur durum                           ayarları gösterir
 *
 * Ticket içinde (açan kişi ya da yetkili; ekle/çıkar/üstlen yalnızca yetkili):
 *   /destek kapat [sebep]   /destek ekle kullanici   /destek cikar kullanici   /destek ustlen
 *
 * Yasak (yetkili, her kanalda): /destek yasakla kullanici [sebep] [gun]   /destek yasak-kaldir kullanici   /destek yasaklilar
 *
 * Ticket: kategoride "destek-0001" gibi özel kanal; yalnızca açan, yetkili roller ve bot görür.
 * Kapanınca bütün mesajların .txt dökümü açan kişiye özelden ve log kanalına gider, kanal silinir.
 * Ayarlar ve açık ticketlar veri/destek.json'da (git'te değil, güncellemede silinmez).
 * Metinler src/mesajlar.json > destek; eksik olan anahtar için aşağıdaki varsayılan kullanılır.
 */

const DEFAULTS = {
  panelBaslik: '🎫 Barbeque Destek',
  panelAciklama:
    'Barbeque ile ilgili bir sorun, soru ya da şikayetin mi var?\nAşağıdaki butona bas, sana özel bir destek kanalı açılsın. Yetkililer en kısa sürede ilgilenecek.',
  panelButon: 'Destek Talebi Aç',
  bannerUst: 'BARBEQUE',
  bannerBaslik: 'DESTEK',
  bannerVurgu: 'MERKEZİ',
  bannerAltYazi: 'Sorun, soru ya da şikayet? Sana özel kanalda yetkililer yardımcı olsun.',
  bannerEtiket: 'Aşağıdaki butona bas',
  acilisBaslik: 'Destek Talebi #{no}',
  acilisAciklama:
    'Merhaba {kisi}, destek talebin açıldı.\nSorununu ayrıntılı yaz; ekran görüntüsü varsa ekle. Bir yetkili birazdan seninle ilgilenecek.\n\nİşin bitince **Kapat** butonuna basabilirsin.',
  acilisPing: '{kisi} {roller}',
  butonUstlen: 'Üstlen',
  butonUstlenildi: 'Üstlenen: {yetkili}',
  butonKapat: 'Kapat',
  butonOnay: 'Evet, kapat',
  butonVazgec: 'Vazgeç',
  acildiCevap: 'Destek talebin açıldı: {kanal}',
  limitDolu: 'Zaten açık destek talebin var: {kanallar}. Önce onu kapat.',
  kurulmamis: 'Destek sistemi henüz kurulmamış. Bir yetkiliye haber ver.',
  acilamadi: 'Destek kanalı açılamadı. Botun "Kanalları Yönet" izni olmalı ve ayarlanan kategori hâlâ var olmalı.',
  ustlenildi: '🙋 {yetkili} bu talebi üstlendi.',
  zatenUstlenildi: 'Bu talebi zaten {yetkili} üstlenmiş.',
  kapatSor: 'Bu destek talebini kapatmak istediğine emin misin? Kanal silinecek, döküm sana ve log kanalına gidecek.',
  vazgecildi: 'Vazgeçildi, talep açık kalıyor.',
  kapaniyor: '🔒 Talep {yetkili} tarafından kapatıldı{sebep}. Kanal {saniye} saniye içinde silinecek.',
  ozelKapandi: '**{sunucu}** sunucusundaki **#{no}** numaralı destek talebin kapatıldı{sebep}. Konuşmanın dökümü ekte.',
  eklendi: '➕ {kullanici} talebe eklendi.',
  cikarildi: '➖ {kullanici} talepten çıkarıldı.',
  ticketDegil: 'Bu komut yalnızca bir destek kanalında kullanılabilir.',
  yetkiYok: 'Bunu yalnızca destek yetkilileri yapabilir.',
  kapatmaYetkiYok: 'Bu talebi yalnızca açan kişi ya da bir yetkili kapatabilir.',
  yasakli: 'Destek talebi açman yasaklandı{bitis}.{sebep}',
  yasaklandi: '🚫 {kullanici} destek talebi açmaktan yasaklandı{bitis}.{sebep}',
  yasakKalkti: '✅ {kullanici} için destek talebi yasağı kaldırıldı.',
  ozelYasak: '**{sunucu}** sunucusunda destek talebi açman yasaklandı{bitis}.{sebep}',
  logBaslik: '📁 Destek Talebi #{no} kapatıldı',
};

const FILE = fileURLToPath(new URL('../veri/destek.json', import.meta.url));
const DIR = fileURLToPath(new URL('../veri/', import.meta.url));
const COLOR = 0xf28c28;
const DELETE_AFTER_S = 5;
const TRANSCRIPT_MAX_MESSAGES = 10_000;
const MAX_LIMIT = 10;

const TICKET_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

export const COMMANDS = [
  {
    name: 'destek-kur',
    description: 'Destek (ticket) sistemini ayarla',
    default_member_permissions: String(PermissionFlagsBits.ManageGuild),
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'kategori',
        description: 'Ticket kanallarının açılacağı kategori',
        options: [{type: ApplicationCommandOptionType.Channel, name: 'kategori', description: 'Kategori', required: true, channel_types: [ChannelType.GuildCategory]}],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'yetkili-ekle',
        description: 'Ticketları görecek yetkili rolü ekle',
        options: [{type: ApplicationCommandOptionType.Role, name: 'rol', description: 'Yetkili rolü', required: true}],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'yetkili-cikar',
        description: 'Yetkili rolünü çıkar',
        options: [{type: ApplicationCommandOptionType.Role, name: 'rol', description: 'Yetkili rolü', required: true}],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'log',
        description: 'Kapanan ticket dökümlerinin gideceği kanal',
        options: [{type: ApplicationCommandOptionType.Channel, name: 'kanal', description: 'Log kanalı', required: true, channel_types: [ChannelType.GuildText]}],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'limit',
        description: 'Kişi başı aynı anda açık ticket sayısı',
        options: [{type: ApplicationCommandOptionType.Integer, name: 'sayi', description: `1-${MAX_LIMIT}`, required: true, min_value: 1, max_value: MAX_LIMIT}],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'panel',
        description: '"Destek Talebi Aç" butonlu paneli bir kanala at',
        options: [{type: ApplicationCommandOptionType.Channel, name: 'kanal', description: 'Panelin atılacağı kanal', required: true, channel_types: [ChannelType.GuildText]}],
      },
      {type: ApplicationCommandOptionType.Subcommand, name: 'durum', description: 'Destek ayarlarını göster'},
    ],
  },
  {
    name: 'destek',
    description: 'Destek talebi işlemleri (destek kanalında)',
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'kapat',
        description: 'Bu destek talebini kapat',
        options: [{type: ApplicationCommandOptionType.String, name: 'sebep', description: 'Kapatma sebebi', required: false, max_length: 300}],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'ekle',
        description: 'Talebe bir üye ekle',
        options: [{type: ApplicationCommandOptionType.User, name: 'kullanici', description: 'Eklenecek üye', required: true}],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'cikar',
        description: 'Talepten bir üyeyi çıkar',
        options: [{type: ApplicationCommandOptionType.User, name: 'kullanici', description: 'Çıkarılacak üye', required: true}],
      },
      {type: ApplicationCommandOptionType.Subcommand, name: 'ustlen', description: 'Bu talebi üstlen'},
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'yasakla',
        description: 'Bir üyenin destek talebi açmasını yasakla',
        options: [
          {type: ApplicationCommandOptionType.User, name: 'kullanici', description: 'Yasaklanacak üye', required: true},
          {type: ApplicationCommandOptionType.String, name: 'sebep', description: 'Yasak sebebi', required: false, max_length: 300},
          {type: ApplicationCommandOptionType.Integer, name: 'gun', description: 'Kaç gün (boş = süresiz)', required: false, min_value: 1, max_value: 3650},
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'yasak-kaldir',
        description: 'Destek talebi yasağını kaldır',
        options: [{type: ApplicationCommandOptionType.User, name: 'kullanici', description: 'Yasağı kaldırılacak üye', required: true}],
      },
      {type: ApplicationCommandOptionType.Subcommand, name: 'yasaklilar', description: 'Destek talebi yasağı olanları listele'},
    ],
  },
];

function load() {
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

const whisper = (content) => ({content, flags: MessageFlags.Ephemeral, allowedMentions: {parse: []}});
const pad = (no) => String(no).padStart(4, '0');
const name = (user) => user?.globalName ?? user?.username ?? 'bilinmiyor';
/** Logo: botun profil fotoğrafı (Barbeque logosu). */
const logo = (client) => client.user?.displayAvatarURL?.({extension: 'png', size: 256}) ?? null;
const date = (ms) => new Date(ms).toLocaleString('tr-TR', {timeZone: 'Europe/Istanbul'});

function duration(ms) {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} dakika`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} saat ${m % 60} dakika`;
  return `${Math.floor(h / 24)} gün ${h % 24} saat`;
}

export function createSupport({text = {}, fill}) {
  const T = {...DEFAULTS, ...(text.destek ?? {})};
  const t = (key, values = {}) => fill(T[key] ?? DEFAULTS[key], values);
  const data = load();
  // Micup aynı etkileşimi iki kez gönderebiliyor; ikincisi yok sayılır.
  const seen = new Set();
  // Çift tıklama: aynı kişi aynı anda iki ticket açamasın, aynı kanal iki kez kapanmasın.
  const opening = new Set();
  const closing = new Set();

  function save() {
    try {
      mkdirSync(DIR, {recursive: true});
      writeFileSync(`${FILE}.tmp`, JSON.stringify(data, null, 2));
      renameSync(`${FILE}.tmp`, FILE);
    } catch (error) {
      console.error(`veri/destek.json yazılamadı: ${error.message}`);
    }
  }

  const guildData = (guildId) => {
    const g = (data[guildId] ??= {});
    g.yetkiliRoller ??= [];
    g.limit ??= 1;
    g.sayac ??= 0;
    g.ticketlar ??= {};
    g.yasaklar ??= {};
    return g;
  };

  /** Yetkili: ayarlanan rollerden biri ya da Kanalları Yönet / Yönetici izni. */
  function isStaff(member, g) {
    if (!member) return false;
    const perms = member.permissions;
    if (perms?.has?.(PermissionFlagsBits.Administrator) || perms?.has?.(PermissionFlagsBits.ManageChannels)) return true;
    const roles = member.roles?.cache ? [...member.roles.cache.keys()] : (member.roles ?? []);
    return roles.some((id) => g.yetkiliRoller.includes(id));
  }

  /** Silinmiş kanallara ait kayıtları temizler (bot kapalıyken elle silinmiş olabilir). */
  function prune(guild, g) {
    let changed = false;
    for (const channelId of Object.keys(g.ticketlar)) {
      if (!guild.channels.cache.has(channelId)) {
        delete g.ticketlar[channelId];
        changed = true;
      }
    }
    if (changed) save();
  }

  const ticketButtons = (claimedBy) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('destek:ustlen')
        .setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
        .setEmoji('🙋')
        .setLabel(claimedBy ? t('butonUstlenildi', {yetkili: claimedBy}).slice(0, 80) : t('butonUstlen'))
        .setDisabled(Boolean(claimedBy)),
      new ButtonBuilder().setCustomId('destek:kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒').setLabel(t('butonKapat')),
    );

  /** Yetkili rol eklenince/çıkarılınca açık ticket kanallarının izinleri de güncellenir. Güncellenen kanal sayısını döner. */
  async function applyRoleToOpenTickets(guild, g, roleId, add) {
    prune(guild, g);
    const allow = Object.fromEntries([...TICKET_ALLOW, PermissionFlagsBits.ManageMessages].map((p) => [permName(p), true]));
    let changed = 0;
    for (const channelId of Object.keys(g.ticketlar)) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      const done = add ? channel.permissionOverwrites.edit(roleId, allow) : channel.permissionOverwrites.delete(roleId);
      await done.then(
        () => changed++,
        (error) => console.warn(`Destek kanalı izni güncellenemedi (#${channelId}): ${error.message}`),
      );
    }
    return changed;
  }

  // ---------- Kurulum ----------

  async function setup(interaction) {
    const g = guildData(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    if (sub === 'kategori') {
      const category = interaction.options.getChannel('kategori', true);
      g.kategori = category.id;
      save();
      await interaction.reply(whisper(`Ticketlar artık **${category.name}** kategorisinde açılacak.`));
    } else if (sub === 'yetkili-ekle') {
      const role = interaction.options.getRole('rol', true);
      if (!g.yetkiliRoller.includes(role.id)) g.yetkiliRoller.push(role.id);
      save();
      const changed = await applyRoleToOpenTickets(interaction.guild, g, role.id, true);
      await interaction.reply(whisper(`<@&${role.id}> yetkili olarak eklendi. Yeni ticketları ve açık ${changed} ticketı görecek.`));
    } else if (sub === 'yetkili-cikar') {
      const role = interaction.options.getRole('rol', true);
      g.yetkiliRoller = g.yetkiliRoller.filter((id) => id !== role.id);
      save();
      const changed = await applyRoleToOpenTickets(interaction.guild, g, role.id, false);
      await interaction.reply(whisper(`<@&${role.id}> yetkililerden çıkarıldı; açık ${changed} ticketdan da izni kaldırıldı.`));
    } else if (sub === 'log') {
      const channel = interaction.options.getChannel('kanal', true);
      g.log = channel.id;
      save();
      await interaction.reply(whisper(`Kapanan ticketların dökümü artık <#${channel.id}> kanalına gidecek.`));
    } else if (sub === 'limit') {
      g.limit = Math.min(MAX_LIMIT, Math.max(1, interaction.options.getInteger('sayi', true)));
      save();
      await interaction.reply(whisper(`Bir kişi aynı anda en fazla **${g.limit}** açık ticket açabilir.`));
    } else if (sub === 'panel') {
      const channel = interaction.options.getChannel('kanal', true);
      const target = interaction.guild.channels.cache.get(channel.id) ?? (await interaction.guild.channels.fetch(channel.id).catch(() => null));
      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(t('panelBaslik'))
        .setDescription(t('panelAciklama'))
        .setImage('attachment://destek-banner.png');
      await interaction.deferReply({flags: MessageFlags.Ephemeral});
      // 16:9 banner: logo + başlık; çizilemezse panel banner'sız gider.
      const banner = await renderBanner({
        logoUrl: logo(interaction.client),
        top: t('bannerUst'),
        title: t('bannerBaslik'),
        accent: t('bannerVurgu'),
        subtitle: t('bannerAltYazi'),
        tag: t('bannerEtiket'),
      }).catch((error) => {
        console.warn(`Destek banner'ı çizilemedi: ${error.message}`);
        return null;
      });
      if (!banner) embed.setImage(null).setThumbnail(logo(interaction.client));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('destek:ac').setStyle(ButtonStyle.Primary).setEmoji('🎫').setLabel(t('panelButon')),
      );
      const sent = await target?.send?.({embeds: [embed], components: [row], files: banner ? [{attachment: banner, name: 'destek-banner.png'}] : []}).catch((error) => {
        console.warn(`Destek paneli atılamadı (#${channel.id}): ${error.message}`);
        return null;
      });
      if (sent) {
        g.panel = {kanal: channel.id, mesaj: sent.id};
        save();
      }
      await interaction.editReply(sent ? `Panel <#${channel.id}> kanalına atıldı.` : 'Panel atılamadı. Botun o kanalda mesaj gönderme ve dosya ekleme izni olmalı.');
    } else if (sub === 'durum') {
      prune(interaction.guild, g);
      const open = Object.keys(g.ticketlar).length;
      const lines = [
        `**Kategori:** ${g.kategori ? `<#${g.kategori}>` : 'ayarlanmamış (kanallar kategorisiz açılır)'}`,
        `**Yetkili roller:** ${g.yetkiliRoller.length ? g.yetkiliRoller.map((id) => `<@&${id}>`).join(', ') : 'yok (yalnızca Kanalları Yönet izni olanlar)'}`,
        `**Log kanalı:** ${g.log ? `<#${g.log}>` : 'ayarlanmamış'}`,
        `**Kişi başı limit:** ${g.limit}`,
        `**Panel:** ${g.panel ? `<#${g.panel.kanal}>` : 'atılmamış'}`,
        `**Açık ticket:** ${open} · **Toplam açılan:** ${g.sayac}`,
      ];
      await interaction.reply({embeds: [new EmbedBuilder().setColor(COLOR).setTitle('Destek ayarları').setDescription(lines.join('\n'))], flags: MessageFlags.Ephemeral});
    }
  }

  // ---------- Yasak ----------

  /** Süresi geçmemiş yasak; süresi geçmişse silinir. */
  function activeBan(g, userId) {
    const ban = g.yasaklar[userId];
    if (!ban) return null;
    if (ban.bitis && ban.bitis <= Date.now()) {
      delete g.yasaklar[userId];
      save();
      return null;
    }
    return ban;
  }

  const banValues = (ban) => ({
    bitis: ban.bitis ? ` (${date(ban.bitis)} tarihine kadar)` : ' (süresiz)',
    sebep: ban.sebep ? ` Sebep: ${ban.sebep}` : '',
  });

  async function logTo(guild, g, content) {
    if (!g.log) return;
    const channel = guild.channels.cache.get(g.log) ?? (await guild.channels.fetch(g.log).catch(() => null));
    await channel?.send?.({content, allowedMentions: {parse: []}}).catch(() => {});
  }

  async function banUser(interaction) {
    const g = guildData(interaction.guildId);
    if (!isStaff(interaction.member, g)) return interaction.reply(whisper(t('yetkiYok')));
    const user = interaction.options.getUser('kullanici', true);
    if (user.bot) return interaction.reply(whisper('Botlar zaten destek talebi açamaz.'));
    const days = interaction.options.getInteger('gun');
    const ban = {
      sebep: interaction.options.getString('sebep')?.trim() || '',
      yetkili: interaction.user.id,
      tarih: Date.now(),
      bitis: days ? Date.now() + days * 86_400_000 : null,
    };
    g.yasaklar[user.id] = ban;
    save();
    const values = {kullanici: `<@${user.id}>`, sunucu: interaction.guild.name, ...banValues(ban)};
    await interaction.reply({content: t('yasaklandi', values), allowedMentions: {parse: []}});
    await Promise.all([
      user.send({content: t('ozelYasak', values), allowedMentions: {parse: []}}).catch(() => {}),
      logTo(interaction.guild, g, `${t('yasaklandi', values)} · yetkili: <@${interaction.user.id}>`),
    ]);
    console.log(`Destek yasağı: ${user.username} (${user.id})${days ? `, ${days} gün` : ', süresiz'}`);
  }

  async function unbanUser(interaction) {
    const g = guildData(interaction.guildId);
    if (!isStaff(interaction.member, g)) return interaction.reply(whisper(t('yetkiYok')));
    const user = interaction.options.getUser('kullanici', true);
    if (!activeBan(g, user.id)) return interaction.reply(whisper('Bu üyenin destek talebi yasağı yok.'));
    delete g.yasaklar[user.id];
    save();
    const text = t('yasakKalkti', {kullanici: `<@${user.id}>`});
    await interaction.reply({content: text, allowedMentions: {parse: []}});
    await logTo(interaction.guild, g, `${text} · yetkili: <@${interaction.user.id}>`);
  }

  async function listBans(interaction) {
    const g = guildData(interaction.guildId);
    if (!isStaff(interaction.member, g)) return interaction.reply(whisper(t('yetkiYok')));
    const ids = Object.keys(g.yasaklar).filter((id) => activeBan(g, id));
    const lines = ids.map((id) => {
      const ban = g.yasaklar[id];
      return `• <@${id}> · ${ban.bitis ? `${date(ban.bitis)} tarihine kadar` : 'süresiz'} · <@${ban.yetkili}>${ban.sebep ? ` · ${ban.sebep}` : ''}`;
    });
    let body = lines.join('\n') || 'Yasaklı kimse yok.';
    if (body.length > 3900) body = `${body.slice(0, 3900)}\n…`;
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`Destek yasakları (${ids.length})`).setDescription(body)],
      flags: MessageFlags.Ephemeral,
      allowedMentions: {parse: []},
    });
  }

  // ---------- Açma ----------

  async function open(interaction) {
    const guild = interaction.guild;
    const g = guildData(guild.id);
    const userId = interaction.user.id;
    const lockKey = `${guild.id}:${userId}`;
    if (opening.has(lockKey)) return interaction.reply(whisper('Talebin açılıyor, bir saniye...'));
    if (!g.kategori && !g.yetkiliRoller.length) return interaction.reply(whisper(t('kurulmamis')));
    const ban = activeBan(g, userId);
    if (ban) return interaction.reply(whisper(t('yasakli', banValues(ban))));
    prune(guild, g);
    const mine = Object.entries(g.ticketlar).filter(([, ticket]) => ticket.sahip === userId);
    if (mine.length >= g.limit) return interaction.reply(whisper(t('limitDolu', {kanallar: mine.map(([id]) => `<#${id}>`).join(', ')})));

    opening.add(lockKey);
    try {
      await interaction.deferReply({flags: MessageFlags.Ephemeral});
      const no = g.sayac + 1;
      const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      const parent = g.kategori && guild.channels.cache.has(g.kategori) ? g.kategori : null;
      const overwrites = [
        {id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel]},
        {id: userId, allow: TICKET_ALLOW},
        ...g.yetkiliRoller.filter((id) => guild.roles.cache.has(id)).map((id) => ({id, allow: [...TICKET_ALLOW, PermissionFlagsBits.ManageMessages]})),
      ];
      if (me) overwrites.push({id: me.id, allow: [...TICKET_ALLOW, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages]});

      const channel = await guild.channels
        .create({
          name: `destek-${pad(no)}`,
          type: ChannelType.GuildText,
          parent,
          topic: `Destek talebi #${pad(no)} · açan: ${interaction.user.username} (${userId})`,
          permissionOverwrites: overwrites,
          reason: `Destek talebi #${pad(no)}: ${interaction.user.username}`,
        })
        .catch((error) => {
          console.warn(`Destek kanalı açılamadı: ${error.message}`);
          return null;
        });
      if (!channel) return interaction.editReply(t('acilamadi'));

      g.sayac = no;
      g.ticketlar[channel.id] = {no, sahip: userId, acildi: Date.now(), ustlenen: null, eklenenler: []};
      save();

      const kisi = `<@${userId}>`;
      const roles = g.yetkiliRoller.map((id) => `<@&${id}>`).join(' ');
      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(t('acilisBaslik', {no: pad(no)}))
        .setThumbnail(logo(interaction.client))
        .setDescription(t('acilisAciklama', {kisi, no: pad(no)}))
        .setFooter({text: `${interaction.user.username} · ${userId}`})
        .setTimestamp();
      await channel
        .send({
          content: t('acilisPing', {kisi, roller: roles}).trim() || undefined,
          embeds: [embed],
          components: [ticketButtons(null)],
          allowedMentions: {users: [userId], roles: g.yetkiliRoller},
        })
        .catch((error) => console.warn(`Destek açılış mesajı gönderilemedi: ${error.message}`));
      console.log(`Destek talebi açıldı: #${pad(no)} ${interaction.user.username} (${userId})`);
      await interaction.editReply(t('acildiCevap', {kanal: `<#${channel.id}>`}));
    } finally {
      opening.delete(lockKey);
    }
  }

  // ---------- Talep içi işlemler ----------

  /** Etkileşim bir ticket kanalında mı; değilse cevap verip null döner. */
  async function ticketOf(interaction) {
    const g = guildData(interaction.guildId);
    const ticket = g.ticketlar[interaction.channelId];
    if (!ticket) {
      await interaction.reply(whisper(t('ticketDegil')));
      return null;
    }
    return {g, ticket};
  }

  async function claim(interaction) {
    const found = await ticketOf(interaction);
    if (!found) return;
    const {g, ticket} = found;
    if (!isStaff(interaction.member, g)) return interaction.reply(whisper(t('yetkiYok')));
    if (ticket.ustlenen) return interaction.reply(whisper(t('zatenUstlenildi', {yetkili: `<@${ticket.ustlenen}>`})));
    ticket.ustlenen = interaction.user.id;
    ticket.ustlenenAd = interaction.user.username;
    save();
    const label = name(interaction.user);
    if (interaction.isButton?.()) {
      await interaction.update({components: [ticketButtons(label)]});
    } else {
      // Slash komutuyla üstlenildiyse açılış mesajındaki buton da güncellensin.
      const first = await interaction.channel.messages.fetch({limit: 10, cache: false}).catch(() => null);
      const opener = first?.find((m) => m.author.id === interaction.client.user.id && m.components?.length);
      await opener?.edit({components: [ticketButtons(label)]}).catch(() => {});
      await interaction.reply({content: t('ustlenildi', {yetkili: `<@${interaction.user.id}>`}), allowedMentions: {parse: []}});
      return;
    }
    await interaction.channel.send({content: t('ustlenildi', {yetkili: `<@${interaction.user.id}>`}), allowedMentions: {parse: []}}).catch(() => {});
  }

  async function addOrRemove(interaction, add) {
    const found = await ticketOf(interaction);
    if (!found) return;
    const {g, ticket} = found;
    if (!isStaff(interaction.member, g)) return interaction.reply(whisper(t('yetkiYok')));
    const user = interaction.options.getUser('kullanici', true);
    if (!add && user.id === ticket.sahip) return interaction.reply(whisper('Talebi açan kişi çıkarılamaz; kapatmak için `/destek kapat`.'));
    try {
      if (add) await interaction.channel.permissionOverwrites.edit(user.id, Object.fromEntries(TICKET_ALLOW.map((p) => [permName(p), true])));
      else await interaction.channel.permissionOverwrites.delete(user.id);
    } catch (error) {
      console.warn(`Destek kanalı izni değiştirilemedi: ${error.message}`);
      return interaction.reply(whisper('İzin değiştirilemedi. Botun "Kanalları Yönet" / "İzinleri Yönet" izni olmalı.'));
    }
    ticket.eklenenler = add ? [...new Set([...(ticket.eklenenler ?? []), user.id])] : (ticket.eklenenler ?? []).filter((id) => id !== user.id);
    save();
    await interaction.reply({content: t(add ? 'eklendi' : 'cikarildi', {kullanici: `<@${user.id}>`}), allowedMentions: {users: add ? [user.id] : []}});
  }

  // ---------- Kapatma ----------

  async function askClose(interaction) {
    const found = await ticketOf(interaction);
    if (!found) return;
    const {g, ticket} = found;
    if (interaction.user.id !== ticket.sahip && !isStaff(interaction.member, g)) return interaction.reply(whisper(t('kapatmaYetkiYok')));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('destek:kapat-onay').setStyle(ButtonStyle.Danger).setLabel(t('butonOnay')),
      new ButtonBuilder().setCustomId('destek:kapat-vazgec').setStyle(ButtonStyle.Secondary).setLabel(t('butonVazgec')),
    );
    await interaction.reply({content: t('kapatSor'), components: [row], flags: MessageFlags.Ephemeral});
  }

  /** Kanaldaki bütün mesajları eskiden yeniye çeker. */
  async function fetchAll(channel) {
    const all = [];
    let before;
    while (all.length < TRANSCRIPT_MAX_MESSAGES) {
      const batch = await channel.messages.fetch({limit: 100, before, cache: false}).catch(() => null);
      if (!batch?.size) break;
      all.push(...batch.values());
      before = batch.last().id;
      if (batch.size < 100) break;
    }
    return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  }

  function transcript({guild, channel, ticket, owner, closer, reason, messages}) {
    const out = [
      `Barbeque Destek · Talep #${pad(ticket.no)}`,
      `Sunucu      : ${guild.name} (${guild.id})`,
      `Kanal       : #${channel.name} (${channel.id})`,
      `Açan        : ${owner ? `${owner.username} (${owner.id})` : ticket.sahip}`,
      `Açılış      : ${date(ticket.acildi)}`,
      `Üstlenen    : ${ticket.ustlenenAd ? `${ticket.ustlenenAd} (${ticket.ustlenen})` : (ticket.ustlenen ?? '-')}`,
      `Kapatan     : ${closer.username} (${closer.id})`,
      `Kapanış     : ${date(Date.now())}`,
      `Sebep       : ${reason || '-'}`,
      `Mesaj sayısı: ${messages.length}`,
      '='.repeat(60),
      '',
    ];
    for (const m of messages) {
      out.push(`[${date(m.createdTimestamp)}] ${m.author?.username ?? '?'}${m.author?.bot ? ' [BOT]' : ''} (${m.author?.id ?? '?'})${m.editedTimestamp ? ' (düzenlendi)' : ''}`);
      if (m.content) out.push(...m.content.split('\n').map((line) => `    ${line}`));
      for (const e of m.embeds ?? []) {
        const parts = [e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`)].filter(Boolean);
        if (parts.length) out.push(`    [Embed] ${parts.join(' | ').replace(/\n/g, ' ')}`);
      }
      for (const a of m.attachments?.values?.() ?? []) out.push(`    [Dosya] ${a.name} ${a.url}`);
      out.push('');
    }
    // Başta BOM: Windows Not Defteri Türkçe karakterleri doğru göstersin.
    return Buffer.from(`﻿${out.join('\r\n')}`, 'utf8');
  }

  async function close(interaction, reason = '') {
    const g = guildData(interaction.guildId);
    const ticket = g.ticketlar[interaction.channelId];
    if (!ticket) return interaction.reply(whisper(t('ticketDegil')));
    if (interaction.user.id !== ticket.sahip && !isStaff(interaction.member, g)) return interaction.reply(whisper(t('kapatmaYetkiYok')));
    if (closing.has(interaction.channelId)) return interaction.reply(whisper('Talep zaten kapatılıyor.'));
    closing.add(interaction.channelId);
    try {
      const sebep = reason ? ` (sebep: ${reason})` : '';
      const closingText = t('kapaniyor', {yetkili: `<@${interaction.user.id}>`, sebep, saniye: DELETE_AFTER_S});
      if (interaction.isButton?.()) await interaction.update({content: closingText, components: []});
      else await interaction.reply({content: closingText, allowedMentions: {parse: []}});
      if (interaction.isButton?.()) await interaction.channel.send({content: closingText, allowedMentions: {parse: []}}).catch(() => {});

      const {guild, channel, client} = interaction;
      const owner = await client.users.fetch(ticket.sahip).catch(() => null);
      const messages = await fetchAll(channel);
      const file = {attachment: transcript({guild, channel, ticket, owner, closer: interaction.user, reason, messages}), name: `destek-${pad(ticket.no)}.txt`};

      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(t('logBaslik', {no: pad(ticket.no)}))
        .addFields(
          {name: 'Açan', value: `<@${ticket.sahip}> (${ticket.sahip})`, inline: true},
          {name: 'Kapatan', value: `<@${interaction.user.id}>`, inline: true},
          {name: 'Üstlenen', value: ticket.ustlenen ? `<@${ticket.ustlenen}>` : '-', inline: true},
          {name: 'Açık kaldığı süre', value: duration(Date.now() - ticket.acildi), inline: true},
          {name: 'Mesaj', value: String(messages.length), inline: true},
          {name: 'Sebep', value: reason || '-', inline: false},
        )
        .setTimestamp();

      const sends = [];
      if (g.log) {
        const logChannel = guild.channels.cache.get(g.log) ?? (await guild.channels.fetch(g.log).catch(() => null));
        if (logChannel?.send) sends.push(logChannel.send({embeds: [embed], files: [file], allowedMentions: {parse: []}}).catch((error) => console.warn(`Destek logu gönderilemedi: ${error.message}`)));
      }
      if (owner) {
        sends.push(
          owner.send({content: t('ozelKapandi', {sunucu: guild.name, no: pad(ticket.no), sebep}), files: [file], allowedMentions: {parse: []}}).catch(() => {
            // Özel mesajı kapalı: sessizce geçilir.
          }),
        );
      }
      await Promise.all(sends);

      delete g.ticketlar[channel.id];
      save();
      console.log(`Destek talebi kapatıldı: #${pad(ticket.no)} (${interaction.user.username}, ${messages.length} mesaj)`);
      setTimeout(() => channel.delete(`Destek talebi #${pad(ticket.no)} kapatıldı`).catch((error) => console.warn(`Destek kanalı silinemedi: ${error.message}`)), DELETE_AFTER_S * 1000).unref?.();
    } finally {
      closing.delete(interaction.channelId);
    }
  }

  return {
    async handle(interaction) {
      if (!interaction.guild) return;
      const isCommand = interaction.isChatInputCommand?.() && ['destek', 'destek-kur'].includes(interaction.commandName);
      const isButton = interaction.isButton?.() && interaction.customId?.startsWith('destek:');
      if (!isCommand && !isButton) return;
      if (seen.has(interaction.id)) return;
      seen.add(interaction.id);
      if (seen.size > 2_000) seen.delete(seen.values().next().value);
      try {
        if (isButton) {
          const id = interaction.customId;
          if (id === 'destek:ac') await open(interaction);
          else if (id === 'destek:ustlen') await claim(interaction);
          else if (id === 'destek:kapat') await askClose(interaction);
          else if (id === 'destek:kapat-onay') await close(interaction);
          else if (id === 'destek:kapat-vazgec') await interaction.update({content: t('vazgecildi'), components: []});
          return;
        }
        if (interaction.commandName === 'destek-kur') {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply(whisper('Bunun için "Sunucuyu Yönet" izni gerekir.'));
          return await setup(interaction);
        }
        const sub = interaction.options.getSubcommand();
        if (sub === 'kapat') await close(interaction, interaction.options.getString('sebep')?.trim() ?? '');
        else if (sub === 'ekle') await addOrRemove(interaction, true);
        else if (sub === 'cikar') await addOrRemove(interaction, false);
        else if (sub === 'ustlen') await claim(interaction);
        else if (sub === 'yasakla') await banUser(interaction);
        else if (sub === 'yasak-kaldir') await unbanUser(interaction);
        else if (sub === 'yasaklilar') await listBans(interaction);
      } catch (error) {
        console.error(`Destek etkileşimi çalışmadı (${interaction.customId ?? interaction.commandName}):`, error);
        const reply = {content: 'Bir şeyler ters gitti. Birazdan tekrar dene.', allowedMentions: {parse: []}};
        if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
        else await interaction.reply({...reply, flags: MessageFlags.Ephemeral}).catch(() => {});
      }
    },

    /** Ticket kanalı elle silinirse kaydı da silinir (kişi yeni talep açabilsin). */
    onChannelDelete(channel) {
      const g = data[channel.guildId];
      if (g?.ticketlar?.[channel.id]) {
        delete g.ticketlar[channel.id];
        save();
      }
    },
  };
}

/** PermissionFlagsBits değerinden izin adı (permissionOverwrites.edit isimle ister). */
function permName(bit) {
  return Object.keys(PermissionFlagsBits).find((key) => PermissionFlagsBits[key] === bit);
}
