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
const { createClient } = require('@libsql/client');
require('dotenv').config();

// CONSTANTES DES RÔLES
const VERIFIED_ROLE_ID = '1532346852203040768';
const BOOSTER_ROLE_ID = '1532347027441057812';

// --- CONFIGURATION DE L'ENVIRONNEMENT RENDER ---
const PORT = process.env.PORT || 3000;

let BASE_URL = `http://localhost:${PORT}`;
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    BASE_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
} else if (process.env.RENDER_EXTERNAL_URL) {
    BASE_URL = process.env.RENDER_EXTERNAL_URL;
} else if (process.env.CALLBACK_URL) {
    BASE_URL = process.env.CALLBACK_URL;
}

const REDIRECT_URI = `${BASE_URL.replace(/\/$/, '')}/callback`;

// --- INITIALISATION DE LA BASE DE DONNÉES TURSO ---
const turso = createClient({
    url: process.env.TURSO_DATABASE_URL || 'libsql://nextgen-limoons.aws-eu-west-1.turso.io',
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function initTursoDB() {
    try {
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS combos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                combo TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                is_working INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('⚡ Base de données Turso DB initialisée avec succès !');
    } catch (e) {
        console.error('❌ Erreur de connexion Turso DB :', e);
    }
}

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

// --- GESTION DES ERREURS GLOBALES ET ANTI-CRASH ---
client.on('error', error => {
    console.error('🛡️ Client Error (Non-Fatal) :', error.message || error);
});

process.on('unhandledRejection', (reason) => {
    console.error('🛡️ Unhandled Rejection (Non-Fatal) :', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('🛡️ Uncaught Exception (Non-Fatal) :', err?.message || err);
});

// --- GESTION DE LA CONFIGURATION PERSISTANTE (config.json & stocks.json) ---
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

// --- FONCTIONS TURSO DB ---
async function addTursoCombos(serviceId, combos) {
    addServiceStock(serviceId, combos);
    try {
        for (const combo of combos) {
            await turso.execute({
                sql: 'INSERT INTO combos (service_id, combo) VALUES (?, ?)',
                args: [serviceId, combo]
            });
        }
    } catch (e) {
        console.error('Erreur Turso addCombos :', e);
    }
}

async function getTursoStockCount(serviceId) {
    try {
        const res = await turso.execute({
            sql: 'SELECT COUNT(*) as count FROM combos WHERE service_id = ?',
            args: [serviceId]
        });
        const count = Number(res.rows[0]?.count || 0);
        if (count === 0) return getServiceStock(serviceId).length;
        return count;
    } catch {
        return getServiceStock(serviceId).length;
    }
}

async function popTursoCombo(serviceId) {
    try {
        const res = await turso.execute({
            sql: 'SELECT id, combo FROM combos WHERE service_id = ? ORDER BY id ASC LIMIT 1',
            args: [serviceId]
        });
        if (res.rows.length === 0) {
            return popServiceStock(serviceId);
        }
        const row = res.rows[0];
        await turso.execute({
            sql: 'DELETE FROM combos WHERE id = ?',
            args: [row.id]
        });
        popServiceStock(serviceId);
        return row.combo;
    } catch {
        return popServiceStock(serviceId);
    }
}

async function addTursoFeedback(serviceId, isWorking, userId) {
    try {
        await turso.execute({
            sql: 'INSERT INTO feedback (service_id, is_working, user_id) VALUES (?, ?, ?)',
            args: [serviceId, isWorking ? 1 : 0, userId]
        });
    } catch (e) {
        console.error('Erreur Turso feedback :', e);
    }
}

async function getTursoSuccessRate(serviceId) {
    try {
        const res = await turso.execute({
            sql: 'SELECT SUM(is_working) as success, COUNT(*) as total FROM feedback WHERE service_id = ?',
            args: [serviceId]
        });
        const row = res.rows[0];
        const total = Number(row?.total || 0);
        if (total === 0) return { rate: 100, total: 0 };
        const success = Number(row?.success || 0);
        const rate = Math.round((success / total) * 100);
        return { rate, total };
    } catch {
        return { rate: 100, total: 0 };
    }
}

// Envoi des logs
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

// --- CATALOGUE DES SERVICES AVEC LOGOS OFFICIELS D'ORIGINE ---
const services = [
    { id: 'paramount', label: 'Paramount+', emojiName: 'ng_paramount', defaultEmoji: '🎬', iconUrl: 'https://play-lh.googleusercontent.com/O5QHZxy2pkxwHrjU3Omd_1jdIYk_pZQexy2VVEDBDhaXgNhvZV7wjhfN_0kLUrQfCKFsaGbQbVm8usyrc-yBGhI', style: ButtonStyle.Secondary },
    { id: 'disney', label: 'Disney+', emojiName: 'ng_disney', defaultEmoji: '🏰', iconUrl: 'https://store-images.s-microsoft.com/image/apps.14187.14495311847124170.7646206e-bd82-4cf0-8b8c-d06a67bc302c.2e474878-acb7-4afb-a503-c2a1a32feaa8?h=210', style: ButtonStyle.Secondary },
    { id: 'adn', label: 'ADN', emojiName: 'ng_adn', defaultEmoji: '🍥', iconUrl: 'https://m.media-amazon.com/images/I/51s-YfZ2TlS.png', style: ButtonStyle.Secondary },
    { id: 'crunchyroll', label: 'Crunchyroll', emojiName: 'ng_crunchyroll', defaultEmoji: '🍿', iconUrl: 'https://img.icons8.com/color/512/crunchyroll.png', style: ButtonStyle.Secondary },
    { id: 'fortnite', label: 'Fortnite', emojiName: 'ng_fortnite', defaultEmoji: '🎮', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Fortnite_F_lettermark_logo.png', style: ButtonStyle.Secondary },
    { id: 'valorant', label: 'Valorant', emojiName: 'ng_valorant', defaultEmoji: '🎯', iconUrl: 'https://img.icons8.com/color/512/valorant.png', style: ButtonStyle.Secondary },
    { id: 'xbox', label: 'Xbox', emojiName: 'ng_xbox', defaultEmoji: '🟢', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Xbox_one_logo.svg/500px-Xbox_one_logo.svg.png', style: ButtonStyle.Secondary },
    { id: 'nordvpn', label: 'NordVPN', emojiName: 'ng_nordvpn', defaultEmoji: '🛡️', iconUrl: 'https://img.icons8.com/color/512/nordvpn.png', style: ButtonStyle.Secondary },
    { id: 'hotmail', label: 'Hotmail', emojiName: 'ng_hotmail', defaultEmoji: '✉️', iconUrl: 'https://img.icons8.com/color/512/microsoft-outlook-2019.png', style: ButtonStyle.Secondary },
    { id: 'expressvpn', label: 'ExpressVPN', emojiName: 'ng_expressvpn', defaultEmoji: '🚀', iconUrl: 'https://logosandtypes.com/wp-content/uploads/2025/03/ExpressVPN.png', style: ButtonStyle.Secondary },
    { id: 'mullvadvpn', label: 'MullvadVPN', emojiName: 'ng_mullvadvpn', defaultEmoji: '🔒', iconUrl: 'https://mullvad.net/press/MullvadVPN_logo_Round_RGB_Color_negative.png', style: ButtonStyle.Secondary }
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

// ActionRows pour le Panel avec Stock en Temps Réel ex: Valorant (12)
async function buildServiceRows(guild) {
    const rows = [];
    let currentRow = new ActionRowBuilder();

    for (let i = 0; i < services.length; i++) {
        const service = services[i];
        const emoji = await getOrFetchEmoji(guild, service);
        const count = await getTursoStockCount(service.id);

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

// --- GESTION DES RÔLES DE LANGUES (Français & English) ---
async function getOrCreateLanguageRoles(guild) {
    let frRole = guild.roles.cache.find(r => r.name === '🇫🇷 Français');
    if (!frRole) {
        frRole = await guild.roles.create({ name: '🇫🇷 Français', color: '#3498DB', reason: 'Configuration Bilingue' }).catch(() => null);
    }
    let enRole = guild.roles.cache.find(r => r.name === '🇬🇧 English');
    if (!enRole) {
        enRole = await guild.roles.create({ name: '🇬🇧 English', color: '#E74C3C', reason: 'Configuration Bilingue' }).catch(() => null);
    }
    return { frRole, enRole };
}

function sendLanguageSelectionPrompt(channel) {
    const langEmbed = new EmbedBuilder()
        .setTitle('🌐 Choose your Language / Choisissez votre Langue')
        .setDescription([
            'Veuillez sélectionner votre langue ci-dessous pour débloquer les salons correspondants :',
            'Please select your language below to unlock your language channels:',
            '',
            '🇫🇷 **Français** — Accéder à la communauté francophone & salons FR',
            '🇬🇧 **English** — Access the English community & EN channels'
        ].join('\n'))
        .setColor('#5865F2')
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('lang_fr')
            .setLabel('🇫🇷 Français')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('lang_en')
            .setLabel('🇬🇧 English')
            .setStyle(ButtonStyle.Danger)
    );

    return { embeds: [langEmbed], components: [row] };
}

// --- PERMISSIONS ET CONFIGURATION DES SALONS BILINGUES ---
const channelPermissionConfigs = {
    '✅・invites': { readOnly: true },
    '🌠・boost': { readOnly: true },
    '📢・annonce': { readOnly: true },
    '📢・announcements': { readOnly: true },
    '🎁・giveaway': { readOnly: true, allowReactions: true },
    '🎁・giveaways-en': { readOnly: true, allowReactions: true },
    '💧・drop': { readOnly: true },
    '📦・restock-fr': { readOnly: true },
    '📦・restock-en': { readOnly: true },
    '✅・proof': { readOnly: false, proofRules: true },
    '💬・general-fr': { readOnly: false },
    '💬・general-en': { readOnly: false },
    '📩・ticket': { readOnly: false },
    '❓・req': { readOnly: false },
    '⭐・gen-free': { readOnly: false, allowCommands: true },
    '🚀・gen-premium': { premiumOnly: true }
};

function getPermissionOverwrites(guild, channelName) {
    const everyoneRole = guild.roles.everyone;
    const verifiedRole = guild.roles.cache.get(VERIFIED_ROLE_ID);
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
    const config = channelPermissionConfigs[channelName] || { readOnly: false };

    if (config.readOnly) {
        overwrites.push({
            id: targetRoleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages]
        });
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

async function sendProofRuleBanner(channel) {
    try {
        const bannerEmbed = new EmbedBuilder()
            .setTitle('📸 Salon Preuves (Proofs)')
            .setDescription([
                'Merci d\'envoyer vos captures d\'écran de preuves ici !',
                '',
                '📌 **Consigne :** Seules les captures d\'écran sont autorisées dans ce salon.',
                '❌ **Pas de bavardage :** Pour discuter, utilisez le salon général. Tout message sans image sera supprimé.'
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

// --- SERVEUR CALLBACK OAUTH2 POUR RENDER ---
const server = http.createServer(async (req, res) => {
    const reqUrl = url.parse(req.url, true);

    if (reqUrl.pathname === '/' || reqUrl.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            status: 'online',
            service: 'NextGen Discord Bot',
            bot: client.user ? client.user.tag : 'Connecting'
        }));
    }

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
                        <html lang="fr">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>NextGen • Vérification Réussie</title>
                            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
                            <style>
                                * { box-sizing: border-box; margin: 0; padding: 0; }
                                body {
                                    background: #0E0F12;
                                    color: #FFFFFF;
                                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                                    display: flex;
                                    justify-content: center;
                                    align-items: center;
                                    min-height: 100vh;
                                    padding: 20px;
                                    overflow: hidden;
                                }
                                .bg-glow {
                                    position: absolute;
                                    width: 450px;
                                    height: 450px;
                                    background: radial-gradient(circle, rgba(87, 242, 135, 0.15) 0%, rgba(0, 0, 0, 0) 70%);
                                    top: 50%;
                                    left: 50%;
                                    transform: translate(-50%, -50%);
                                    z-index: 0;
                                    pointer-events: none;
                                }
                                .card {
                                    position: relative;
                                    z-index: 1;
                                    background: rgba(30, 31, 34, 0.85);
                                    backdrop-filter: blur(16px);
                                    border: 1px solid rgba(255, 255, 255, 0.08);
                                    border-radius: 20px;
                                    padding: 48px 36px;
                                    text-align: center;
                                    max-width: 440px;
                                    width: 100%;
                                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
                                    animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                                }
                                @keyframes fadeIn {
                                    from { opacity: 0; transform: translateY(20px) scale(0.95); }
                                    to { opacity: 1; transform: translateY(0) scale(1); }
                                }
                                .icon-container {
                                    width: 80px;
                                    height: 80px;
                                    background: rgba(87, 242, 135, 0.1);
                                    border: 2px solid #57F287;
                                    border-radius: 50%;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    margin: 0 auto 24px auto;
                                    box-shadow: 0 0 30px rgba(87, 242, 135, 0.3);
                                    animation: pulse 2s infinite;
                                }
                                @keyframes pulse {
                                    0% { box-shadow: 0 0 20px rgba(87, 242, 135, 0.2); }
                                    50% { box-shadow: 0 0 35px rgba(87, 242, 135, 0.4); }
                                    100% { box-shadow: 0 0 20px rgba(87, 242, 135, 0.2); }
                                }
                                .icon-container svg {
                                    width: 40px;
                                    height: 40px;
                                    fill: none;
                                    stroke: #57F287;
                                    stroke-width: 3;
                                    stroke-linecap: round;
                                    stroke-linejoin: round;
                                }
                                h1 {
                                    font-size: 24px;
                                    font-weight: 800;
                                    margin-bottom: 12px;
                                    color: #FFFFFF;
                                    letter-spacing: -0.5px;
                                }
                                p {
                                    color: #B5BAC1;
                                    font-size: 15px;
                                    line-height: 1.6;
                                    margin-bottom: 28px;
                                }
                                .btn {
                                    display: inline-block;
                                    width: 100%;
                                    padding: 14px 20px;
                                    background: #5865F2;
                                    color: #FFFFFF;
                                    font-weight: 700;
                                    font-size: 15px;
                                    border-radius: 10px;
                                    text-decoration: none;
                                    transition: all 0.2s ease;
                                    box-shadow: 0 4px 14px rgba(88, 101, 242, 0.4);
                                }
                                .btn:hover {
                                    background: #4752C4;
                                    transform: translateY(-2px);
                                    box-shadow: 0 6px 20px rgba(88, 101, 242, 0.6);
                                }
                                .footer-text {
                                    font-size: 12px;
                                    color: #80848E;
                                    margin-top: 20px;
                                }
                            </style>
                        </head>
                        <body>
                            <div class="bg-glow"></div>
                            <div class="card">
                                <div class="icon-container">
                                    <svg viewBox="0 0 24 24">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                </div>
                                <h1>Vérification Réussie !</h1>
                                <p>Votre compte Discord a été vérifié avec succès par <strong>NextGen Security Protocol</strong>.<br><br>Tous vos accès aux salons du serveur sont désormais débloqués !</p>
                                <a href="discord://" class="btn">Retourner sur Discord</a>
                                <div class="footer-text">Vous pouvez désormais fermer cet onglet.</div>
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Serveur Web & Callback Render actif sur ${REDIRECT_URI} (Port ${PORT})`);
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
            .setName('en-fr')
            .setDescription('Crée l\'arborescence bilingue (Français & English) du serveur')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        new SlashCommandBuilder()
            .setName('broadcast')
            .setDescription('Envoie une annonce simultanément dans les salons Français et Anglais')
            .addStringOption(option =>
                option.setName('message_fr')
                    .setDescription('Message de l\'annonce en français')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('message_en')
                    .setDescription('Message de l\'annonce en anglais (optionnel)')
                    .setRequired(false)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
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
            .setDescription('Ajoute du stock pour un service (multilingue FR/EN)')
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
            .setDescription('Lance un giveaway bilingue simultané (FR & EN)')
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
    await initTursoDB();
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
    try {
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

            if (commandName === 'settings') {
                const dashboard = buildSettingsDashboard(interaction.guild);
                await interaction.reply({
                    ...dashboard,
                    flags: MessageFlags.Ephemeral
                });
            }

            // --- COMMANDE /en-fr (SETUP BILINGUE ULTRA STRICT) ---
            else if (commandName === 'en-fr') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guild = interaction.guild;
                const everyoneRole = guild.roles.everyone;
                const { frRole, enRole } = await getOrCreateLanguageRoles(guild);

                const createdSummary = [];

                // 1. Catégorie & Salons Globaux (Vérifiés uniquement)
                const commonCat = await guild.channels.create({
                    name: '🌐 COMMON / GENERAL',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: VERIFIED_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel] }
                    ]
                });

                const commonChannels = [
                    '✅・invites',
                    '🌠・boost',
                    '✅・proof',
                    '📩・ticket'
                ];

                const createdCommon = [];
                for (const chName of commonChannels) {
                    const overwrites = getPermissionOverwrites(guild, chName);
                    const textCh = await guild.channels.create({
                        name: chName,
                        type: ChannelType.GuildText,
                        parent: commonCat.id,
                        permissionOverwrites: overwrites
                    });
                    if (chName === '✅・proof') {
                        await sendProofRuleBanner(textCh);
                    }
                    createdCommon.push(`- <#${textCh.id}>`);
                }
                createdSummary.push(`📁 **Catégorie : 🌐 COMMON / GENERAL**\n${createdCommon.join('\n')}`);

                // 2. Catégorie 🇫🇷 FRANÇAIS (Rôle FR uniquement)
                const frCat = await guild.channels.create({
                    name: '🇫🇷 FRANÇAIS',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: frRole ? frRole.id : everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });

                const frChannelsData = [
                    { name: '📢・annonces', readOnly: true },
                    { name: '🎁・giveaways-fr', readOnly: true },
                    { name: '💬・general-fr', readOnly: false },
                    { name: '⭐・gen-fr', readOnly: false },
                    { name: '📦・restock-fr', readOnly: true }
                ];

                const createdFr = [];
                for (const chData of frChannelsData) {
                    const overwrites = [
                        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
                        {
                            id: frRole ? frRole.id : everyoneRole.id,
                            allow: chData.readOnly 
                                ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] 
                                : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands],
                            deny: chData.readOnly ? [PermissionFlagsBits.SendMessages] : []
                        }
                    ];
                    const textCh = await guild.channels.create({
                        name: chData.name,
                        type: ChannelType.GuildText,
                        parent: frCat.id,
                        permissionOverwrites: overwrites
                    });
                    createdFr.push(`- <#${textCh.id}> ${chData.readOnly ? '🔒 *(Lecture seule)*' : '💬 *(Public)*'}`);
                }
                createdSummary.push(`📁 **Catégorie : 🇫🇷 FRANÇAIS**\n${createdFr.join('\n')}`);

                // 3. Catégorie 🇬🇧 ENGLISH (Rôle EN uniquement)
                const enCat = await guild.channels.create({
                    name: '🇬🇧 ENGLISH',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: enRole ? enRole.id : everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }
                    ]
                });

                const enChannelsData = [
                    { name: '📢・announcements', readOnly: true },
                    { name: '🎁・giveaways-en', readOnly: true },
                    { name: '💬・general-en', readOnly: false },
                    { name: '⭐・gen-en', readOnly: false },
                    { name: '📦・restock-en', readOnly: true }
                ];

                const createdEn = [];
                for (const chData of enChannelsData) {
                    const overwrites = [
                        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
                        {
                            id: enRole ? enRole.id : everyoneRole.id,
                            allow: chData.readOnly 
                                ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] 
                                : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands],
                            deny: chData.readOnly ? [PermissionFlagsBits.SendMessages] : []
                        }
                    ];
                    const textCh = await guild.channels.create({
                        name: chData.name,
                        type: ChannelType.GuildText,
                        parent: enCat.id,
                        permissionOverwrites: overwrites
                    });
                    createdEn.push(`- <#${textCh.id}> ${chData.readOnly ? '🔒 *(Read Only)*' : '💬 *(Public)*'}`);
                }
                createdSummary.push(`📁 **Catégorie : 🇬🇧 ENGLISH**\n${createdEn.join('\n')}`);

                const setupEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Arborescence Bilingue & Permissions Déployées !')
                    .setDescription([
                        'Les permissions ont été ajustées de manière ultra stricte :',
                        '🔒 **Non Vérifiés :** Ne voient **ABSOLUMENT RIEN** d\'autre que le salon <#verify>.',
                        '🇫🇷 **Membres Français :** Voient la catégorie 🌐 COMMON et 🇫🇷 FRANÇAIS.',
                        '🇬🇧 **English Members:** See 🌐 COMMON & 🇬🇧 ENGLISH categories.',
                        '',
                        createdSummary.join('\n\n')
                    ].join('\n'))
                    .setColor('#57F287')
                    .setTimestamp();

                await interaction.editReply({ embeds: [setupEmbed] });
            }

            // --- COMMANDE /broadcast (DIFFUSION BILINGUE DE MESSAGE) ---
            else if (commandName === 'broadcast') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const msgFr = interaction.options.getString('message_fr');
                let msgEn = interaction.options.getString('message_en');

                if (!msgEn) {
                    msgEn = msgFr; // Fallback si non renseigné
                }

                const guild = interaction.guild;
                const frCh = guild.channels.cache.find(c => c.name.includes('annonces') || c.name.includes('annonce'));
                const enCh = guild.channels.cache.find(c => c.name.includes('announcements') || c.name.includes('announcement'));

                let frSent = false;
                let enSent = false;

                if (frCh && frCh.isTextBased()) {
                    const embedFr = new EmbedBuilder()
                        .setTitle('📢 NextGen • Annonce Officielle')
                        .setDescription(msgFr)
                        .setColor('#5865F2')
                        .setFooter({ text: 'NextGen FR', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();
                    await frCh.send({ content: '@everyone', embeds: [embedFr] });
                    frSent = true;
                }

                if (enCh && enCh.isTextBased()) {
                    const embedEn = new EmbedBuilder()
                        .setTitle('📢 NextGen • Official Announcement')
                        .setDescription(msgEn)
                        .setColor('#5865F2')
                        .setFooter({ text: 'NextGen EN', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();
                    await enCh.send({ content: '@everyone', embeds: [embedEn] });
                    enSent = true;
                }

                await interaction.editReply({
                    content: `✅ Broadcast effectué ! ${frSent ? `🇫🇷 Envoyé dans <#${frCh.id}>` : '⚠️ Salon FR non trouvé.'} | ${enSent ? `🇬🇧 Envoyé dans <#${enCh.id}>` : '⚠️ Salon EN non trouvé.'}`
                });
            }

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

            else if (commandName === 'panel') {
                await interaction.deferReply();

                const statsLines = [];
                for (const service of services) {
                    const emoji = await getOrFetchEmoji(interaction.guild, service);
                    const emojiStr = (typeof emoji === 'string') ? emoji : `<:${emoji.name}:${emoji.id}>`;
                    const { rate, total } = await getTursoSuccessRate(service.id);
                    statsLines.push(`${emojiStr} **${service.label}** — \`${rate}% de réussite\` *(${total} avis)*`);
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
                        'Bienvenue sur le générateur **NextGen** ! Cliquez sur le bouton d\'un service ci-dessous pour obtenir vos identifiants envoyés directement en Message Privé.',
                        '',
                        '### 📊 **Taux de Réussite des Services (Turso DB) :**',
                        ...statsLines,
                        '',
                        '*N\'oubliez pas de donner votre avis en DM après chaque génération (Fonctionne / Fonctionne pas) !*'
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

            // --- COMMANDE /giveaway (GIVEAWAY SIMULTANÉ BILINGUE AVEC PARTICIPATION UNIFIÉE) ---
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
                let frGwChannel = guild.channels.cache.find(c => c.name.includes('giveaway') && !c.name.includes('en'));
                let enGwChannel = guild.channels.cache.find(c => c.name.includes('giveaways-en') || c.name.includes('giveaway-en'));

                if (!frGwChannel) frGwChannel = interaction.channel;

                const endTime = Math.floor((Date.now() + durationMs) / 1000);
                const gwId = `gw_${Date.now()}`;

                const gwEmbedFr = new EmbedBuilder()
                    .setTitle('🎉 Giveaway NextGen (FR)')
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
                    .setFooter({ text: 'NextGen Giveaway FR', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                const rowFr = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(gwId)
                        .setLabel('🎉 Rejoindre (0)')
                        .setStyle(ButtonStyle.Primary)
                );

                const frMsg = await frGwChannel.send({ embeds: [gwEmbedFr], components: [rowFr] });

                let enMsg = null;
                if (enGwChannel && enGwChannel.isTextBased()) {
                    const gwEmbedEn = new EmbedBuilder()
                        .setTitle('🎉 NextGen Giveaway (EN)')
                        .setDescription([
                            `A new giveaway has just started!`,
                            '',
                            `🎁 **Prize:** **${prize}**`,
                            `👤 **Host:** <@${interaction.user.id}>`,
                            `🏆 **Winners:** **${winnerCount}**`,
                            `⏰ **Ends:** <t:${endTime}:R> (<t:${endTime}:f>)`,
                            '',
                            'Click **Join** below to enter!'
                        ].join('\n'))
                        .setColor('#FEE75C')
                        .setFooter({ text: 'NextGen Giveaway EN', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();

                    const rowEn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(gwId)
                            .setLabel('🎉 Join (0)')
                            .setStyle(ButtonStyle.Primary)
                    );

                    enMsg = await enGwChannel.send({ embeds: [gwEmbedEn], components: [rowEn] });
                }

                activeGiveaways.set(gwId, {
                    prize,
                    winnerCount,
                    participants: new Set(),
                    frChannelId: frGwChannel.id,
                    frMessageId: frMsg.id,
                    enChannelId: enGwChannel ? enGwChannel.id : null,
                    enMessageId: enMsg ? enMsg.id : null,
                    endTime
                });

                await interaction.editReply({
                    content: `✅ Giveaway publié simultanément en Français ${enGwChannel ? 'et en Anglais' : ''}.`
                });

                setTimeout(async () => {
                    const gwData = activeGiveaways.get(gwId);
                    if (!gwData) return;

                    const participantsArray = Array.from(gwData.participants);
                    let winnersText = 'Aucun participant / No entries.';

                    if (participantsArray.length > 0) {
                        const shuffled = participantsArray.sort(() => 0.5 - Math.random());
                        const selectedWinners = shuffled.slice(0, gwData.winnerCount);
                        winnersText = selectedWinners.map(id => `<@${id}>`).join(', ');
                    }

                    const endEmbedFr = new EmbedBuilder()
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

                    const endEmbedEn = new EmbedBuilder()
                        .setTitle('🎉 Giveaway Ended')
                        .setDescription([
                            `The giveaway has ended!`,
                            '',
                            `🎁 **Prize:** **${gwData.prize}**`,
                            `🏆 **Winner(s):** ${winnersText}`,
                            `👥 **Participants:** ${participantsArray.length}`
                        ].join('\n'))
                        .setColor('#57F287')
                        .setTimestamp();

                    const disabledRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('gw_ended')
                            .setLabel(`🎉 Terminé / Ended (${participantsArray.length})`)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );

                    try {
                        const msgFr = await frGwChannel.messages.fetch(gwData.frMessageId);
                        await msgFr.edit({ embeds: [endEmbedFr], components: [disabledRow] });
                        if (participantsArray.length > 0) {
                            await frGwChannel.send({ content: `🎉 Bravo à ${winnersText} qui remporte **${gwData.prize}** !` });
                        }
                    } catch (e) {}

                    if (enGwChannel && gwData.enMessageId) {
                        try {
                            const msgEn = await enGwChannel.messages.fetch(gwData.enMessageId);
                            await msgEn.edit({ embeds: [endEmbedEn], components: [disabledRow] });
                            if (participantsArray.length > 0) {
                                await enGwChannel.send({ content: `🎉 Congratulations to ${winnersText} for winning **${gwData.prize}**!` });
                            }
                        } catch (e) {}
                    }

                    activeGiveaways.delete(gwId);
                }, durationMs);
            }

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

            // --- COMMANDE /restock (MULTILINGUE FR ET EN) ---
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

                    await addTursoCombos(serviceId, combos);
                    const totalStockCount = await getTursoStockCount(serviceId);

                    const guild = interaction.guild;
                    let frRestockCh = guild.channels.cache.find(c => c.name.includes('restock-fr') || c.name.includes('restock'));
                    let enRestockCh = guild.channels.cache.find(c => c.name.includes('restock-en'));

                    if (!frRestockCh) frRestockCh = interaction.channel;

                    const restockEmbedFr = new EmbedBuilder()
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

                    await frRestockCh.send({ embeds: [restockEmbedFr] });

                    if (enRestockCh && enRestockCh.isTextBased()) {
                        const restockEmbedEn = new EmbedBuilder()
                            .setTitle('📦 Restock Complete')
                            .setDescription([
                                `A new restock has just been processed!`,
                                '',
                                `🛒 **Service:** **${serviceName}**`,
                                `📊 **New accounts imported:** **${comboCount}**`,
                                `📈 **Total Current Stock:** **${totalStockCount}** accounts`,
                                `👤 **Restocked by:** <@${interaction.user.id}>`,
                                '',
                                'Head over to `/panel` to generate your account!'
                            ].join('\n'))
                            .setColor('#FEE75C')
                            .setTimestamp();

                        await enRestockCh.send({ embeds: [restockEmbedEn] });
                    }

                    await interaction.editReply({
                        content: `✅ Restock de **${comboCount}** comptes pour **${serviceName}** publié dans les salons ! Stock total : **${totalStockCount}**.`
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
                    .setTitle('🛡️ Vérification / Verification')
                    .setDescription([
                        'Bienvenue sur le serveur ! Pour accéder aux salons et aux générateurs, merci de vous vérifier ci-dessous.',
                        'Welcome! Please verify below to access channels and generators.',
                        '',
                        '1. Cliquez sur le bouton **Se Vérifier / Verify** ci-dessous.',
                        '2. Acceptez l\'autorisation.',
                        '3. Vos salons se débloqueront automatiquement !'
                    ].join('\n'))
                    .setColor('#57F287')
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('🛡️ Se Vérifier / Verify')
                        .setStyle(ButtonStyle.Link)
                        .setURL(oauthUrl)
                );

                await verifyChannel.send({
                    embeds: [verifyEmbed],
                    components: [row]
                });

                // Envoi du prompt de choix de langue
                const langPrompt = sendLanguageSelectionPrompt(verifyChannel);
                await verifyChannel.send(langPrompt);

                await interaction.editReply({
                    content: `✅ Panneau de vérification et choix de langue déployés dans <#${verifyChannel.id}>.`
                });
            }

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

            // CHOIX DE LANGUE (Français / English)
            if (customId === 'lang_fr' || customId === 'lang_en') {
                const isFr = customId === 'lang_fr';
                const { frRole, enRole } = await getOrCreateLanguageRoles(guild);
                const member = await guild.members.fetch(user.id).catch(() => null);

                if (member) {
                    if (isFr) {
                        if (frRole) await member.roles.add(frRole.id).catch(() => {});
                        if (enRole) await member.roles.remove(enRole.id).catch(() => {});
                    } else {
                        if (enRole) await member.roles.add(enRole.id).catch(() => {});
                        if (frRole) await member.roles.remove(frRole.id).catch(() => {});
                    }
                }

                return interaction.reply({
                    content: isFr 
                        ? '🇫🇷 **Vous avez sélectionné le français !** Vos accès aux salons FR sont débloqués.' 
                        : '🇬🇧 **You selected English!** Your access to EN channels has been unlocked.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // BOUTONS DE FEEDBACK DM
            if (customId.startsWith('fb_work_') || customId.startsWith('fb_fail_')) {
                const isWorking = customId.startsWith('fb_work_');
                const serviceId = customId.replace(isWorking ? 'fb_work_' : 'fb_fail_', '');
                const serviceObj = services.find(s => s.id === serviceId);

                await addTursoFeedback(serviceId, isWorking, user.id);

                const confirmEmbed = new EmbedBuilder()
                    .setTitle(isWorking ? '✅ Retour Enregistré !' : '⚠️ Signalement Enregistré')
                    .setDescription(isWorking 
                        ? `Merci pour votre avis ! Vous avez confirmé que le compte **${serviceObj ? serviceObj.label : serviceId}** fonctionne correctement.`
                        : `Merci pour votre retour ! Votre signalement pour le compte **${serviceObj ? serviceObj.label : serviceId}** a bien été pris en compte.`)
                    .setColor(isWorking ? '#57F287' : '#ED4245')
                    .setTimestamp();

                return interaction.reply({ embeds: [confirmEmbed] });
            }

            // BOUTONS SETTINGS
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

            // GIVEAWAY (GESTION UNIFIÉE DES CLICS SUR LES BOUTONS FR ET EN)
            else if (customId.startsWith('gw_') && customId !== 'gw_ended') {
                const gwData = activeGiveaways.get(customId);
                if (!gwData) {
                    return interaction.reply({
                        content: '⚠️ Ce giveaway est terminé / This giveaway has ended.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                let isJoined = false;
                if (gwData.participants.has(user.id)) {
                    gwData.participants.delete(user.id);
                    await interaction.reply({
                        content: '❌ Participation retirée / Entry removed.',
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    gwData.participants.add(user.id);
                    isJoined = true;
                    await interaction.reply({
                        content: '🎉 **Participation enregistrée / Entry registered !** Bonne chance / Good luck !',
                        flags: MessageFlags.Ephemeral
                    });
                }

                // Mise à jour synchrone du compteur sur les messages FR et EN
                try {
                    const frChannel = guild.channels.cache.get(gwData.frChannelId);
                    if (frChannel) {
                        const msgFr = await frChannel.messages.fetch(gwData.frMessageId);
                        const updatedRowFr = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(customId)
                                .setLabel(`🎉 Rejoindre (${gwData.participants.size})`)
                                .setStyle(ButtonStyle.Primary)
                        );
                        await msgFr.edit({ components: [updatedRowFr] });
                    }
                } catch (e) {}

                if (gwData.enChannelId && gwData.enMessageId) {
                    try {
                        const enChannel = guild.channels.cache.get(gwData.enChannelId);
                        if (enChannel) {
                            const msgEn = await enChannel.messages.fetch(gwData.enMessageId);
                            const updatedRowEn = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(customId)
                                    .setLabel(`🎉 Join (${gwData.participants.size})`)
                                    .setStyle(ButtonStyle.Primary)
                            );
                            await msgEn.edit({ components: [updatedRowEn] });
                        }
                    } catch (e) {}
                }
            }

            // GÉNÉRATION DE COMPTE (gen_xxx)
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

                const currentStockCount = await getTursoStockCount(serviceId);

                if (currentStockCount === 0) {
                    return interaction.reply({
                        content: `⚠️ Aucun compte disponible pour le service **${serviceName}**. Aucun message privé n'a été envoyé. Rendez-vous au prochain restock !`,
                        flags: MessageFlags.Ephemeral
                    });
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

                const realAccountCombo = await popTursoCombo(serviceId);

                if (!realAccountCombo) {
                    return interaction.reply({
                        content: `⚠️ Aucun compte disponible pour le service **${serviceName}**. Aucun message privé n'a été envoyé.`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                userCooldowns.set(userKey, now);

                let dmSent = true;

                try {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle(`✨ Votre Compte ${serviceName}`)
                        .setDescription([
                            `Merci d'avoir utilisé **NextGen Generator** !`,
                            `Voici vos identifiants pour **${serviceName}** :`,
                            '',
                            '```',
                            realAccountCombo,
                            '```',
                            '',
                            '📌 *Merci d\'indiquer ci-dessous si le compte fonctionne pour mettre à jour les statistiques en direct !*'
                        ].join('\n'))
                        .setColor('#5865F2')
                        .setTimestamp();

                    const feedbackRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`fb_work_${serviceId}`)
                            .setLabel('🟢 Fonctionne')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`fb_fail_${serviceId}`)
                            .setLabel('🔴 Ne fonctionne pas')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await user.send({
                        embeds: [dmEmbed],
                        components: [feedbackRow]
                    });
                } catch (err) {
                    dmSent = false;
                    console.error(`Erreur DM à ${user.tag}:`, err);
                }

                const responseEmbed = new EmbedBuilder();

                if (dmSent) {
                    responseEmbed
                        .setTitle('📩 Message Privé Envoyé !')
                        .setDescription(`Regardez vos **Messages Privés (DMs)** ! Votre compte **${serviceName}** y a été envoyé.`)
                        .setColor('#57F287');

                    if (guild) {
                        const logGenEmbed = new EmbedBuilder()
                            .setTitle('⚡ Compte Généré')
                            .setDescription([
                                `👤 **Membre :** <@${user.id}> (\`${user.tag}\`)`,
                                `🛒 **Service :** **${serviceName}**`,
                                `🔑 **Compte Généré :**`,
                                '```',
                                realAccountCombo,
                                '```'
                            ].join('\n'))
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
    } catch (err) {
        console.error('Erreur Interaction (handled) :', err);
    }
});

client.login(process.env.DISCORD_TOKEN);
