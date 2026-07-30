const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
require('dotenv').config();

// CONSTANTES DES RÔLES
const VERIFIED_ROLE_ID = '1532346852203040768';
const BOOSTER_ROLE_ID = '1532347027441057812';

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL || process.env.CALLBACK_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BASE_URL.replace(/\/$/, '')}/callback`;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildPresences
    ]
});

// --- GESTION DE LA CONFIGURATION PERSISTANTE (config.json) ---
const configPath = path.join(__dirname, 'config.json');

function getConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({}));
    }
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return {};
    }
}

function setGuildConfig(guildId, key, value) {
    const config = getConfig();
    if (!config[guildId]) config[guildId] = {};
    config[guildId][key] = value;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getGuildConfig(guildId, key) {
    const config = getConfig();
    return config[guildId] ? config[guildId][key] : null;
}

// --- GESTION DU STOCK DE COMPTES (stocks.json) ---
const stockPath = path.join(__dirname, 'stocks.json');

function getStocks() {
    if (!fs.existsSync(stockPath)) {
        const initial = {};
        services.forEach(s => initial[s.id] = []);
        fs.writeFileSync(stockPath, JSON.stringify(initial, null, 2));
    }
    try {
        return JSON.parse(fs.readFileSync(stockPath, 'utf8'));
    } catch {
        return {};
    }
}

function getServiceStock(serviceId) {
    const stocks = getStocks();
    return stocks[serviceId] || [];
}

function addServiceStock(serviceId, combos) {
    const stocks = getStocks();
    if (!stocks[serviceId]) stocks[serviceId] = [];
    stocks[serviceId].push(...combos);
    fs.writeFileSync(stockPath, JSON.stringify(stocks, null, 2));
}

function popServiceStock(serviceId) {
    const stocks = getStocks();
    if (!stocks[serviceId] || stocks[serviceId].length === 0) {
        return null;
    }
    const account = stocks[serviceId].shift();
    fs.writeFileSync(stockPath, JSON.stringify(stocks, null, 2));
    return account;
}

// Fonction d'envoi des logs du bot
async function sendLog(guild, embed) {
    if (!guild) return;
    const logChannelId = getGuildConfig(guild.id, 'logsChannelId');
    if (!logChannelId) return;
    try {
        const channel = await guild.channels.fetch(logChannelId);
        if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [embed] });
        }
    } catch (err) {}
}

// --- CATALOGUE DES SERVICES AVEC LOGOS OFFICIELS PNG HD ---
const services = [
    { id: 'paramount', label: 'Paramount+', emojiName: 'ng_paramount', defaultEmoji: '🎬', iconUrl: 'https://img.icons8.com/color/512/paramount-plus.png', style: ButtonStyle.Secondary },
    { id: 'disney', label: 'Disney+', emojiName: 'ng_disney', defaultEmoji: '🏰', iconUrl: 'https://img.icons8.com/color/512/disney-plus.png', style: ButtonStyle.Secondary },
    { id: 'adn', label: 'ADN', emojiName: 'ng_adn', defaultEmoji: '🍥', iconUrl: 'https://i.imgur.com/8Q9Z5bX.png', style: ButtonStyle.Secondary },
    { id: 'crunchyroll', label: 'Crunchyroll', emojiName: 'ng_crunchyroll', defaultEmoji: '🍿', iconUrl: 'https://img.icons8.com/color/512/crunchyroll.png', style: ButtonStyle.Secondary },
    { id: 'fortnite', label: 'Fortnite', emojiName: 'ng_fortnite', defaultEmoji: '🎮', iconUrl: 'https://img.icons8.com/color/512/fortnite.png', style: ButtonStyle.Secondary },
    { id: 'valorant', label: 'Valorant', emojiName: 'ng_valorant', defaultEmoji: '🎯', iconUrl: 'https://img.icons8.com/color/512/valorant.png', style: ButtonStyle.Secondary },
    { id: 'xbox', label: 'Xbox', emojiName: 'ng_xbox', defaultEmoji: '🟢', iconUrl: 'https://img.icons8.com/color/512/xbox.png', style: ButtonStyle.Secondary },
    { id: 'nordvpn', label: 'NordVPN', emojiName: 'ng_nordvpn', defaultEmoji: '🛡️', iconUrl: 'https://img.icons8.com/color/512/nordvpn.png', style: ButtonStyle.Secondary },
    { id: 'hotmail', label: 'Hotmail', emojiName: 'ng_hotmail', defaultEmoji: '✉️', iconUrl: 'https://img.icons8.com/color/512/microsoft-outlook-2019.png', style: ButtonStyle.Secondary },
    { id: 'expressvpn', label: 'ExpressVPN', emojiName: 'ng_expressvpn', defaultEmoji: '🚀', iconUrl: 'https://img.icons8.com/color/512/expressvpn.png', style: ButtonStyle.Secondary },
    { id: 'mullvadvpn', label: 'MullvadVPN', emojiName: 'ng_mullvadvpn', defaultEmoji: '🔒', iconUrl: 'https://img.icons8.com/color/512/mullvad-vpn.png', style: ButtonStyle.Secondary }
];

async function getOrFetchEmoji(guild, service) {
    if (!guild) return service.defaultEmoji;

    const existingEmoji = guild.emojis.cache.find(e => e.name === service.emojiName);
    if (existingEmoji) return existingEmoji;

    try {
        if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
            const newEmoji = await guild.emojis.create({
                attachment: service.iconUrl,
                name: service.emojiName
            });
            return newEmoji;
        }
    } catch (e) {}

    return service.defaultEmoji;
}

// Construction des ActionRows avec Stock en Temps Réel ex: Valorant (12)
async function buildServiceRows(guild) {
    const rows = [];
    let currentRow = new ActionRowBuilder();

    for (let i = 0; i < services.length; i++) {
        const service = services[i];
        const emoji = await getOrFetchEmoji(guild, service);
        const count = getServiceStock(service.id).length;

        const button = new ButtonBuilder()
            .setCustomId(`gen_${service.id}`)
            .setLabel(`${service.label} (${count})`)
            .setStyle(count > 0 ? ButtonStyle.Primary : ButtonStyle.Secondary);

        if (typeof emoji === 'string') {
            button.setEmoji(emoji);
        } else {
            button.setEmoji(emoji.id);
        }

        currentRow.addComponents(button);

        if ((i + 1) % 5 === 0 || i === services.length - 1) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    }

    return rows;
}

// --- PERMISSIONS DU SERVEUR ---
const channelPermissionConfigs = {
    '✅・invites': { readOnly: true },
    '🌠・boost': { readOnly: true },
    '📢・annonce': { readOnly: true },
    '🎁・giveaway': { readOnly: true, allowReactions: true },
    '💧・drop': { readOnly: true },
    '📦・restock': { readOnly: true },
    '✅・proof': { readOnly: false, proofRules: true },
    '💬・general': { readOnly: false },
    '📩・ticket': { readOnly: false },
    '❓・req': { readOnly: false },
    '⭐・gen-free': { readOnly: false, allowCommands: true },
    '🚀・gen-premium': { premiumOnly: true }
};

function getPermissionOverwrites(guild, channelName) {
    const everyoneRole = guild.roles.everyone;
    const verifiedRole = guild.roles.cache.get(VERIFIED_ROLE_ID);
    const premiumRole = guild.roles.cache.find(r => 
        r.name.toLowerCase().includes('premium') || r.name.toLowerCase().includes('vip')
    );

    const config = channelPermissionConfigs[channelName] || { readOnly: false };
    const overwrites = [];

    if (channelName.includes('verify')) {
        overwrites.push({
            id: everyoneRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
        });
        return overwrites;
    }

    overwrites.push({
        id: everyoneRole.id,
        deny: [PermissionFlagsBits.ViewChannel]
    });

    const targetRoleId = verifiedRole ? verifiedRole.id : everyoneRole.id;

    if (config.readOnly) {
        const denies = [PermissionFlagsBits.SendMessages];
        const allows = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
        if (config.allowReactions) allows.push(PermissionFlagsBits.AddReactions);

        overwrites.push({ id: targetRoleId, allow: allows, deny: denies });
    } else if (config.premiumOnly) {
        overwrites.push({
            id: targetRoleId,
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.UseApplicationCommands],
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
        });

        if (premiumRole) {
            overwrites.push({
                id: premiumRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.UseApplicationCommands
                ]
            });
        }
    } else {
        overwrites.push({
            id: targetRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.UseApplicationCommands
            ]
        });
    }

    return overwrites;
}

// Fonction pour envoyer et épingler les consignes dans ✅・proof
async function sendProofRuleBanner(channel) {
    try {
        const bannerEmbed = new EmbedBuilder()
            .setTitle('📸 Salon Preuves (Proofs)')
            .setDescription([
                'Merci d\'envoyer vos captures d\'écran de preuves ici !',
                '',
                '📌 **Consigne :** Seules les captures d\'écran sont autorisées dans ce salon.',
                '❌ **Pas de bavardage :** Pour discuter, utilisez le salon <#general>. Tout message sans image sera supprimé.'
            ].join('\n'))
            .setColor('#57F287')
            .setTimestamp();

        const pinnedMsg = await channel.send({ embeds: [bannerEmbed] });
        await pinnedMsg.pin().catch(() => {});
        return pinnedMsg;
    } catch (e) {
        return null;
    }
}

// --- DASHBOARD DE CONFIGURATION DRAFTBOT ---
function buildSettingsDashboard(guild) {
    const logCh = getGuildConfig(guild.id, 'logsChannelId');
    const cooldown = getGuildConfig(guild.id, 'cooldown') ?? 60;
    const reqRole = getGuildConfig(guild.id, 'requiredRoleId');
    const dailyLimit = getGuildConfig(guild.id, 'dailyLimit') ?? 0;

    const embed = new EmbedBuilder()
        .setTitle('⚙️ NextGen • Panneau de Configuration')
        .setDescription([
            'Bienvenue dans le panneau de configuration de votre serveur **NextGen**.',
            '',
            '### 📊 **État Actuel de la Configuration :**',
            `> 📁 **Salon de Logs :** ${logCh ? `<#${logCh}>` : '`Non configuré`'}`,
            `> ⏱️ **Cooldown Générateur :** **${cooldown}s**`,
            `> 🔑 **Rôle Générateur Requis :** ${reqRole ? `<@&${reqRole}>` : '`Aucun (Tous les membres vérifiés)`'}`,
            `> 📊 **Limite Journalière :** ${dailyLimit > 0 ? `**${dailyLimit}** / jour` : '`Illimitée`'}`,
            `> 🛡️ **Rôle Vérifié :** <@&${VERIFIED_ROLE_ID}>`,
            `> 🚀 **Rôle Server Booster :** <@&${BOOSTER_ROLE_ID}>`,
            '',
            '*Utilisez le menu déroulant et les boutons ci-dessous pour modifier les paramètres en direct !*'
        ].join('\n'))
        .setColor('#5865F2')
        .setThumbnail(guild.iconURL() || client.user.displayAvatarURL())
        .setFooter({ text: 'NextGen Dashboard System', iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('settings_select_category')
        .setPlaceholder('⚙️ Choisir une catégorie à configurer...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Générateur & Limites')
                .setDescription('Modifier le cooldown, le rôle requis et la limite daily')
                .setValue('settings_cat_gen')
                .setEmoji('⚡'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Logs & Modération')
                .setDescription('Définir le salon de logs principal du serveur')
                .setValue('settings_cat_logs')
                .setEmoji('📡'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Vérification & Sécurité')
                .setDescription('Consulter la configuration anti-unverified')
                .setValue('settings_cat_verify')
                .setEmoji('🛡️')
        );

    const row1 = new ActionRowBuilder().addComponents(selectMenu);

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('settings_btn_cooldown')
            .setLabel('⏱️ Modifier Cooldown')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('settings_btn_daily')
            .setLabel('📊 Modifier Limite Daily')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('settings_btn_reset')
            .setLabel('🔄 Réinitialiser Config')
            .setStyle(ButtonStyle.Danger)
    );

    return { embeds: [embed], components: [row1, row2] };
}

// --- SERVEUR CALLBACK OAUTH2 COMPATIBLE RENDER ---
const server = http.createServer(async (req, res) => {
    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname === '/callback') {
        const code = reqUrl.query.code;
        if (code) {
            try {
                const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: process.env.CLIENT_ID,
                        client_secret: process.env.CLIENT_SECRET,
                        grant_type: 'authorization_code',
                        code: code,
                        redirect_uri: REDIRECT_URI
                    })
                });
                const tokenData = await tokenRes.json();

                if (tokenData.access_token) {
                    const userRes = await fetch('https://discord.com/api/v10/users/@me', {
                        headers: { Authorization: `Bearer ${tokenData.access_token}` }
                    });
                    const userData = await userRes.json();

                    client.guilds.cache.forEach(async (guild) => {
                        try {
                            const member = await guild.members.fetch(userData.id).catch(() => null);
                            if (member) {
                                await member.roles.add(VERIFIED_ROLE_ID).catch(() => {});

                                const logEmbed = new EmbedBuilder()
                                    .setTitle('🛡️ Membre Vérifié')
                                    .setDescription(`👤 **Membre :** <@${userData.id}> (\`${userData.username}\`)\n✅ **Rôle attribué :** <@&${VERIFIED_ROLE_ID}>`)
                                    .setColor('#57F287')
                                    .setTimestamp();
                                await sendLog(guild, logEmbed);
                            }
                        } catch (e) {}
                    });

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    return res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>Vérification Réussie</title>
                            <style>
                                body { background: #2B2D31; color: white; font-family: 'gg sans', Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                                .card { background: #1E1F22; padding: 40px; border-radius: 12px; text-align: center; max-width: 380px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
                                h1 { color: #57F287; margin-bottom: 12px; font-size: 22px; }
                                p { color: #DBDEE1; font-size: 14px; line-height: 1.5; }
                            </style>
                        </head>
                        <body>
                            <div class="card">
                                <h1>✅ Vérification réussie !</h1>
                                <p>Votre compte a bien été vérifié. Vous pouvez retourner sur Discord, tous vos accès sont débloqués.</p>
                            </div>
                        </body>
                        </html>
                    `);
                }
            } catch (err) {
                console.error('Erreur Callback OAuth :', err);
            }
        }
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Erreur Callback OAuth.');
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Serveur OAuth Callback actif sur ${REDIRECT_URI}`);
});

// --- TRACKER D'INVITATIONS ---
const invitesCache = new Map();
const userInviteStats = new Map();

async function cacheGuildInvites(guild) {
    try {
        if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
            const guildInvites = await guild.invites.fetch();
            const inviteMap = new Map();
            guildInvites.forEach(inv => inviteMap.set(inv.code, inv.uses));
            invitesCache.set(guild.id, inviteMap);
        }
    } catch (e) {}
}

const userCooldowns = new Map();
const userDailyGens = new Map();

// --- ENREGISTREMENT DES COMMANDES SLASH ---
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('panel')
            .setDescription('Affiche le panel de génération NextGen'),
        new SlashCommandBuilder()
            .setName('settings')
            .setDescription('Ouvre le panneau de configuration interactif (style DraftBot)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('setup-channel')
            .setDescription('Crée l\'arborescence des salons du serveur')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('setup-channel-perm')
            .setDescription('Ajuste les permissions sur tous les salons du serveur')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('ticket-panel')
            .setDescription('Déploie le panel de création de tickets'),
        new SlashCommandBuilder()
            .setName('proof-rules')
            .setDescription('Déploie et épingle les consignes du salon proof')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('faq-panel')
            .setDescription('Déploie le panneau de la Foire Aux Questions (FAQ)')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('verify')
            .setDescription('Déploie le message de vérification du serveur'),
        new SlashCommandBuilder()
            .setName('logs')
            .setDescription('Définit le salon de logs pour le bot')
            .addChannelOption(option =>
                option.setName('salon')
                    .setDescription('Salon textuel de logs')
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('settings-gen')
            .setDescription('Configuration rapide du générateur (cooldown, rôle, limite)')
            .addIntegerOption(option =>
                option.setName('cooldown')
                    .setDescription('Temps d\'attente entre 2 générations (en secondes)')
                    .setRequired(false)
            )
            .addRoleOption(option =>
                option.setName('role_requis')
                    .setDescription('Rôle requis pour utiliser le générateur')
                    .setRequired(false)
            )
            .addIntegerOption(option =>
                option.setName('limite_journaliere')
                    .setDescription('Nombre max de générations par jour (0 = illimité)')
                    .setRequired(false)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('restock')
            .setDescription('Ajoute du stock pour un service')
            .addStringOption(option =>
                option.setName('service')
                    .setDescription('Le service à restocker')
                    .setRequired(true)
                    .addChoices(...services.map(s => ({ name: s.label, value: s.label })))
            )
            .addAttachmentOption(option =>
                option.setName('fichier')
                    .setDescription('Fichier texte (.txt) contenant les combos')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('giveaway')
            .setDescription('Lance un giveaway sur le serveur')
            .addStringOption(option =>
                option.setName('prix')
                    .setDescription('Le lot à gagner')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('duree')
                    .setDescription('Durée (ex: 10m, 1h, 24h)')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName('gagnants')
                    .setDescription('Nombre de gagnants (1 par défaut)')
                    .setRequired(false)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('drops')
            .setDescription('Droppe des comptes/combos dans le salon drop')
            .addStringOption(option =>
                option.setName('service')
                    .setDescription('Nom du service')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('combos')
                    .setDescription('Les identifiants/combos à dropper')
                    .setRequired(true)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔄 Enregistrement des commandes Slash...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Commandes Slash enregistrées avec succès !');
    } catch (error) {
        console.error('❌ Erreur d\'enregistrement des commandes :', error);
    }
}

client.once('clientReady', async () => {
    console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);
    await registerCommands();
    client.guilds.cache.forEach(guild => cacheGuildInvites(guild));
});

// Événement d'arrivée de membres
client.on('guildMemberAdd', async (member) => {
    const { guild } = member;

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = Math.floor(accountAgeMs / (1000 * 60 * 60 * 24));
    const isFake = accountAgeDays < 7;

    let usedInvite = null;
    const oldInvites = invitesCache.get(guild.id);

    try {
        if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
            const newInvites = await guild.invites.fetch();
            for (const [code, inv] of newInvites) {
                const oldUses = oldInvites?.get(code) || 0;
                if (inv.uses > oldUses) {
                    usedInvite = inv;
                    break;
                }
            }
            const inviteMap = new Map();
            newInvites.forEach(inv => inviteMap.set(inv.code, inv.uses));
            invitesCache.set(guild.id, inviteMap);
        }
    } catch (e) {}

    let inviterText = 'Lien direct / Inconnu';
    let inviterStatsText = '';

    if (usedInvite && usedInvite.inviter) {
        const inviter = usedInvite.inviter;
        const statKey = `${guild.id}_${inviter.id}`;
        const currentStats = userInviteStats.get(statKey) || { total: 0, fake: 0 };
        currentStats.total += 1;
        if (isFake) currentStats.fake += 1;
        userInviteStats.set(statKey, currentStats);

        inviterText = `<@${inviter.id}> (\`${inviter.tag}\`)`;
        inviterStatsText = `📊 **Invitations :** ${currentStats.total} total (${currentStats.fake} fakes)`;
    }

    const invitesChannel = guild.channels.cache.find(c => c.name.includes('invite'));
    if (invitesChannel && invitesChannel.isTextBased()) {
        const inviteEmbed = new EmbedBuilder()
            .setTitle('📥 Arrivée d\'un membre')
            .setDescription([
                `👤 **Membre :** <@${member.id}> (\`${member.user.tag}\`)`,
                `👤 **Invité par :** ${inviterText}`,
                inviterStatsText,
                `🕒 **Âge du compte :** ${accountAgeDays} jour(s) ${isFake ? '⚠️ *(Compte Récent / Fake)*' : '✅'}`
            ].filter(Boolean).join('\n'))
            .setColor(isFake ? '#ED4245' : '#57F287')
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp();

        await invitesChannel.send({ embeds: [inviteEmbed] }).catch(() => {});
    }

    const logEmbed = new EmbedBuilder()
        .setTitle('📥 Arrivée Membre')
        .setDescription(`👤 **Membre :** <@${member.id}>\n👤 **Invité par :** ${inviterText}\n${inviterStatsText}`)
        .setColor('#5865F2')
        .setTimestamp();
    await sendLog(guild, logEmbed);
});

// Événement de Boost du serveur
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!oldMember.premiumSince && newMember.premiumSince) {
        try {
            await newMember.roles.add(BOOSTER_ROLE_ID).catch(() => {});

            const boostChannel = newMember.guild.channels.cache.find(c => c.name.includes('boost'));
            if (boostChannel && boostChannel.isTextBased()) {
                const boostEmbed = new EmbedBuilder()
                    .setTitle('🚀 Un grand merci pour le boost !')
                    .setDescription([
                        `Merci à <@${newMember.id}> pour son boost sur le serveur !`,
                        '',
                        `🎉 Le rôle <@&${BOOSTER_ROLE_ID}> t'a été automatiquement attribué !`
                    ].join('\n'))
                    .setColor('#EB459E')
                    .setThumbnail(newMember.user.displayAvatarURL())
                    .setTimestamp();

                await boostChannel.send({ content: `<@${newMember.id}>`, embeds: [boostEmbed] }).catch(() => {});
            }

            const logEmbed = new EmbedBuilder()
                .setTitle('🚀 Nouveau Boost')
                .setDescription(`👤 **Booster :** <@${newMember.id}>\n✅ Rôle attribué : <@&${BOOSTER_ROLE_ID}>`)
                .setColor('#EB459E')
                .setTimestamp();
            await sendLog(newMember.guild, logEmbed);

        } catch (err) {}
    }
});

// Modération salon proof
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.channel.name.includes('proof')) {
        const hasAttachment = message.attachments.size > 0;
        const hasImageLink = /(https?:\/\/[^\s]+(?:\.png|\.jpg|\.jpeg|\.gif|\.webp))/i.test(message.content);

        if (!hasAttachment && !hasImageLink) {
            try {
                if (message.guild.members.me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) {
                    await message.delete().catch(() => {});
                }
            } catch (e) {}

            const warningMsg = await message.channel.send({
                content: `⚠️ <@${message.author.id}>, ce salon est uniquement réservé aux captures d'écran (proofs). Merci de ne pas y meubler de texte.`
            }).catch(() => {});

            setTimeout(() => {
                warningMsg?.delete().catch(() => {});
            }, 8000);
        }
    }
});

const activeGiveaways = new Map();

function parseDuration(str) {
    const match = str.match(/^(\d+)\s*([smhd])$/i);
    if (!match) return null;
    const num = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 's') return num * 1000;
    if (unit === 'm') return num * 60 * 1000;
    if (unit === 'h') return num * 60 * 60 * 1000;
    if (unit === 'd') return num * 24 * 60 * 60 * 1000;
    return null;
}

// --- GESTIONNAIRE D'INTERACTIONS ---
client.on('interactionCreate', async (interaction) => {
    if (interaction.isModalSubmit()) {
        const { customId, guild } = interaction;

        if (customId === 'modal_settings_cooldown') {
            const inputVal = interaction.fields.getTextInputValue('cooldown_input');
            const num = parseInt(inputVal);

            if (isNaN(num) || num < 0) {
                return interaction.reply({
                    content: '❌ Veuillez saisir un nombre valide de secondes.',
                    flags: MessageFlags.Ephemeral
                });
            }

            setGuildConfig(guild.id, 'cooldown', num);
            await interaction.reply({
                content: `✅ Cooldown mis à jour à **${num} seconde(s)** !`,
                flags: MessageFlags.Ephemeral
            });
        } 
        else if (customId === 'modal_settings_daily') {
            const inputVal = interaction.fields.getTextInputValue('daily_input');
            const num = parseInt(inputVal);

            if (isNaN(num) || num < 0) {
                return interaction.reply({
                    content: '❌ Veuillez saisir un nombre valide.',
                    flags: MessageFlags.Ephemeral
                });
            }

            setGuildConfig(guild.id, 'dailyLimit', num);
            await interaction.reply({
                content: `✅ Limite journalière mise à jour à **${num > 0 ? num : 'Illimitée'}** !`,
                flags: MessageFlags.Ephemeral
            });
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        // --- COMMANDE /settings ---
        if (commandName === 'settings') {
            const dashboard = buildSettingsDashboard(interaction.guild);
            await interaction.reply({
                ...dashboard,
                flags: MessageFlags.Ephemeral
            });
        }

        // --- COMMANDE /proof-rules ---
        else if (commandName === 'proof-rules') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const guild = interaction.guild;
            let proofChannel = guild.channels.cache.find(c => c.name.includes('proof'));
            if (!proofChannel) proofChannel = interaction.channel;

            const pinnedMsg = await sendProofRuleBanner(proofChannel);

            if (pinnedMsg) {
                await interaction.editReply({
                    content: `✅ Les consignes du salon proof ont été déployées et épinglées dans <#${proofChannel.id}>.`
                });
            } else {
                await interaction.editReply({
                    content: '❌ Impossible de déployer ou d\'épingler les consignes.'
                });
            }
        }

        // --- COMMANDE /faq-panel ---
        else if (commandName === 'faq-panel') {
            await interaction.deferReply();

            const guild = interaction.guild;
            let faqChannel = guild.channels.cache.find(c => c.name.includes('faq') || c.name.includes('req'));
            if (!faqChannel) faqChannel = interaction.channel;

            const faqEmbed = new EmbedBuilder()
                .setTitle('❓ NextGen • Foire Aux Questions (FAQ)')
                .setDescription([
                    'Bienvenue dans la FAQ du serveur **NextGen** ! Retrouvez ci-dessous les réponses aux questions les plus fréquentes :',
                    '',
                    '### ⚡ **Comment générer un compte ?**',
                    'Rendez-vous dans le salon du générateur `/panel`, puis cliquez sur le bouton du service de votre choix. Vos identifiants vous seront immédiatement envoyés en **Message Privé (DM)**.',
                    '',
                    '### 🛡️ **Comment débloquer les salons du serveur ?**',
                    'Vous devez effectuer la vérification dans le salon <#verify>. Une fois vérifié, tous les salons se débloqueront automatiquement.',
                    '',
                    '### 📦 **Quand ont lieu les restocks de comptes ?**',
                    'Les restocks sont annoncés en temps réel dans le salon <#restock>. Soyez attentifs aux notifications !',
                    '',
                    '### ⏱️ **Pourquoi le bot me demande de patienter ?**',
                    'Un temps d\'attente (cooldown) est configuré entre deux générations pour garantir un accès équitable à tous les membres.',
                    '',
                    '### 📩 **Comment contacter l\'équipe de modération ?**',
                    'Ouvrez un ticket privé en vous rendant dans le salon <#ticket>.'
                ].join('\n'))
                .setColor('#5865F2')
                .setThumbnail(guild.iconURL() || client.user.displayAvatarURL())
                .setFooter({ text: 'NextGen FAQ System', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            await faqChannel.send({ embeds: [faqEmbed] });

            await interaction.editReply({
                content: `✅ Le panneau FAQ a été publié dans <#${faqChannel.id}>.`
            });
        }

        // --- COMMANDE /panel ---
        else if (commandName === 'panel') {
            await interaction.deferReply();

            const serviceLines = [];
            for (const service of services) {
                const emoji = await getOrFetchEmoji(interaction.guild, service);
                const emojiStr = (typeof emoji === 'string') ? emoji : `<:${emoji.name}:${emoji.id}>`;
                const count = getServiceStock(service.id).length;
                serviceLines.push(`${emojiStr} **${service.label}** — \`${count} en stock\``);
            }

            const newBannerUrl = 'https://i.goopics.net/mkvcwm.gif';
            const localGifPath = 'D:/Download Twp/ff7adda344439436df0991801fb91272.gif';
            let bannerAttachment = null;
            let imageTarget = newBannerUrl;

            if (fs.existsSync(localGifPath)) {
                bannerAttachment = new AttachmentBuilder(localGifPath, { name: 'banner.gif' });
                imageTarget = 'attachment://banner.gif';
            }

            const panelEmbed = new EmbedBuilder()
                .setTitle('✨ NextGen Generator')
                .setDescription([
                    'Appuyez sur le bouton correspondant au service que vous souhaitez pour générer un compte. Vos identifiants vous seront directement envoyés en Message Privé !',
                    '',
                    '### 🛠️ **Services & Stocks disponibles :**',
                    ...serviceLines,
                    '',
                    '*N\'oubliez pas d\'ouvrir vos MPs pour recevoir le compte !*'
                ].join('\n'))
                .setColor('#2B2D31')
                .setImage(imageTarget)
                .setFooter({ text: 'NextGen • Génération instantanée', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            const components = await buildServiceRows(interaction.guild);
            const replyPayload = { embeds: [panelEmbed], components: components };

            if (bannerAttachment) {
                replyPayload.files = [bannerAttachment];
            }

            await interaction.editReply(replyPayload);
        }

        // --- COMMANDE /settings-gen ---
        else if (commandName === 'settings-gen') {
            const cooldownInput = interaction.options.getInteger('cooldown');
            const roleInput = interaction.options.getRole('role_requis');
            const limitInput = interaction.options.getInteger('limite_journaliere');

            if (cooldownInput !== null) {
                setGuildConfig(interaction.guild.id, 'cooldown', cooldownInput);
            }
            if (roleInput !== null) {
                setGuildConfig(interaction.guild.id, 'requiredRoleId', roleInput.id);
            }
            if (limitInput !== null) {
                setGuildConfig(interaction.guild.id, 'dailyLimit', limitInput);
            }

            const currentCooldown = getGuildConfig(interaction.guild.id, 'cooldown') ?? 60;
            const currentReqRole = getGuildConfig(interaction.guild.id, 'requiredRoleId');
            const currentLimit = getGuildConfig(interaction.guild.id, 'dailyLimit') ?? 0;

            const settingsEmbed = new EmbedBuilder()
                .setTitle('⚙️ Configuration du Générateur NextGen')
                .setDescription([
                    'Voici la configuration actuelle du générateur pour votre serveur :',
                    '',
                    `⏱️ **Cooldown entre 2 générations :** **${currentCooldown} seconde(s)**`,
                    `🔑 **Rôle requis :** ${currentReqRole ? `<@&${currentReqRole}>` : '`Aucun (Ouvert aux membres vérifiés)`'}`,
                    `📊 **Limite journalière :** ${currentLimit > 0 ? `**${currentLimit}** générations par jour` : '`Illimitée`'}`,
                    '',
                    '*Utilisez les paramètres de la commande `/settings-gen` ou le dashboard `/settings` pour modifier ces valeurs.*'
                ].join('\n'))
                .setColor('#5865F2')
                .setTimestamp();

            await interaction.reply({
                embeds: [settingsEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // --- COMMANDE /giveaway ---
        else if (commandName === 'giveaway') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const prize = interaction.options.getString('prix');
            const durationStr = interaction.options.getString('duree');
            const winnerCount = interaction.options.getInteger('gagnants') || 1;

            const durationMs = parseDuration(durationStr);
            if (!durationMs) {
                return interaction.editReply({
                    content: '❌ Durée invalide. Exemple : `10m`, `1h`, `24h`.'
                });
            }

            const guild = interaction.guild;
            let gwChannel = guild.channels.cache.find(c => c.name.includes('giveaway'));
            if (!gwChannel) gwChannel = interaction.channel;

            const endTime = Math.floor((Date.now() + durationMs) / 1000);
            const gwId = `gw_${Date.now()}`;

            const gwEmbed = new EmbedBuilder()
                .setTitle('🎉 Giveaway NextGen')
                .setDescription([
                    `Un nouveau giveaway vient d'être lancé !`,
                    '',
                    `🎁 **Lot :** **${prize}**`,
                    `👤 **Hôte :** <@${interaction.user.id}>`,
                    `🏆 **Gagnants :** **${winnerCount}**`,
                    `⏰ **Fin :** <t:${endTime}:R> (<t:${endTime}:f>)`,
                    '',
                    'Cliquez sur **Rejoindre** ci-dessous pour participer !'
                ].join('\n'))
                .setColor('#FEE75C')
                .setFooter({ text: 'NextGen Giveaway', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(gwId)
                    .setLabel('🎉 Rejoindre (0)')
                    .setStyle(ButtonStyle.Primary)
            );

            const gwMsg = await gwChannel.send({ embeds: [gwEmbed], components: [row] });

            activeGiveaways.set(gwId, {
                prize,
                winnerCount,
                participants: new Set(),
                channelId: gwChannel.id,
                messageId: gwMsg.id,
                endTime
            });

            await interaction.editReply({
                content: `✅ Giveaway publié dans <#${gwChannel.id}>.`
            });

            setTimeout(async () => {
                const gwData = activeGiveaways.get(gwId);
                if (!gwData) return;

                const participantsArray = Array.from(gwData.participants);
                let winnersText = 'Aucun participant.';

                if (participantsArray.length > 0) {
                    const shuffled = participantsArray.sort(() => 0.5 - Math.random());
                    const selectedWinners = shuffled.slice(0, gwData.winnerCount);
                    winnersText = selectedWinners.map(id => `<@${id}>`).join(', ');
                }

                const endEmbed = new EmbedBuilder()
                    .setTitle('🎉 Giveaway Terminé')
                    .setDescription([
                        `Le giveaway est terminé !`,
                        '',
                        `🎁 **Lot :** **${gwData.prize}**`,
                        `🏆 **Gagnant(s) :** ${winnersText}`,
                        `👥 **Participants :** ${participantsArray.length}`
                    ].join('\n'))
                    .setColor('#57F287')
                    .setTimestamp();

                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('gw_ended')
                        .setLabel(`🎉 Terminé (${participantsArray.length})`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );

                try {
                    const msg = await gwChannel.messages.fetch(gwData.messageId);
                    await msg.edit({ embeds: [endEmbed], components: [disabledRow] });
                    if (participantsArray.length > 0) {
                        await gwChannel.send({ content: `🎉 Bravo à ${winnersText} qui remporte **${gwData.prize}** !` });
                    }
                } catch (e) {}

                activeGiveaways.delete(gwId);
            }, durationMs);
        }

        // --- COMMANDE /drops ---
        else if (commandName === 'drops') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const serviceName = interaction.options.getString('service');
            const combosText = interaction.options.getString('combos');

            const guild = interaction.guild;
            let dropChannel = guild.channels.cache.find(c => c.name.includes('drop'));
            if (!dropChannel) dropChannel = interaction.channel;

            const dropEmbed = new EmbedBuilder()
                .setTitle('💧 Drop Express')
                .setDescription([
                    `Nouveau drop disponible !`,
                    '',
                    `🛒 **Service :** **${serviceName}**`,
                    `👤 **Proposé par :** <@${interaction.user.id}>`,
                    '',
                    '```',
                    combosText,
                    '```',
                    '',
                    '*Premier arrivé, premier servi !*'
                ].join('\n'))
                .setColor('#3498DB')
                .setTimestamp();

            await dropChannel.send({ content: '@everyone', embeds: [dropEmbed] });

            await interaction.editReply({
                content: `✅ Drop publié dans <#${dropChannel.id}>.`
            });

            const logEmbed = new EmbedBuilder()
                .setTitle('💧 Drop Effectué')
                .setDescription(`👤 **Auteur :** <@${interaction.user.id}>\n🛒 **Service :** \`${serviceName}\``)
                .setColor('#3498DB')
                .setTimestamp();
            await sendLog(guild, logEmbed);
        }

        // --- COMMANDE /restock ---
        else if (commandName === 'restock') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const serviceName = interaction.options.getString('service');
            const attachment = interaction.options.getAttachment('fichier');

            const serviceObj = services.find(s => s.label.toLowerCase() === serviceName.toLowerCase()) || services.find(s => s.id === serviceName.toLowerCase());
            const serviceId = serviceObj ? serviceObj.id : serviceName.toLowerCase();

            try {
                const response = await fetch(attachment.url);
                const textContent = await response.text();

                const combos = textContent
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(line => line.length > 0);

                const comboCount = combos.length;

                if (comboCount === 0) {
                    return interaction.editReply({
                        content: '⚠️ Le fichier fourni ne contient aucun combo valide.'
                    });
                }

                addServiceStock(serviceId, combos);
                const totalStockCount = getServiceStock(serviceId).length;

                const guild = interaction.guild;
                let restockChannel = guild.channels.cache.find(c => c.name.includes('restock'));
                if (!restockChannel) restockChannel = interaction.channel;

                const restockEmbed = new EmbedBuilder()
                    .setTitle('📦 Restock Effectué')
                    .setDescription([
                        `Un nouveau restock vient d'être effectué !`,
                        '',
                        `🛒 **Service :** **${serviceName}**`,
                        `📊 **Nouveaux comptes importés :** **${comboCount}**`,
                        `📈 **Stock Total Actuel :** **${totalStockCount}** comptes`,
                        `👤 **Restocké par :** <@${interaction.user.id}>`,
                        '',
                        'Rendez-vous sur le `/panel` pour générer votre compte !'
                    ].join('\n'))
                    .setColor('#FEE75C')
                    .setTimestamp();

                await restockChannel.send({ embeds: [restockEmbed] });

                await interaction.editReply({
                    content: `✅ Restock de **${comboCount}** comptes pour **${serviceName}** enregistré ! Stock total : **${totalStockCount}**.`
                });

                const logEmbed = new EmbedBuilder()
                    .setTitle('📦 Restock Exécuté')
                    .setDescription(`👤 **Auteur :** <@${interaction.user.id}>\n🛒 **Service :** \`${serviceName}\`\n📊 **Combos ajoutés :** \`${comboCount}\` (Total: \`${totalStockCount}\`)`)
                    .setColor('#FEE75C')
                    .setTimestamp();
                await sendLog(guild, logEmbed);

            } catch (err) {
                console.error('Erreur restock :', err);
                await interaction.editReply({
                    content: '❌ Erreur lors de la lecture du fichier.'
                });
            }
        }

        // --- COMMANDE /ticket-panel ---
        else if (commandName === 'ticket-panel') {
            await interaction.deferReply();

            const ticketEmbed = new EmbedBuilder()
                .setTitle('📩 Support NextGen')
                .setDescription([
                    'Besoin d\'aide ou une question ?',
                    '',
                    'Cliquez sur le bouton ci-dessous pour ouvrir un ticket privé avec l\'équipe de modération.'
                ].join('\n'))
                .setColor('#5865F2')
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_open')
                    .setLabel('📩 Ouvrir un Ticket')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.editReply({
                embeds: [ticketEmbed],
                components: [row]
            });
        }

        // --- COMMANDE /verify ---
        else if (commandName === 'verify') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const guild = interaction.guild;
            let verifyChannel = guild.channels.cache.find(c => c.name.includes('verify'));

            if (!verifyChannel) {
                verifyChannel = await guild.channels.create({
                    name: '🛡️・verify',
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                            deny: [PermissionFlagsBits.SendMessages]
                        }
                    ]
                });
            }

            const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=guilds.join+identify`;

            const verifyEmbed = new EmbedBuilder()
                .setTitle('🛡️ Vérification du Serveur')
                .setDescription([
                    'Bienvenue sur le serveur ! Pour accéder aux salons et aux générateurs, merci de vous vérifier ci-dessous.',
                    '',
                    '1. Cliquez sur le bouton **Se Vérifier** ci-dessous.',
                    '2. Acceptez l\'autorisation.',
                    '3. Vos salons se débloqueront automatiquement !'
                ].join('\n'))
                .setColor('#57F287')
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('🛡️ Se Vérifier')
                    .setStyle(ButtonStyle.Link)
                    .setURL(oauthUrl)
            );

            await verifyChannel.send({
                embeds: [verifyEmbed],
                components: [row]
            });

            await interaction.editReply({
                content: `✅ Panneau de vérification déployé dans <#${verifyChannel.id}>.`
            });
        }

        // --- COMMANDE /logs ---
        else if (commandName === 'logs') {
            const targetChannel = interaction.options.getChannel('salon');
            setGuildConfig(interaction.guild.id, 'logsChannelId', targetChannel.id);

            const logSetupEmbed = new EmbedBuilder()
                .setTitle('⚙️ Configuration des Logs')
                .setDescription(`Le salon <#${targetChannel.id}> recevra désormais les logs du bot.`)
                .setColor('#5865F2')
                .setTimestamp();

            await interaction.reply({
                embeds: [logSetupEmbed],
                flags: MessageFlags.Ephemeral
            });

            const testLog = new EmbedBuilder()
                .setTitle('📡 Logs Activés')
                .setDescription(`🟢 Salon de logs activé par **${interaction.user.tag}**.`)
                .setColor('#57F287')
                .setTimestamp();

            await sendLog(interaction.guild, testLog);
        }

        // --- COMMANDE /setup-channel ---
        else if (commandName === 'setup-channel') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const guild = interaction.guild;
            const structure = [
                {
                    category: 'main',
                    channels: [
                        '✅・invites',
                        '🌠・boost',
                        '📢・annonce',
                        '🎁・giveaway',
                        '📩・ticket',
                        '💬・general',
                        '💧・drop'
                    ]
                },
                {
                    category: 'GENERATOR',
                    channels: [
                        '❓・req',
                        '⭐・gen-free',
                        '🚀・gen-premium',
                        '📦・restock',
                        '✅・proof'
                    ]
                }
            ];

            try {
                const createdSummary = [];

                for (const catData of structure) {
                    const categoryChannel = await guild.channels.create({
                        name: catData.category,
                        type: ChannelType.GuildCategory
                    });

                    const createdChannels = [];
                    for (const chName of catData.channels) {
                        const overwrites = getPermissionOverwrites(guild, chName);

                        const textChannel = await guild.channels.create({
                            name: chName,
                            type: ChannelType.GuildText,
                            parent: categoryChannel.id,
                            permissionOverwrites: overwrites
                        });

                        if (chName === '✅・proof') {
                            await sendProofRuleBanner(textChannel);
                        }

                        const permInfo = channelPermissionConfigs[chName]?.readOnly 
                            ? '🔒 *(Lecture seule)*'
                            : (channelPermissionConfigs[chName]?.proofRules ? '📸 *(Proofs)*' : (channelPermissionConfigs[chName]?.premiumOnly ? '⭐ *(Premium)*' : '💬 *(Public)*'));

                        createdChannels.push(`- <#${textChannel.id}> ${permInfo}`);
                    }

                    createdSummary.push(`📁 **Catégorie : ${catData.category}**\n${createdChannels.join('\n')}`);
                }

                const setupEmbed = new EmbedBuilder()
                    .setTitle('🎉 Salons créés avec succès !')
                    .setDescription(`Les salons et permissions ont été configurés :\n\n${createdSummary.join('\n\n')}`)
                    .setColor('#57F287')
                    .setTimestamp();

                await interaction.editReply({ embeds: [setupEmbed] });

                const logEmbed = new EmbedBuilder()
                    .setTitle('🛠️ Setup Salons')
                    .setDescription(`L'administrateur **${interaction.user.tag}** a exécuté \`/setup-channel\`.`)
                    .setColor('#5865F2')
                    .setTimestamp();
                await sendLog(guild, logEmbed);

            } catch (error) {
                console.error('Erreur /setup-channel :', error);
                await interaction.editReply({
                    content: '❌ Erreur lors de la création des salons.'
                });
            }
        }

        // --- COMMANDE /setup-channel-perm ---
        else if (commandName === 'setup-channel-perm') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const guild = interaction.guild;
            const updatedChannels = [];

            try {
                const channels = await guild.channels.fetch();

                for (const [id, ch] of channels) {
                    if (ch && ch.type === ChannelType.GuildText && (channelPermissionConfigs[ch.name] || ch.name.includes('verify'))) {
                        const overwrites = getPermissionOverwrites(guild, ch.name);
                        await ch.permissionOverwrites.set(overwrites);

                        if (ch.name === '✅・proof') {
                            await sendProofRuleBanner(ch);
                        }

                        const permType = channelPermissionConfigs[ch.name]?.readOnly 
                            ? '🔒 *(Lecture Seule)*' 
                            : (channelPermissionConfigs[ch.name]?.proofRules ? '📸 *(Proofs)*' : (channelPermissionConfigs[ch.name]?.premiumOnly ? '⭐ *(Premium)*' : '💬 *(Public)*'));

                        updatedChannels.push(`- <#${ch.id}> (\`${ch.name}\`) : ${permType}`);
                    }
                }

                const permEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Permissions Mises à Jour')
                    .setDescription(updatedChannels.length > 0 
                        ? `Les permissions ont été ajustées sur les salons :\n\n${updatedChannels.join('\n')}`
                        : '⚠️ Aucun salon trouvé.')
                    .setColor('#5865F2')
                    .setTimestamp();

                await interaction.editReply({ embeds: [permEmbed] });

            } catch (error) {
                console.error('Erreur /setup-channel-perm :', error);
                await interaction.editReply({
                    content: '❌ Erreur lors de la mise à jour.'
                });
            }
        }
    } 

    // --- GESTIONNAIRE DE SELECT MENUS DE CONFIGURATION ---
    else if (interaction.isStringSelectMenu()) {
        const { customId, values, guild } = interaction;

        if (customId === 'settings_select_category') {
            const selectedVal = values[0];

            if (selectedVal === 'settings_cat_gen') {
                const cooldown = getGuildConfig(guild.id, 'cooldown') ?? 60;
                const reqRole = getGuildConfig(guild.id, 'requiredRoleId');
                const dailyLimit = getGuildConfig(guild.id, 'dailyLimit') ?? 0;

                const genEmbed = new EmbedBuilder()
                    .setTitle('⚡ Configuration du Générateur')
                    .setDescription([
                        'Paramètres actuels du générateur :',
                        '',
                        `⏱️ **Cooldown :** **${cooldown}s**`,
                        `🔑 **Rôle Requis :** ${reqRole ? `<@&${reqRole}>` : '`Aucun`'}`,
                        `📊 **Limite Daily :** ${dailyLimit > 0 ? `**${dailyLimit}** / jour` : '`Illimitée`'}`,
                        '',
                        'Utilisez les boutons ci-dessous pour modifier la valeur souhaitée.'
                    ].join('\n'))
                    .setColor('#5865F2');

                await interaction.reply({
                    embeds: [genEmbed],
                    flags: MessageFlags.Ephemeral
                });
            } else if (selectedVal === 'settings_cat_logs') {
                const logCh = getGuildConfig(guild.id, 'logsChannelId');

                const logEmbed = new EmbedBuilder()
                    .setTitle('📡 Configuration des Logs')
                    .setDescription([
                        `Salon de logs actuel : ${logCh ? `<#${logCh}>` : '`Non configuré`'}`,
                        '',
                        'Pour définir un nouveau salon de logs, utilisez la commande `/logs salon:#votre-salon`.'
                    ].join('\n'))
                    .setColor('#5865F2');

                await interaction.reply({
                    embeds: [logEmbed],
                    flags: MessageFlags.Ephemeral
                });
            } else if (selectedVal === 'settings_cat_verify') {
                const verifyEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Configuration de la Vérification')
                    .setDescription([
                        `Rôle Vérifié appliqué : <@&${VERIFIED_ROLE_ID}>`,
                        `Rôle Booster appliqué : <@&${BOOSTER_ROLE_ID}>`,
                        '',
                        'Seuls les membres possédant le rôle vérifié ont accès à l\'arborescence des salons du serveur.'
                    ].join('\n'))
                    .setColor('#57F287');

                await interaction.reply({
                    embeds: [verifyEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    }

    // --- GESTIONNAIRE DE BOUTONS ---
    else if (interaction.isButton()) {
        const { customId, guild, user } = interaction;

        // BOUTONS DU DASHBOARD SETTINGS
        if (customId === 'settings_btn_cooldown') {
            const modal = new ModalBuilder()
                .setCustomId('modal_settings_cooldown')
                .setTitle('⏱️ Cooldown du Générateur');

            const cooldownInput = new TextInputBuilder()
                .setCustomId('cooldown_input')
                .setLabel('Nouveau cooldown en secondes')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ex: 30')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(cooldownInput));
            await interaction.showModal(modal);
        }
        else if (customId === 'settings_btn_daily') {
            const modal = new ModalBuilder()
                .setCustomId('modal_settings_daily')
                .setTitle('📊 Limite Journalière');

            const dailyInput = new TextInputBuilder()
                .setCustomId('daily_input')
                .setLabel('Limite daily (0 = illimité)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ex: 5')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(dailyInput));
            await interaction.showModal(modal);
        }
        else if (customId === 'settings_btn_reset') {
            setGuildConfig(guild.id, 'cooldown', 60);
            setGuildConfig(guild.id, 'requiredRoleId', null);
            setGuildConfig(guild.id, 'dailyLimit', 0);

            await interaction.reply({
                content: '🔄 **Configuration réinitialisée aux valeurs par défaut !**',
                flags: MessageFlags.Ephemeral
            });
        }

        // GIVEAWAY
        else if (customId.startsWith('gw_') && customId !== 'gw_ended') {
            const gwData = activeGiveaways.get(customId);
            if (!gwData) {
                return interaction.reply({
                    content: '⚠️ Ce giveaway est terminé.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (gwData.participants.has(user.id)) {
                gwData.participants.delete(user.id);
                await interaction.reply({
                    content: '❌ Participation retirée.',
                    flags: MessageFlags.Ephemeral
                });
            } else {
                gwData.participants.add(user.id);
                await interaction.reply({
                    content: '🎉 **Participation enregistrée !** Bonne chance !',
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                const gwChannel = guild.channels.cache.get(gwData.channelId);
                if (gwChannel) {
                    const msg = await gwChannel.messages.fetch(gwData.messageId);
                    const updatedRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(customId)
                            .setLabel(`🎉 Rejoindre (${gwData.participants.size})`)
                            .setStyle(ButtonStyle.Primary)
                    );
                    await msg.edit({ components: [updatedRow] });
                }
            } catch (e) {}
        }

        // GÉNÉRATION DE COMPTE (gen_xxx) AVEC DISTRIBUTION DU STOCK RÉEL
        else if (customId.startsWith('gen_')) {
            const serviceId = customId.replace('gen_', '');
            const serviceObj = services.find(s => s.id === serviceId);
            const serviceName = serviceObj ? serviceObj.label : serviceId;

            const reqRoleId = getGuildConfig(guild.id, 'requiredRoleId');
            if (reqRoleId) {
                const member = await guild.members.fetch(user.id).catch(() => null);
                if (member && !member.roles.cache.has(reqRoleId)) {
                    return interaction.reply({
                        content: `⚠️ Vous devez posséder le rôle <@&${reqRoleId}> pour utiliser le générateur.`,
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            const cooldownSec = getGuildConfig(guild.id, 'cooldown') ?? 60;
            const userKey = `${guild.id}_${user.id}`;
            const lastGen = userCooldowns.get(userKey) || 0;
            const now = Date.now();
            const timePassedSec = Math.floor((now - lastGen) / 1000);

            if (timePassedSec < cooldownSec) {
                const remainingSec = cooldownSec - timePassedSec;
                return interaction.reply({
                    content: `⏱️ Merci de patienter encore **${remainingSec} seconde(s)** avant de générer un nouveau compte.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const dailyLimit = getGuildConfig(guild.id, 'dailyLimit') || 0;
            if (dailyLimit > 0) {
                const todayStr = new Date().toISOString().split('T')[0];
                const dailyKey = `${userKey}_${todayStr}`;
                const currentCount = userDailyGens.get(dailyKey) || 0;

                if (currentCount >= dailyLimit) {
                    return interaction.reply({
                        content: `📊 Vous avez atteint votre limite journalière de **${dailyLimit}** génération(s) pour aujourd'hui. Réessayez demain !`,
                        flags: MessageFlags.Ephemeral
                    });
                }
                userDailyGens.set(dailyKey, currentCount + 1);
            }

            const realAccountCombo = popServiceStock(serviceId);

            if (!realAccountCombo) {
                return interaction.reply({
                    content: `⚠️ Le stock pour le service **${serviceName}** est actuellement épuisé. Veuillez patienter jusqu'au prochain restock !`,
                    flags: MessageFlags.Ephemeral
                });
            }

            userCooldowns.set(userKey, now);

            let dmSent = true;

            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`✨ Votre Compte ${serviceName}`)
                    .setDescription(`Merci d'avoir utiliser NextGen !\nVoici votre compte **${serviceName}** :\n\n\`\`\`${realAccountCombo}\`\`\``)
                    .setColor('#5865F2')
                    .setTimestamp();

                await user.send({ embeds: [dmEmbed] });
            } catch (err) {
                dmSent = false;
                console.error(`Erreur DM à ${user.tag}:`, err);
            }

            const responseEmbed = new EmbedBuilder();

            if (dmSent) {
                responseEmbed
                    .setTitle('📩 Message Privé Envoyé !')
                    .setDescription(`Regardez vos **Messages Privés (DMs)** ! Votre compte **${serviceName}** t'y attend.`)
                    .setColor('#57F287');

                if (guild) {
                    const logGenEmbed = new EmbedBuilder()
                        .setTitle('⚡ Compte Généré')
                        .setDescription(`👤 **Membre :** <@${user.id}>\n🛒 **Service :** \`${serviceName}\``)
                        .setColor('#57F287')
                        .setTimestamp();
                    await sendLog(guild, logGenEmbed);
                }
            } else {
                responseEmbed
                    .setTitle('⚠️ Erreur MP')
                    .setDescription(`Impossible de vous envoyer un message privé. Veuillez ouvrir vos DMs Discord et réessayez.`)
                    .setColor('#ED4245');
            }

            await interaction.reply({
                embeds: [responseEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // TICKET OPEN
        else if (customId === 'ticket_open') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            let ticketCategory = guild.channels.cache.find(c => c.name === 'TICKETS' && c.type === ChannelType.GuildCategory);
            if (!ticketCategory) {
                ticketCategory = await guild.channels.create({
                    name: 'TICKETS',
                    type: ChannelType.GuildCategory
                });
            }

            const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

            const existingChannel = guild.channels.cache.find(c => c.name === channelName);
            if (existingChannel) {
                return interaction.editReply({
                    content: `⚠️ Vous avez déjà un ticket ouvert : <#${existingChannel.id}>`
                });
            }

            const ticketChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: ticketCategory.id,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
                    }
                ]
            });

            const welcomeEmbed = new EmbedBuilder()
                .setTitle(`🎟️ Ticket de ${user.username}`)
                .setDescription(`Bienvenue <@${user.id}> dans votre ticket !\nUn modérateur va vous répondre sous peu. Expliquez votre demande ci-dessous.`)
                .setColor('#5865F2')
                .setTimestamp();

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('🔒 Fermer le Ticket')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('📌 Prendre en charge')
                    .setStyle(ButtonStyle.Success)
            );

            await ticketChannel.send({
                content: `<@${user.id}>`,
                embeds: [welcomeEmbed],
                components: [actionRow]
            });

            await interaction.editReply({
                content: `✅ Votre ticket a été créé : <#${ticketChannel.id}>`
            });

            const logEmbed = new EmbedBuilder()
                .setTitle('📩 Nouveau Ticket')
                .setDescription(`👤 **Membre :** <@${user.id}>\n📌 **Salon :** <#${ticketChannel.id}>`)
                .setColor('#5865F2')
                .setTimestamp();
            await sendLog(guild, logEmbed);
        }

        // TICKET CLOSE
        else if (customId === 'ticket_close') {
            await interaction.reply({
                content: '🔒 **Fermeture du ticket dans 5 secondes...**'
            });

            const logEmbed = new EmbedBuilder()
                .setTitle('🔒 Ticket Fermé')
                .setDescription(`📌 **Salon :** \`${interaction.channel.name}\`\n👤 **Par :** <@${user.id}>`)
                .setColor('#ED4245')
                .setTimestamp();
            await sendLog(guild, logEmbed);

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (e) {}
            }, 5000);
        }

        // TICKET CLAIM
        else if (customId === 'ticket_claim') {
            const claimEmbed = new EmbedBuilder()
                .setTitle('📌 Ticket Pris en Charge')
                .setDescription(`Ce ticket est désormais pris en charge par <@${user.id}>.`)
                .setColor('#57F287')
                .setTimestamp();

            await interaction.reply({ embeds: [claimEmbed] });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
