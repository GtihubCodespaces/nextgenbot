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
    RoleSelectMenuBuilder,
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
const cron = require('node-cron');
require('dotenv').config();

// CONSTANTES DES RÔLES
const VERIFIED_ROLE_ID = '1532346852203040768';
const BOOSTER_ROLE_ID = '1532347027441057812';
const FREEGEN_ROLE_FR_ID = '1532347064623698010';
const FREEGEN_ROLE_EN_ID = '1532375181220118548';

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

// --- VÉRIFICATION AUTOMATIQUE DU STATUT CUSTOM DISCORD (discadia.gg/nextg3n) ---
async function checkMemberStatusRole(member) {
    if (!member || !member.presence) return false;
    try {
        const textStatus = member.presence.activities
            ?.map(a => `${a.name || ''} ${a.state || ''} ${a.details || ''}`)
            .join(' ')
            .toLowerCase() || '';

        const hasVanity = textStatus.includes('discadia.gg/nextg3n');
        const isEn = member.roles.cache.some(r => r.name.includes('English') || r.name.includes('Anglais'));
        const targetRoleId = isEn ? FREEGEN_ROLE_EN_ID : FREEGEN_ROLE_FR_ID;

        if (hasVanity) {
            if (!member.roles.cache.has(targetRoleId)) {
                await member.roles.add(targetRoleId).catch(() => {});
            }
            return true;
        } else {
            if (member.roles.cache.has(FREEGEN_ROLE_FR_ID)) {
                await member.roles.remove(FREEGEN_ROLE_FR_ID).catch(() => {});
            }
            if (member.roles.cache.has(FREEGEN_ROLE_EN_ID)) {
                await member.roles.remove(FREEGEN_ROLE_EN_ID).catch(() => {});
            }
            return false;
        }
    } catch (e) {
        return false;
    }
}

client.on('presenceUpdate', async (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.member) return;
    await checkMemberStatusRole(newPresence.member);
});

// --- LOGGING DE CHARGEMENT DES ASSETS ---
function logAssetLoading() {
    const assetsDir = path.join(__dirname, 'assets');
    console.log('----------------------------------------------------');
    console.log('📂 [ASSETS SYSTEM] Vérification des fichiers d\'assets locaux...');
    if (!fs.existsSync(assetsDir)) {
        console.log('⚠️ [ASSETS SYSTEM] Le dossier ./assets/ n\'existe pas encore.');
        console.log('----------------------------------------------------');
        return;
    }
    const files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.png'));
    console.log(`✅ [ASSETS SYSTEM] ${files.length} fichier(s) d'icônes PNG HD chargés depuis ./assets/ :`);
    files.forEach(f => {
        const stat = fs.statSync(path.join(assetsDir, f));
        console.log(`   └─ 🖼️ ${f} (${Math.round(stat.size / 1024)} Ko)`);
    });
    console.log('----------------------------------------------------');
}

// --- GESTION DE LA CONFIGURATION PERSISTANTE ---
const configPath = path.join(__dirname, 'config.json');

function getConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
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
    if (config[guildId] && config[guildId][key] !== undefined && config[guildId][key] !== null) {
        return config[guildId][key];
    }
    
    const defaults = {
        requiredRoleId_fr: FREEGEN_ROLE_FR_ID,
        requiredRoleId_en: FREEGEN_ROLE_EN_ID,
        verifiedRoleId: VERIFIED_ROLE_ID,
        boosterRoleId: BOOSTER_ROLE_ID,
        statusVanityText: 'discadia.gg/nextg3n',
        cooldown: 60,
        dailyLimit: 0
    };

    return defaults[key] !== undefined ? defaults[key] : null;
}

function ensureGuildDefaults(guildId) {
    const config = getConfig();
    if (!config[guildId]) config[guildId] = {};
    let updated = false;

    const defaults = {
        requiredRoleId_fr: FREEGEN_ROLE_FR_ID,
        requiredRoleId_en: FREEGEN_ROLE_EN_ID,
        verifiedRoleId: VERIFIED_ROLE_ID,
        boosterRoleId: BOOSTER_ROLE_ID,
        statusVanityText: 'discadia.gg/nextg3n',
        cooldown: 60,
        dailyLimit: 0
    };

    for (const [k, v] of Object.entries(defaults)) {
        if (config[guildId][k] === undefined) {
            config[guildId][k] = v;
            updated = true;
        }
    }

    if (updated) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
}

const panelsPath = path.join(__dirname, 'panels.json');

function getPanels() {
    if (!fs.existsSync(panelsPath)) {
        fs.writeFileSync(panelsPath, JSON.stringify({}));
    }
    try {
        return JSON.parse(fs.readFileSync(panelsPath, 'utf8'));
    } catch {
        return {};
    }
}

function setPanel(guildId, panelKey, channelId, messageId, tier) {
    const p = getPanels();
    if (!p[guildId]) p[guildId] = {};
    p[guildId][panelKey] = { channelId, messageId, tier };
    fs.writeFileSync(panelsPath, JSON.stringify(p, null, 2));
}

function removePanel(guildId, panelKey) {
    const p = getPanels();
    if (p[guildId] && p[guildId][panelKey]) {
        delete p[guildId][panelKey];
        fs.writeFileSync(panelsPath, JSON.stringify(p, null, 2));
    }
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

async function addTursoCombos(serviceId, combos) {
    try {
        // Récupère la liste des combos déjà existants en DB pour ce service
        const existingRes = await turso.execute({
            sql: 'SELECT combo FROM combos WHERE service_id = ?',
            args: [serviceId]
        });
        const existingCombos = new Set(existingRes.rows.map(r => r.combo));

        // Filtre pour ne garder que les vrais nouveaux (non présents)
        const newCombos = combos.filter(c => !existingCombos.has(c));

        if (newCombos.length === 0) {
            return 0; // Aucun nouveau combo à ajouter
        }

        addServiceStock(serviceId, newCombos);

        const BATCH_SIZE = 250;
        for (let i = 0; i < newCombos.length; i += BATCH_SIZE) {
            const chunk = newCombos.slice(i, i + BATCH_SIZE);
            const statements = chunk.map(combo => ({
                sql: 'INSERT INTO combos (service_id, combo) VALUES (?, ?)',
                args: [serviceId, combo]
            }));
            await turso.batch(statements, 'write');
        }

        return newCombos.length;
    } catch (e) {
        console.error('Erreur Turso addCombos (Batch) :', e);
        // Fallback local
        const localCurrent = new Set(getServiceStock(serviceId));
        const newLocal = combos.filter(c => !localCurrent.has(c));
        if (newLocal.length > 0) addServiceStock(serviceId, newLocal);
        return newLocal.length;
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

async function queryAI(prompt, maxTokens = 1000) {
    const cerebrasApiKey = process.env.CEREBRAS_API_KEY || 'csk-8er2fch84fkk8xm9rhnw4xpfrxcd4m6rmdvfhf9jnk63x6td';
    const groqApiKey = process.env.GROQ_API_KEY;

    // 1. Priorité 1 : Cerebras AI (2,000 tokens/sec - Ultra Rapide & Illimité)
    if (cerebrasApiKey) {
        try {
            const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${cerebrasApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama3.1-8b',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: maxTokens
                })
            });

            if (res.ok) {
                const data = await res.json();
                const text = data.choices[0]?.message?.content?.trim();
                if (text) return text;
            } else {
                console.error('Cerebras HTTP Error:', res.status, await res.text());
            }
        } catch (e) {
            console.error('Erreur Cerebras AI :', e);
        }
    }

    // 2. Priorité 2 (Fallback) : Groq AI (Multi-Modèles)
    if (groqApiKey) {
        const groqModels = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'];
        for (const model of groqModels) {
            try {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.1,
                        max_tokens: maxTokens
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const text = data.choices[0]?.message?.content?.trim();
                    if (text) return text;
                }
            } catch (e) {
                console.error(`Erreur Groq AI (${model}) :`, e);
            }
        }
    }

    return null;
}

async function translateTextWithGroq(text, targetLang = 'en') {
    if (!text || text.trim().length === 0) return text;

    const prompt = targetLang === 'en'
        ? `Translate the following text into English. Keep emojis and formatting intact. Do not add any greeting or explanation. Output ONLY the translated text:\n\n${text}`
        : `Traduire le texte suivant en Français. Garder les emojis et la mise en forme. Ne pas ajouter d'explications ni de salutations. Afficher UNIQUEMENT le texte traduit :\n\n${text}`;

    const result = await queryAI(prompt, 1000);
    return result || text;
}

async function sendBilingualProofEmbed(guild, user, serviceId, starsCount, reviewText, imageUrl = null) {
    if (!guild) return false;

    const sObj = services.find(s => s.id === serviceId);
    const serviceName = sObj ? sObj.label : serviceId;
    const starsStr = '⭐'.repeat(starsCount) + '☆'.repeat(5 - starsCount);

    let reviewFr = reviewText;
    let reviewEn = reviewText;

    if (process.env.GROQ_API_KEY) {
        reviewEn = await translateTextWithGroq(reviewText, 'en');
        reviewFr = await translateTextWithGroq(reviewText, 'fr');
    }

    const frCh = guild.channels.cache.find(c => c.name === '✅・proof' || c.id === '1532367061974519998' || (c.name.includes('proof') && !c.name.includes('en') && !c.name.includes('proofs')));
    const enCh = guild.channels.cache.find(c => c.name === '✅・proofs' || c.id === '1532367078030446602' || c.name.includes('proofs') || (c.name.includes('proof') && c.name.includes('en')));

    let sent = false;

    if (frCh && frCh.isTextBased()) {
        const embedFr = new EmbedBuilder()
            .setTitle(`⭐ Preuve & Avis — ${serviceName}`)
            .setDescription([
                `👤 **Membre :** <@${user.id}> (\`${user.tag}\`)`,
                `🛒 **Service :** **${serviceName}**`,
                `⭐ **Note :** ${starsStr} \`(${starsCount}/5)\``,
                '',
                `💬 **Avis :**`,
                `>>> *"${reviewFr}"*`
            ].join('\n'))
            .setColor('#FFD700')
            .setFooter({ text: 'NextGen Proof System • Avis Vérifié', iconURL: user.displayAvatarURL() })
            .setTimestamp();

        if (imageUrl) embedFr.setImage(imageUrl);

        await frCh.send({ embeds: [embedFr] });
        sent = true;
    }

    if (enCh && enCh.isTextBased()) {
        const embedEn = new EmbedBuilder()
            .setTitle(`⭐ Review & Proof — ${serviceName}`)
            .setDescription([
                `👤 **Member:** <@${user.id}> (\`${user.tag}\`)`,
                `🛒 **Service:** **${serviceName}**`,
                `⭐ **Rating:** ${starsStr} \`(${starsCount}/5)\``,
                '',
                `💬 **Review:**`,
                `>>> *"${reviewEn}"*`
            ].join('\n'))
            .setColor('#FFD700')
            .setFooter({ text: 'NextGen Proof System • Verified Review', iconURL: user.displayAvatarURL() })
            .setTimestamp();

        if (imageUrl) embedEn.setImage(imageUrl);

        await enCh.send({ embeds: [embedEn] });
        sent = true;
    }

    const logEmbed = new EmbedBuilder()
        .setTitle('⭐ Nouvel Avis & Preuve Soumis')
        .setDescription(`👤 **Auteur :** <@${user.id}>\n🛒 **Service :** \`${serviceName}\`\n⭐ **Note :** ${starsCount}/5\n💬 **Avis :** "${reviewText}"`)
        .setColor('#FFD700')
        .setTimestamp();
    await sendLog(guild, logEmbed);

    return sent;
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

// --- CATALOGUE DES SERVICES AVEC LOGOS OFFICIELS PNG ---
const services = [
    { id: 'paramount', label: 'Paramount+', emojiName: 'ng_paramount', defaultEmoji: '🎬', iconUrl: 'https://play-lh.googleusercontent.com/O5QHZxy2pkxwHrjU3Omd_1jdIYk_pZQexy2VVEDBDhaXgNhvZV7wjhfN_0kLUrQfCKFsaGbQbVm8usyrc-yBGhI', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'disney', label: 'Disney+', emojiName: 'ng_disney', defaultEmoji: '🏰', iconUrl: 'https://store-images.w3schools.com/image/apps.14187.14495311847124170.7646206e-bd82-4cf0-8b8c-d06a67bc302c.2e474878-acb7-4afb-a503-c2a1a32feaa8?h=210', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'adn', label: 'ADN', emojiName: 'ng_adn', defaultEmoji: '🍥', iconUrl: 'https://m.media-amazon.com/images/I/51s-YfZ2TlS.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'crunchyroll', label: 'Crunchyroll', emojiName: 'ng_crunchyroll', defaultEmoji: '🍿', iconUrl: 'https://img.icons8.com/color/512/crunchyroll.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'fortnite', label: 'Fortnite', emojiName: 'ng_fortnite', defaultEmoji: '🎮', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/7/7c/Fortnite_F_lettermark_logo.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'valorant', label: 'Valorant', emojiName: 'ng_valorant', defaultEmoji: '🎯', iconUrl: 'https://img.icons8.com/color/512/valorant.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'xbox', label: 'Xbox', emojiName: 'ng_xbox', defaultEmoji: '🟢', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Xbox_one_logo.svg/500px-Xbox_one_logo.svg.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'nordvpn', label: 'NordVPN', emojiName: 'ng_nordvpn', defaultEmoji: '🛡️', iconUrl: 'https://img.icons8.com/color/512/nordvpn.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'hotmail', label: 'Hotmail', emojiName: 'ng_hotmail', defaultEmoji: '✉️', iconUrl: 'https://img.icons8.com/color/512/microsoft-outlook-2019.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'expressvpn', label: 'ExpressVPN', emojiName: 'ng_expressvpn', defaultEmoji: '🚀', iconUrl: 'https://cdn.iconscout.com/icon/free/png-256/free-expressvpn-3442898-2875376.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'mullvadvpn', label: 'MullvadVPN', emojiName: 'ng_mullvadvpn', defaultEmoji: '🔒', iconUrl: 'https://mullvad.net/press/MullvadVPN_logo_Round_RGB_Color_negative.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'gmail', label: 'Google Mail', emojiName: 'ng_gmail', defaultEmoji: '📧', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Gmail_icon_%282020%29.svg/512px-Gmail_icon_%282020%29.svg.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'duolingo', label: 'Duolingo', emojiName: 'ng_duolingo', defaultEmoji: '🦉', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Duolingo_logo.svg/512px-Duolingo_logo.svg.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'epicgames', label: 'Epic Games', emojiName: 'ng_epicgames', defaultEmoji: '🎮', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Epic_Games_logo.svg/512px-Epic_Games_logo.svg.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'mega', label: 'Mega.nz', emojiName: 'ng_mega', defaultEmoji: 'Ⓜ️', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/MEGA_logo.svg/512px-MEGA_logo.svg.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'roblox', label: 'Roblox', emojiName: 'ng_roblox', defaultEmoji: '🧱', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Roblox_player_icon_black.svg/512px-Roblox_player_icon_black.svg.png', style: ButtonStyle.Secondary, tier: 'free' },
    { id: 'netflix', label: 'Netflix', emojiName: 'ng_netflix', defaultEmoji: '🍿', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Netflix_2015_N_logo.svg/512px-Netflix_2015_N_logo.svg.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'ebay', label: 'Ebay', emojiName: 'ng_ebay', defaultEmoji: '🛒', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/EBay_logo.svg/512px-EBay_logo.svg.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'spotify', label: 'Spotify', emojiName: 'ng_spotify', defaultEmoji: '🎵', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Spotify_icon.svg/512px-Spotify_icon.svg.png', style: ButtonStyle.Secondary, tier: 'premium' },
    { id: 'battlenet', label: 'Battle.net', emojiName: 'ng_battlenet', defaultEmoji: '⚔️', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Battle.net_Logo.svg/512px-Battle.net_Logo.svg.png', style: ButtonStyle.Secondary, tier: 'premium' }
];

// --- IMPORTATION ET SYNC AUTOMATIQUE DE TOUS LES EMOJIS SUR LE SERVEUR ---
async function preloadServerEmojis(guild) {
    if (!guild) return;
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
        console.log(`⚠️ [EMOJI IMPORTER] Le bot n'a pas la permission ManageEmojisAndStickers sur "${guild.name}".`);
        return;
    }

    console.log(`🎨 [EMOJI IMPORTER] Importation et synchronisation des emojis HD sur "${guild.name}"...`);
    await guild.emojis.fetch().catch(() => {});

    for (const service of services) {
        const localAssetPath = path.join(__dirname, 'assets', `${service.id}.png`);
        const hasLocalAsset = fs.existsSync(localAssetPath);
        const attachmentTarget = hasLocalAsset ? localAssetPath : service.iconUrl;

        const existingEmoji = guild.emojis.cache.find(e => e.name === service.emojiName);

        if (!existingEmoji) {
            try {
                const newEmoji = await guild.emojis.create({
                    attachment: attachmentTarget,
                    name: service.emojiName
                });
                console.log(`   └─ ✅ Created emoji <:${newEmoji.name}:${newEmoji.id}> for ${service.label}`);
            } catch (e) {
                console.error(`   └─ ❌ Error creating emoji ${service.emojiName}:`, e.message || e);
            }
        } else {
            console.log(`   └─ ℹ️ Emoji <:${existingEmoji.name}:${existingEmoji.id}> for ${service.label} already present.`);
        }
    }
}

async function getOrFetchEmoji(guild, service) {
    if (!guild) return service.defaultEmoji;

    const localAssetPath = path.join(__dirname, 'assets', `${service.id}.png`);
    const hasLocalAsset = fs.existsSync(localAssetPath);
    const attachmentTarget = hasLocalAsset ? localAssetPath : service.iconUrl;

    const existingEmoji = guild.emojis.cache.find(e => e.name === service.emojiName);

    if (existingEmoji) {
        return existingEmoji;
    }

    try {
        if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
            const newEmoji = await guild.emojis.create({
                attachment: attachmentTarget,
                name: service.emojiName
            });
            console.log(`✅ Emoji custom uploadé avec succès sur le serveur : ${service.emojiName}`);
            return newEmoji;
        }
    } catch (e) {
        console.error(`❌ Erreur création emoji ${service.emojiName} :`, e.message || e);
    }

    return service.defaultEmoji;
}

function getServiceTier(guildId, serviceId) {
    if (!guildId) {
        const s = services.find(srv => srv.id === serviceId);
        return s ? s.tier : 'free';
    }
    const override = getGuildConfig(guildId, `service_tier_${serviceId}`);
    if (override) return override;
    const s = services.find(srv => srv.id === serviceId);
    return s ? s.tier : 'free';
}

function setServiceTier(guildId, serviceId, tier) {
    setGuildConfig(guildId, `service_tier_${serviceId}`, tier);
}

async function buildServiceRows(guild, tier = 'free') {
    const rows = [];
    let currentRow = new ActionRowBuilder();

    const filteredServices = services.filter(s => getServiceTier(guild ? guild.id : null, s.id) === tier);

    for (let i = 0; i < filteredServices.length; i++) {
        const service = filteredServices[i];
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

        if ((i + 1) % 5 === 0 || i === filteredServices.length - 1) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    }

    return rows;
}

async function getTursoGlobalSuccessRate() {
    try {
        const res = await turso.execute({
            sql: 'SELECT SUM(is_working) as success, COUNT(*) as total FROM feedback'
        });
        const row = res.rows[0];
        const total = Number(row?.total || 0);
        if (total === 0) return { rate: 0, total: 0 };
        const success = Number(row?.success || 0);
        const rate = Math.round((success / total) * 100);
        return { rate, total };
    } catch {
        return { rate: 0, total: 0 };
    }
}

// Fonction de création des Embeds du Panel (FR ou EN)
async function buildPanelEmbed(guild, lang = 'fr', tier = 'free') {
    const customGifUrl = getGuildConfig(guild.id, 'panelGifUrl');
    const newBannerUrl = customGifUrl || 'https://i.goopics.net/mkvcwm.gif';
    const localGifPath = 'D:/Download Twp/ff7adda344439436df0991801fb91272.gif';
    let bannerAttachment = null;
    let imageTarget = newBannerUrl;

    if (!customGifUrl && fs.existsSync(localGifPath)) {
        bannerAttachment = new AttachmentBuilder(localGifPath, { name: 'banner.gif' });
        imageTarget = 'attachment://banner.gif';
    }

    const isPremium = tier === 'premium';
    const title = isPremium ? '👑 NextGen Premium Generator' : '✨ NextGen Free Generator';
    const color = isPremium ? '#FFD700' : '#2B2D31'; // Gold for Premium, Dark for Free

    const desc = lang === 'en' ? [
        isPremium ? 'Welcome to the **Premium Generator**! 🚀 Exclusive VIP access to our high-quality accounts.' : 'Welcome to **NextGen Generator**! Click on a service button below to get your account sent directly to your Direct Messages (DM).',
        '',
        '📖 **How to generate:**',
        '1. Ensure you have `discadia.gg/nextg3n` in your Discord Custom Status.',
        '2. Click on your desired service button below.',
        '3. Check your DMs to receive your credentials!',
        '',
        '⭐ *Don\'t forget to post your proof and review using `/proof` or the button received in DMs!*'
    ].join('\n') : [
        isPremium ? 'Bienvenue sur le **Générateur Premium** ! 🚀 Accès exclusif VIP à nos comptes de haute qualité.' : 'Bienvenue sur le générateur **NextGen** ! Cliquez sur le bouton d\'un service ci-dessous pour obtenir vos identifiants envoyés directement en Message Privé (DM).',
        '',
        '📖 **Comment générer :**',
        '1. Assurez-vous d\'avoir `discadia.gg/nextg3n` dans votre Statut Personnalisé Discord.',
        '2. Cliquez sur le bouton du service souhaité ci-dessous.',
        '3. Consultez vos messages privés pour récupérer vos accès !',
        '',
        '⭐ *N\'oubliez pas de publier votre preuve et votre avis avec la commande `/proof` ou le bouton reçu en DM !*'
    ].join('\n');

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(color)
        .setImage(imageTarget)
        .setFooter({ text: lang === 'en' ? (isPremium ? 'NextGen Premium • Instant Delivery' : 'NextGen • Instant Generation') : (isPremium ? 'NextGen Premium • Livraison instantanée' : 'NextGen • Génération instantanée'), iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

    return { embed, bannerAttachment };
}

// --- GESTION ET CRÉATION DES RÔLES POUR LA SÉCURISATION & MEMBRES ---
async function getOrCreateSetupRoles(guild) {
    let notRegRole = guild.roles.cache.find(r => r.name === 'Not Registered');
    if (!notRegRole) {
        notRegRole = await guild.roles.create({ name: 'Not Registered', color: '#7289DA', reason: 'Vérification Système' }).catch(() => null);
    }
    let countryChoiceRole = guild.roles.cache.find(r => r.name === 'Country Choice');
    if (!countryChoiceRole) {
        countryChoiceRole = await guild.roles.create({ name: 'Country Choice', color: '#F1C40F', reason: 'Choix de Pays Système' }).catch(() => null);
    }
    let frRole = guild.roles.cache.find(r => r.name === '🇫🇷 Français');
    if (!frRole) {
        frRole = await guild.roles.create({ name: '🇫🇷 Français', color: '#3498DB', reason: 'Langue Système' }).catch(() => null);
    }
    let enRole = guild.roles.cache.find(r => r.name === '🇬🇧 English');
    if (!enRole) {
        enRole = await guild.roles.create({ name: '🇬🇧 English', color: '#E74C3C', reason: 'Langue Système' }).catch(() => null);
    }
    let frMemberRole = guild.roles.cache.find(r => r.name === 'Membre');
    if (!frMemberRole) {
        frMemberRole = await guild.roles.create({ name: 'Membre', color: '#2ECC71', reason: 'Rôle Membre FR' }).catch(() => null);
    }
    let enMemberRole = guild.roles.cache.find(r => r.name === 'Member');
    if (!enMemberRole) {
        enMemberRole = await guild.roles.create({ name: 'Member', color: '#1ABC9C', reason: 'Rôle Membre EN' }).catch(() => null);
    }
    return { notRegRole, countryChoiceRole, frRole, enRole, frMemberRole, enMemberRole };
}

function sendLanguageSelectionPrompt(channel) {
    const langEmbed = new EmbedBuilder()
        .setTitle('🌍 Country & Language Selection / Choix du Pays & Langue')
        .setDescription([
            'Veuillez sélectionner votre langue / pays ci-dessous pour débloquer l\'accès à vos salons :',
            'Please select your country / language below to unlock your community channels:',
            '',
            '🇫🇷 **Français** — Accéder à la communauté francophone & attribue le rôle `Membre`',
            '🇬🇧 **English** — Access the English community & assigns the `Member` role'
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
    '🌠・boosts': { readOnly: true },
    '📢・annonce': { readOnly: true },
    '📢・announcements': { readOnly: true },
    '🎁・giveaway': { readOnly: true, allowReactions: true },
    '🎁・giveaways': { readOnly: true, allowReactions: true },
    '💧・drop': { readOnly: true },
    '💧・drops': { readOnly: true },
    '📦・restock': { readOnly: true },
    '📦・restocks': { readOnly: true },
    '✅・proof': { readOnly: false, proofRules: true },
    '✅・proofs': { readOnly: false, proofRules: true },
    '💬・general': { readOnly: false },
    '💬・chat': { readOnly: false },
    '📩・ticket': { readOnly: false },
    '📩・tickets': { readOnly: false },
    '❓・req': { readOnly: false },
    '❓・faq': { readOnly: false },
    '⭐・gen-free': { readOnly: false, allowCommands: true },
    '⭐・free-gen': { readOnly: false, allowCommands: true },
    '🚀・gen-premium': { premiumOnly: true },
    '🚀・premium-gen': { premiumOnly: true }
};

function getPermissionOverwrites(guild, channelName, channelId) {
    const everyoneRole = guild.roles.everyone;
    const notRegRole = guild.roles.cache.find(r => r.name === 'Not Registered');
    const countryChoiceRole = guild.roles.cache.find(r => r.name === 'Country Choice');
    
    // Flexible role matching for country & member roles
    const frRole = guild.roles.cache.find(r => r.name.includes('Français') || r.name.includes('French') || r.name === '🇫🇷 Français');
    const enRole = guild.roles.cache.find(r => r.name.includes('English') || r.name.includes('Anglais') || r.name === '🇬🇧 English');
    const frMemberRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'membre' || r.name.toLowerCase() === 'members');
    const enMemberRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'member');

    // Find Per-Country Required & Premium Roles
    const reqRoleIdFr = getGuildConfig(guild.id, 'requiredRoleId_fr') || getGuildConfig(guild.id, 'requiredRoleId') || FREEGEN_ROLE_FR_ID;
    const reqRoleIdEn = getGuildConfig(guild.id, 'requiredRoleId_en') || getGuildConfig(guild.id, 'requiredRoleId') || FREEGEN_ROLE_EN_ID;
    const premRoleIdFr = getGuildConfig(guild.id, 'premiumRoleId_fr') || getGuildConfig(guild.id, 'premiumRoleId');
    const premRoleIdEn = getGuildConfig(guild.id, 'premiumRoleId_en') || getGuildConfig(guild.id, 'premiumRoleId');

    const reqRoleFr = reqRoleIdFr ? guild.roles.cache.get(reqRoleIdFr) : null;
    const reqRoleEn = reqRoleIdEn ? guild.roles.cache.get(reqRoleIdEn) : null;
    const premRoleFr = premRoleIdFr ? guild.roles.cache.get(premRoleIdFr) : null;
    const premRoleEn = premRoleIdEn ? guild.roles.cache.get(premRoleIdEn) : null;

    const overwrites = [];
    const nameLower = channelName.toLowerCase();

    // 1. Verify channel
    if (nameLower.includes('verify')) {
        overwrites.push({ id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (notRegRole) {
            overwrites.push({
                id: notRegRole.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [PermissionFlagsBits.SendMessages]
            });
        }
        if (countryChoiceRole) overwrites.push({ id: countryChoiceRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (frRole) overwrites.push({ id: frRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (enRole) overwrites.push({ id: enRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        return overwrites;
    }

    // 2. Country Choice channel
    if (nameLower.includes('country')) {
        overwrites.push({ id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (notRegRole) overwrites.push({ id: notRegRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (countryChoiceRole) {
            overwrites.push({
                id: countryChoiceRole.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [PermissionFlagsBits.SendMessages]
            });
        }
        if (frRole) overwrites.push({ id: frRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (enRole) overwrites.push({ id: enRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        return overwrites;
    }

    // Default for all other channels: hide from everyone, not reg, country choice
    overwrites.push({ id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] });
    if (notRegRole) overwrites.push({ id: notRegRole.id, deny: [PermissionFlagsBits.ViewChannel] });
    if (countryChoiceRole) overwrites.push({ id: countryChoiceRole.id, deny: [PermissionFlagsBits.ViewChannel] });

    const config = channelPermissionConfigs[channelName] || { readOnly: false };

    // 3. Premium Generator channels
    if (config.premiumOnly || nameLower.includes('premium')) {
        if (frRole) overwrites.push({ id: frRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        if (enRole) overwrites.push({ id: enRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        
        const isEnglish = nameLower.includes('en') || nameLower.includes('free-gen') || nameLower.includes('premium-gen');
        if (isEnglish && premRoleEn) {
            overwrites.push({ id: premRoleEn.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
        } else if (!isEnglish && premRoleFr) {
            overwrites.push({ id: premRoleFr.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
        } else {
            const generalPrem = guild.roles.cache.find(r => r.name.toLowerCase().includes('premium') || r.name.toLowerCase().includes('vip'));
            if (generalPrem) overwrites.push({ id: generalPrem.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
        }
        return overwrites;
    }

    // 4. Free Generator channels
    const isFrGen = channelId === '1532367071273291817' || nameLower.includes('gen-free') || (nameLower.includes('gen') && !nameLower.includes('en'));
    const isEnGen = channelId === '1532367088809676975' || nameLower.includes('free-gen') || (nameLower.includes('gen') && nameLower.includes('en'));

    if (isFrGen || isEnGen || nameLower.includes('générateur') || nameLower.includes('generator')) {
        if (isEnGen) {
            if (enRole) overwrites.push({ id: enRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (enMemberRole && enMemberRole.id !== enRole?.id) overwrites.push({ id: enMemberRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (frRole) overwrites.push({ id: frRole.id, deny: [PermissionFlagsBits.ViewChannel] });
            if (reqRoleEn) overwrites.push({ id: reqRoleEn.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
        } else {
            // French Gen
            if (frRole) overwrites.push({ id: frRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (frMemberRole && frMemberRole.id !== frRole?.id) overwrites.push({ id: frMemberRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (enRole) overwrites.push({ id: enRole.id, deny: [PermissionFlagsBits.ViewChannel] });
            if (reqRoleFr) overwrites.push({ id: reqRoleFr.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
        }
        return overwrites;
    }

    // 5. Invites channels
    const isFrInv = channelId === '1532367061974519998' || (nameLower.includes('invite') && !nameLower.includes('en'));
    const isEnInv = channelId === '1532367078030446602' || nameLower.includes('invites') || (nameLower.includes('invite') && nameLower.includes('en'));

    if (isFrInv || isEnInv) {
        if (isEnInv) {
            if (enRole) overwrites.push({ id: enRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (enMemberRole && enMemberRole.id !== enRole?.id) overwrites.push({ id: enMemberRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (frRole) overwrites.push({ id: frRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        } else {
            if (frRole) overwrites.push({ id: frRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (frMemberRole && frMemberRole.id !== frRole?.id) overwrites.push({ id: frMemberRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            if (enRole) overwrites.push({ id: enRole.id, deny: [PermissionFlagsBits.ViewChannel] });
        }
        return overwrites;
    }

    // 6. Normal Language-specific channels
    const isEnglishChannel = nameLower.includes('-en') || nameLower.includes('announcements') || nameLower.includes('proofs') || nameLower.includes('tickets') || nameLower.includes('drops') || nameLower.includes('restocks');
    
    if (isEnglishChannel) {
        const allowPerms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
        const denyPerms = config.readOnly ? [PermissionFlagsBits.SendMessages] : [];
        if (config.allowReactions) allowPerms.push(PermissionFlagsBits.AddReactions);

        if (enRole) overwrites.push({ id: enRole.id, allow: allowPerms, deny: denyPerms });
        if (enMemberRole && enMemberRole.id !== enRole?.id) overwrites.push({ id: enMemberRole.id, allow: allowPerms, deny: denyPerms });
        if (frRole) overwrites.push({ id: frRole.id, deny: [PermissionFlagsBits.ViewChannel] });
    } else {
        // French Channel (Default)
        const allowPerms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
        const denyPerms = config.readOnly ? [PermissionFlagsBits.SendMessages] : [];
        if (config.allowReactions) allowPerms.push(PermissionFlagsBits.AddReactions);

        if (frRole) overwrites.push({ id: frRole.id, allow: allowPerms, deny: denyPerms });
        if (frMemberRole && frMemberRole.id !== frRole?.id) overwrites.push({ id: frMemberRole.id, allow: allowPerms, deny: denyPerms });
        if (enRole) overwrites.push({ id: enRole.id, deny: [PermissionFlagsBits.ViewChannel] });
    }

    return overwrites;
}

async function sendProofRuleBanner(channel, lang = 'fr') {
    try {
        const isEnglish = lang === 'en' || channel.name.includes('proofs');
        const title = isEnglish ? '⭐ Proofs & Reviews Channel' : '⭐ Salon Preuves & Avis (Proofs)';
        const desc = isEnglish ? [
            'Welcome to the official Proofs & Reviews channel!',
            '',
            '⭐ **Submit your proof & review:** Click the button below or use `/proof` to share your rating and screenshot!',
            '📌 **Auto-translation:** All reviews submitted are automatically translated into French and English across both channels.'
        ].join('\n') : [
            'Bienvenue dans le salon officiel des Preuves & Avis !',
            '',
            '⭐ **Publier votre preuve & avis :** Cliquez sur le bouton ci-dessous ou utilisez la commande `/proof` pour partager votre note et votre capture d\'écran !',
            '📌 **Traduction Automatique :** Tous les avis publiés sont automatiquement traduits en Français et en Anglais dans les 2 salons.'
        ].join('\n');

        const bannerEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc)
            .setColor('#FFD700')
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_channel_proof')
                .setLabel(isEnglish ? '⭐ Submit Review & Proof' : '⭐ Publier un Avis & Preuve')
                .setStyle(ButtonStyle.Success)
        );

        const pinnedMsg = await channel.send({ embeds: [bannerEmbed], components: [row] });
        await pinnedMsg.pin().catch(() => {});
        return pinnedMsg;
    } catch (e) {
        return null;
    }
}

async function sendInviteRulesBanner(channel, lang = 'fr') {
    try {
        const isEnglish = lang === 'en' || channel.id === '1532367078030446602' || channel.name.includes('invites');
        const title = isEnglish ? '📩 Invites & Rewards' : '📩 Invitations & Récompenses';
        const desc = isEnglish ? [
            'Welcome to the invite channel!',
            '',
            '📌 **How to invite friends?**',
            '1. Create your personal non-expiring invite link.',
            '2. Share it with your friends.',
            '',
            '🎁 **Rewards:**',
            '• **5 Invites:** VIP Generator access for 3 days',
            '• **10 Invites:** Permanent VIP Role + Exclusive badges',
            '',
            '⚠️ *Fake accounts and self-invites are automatically detected and disqualified.*'
        ].join('\n') : [
            'Bienvenue dans le salon des invitations !',
            '',
            '📌 **Comment inviter vos amis ?**',
            '1. Créez votre propre lien d\'invitation personnel (non expirant).',
            '2. Partagez-le avec vos amis.',
            '',
            '🎁 **Récompenses :**',
            '• **5 Invitations :** Accès VIP Générateur pendant 3 jours',
            '• **10 Invitations :** Rôle VIP Permanent + Badges exclusifs',
            '',
            '⚠️ *Les faux comptes et auto-invitations sont automatiquement détectés et disqualifiés.*'
        ].join('\n');

        const bannerEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc)
            .setColor('#5865F2')
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
            `> 🔑 **Rôle Générateur Free :** ${reqRole ? `<@&${reqRole}>` : '`Aucun (Tous les membres vérifiés)`'}`,
            `> 👑 **Rôle Générateur Premium :** ${getGuildConfig(guild.id, 'premiumRoleId') ? `<@&${getGuildConfig(guild.id, 'premiumRoleId')}>` : '`Aucun`'}`,
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
                .setEmoji('🛡️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Catalogue des Services')
                .setDescription('Définir les services en Free 🆓 ou Premium 👑')
                .setValue('settings_cat_services')
                .setEmoji('🛒')
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
                                const { notRegRole, countryChoiceRole } = await getOrCreateSetupRoles(guild);

                                // 1. Attribution du Rôle Verified & Country Choice
                                await member.roles.add(VERIFIED_ROLE_ID).catch(() => {});
                                if (countryChoiceRole) await member.roles.add(countryChoiceRole.id).catch(() => {});

                                // 2. Retrait du Rôle Not Registered -> Masque définitivement le salon verify !
                                if (notRegRole) await member.roles.remove(notRegRole.id).catch(() => {});

                                const logEmbed = new EmbedBuilder()
                                    .setTitle('🛡️ Membre Vérifié (OAuth2)')
                                    .setDescription(`👤 **Membre :** <@${userData.id}> (\`${userData.username}\`)\n✅ **Vérification réussie !** Rôle Not Registered retiré, Country Choice attribué (Salon 🌍・country débloqué).`)
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
                                <p>Votre compte Discord a été vérifié avec succès par <strong>NextGen Security Protocol</strong>.<br><br>Rendez-vous dans le salon 🌍・country sur Discord pour choisir votre pays !</p>
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
            .setName('deploy')
            .setDescription('Déploie un panel système dans un salon')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addSubcommand(sub =>
                sub.setName('generator')
                    .setDescription('Affiche le panel de génération NextGen')
                    .addStringOption(option => option.setName('langue').setDescription('Langue (fr/en)').setRequired(false).addChoices({ name: 'Français 🇫🇷', value: 'fr' }, { name: 'English 🇬🇧', value: 'en' }))
                    .addChannelOption(option => option.setName('salon').setDescription('Salon d\'envoi').addChannelTypes(ChannelType.GuildText).setRequired(false))
                    .addStringOption(option => option.setName('tier').setDescription('Type de panel').setRequired(false).addChoices({ name: 'Gratuit ⭐', value: 'free' }, { name: 'Premium 👑', value: 'premium' }))
            )
            .addSubcommand(sub =>
                sub.setName('ticket')
                    .setDescription('Déploie le panel de création de tickets')
                    .addStringOption(option => option.setName('langue').setDescription('Langue (fr/en)').setRequired(false).addChoices({ name: 'Français 🇫🇷', value: 'fr' }, { name: 'English 🇬🇧', value: 'en' }))
                    .addChannelOption(option => option.setName('salon').setDescription('Salon d\'envoi').addChannelTypes(ChannelType.GuildText).setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName('faq')
                    .setDescription('Déploie le panneau de la Foire Aux Questions (FAQ)')
                    .addStringOption(option => option.setName('langue').setDescription('Langue (fr/en)').setRequired(false).addChoices({ name: 'Français 🇫🇷', value: 'fr' }, { name: 'English 🇬🇧', value: 'en' }))
                    .addChannelOption(option => option.setName('salon').setDescription('Salon d\'envoi').addChannelTypes(ChannelType.GuildText).setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName('verify')
                    .setDescription('Déploie le message de vérification du serveur')
                    .addStringOption(option => option.setName('langue').setDescription('Langue (fr/en)').setRequired(false).addChoices({ name: 'Français 🇫🇷', value: 'fr' }, { name: 'English 🇬🇧', value: 'en' }))
                    .addChannelOption(option => option.setName('salon').setDescription('Salon d\'envoi').addChannelTypes(ChannelType.GuildText).setRequired(false))
            )
            .addSubcommand(sub =>
                sub.setName('proof-rules')
                    .setDescription('Déploie et épingle les consignes du salon proof')
                    .addStringOption(option => option.setName('langue').setDescription('Langue (fr/en)').setRequired(false).addChoices({ name: 'Français 🇫🇷', value: 'fr' }, { name: 'English 🇬🇧', value: 'en' }))
                    .addChannelOption(option => option.setName('salon').setDescription('Salon d\'envoi').addChannelTypes(ChannelType.GuildText).setRequired(false))
            ),
        new SlashCommandBuilder()
            .setName('setup')
            .setDescription('Configuration globale du serveur')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addSubcommand(sub => sub.setName('staff').setDescription('Crée la catégorie STAFF sécurisée'))
            .addSubcommand(sub => sub.setName('roles').setDescription('Duplique et traduit tous les rôles du serveur en anglais'))
            .addSubcommand(sub => sub.setName('channels').setDescription('Crée l\'arborescence des salons du serveur'))
            .addSubcommand(sub => sub.setName('permissions').setDescription('Ajuste les permissions globales des rôles et salons'))
            .addSubcommand(sub => sub.setName('audit').setDescription('Effectue une révision automatique anti-erreur du serveur via l\'IA Groq'))
            .addSubcommand(sub => sub.setName('en-fr').setDescription('Purge le serveur et déploie le système de sécurité complet')),
        new SlashCommandBuilder()
            .setName('config')
            .setDescription('Configuration du bot (Dashboard et autres options)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addSubcommand(sub => sub.setName('dashboard').setDescription('Ouvre le panneau de configuration interactif (Dashboard)'))
            .addSubcommand(sub => 
                sub.setName('logs')
                    .setDescription('Définit le salon de logs pour le bot')
                    .addChannelOption(option => option.setName('salon').setDescription('Salon textuel de logs').addChannelTypes(ChannelType.GuildText).setRequired(true))
            )
            .addSubcommand(sub => 
                sub.setName('gen')
                    .setDescription('Configuration rapide du générateur (par pays FR & EN)')
                    .addIntegerOption(option => option.setName('cooldown').setDescription('Temps d\'attente (en s)'))
                    .addRoleOption(option => option.setName('role_requis_fr').setDescription('Rôle requis (Générateur Free FR)'))
                    .addRoleOption(option => option.setName('role_requis_en').setDescription('Rôle requis (Générateur Free EN)'))
                    .addRoleOption(option => option.setName('role_premium_fr').setDescription('Rôle requis (Générateur Premium FR)'))
                    .addRoleOption(option => option.setName('role_premium_en').setDescription('Rôle requis (Générateur Premium EN)'))
                    .addIntegerOption(option => option.setName('limite_journaliere').setDescription('Limite/jour (0=illimité)'))
                    .addStringOption(option => option.setName('gif_banner').setDescription('Lien URL du GIF/Bannière pour les panneaux'))
            )
            .addSubcommand(sub => 
                sub.setName('service')
                    .setDescription('Définit si un service est Gratuit (Free) ou Premium (VIP)')
                    .addStringOption(option => option.setName('service').setDescription('Le service à modifier').setRequired(true).addChoices(...services.map(s => ({ name: s.label, value: s.id }))))
                    .addStringOption(option => option.setName('statut').setDescription('Tier du service').setRequired(true).addChoices({ name: 'Gratuit (Free) 🆓', value: 'free' }, { name: 'Premium (VIP) 👑', value: 'premium' }))
            ),
        new SlashCommandBuilder()
            .setName('broadcast')
            .setDescription('Envoie une annonce simultanément dans les salons FR & EN avec traduction automatique par IA')
            .addStringOption(option => option.setName('message').setDescription('Message de l\'annonce (sera automatiquement traduit en anglais/français)').setRequired(true))
            .addStringOption(option => option.setName('message_en').setDescription('Message en anglais (optionnel pour forcer la version anglaise)').setRequired(false))
            .addStringOption(option => option.setName('titre').setDescription('Titre personnalisé de l\'annonce').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('proof')
            .setDescription('Publie un avis et une preuve (screenshot) de votre compte généré')
            .addStringOption(option => 
                option.setName('service')
                    .setDescription('Le service généré')
                    .setRequired(true)
                    .addChoices(...services.map(s => ({ name: s.label, value: s.id })))
            )
            .addIntegerOption(option => 
                option.setName('etoiles')
                    .setDescription('Nombre d\'étoiles / Rating (1 à 5)')
                    .setRequired(true)
                    .addChoices(
                        { name: '⭐⭐⭐⭐⭐ (5/5)', value: 5 },
                        { name: '⭐⭐⭐⭐ (4/5)', value: 4 },
                        { name: '⭐⭐⭐ (3/5)', value: 3 },
                        { name: '⭐⭐ (2/5)', value: 2 },
                        { name: '⭐ (1/5)', value: 1 }
                    )
            )
            .addStringOption(option => 
                option.setName('avis')
                    .setDescription('Votre avis / commentaire')
                    .setRequired(true)
            )
            .addAttachmentOption(option => 
                option.setName('capture')
                    .setDescription('Capture d\'écran (screenshot) de preuve')
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('giveaway')
            .setDescription('Lance un giveaway bilingue simultané')
            .addStringOption(option => option.setName('prix').setDescription('Le lot à gagner').setRequired(true))
            .addStringOption(option => option.setName('duree').setDescription('Durée (ex: 10m, 1h, 24h)').setRequired(true))
            .addIntegerOption(option => option.setName('gagnants').setDescription('Nombre de gagnants (1 par défaut)').setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('drops')
            .setDescription('Droppe des comptes/combos dans le salon drop')
            .addStringOption(option => option.setName('service').setDescription('Nom du service').setRequired(true))
            .addStringOption(option => option.setName('combos').setDescription('Les identifiants/combos à dropper').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('restock')
            .setDescription('Ajoute du stock pour un service (multilingue FR/EN)')
            .addStringOption(option => option.setName('service').setDescription('Le service à restocker').setRequired(true).addChoices(...services.map(s => ({ name: s.label, value: s.label }))))
            .addAttachmentOption(option => option.setName('fichier').setDescription('Fichier texte (.txt) contenant les combos').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('combo-cleaner')
            .setDescription('Nettoie un fichier de combos via l\'IA Groq (Llama-3.3)')
            .addAttachmentOption(option => option.setName('fichier').setDescription('Fichier texte (.txt) contenant les combos sales').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('give-premgen')
            .setDescription('Donne l\'accès Premium Générateur à un utilisateur')
            .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur à qui donner l\'accès premium').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('remove-premgen')
            .setDescription('Retire l\'accès Premium Générateur à un utilisateur')
            .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur à qui retirer l\'accès premium').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    logAssetLoading();
    await initTursoDB();
    await registerCommands();
    
    // Cron pour bump Discadia tous les jours à 15h45 (Heure Française Europe/Paris)
    cron.schedule('45 15 * * *', () => {
        client.guilds.cache.forEach(async (guild) => {
            const staffCh = guild.channels.cache.find(c => c.name === '💬・staff-chat' || c.name.includes('staff'));
            if (staffCh && staffCh.isTextBased()) {
                await staffCh.send('⏰ **Rappel Bump :** Il est 15h45, c\'est l\'heure de bumper le serveur sur Discadia ! `/bump`');
            }
        });
    }, {
        scheduled: true,
        timezone: 'Europe/Paris'
    });

    for (const [id, guild] of client.guilds.cache) {
        ensureGuildDefaults(guild.id);
        await cacheGuildInvites(guild);
        await preloadServerEmojis(guild);
    }

    // Auto-ping Keep-Alive (Render) - Toutes les 5 minutes
    setInterval(() => {
        fetch(`${BASE_URL}/healthz`).catch(() => {});
    }, 300000);

    // Cron pour bump Discadia tous les jours à 15h45
    cron.schedule('45 15 * * *', () => {
        client.guilds.cache.forEach(async (guild) => {
            const staffCh = guild.channels.cache.find(c => c.name === '💬・staff-chat');
            if (staffCh && staffCh.isTextBased()) {
                await staffCh.send('⏰ **Rappel Bump :** Il est 15h45, c\'est l\'heure de bumper le serveur sur Discadia ! `/bump`');
            }
        });
    });

    // Auto-refresh des panels toutes les 5 secondes
    setInterval(async () => {
        const panels = getPanels();
        for (const guildId of Object.keys(panels)) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;
            
            const pData = panels[guildId];
            const updatePanel = async (panelKey) => {
                if (!pData[panelKey]) return;
                try {
                    const ch = guild.channels.cache.get(pData[panelKey].channelId) || await guild.channels.fetch(pData[panelKey].channelId).catch(() => null);
                    if (ch) {
                        const msg = await ch.messages.fetch(pData[panelKey].messageId).catch(() => null);
                        if (msg) {
                            const lang = panelKey.startsWith('en') ? 'en' : 'fr';
                            const tier = pData[panelKey].tier || 'free';
                            const embedData = await buildPanelEmbed(guild, lang, tier);
                            const components = await buildServiceRows(guild, tier);

                            const editOptions = { embeds: [embedData.embed], components: components };
                            if (embedData.bannerAttachment) {
                                editOptions.files = [embedData.bannerAttachment];
                            }

                            await msg.edit(editOptions).catch(err => {
                                if (err.code === 10008) removePanel(guildId, panelKey);
                            });
                        }
                    }
                } catch (e) {
                    // Ne pas supprimer le panel sur une erreur temporaire
                }
            };
            
            for (const key of Object.keys(pData)) {
                await updatePanel(key);
            }
        }
    }, 5000);
});

// Événement d'arrivée de membres
client.on('guildMemberAdd', async (member) => {
    const { guild } = member;

    try {
        const { notRegRole } = await getOrCreateSetupRoles(guild);
        if (notRegRole) {
            await member.roles.add(notRegRole.id).catch(() => {});
        }
    } catch (e) {}

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
        .setTitle('📥 Arrivée Membre (Non Enregistré)')
        .setDescription(`👤 **Membre :** <@${member.id}>\n👤 **Invité par :** ${inviterText}\n${inviterStatsText}\n🏷️ Rôle attribué : \`Not Registered\``)
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

// Modération et Transformation Automatique des Preuves en Embeds Bilingues
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.channel.name.includes('proof')) {
        const firstAttachment = message.attachments.first();
        const imageMatch = message.content.match(/(https?:\/\/[^\s]+(?:\.png|\.jpg|\.jpeg|\.gif|\.webp))/i);
        const imageUrl = firstAttachment ? firstAttachment.url : (imageMatch ? imageMatch[1] : null);

        if (!imageUrl) {
            try {
                if (message.guild.members.me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) {
                    await message.delete().catch(() => {});
                }
            } catch (e) {}

            const warningMsg = await message.channel.send({
                content: `⚠️ <@${message.author.id}>, ce salon est réservé aux preuves (captures d'écran). Utilisez le bouton **⭐ Publier un Avis & Preuve** ci-dessus ou la commande \`/proof\` avec une capture d'écran !`
            }).catch(() => {});

            setTimeout(() => {
                warningMsg?.delete().catch(() => {});
            }, 8000);
            return;
        }

        // Si une image est postée directement dans le salon proof :
        let stars = 5;
        const starMatch = message.content.match(/([1-5])\s*(?:\/5|étoile|etoile|star)/i);
        if (starMatch) {
            stars = parseInt(starMatch[1]);
        }

        let reviewText = message.content.replace(/(https?:\/\/[^\s]+(?:\.png|\.jpg|\.jpeg|\.gif|\.webp))/gi, '').trim();
        if (!reviewText) reviewText = 'Compte valide et fonctionnel ! / Valid & working account!';

        let matchedServiceId = 'generator';
        for (const s of services) {
            if (message.content.toLowerCase().includes(s.id) || message.content.toLowerCase().includes(s.label.toLowerCase())) {
                matchedServiceId = s.id;
                break;
            }
        }

        try {
            if (message.guild.members.me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) {
                await message.delete().catch(() => {});
            }
        } catch (e) {}

        await sendBilingualProofEmbed(message.guild, message.author, matchedServiceId, stars, reviewText, imageUrl);
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
            else if (customId === 'modal_settings_gif') {
                const gifUrl = interaction.fields.getTextInputValue('gif_input').trim();
                if (!gifUrl.startsWith('http://') && !gifUrl.startsWith('https://')) {
                    return interaction.reply({
                        content: '❌ Veuillez saisir un lien URL valide (http:// ou https://).',
                        flags: MessageFlags.Ephemeral
                    });
                }
                setGuildConfig(guild.id, 'panelGifUrl', gifUrl);
                await interaction.reply({
                    content: `✅ URL de la bannière GIF mise à jour avec succès ! Les panneaux s'actualisent automatiquement en direct.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            else if (customId === 'modal_channel_proof') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const serviceStr = interaction.fields.getTextInputValue('service_input').trim();
                const starsStr = interaction.fields.getTextInputValue('stars_input').trim();
                const reviewStr = interaction.fields.getTextInputValue('review_input').trim();
                const imageStr = interaction.fields.getTextInputValue('image_input')?.trim();

                let stars = parseInt(starsStr) || 5;
                if (stars < 1) stars = 1;
                if (stars > 5) stars = 5;

                const imageUrl = (imageStr && (imageStr.startsWith('http://') || imageStr.startsWith('https://'))) ? imageStr : null;

                const success = await sendBilingualProofEmbed(interaction.guild, interaction.user, serviceStr.toLowerCase(), stars, reviewStr, imageUrl);

                if (success) {
                    await interaction.editReply({
                        content: '🎉 **Merci pour votre avis !** Votre preuve et votre avis ont été traduits et publiés automatiquement dans les salons proof (FR & EN).'
                    });
                } else {
                    await interaction.editReply({
                        content: '⚠️ Erreur lors de la publication de votre avis.'
                    });
                }
            }
            else if (customId.startsWith('modal_dm_proof_')) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const serviceId = customId.replace('modal_dm_proof_', '');
                const starsStr = interaction.fields.getTextInputValue('stars_input').trim();
                const reviewStr = interaction.fields.getTextInputValue('review_input').trim();
                const imageStr = interaction.fields.getTextInputValue('image_input')?.trim();

                let stars = parseInt(starsStr) || 5;
                if (stars < 1) stars = 1;
                if (stars > 5) stars = 5;

                const imageUrl = (imageStr && (imageStr.startsWith('http://') || imageStr.startsWith('https://'))) ? imageStr : null;

                const success = await sendBilingualProofEmbed(interaction.guild, interaction.user, serviceId, stars, reviewStr, imageUrl);

                if (success) {
                    await interaction.editReply({
                        content: '🎉 **Merci pour votre avis !** Votre preuve et votre avis ont été traduits et publiés automatiquement dans les salons proof (FR & EN).'
                    });
                } else {
                    await interaction.editReply({
                        content: '⚠️ Erreur lors de la publication de votre avis.'
                    });
                }
            }
            return;
        }

        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;

            // --- RESTRICTION STRICTE DES COMMANDES AUX HAUTS PLACÉS (STAFF / ADMINS) ---
            const staffCommands = ['deploy', 'setup', 'config', 'broadcast', 'giveaway', 'drops', 'restock', 'combo-cleaner', 'give-premgen', 'remove-premgen'];
            if (staffCommands.includes(commandName)) {
                const isOwner = interaction.guild?.ownerId === interaction.user.id;
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
                const isStaffRole = interaction.member?.roles.cache.some(r => 
                    ['fondateur', 'founder', 'administrateur', 'administrator', 'modérateur', 'moderator', 'staff', 'owner', 'co-owner'].some(k => r.name.toLowerCase().includes(k))
                );

                if (!isOwner && !isAdmin && !isStaffRole) {
                    return interaction.reply({
                        content: '❌ **Accès Refusé** : Cette commande est strictement réservée aux hauts placés de l\'équipe (Administrateurs & Staff).',
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            if (commandName === 'config' && interaction.options.getSubcommand() === 'dashboard') {
                const dashboard = buildSettingsDashboard(interaction.guild);
                await interaction.reply({
                    ...dashboard,
                    flags: MessageFlags.Ephemeral
                });
            }

            // --- COMMANDE /setup staff ---
            else if (commandName === 'setup' && interaction.options.getSubcommand() === 'staff') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guild = interaction.guild;
                const everyoneRole = guild.roles.everyone;

                // 1. Création de la Catégorie STAFF (Non traduite, Anglais pur)
                const staffCat = await guild.channels.create({
                    name: 'STAFF',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] }
                    ]
                });

                const staffChannels = [
                    { name: '📢・announcements', readOnly: true },
                    { name: '💬・staff-chat', readOnly: false },
                    { name: '🤖・staff-commands', readOnly: false }
                ];

                const createdStaff = [];
                for (const chData of staffChannels) {
                    const overwrites = [
                        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] }
                    ];

                    const textCh = await guild.channels.create({
                        name: chData.name,
                        type: ChannelType.GuildText,
                        parent: staffCat.id,
                        permissionOverwrites: overwrites
                    });

                    createdStaff.push(`- <#${textCh.id}> ${chData.readOnly ? '🔒 *(Staff Announcements)*' : '💬 *(Staff Only)*'}`);
                }

                const staffEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Catégorie STAFF Déployée !')
                    .setDescription([
                        'La catégorie **STAFF** privée (Anglais pur) a été créée avec succès :',
                        '',
                        createdStaff.join('\n'),
                        '',
                        '*🔒 Ces salons sont strictly réservés à l\'équipe du staff et invisibles aux membres classiques.*'
                    ].join('\n'))
                    .setColor('#5865F2')
                    .setTimestamp();

                await interaction.editReply({ embeds: [staffEmbed] });
            }

            // --- COMMANDE /setup roles ---
            else if (commandName === 'setup' && interaction.options.getSubcommand() === 'roles') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guild = interaction.guild;
                const roles = await guild.roles.fetch();

                const dictionary = {
                    'membre': 'Member',
                    'membres': 'Members',
                    'client': 'Customer',
                    'clients': 'Customers',
                    'client vip': 'VIP Customer',
                    'vip': 'VIP',
                    'partenaire': 'Partner',
                    'partenaires': 'Partners',
                    'banni': 'Banned',
                    'booster': 'Booster',
                    'boosters': 'Boosters',
                    'administrateur': 'Administrator',
                    'admin': 'Admin',
                    'modérateur': 'Moderator',
                    'mod': 'Mod',
                    'assistant': 'Helper',
                    'fondateur': 'Founder',
                    'créateur': 'Creator',
                    'développeur': 'Developer',
                    'dev': 'Dev',
                    'support': 'Support',
                    'gagnant': 'Winner'
                };

                const createdRolesList = [];

                for (const [id, role] of roles) {
                    if (role.managed || role.id === guild.roles.everyone.id) continue;
                    if (role.name === 'Not Registered' || role.name === 'Country Choice' || role.name === '🇫🇷 Français' || role.name === '🇬🇧 English') continue;

                    const nameLower = role.name.toLowerCase().trim();
                    let translatedName = dictionary[nameLower];

                    if (!translatedName) {
                        translatedName = `${role.name} (EN)`;
                    }

                    const existingEnRole = guild.roles.cache.find(r => r.name.toLowerCase() === translatedName.toLowerCase());
                    if (existingEnRole) continue;

                    try {
                        const newRole = await guild.roles.create({
                            name: translatedName,
                            color: role.color,
                            hoist: role.hoist,
                            mentionable: role.mentionable,
                            permissions: role.permissions,
                            reason: `Traduction automatique de ${role.name}`
                        });
                        createdRolesList.push(`- **${role.name}** ➔ <@&${newRole.id}> (\`${newRole.name}\`)`);
                    } catch (e) {
                        console.error(`Erreur création rôle ${translatedName}:`, e);
                    }
                }

                const resultEmbed = new EmbedBuilder()
                    .setTitle('🌐 Traduction & Duplication des Rôles Effectuée !')
                    .setDescription(createdRolesList.length > 0 
                        ? `Les rôles du serveur ont été dupliqués et traduits en Anglais :\n\n${createdRolesList.join('\n')}`
                        : '⚠️ Tous les rôles traduits existent déjà ou aucun rôle personnalisable n\'a été trouvé.')
                    .setColor('#57F287')
                    .setTimestamp();

                await interaction.editReply({ embeds: [resultEmbed] });
            }

            // --- COMMANDE /setup en-fr ---
            else if (commandName === 'setup' && interaction.options.getSubcommand() === 'en-fr') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guild = interaction.guild;
                const everyoneRole = guild.roles.everyone;
                const { notRegRole, countryChoiceRole, frRole, enRole, frMemberRole, enMemberRole } = await getOrCreateSetupRoles(guild);

                // 1. SUPPRESSION DE TOUS LES SALONS ET CATÉGORIES EXISTANTS
                const existingChannels = await guild.channels.fetch();
                for (const [id, ch] of existingChannels) {
                    if (ch) {
                        await ch.delete().catch(() => {});
                    }
                }

                // 2. CRÉATION DU SALON #🛡️・verify (Visible UNIQUEMENT pour Not Registered)
                const verifyChannel = await guild.channels.create({
                    name: '🛡️・verify',
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: everyoneRole.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: notRegRole ? notRegRole.id : everyoneRole.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                            deny: [PermissionFlagsBits.SendMessages]
                        },
                        {
                            id: VERIFIED_ROLE_ID,
                            deny: [PermissionFlagsBits.ViewChannel]
                        }
                    ]
                });

                const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=guilds.join+identify`;

                const verifyEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Verification / Vérification')
                    .setDescription([
                        'Bienvenue sur le serveur ! Pour accéder aux salons et aux générateurs, merci de vous vérifier ci-dessous.',
                        'Welcome! Please verify below to access channels and generators.',
                        '',
                        '1. Cliquez sur le bouton **Se Vérifier / Verify** ci-dessous.',
                        '2. Acceptez l\'autorisation.',
                        '3. Le salon `🌍・country` s\'affichera pour choisir votre pays !'
                    ].join('\n'))
                    .setColor('#57F287')
                    .setTimestamp();

                const verifyRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('🛡️ Se Vérifier / Verify')
                        .setStyle(ButtonStyle.Link)
                        .setURL(oauthUrl)
                );

                await verifyChannel.send({ embeds: [verifyEmbed], components: [verifyRow] });

                // 3. CRÉATION DU SALON #🌍・country (Visible UNIQUEMENT pour Country Choice)
                const countryChannel = await guild.channels.create({
                    name: '🌍・country',
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: everyoneRole.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: countryChoiceRole ? countryChoiceRole.id : everyoneRole.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                            deny: [PermissionFlagsBits.SendMessages]
                        },
                        {
                            id: frRole ? frRole.id : everyoneRole.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: enRole ? enRole.id : everyoneRole.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        }
                    ]
                });

                const langPrompt = sendLanguageSelectionPrompt(countryChannel);
                await countryChannel.send(langPrompt);

                const createdSummary = [];

                // 4. SECTEUR FRANÇAIS (Visible UNIQUEMENT pour rôle 🇫🇷 Français)
                const frStructure = [
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

                let frGenChannel = null;

                for (const catData of frStructure) {
                    const categoryChannel = await guild.channels.create({
                        name: catData.category,
                        type: ChannelType.GuildCategory,
                        permissionOverwrites: [
                            { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: frRole ? frRole.id : everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel] }
                        ]
                    });

                    const createdChannels = [];
                    for (const chName of catData.channels) {
                        const overwrites = getPermissionOverwrites(guild, chName);
                        overwrites.push({
                            id: frRole ? frRole.id : everyoneRole.id,
                            allow: [PermissionFlagsBits.ViewChannel]
                        });

                        const textChannel = await guild.channels.create({
                            name: chName,
                            type: ChannelType.GuildText,
                            parent: categoryChannel.id,
                            permissionOverwrites: overwrites
                        });

                        if (chName === '✅・proof') {
                            await sendProofRuleBanner(textChannel, 'fr');
                        } else if (chName === '⭐・gen-free') {
                            frGenChannel = textChannel;
                        }

                        createdChannels.push(`- <#${textChannel.id}>`);
                    }

                    createdSummary.push(`📁 **Catégorie FR : ${catData.category}**\n${createdChannels.join('\n')}`);
                }

                // 5. SECTEUR ANGLAIS (Visible UNIQUEMENT pour rôle 🇬🇧 English)
                const enStructure = [
                    {
                        category: 'Main',
                        channels: [
                            '✅・invites',
                            '🌠・boosts',
                            '📢・announcements',
                            '🎁・giveaways',
                            '📩・tickets',
                            '💬・chat',
                            '💧・drops'
                        ]
                    },
                    {
                        category: 'Generator',
                        channels: [
                            '❓・faq',
                            '⭐・free-gen',
                            '🚀・premium-gen',
                            '📦・restocks',
                            '✅・proofs'
                        ]
                    }
                ];

                let enGenChannel = null;

                for (const catData of enStructure) {
                    const categoryChannel = await guild.channels.create({
                        name: catData.category,
                        type: ChannelType.GuildCategory,
                        permissionOverwrites: [
                            { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: VERIFIED_ROLE_ID, deny: [PermissionFlagsBits.ViewChannel] },
                            { id: enRole ? enRole.id : everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel] }
                        ]
                    });

                    const createdChannels = [];
                    for (const chName of catData.channels) {
                        const overwrites = getPermissionOverwrites(guild, chName);
                        overwrites.push({
                            id: enRole ? enRole.id : everyoneRole.id,
                            allow: [PermissionFlagsBits.ViewChannel]
                        });

                        const textChannel = await guild.channels.create({
                            name: chName,
                            type: ChannelType.GuildText,
                            parent: categoryChannel.id,
                            permissionOverwrites: overwrites
                        });

                        if (chName === '✅・proofs') {
                            await sendProofRuleBanner(textChannel, 'en');
                        } else if (chName === '⭐・free-gen') {
                            enGenChannel = textChannel;
                        }

                        createdChannels.push(`- <#${textChannel.id}>`);
                    }

                    createdSummary.push(`📁 **Category EN : ${catData.category}**\n${createdChannels.join('\n')}`);
                }

                // DEPLOIEMENT AUTOMATIQUE DES 2 PANELS DE GENERATION TRADUITS AVEC LES NOUVEAUX EMOJIS HD
                const components = await buildServiceRows(guild);

                if (frGenChannel) {
                    const frData = await buildPanelEmbed(guild, 'fr', 'free');
                    const payloadFr = { embeds: [frData.embed], components: components };
                    if (frData.bannerAttachment) payloadFr.files = [frData.bannerAttachment];
                    const msgFr = await frGenChannel.send(payloadFr);
                    setPanel(guild.id, `fr_free_${frGenChannel.id}`, frGenChannel.id, msgFr.id, 'free');
                }

                if (enGenChannel) {
                    const enData = await buildPanelEmbed(guild, 'en', 'free');
                    const payloadEn = { embeds: [enData.embed], components: components };
                    if (enData.bannerAttachment) payloadEn.files = [enData.bannerAttachment];
                    const msgEn = await enGenChannel.send(payloadEn);
                    setPanel(guild.id, `en_free_${enGenChannel.id}`, enGenChannel.id, msgEn.id, 'free');
                }

                const setupEmbed = new EmbedBuilder()
                    .setTitle('🧹 Anciens Salons Supprimés & Systèmes de Rôles Déployés !')
                    .setDescription([
                        'Le serveur a été entièrement réinitialisé avec le flux de sécurité complet et les nouveaux emojis HD :',
                        '',
                        `🛡️ **Salon Verify :** <#${verifyChannel.id}> (Rôle \`Not Registered\`)`,
                        `🌍 **Salon Country :** <#${countryChannel.id}> (Rôle \`Country Choice\`)`,
                        `🇫🇷 **Secteur Français :** (Rôle \`🇫🇷 Français\` + Rôle \`Membre\`)`,
                        `🇬🇧 **English Sector:** (Role \`🇬🇧 English\` + Role \`Member\`)`,
                        '',
                        createdSummary.join('\n\n')
                    ].join('\n'))
                    .setColor('#57F287')
                    .setTimestamp();

                try {
                    await interaction.editReply({ embeds: [setupEmbed] });
                } catch (err) {
                    if (err.code !== 10008) console.error('Interaction editReply handled:', err);
                }
            }

            // --- COMMANDE /broadcast ---
            else if (commandName === 'broadcast') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const rawMsg = interaction.options.getString('message') || interaction.options.getString('message_fr');
                let msgEn = interaction.options.getString('message_en');
                const customTitle = interaction.options.getString('titre');

                let msgFr = rawMsg;

                if (process.env.GROQ_API_KEY) {
                    if (!msgEn) {
                        msgEn = await translateTextWithGroq(rawMsg, 'en');
                    }
                    msgFr = await translateTextWithGroq(rawMsg, 'fr');
                } else if (!msgEn) {
                    msgEn = rawMsg;
                }

                const guild = interaction.guild;
                const frCh = guild.channels.cache.find(c => c.name === '📢・annonce' || c.name.includes('annonce'));
                const enCh = guild.channels.cache.find(c => c.name === '📢・announcements' || c.name.includes('announcement'));

                let frSent = false;
                let enSent = false;

                if (frCh && frCh.isTextBased()) {
                    const embedFr = new EmbedBuilder()
                        .setTitle(customTitle || '📢 NextGen • Annonce Officielle')
                        .setDescription(msgFr)
                        .setColor('#5865F2')
                        .setFooter({ text: 'NextGen FR', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();
                    await frCh.send({ content: '@everyone', embeds: [embedFr] });
                    frSent = true;
                }

                if (enCh && enCh.isTextBased()) {
                    const embedEn = new EmbedBuilder()
                        .setTitle(customTitle || '📢 NextGen • Official Announcement')
                        .setDescription(msgEn)
                        .setColor('#5865F2')
                        .setFooter({ text: 'NextGen EN', iconURL: client.user.displayAvatarURL() })
                        .setTimestamp();
                    await enCh.send({ content: '@everyone', embeds: [embedEn] });
                    enSent = true;
                }

                await interaction.editReply({
                    content: `✅ **Broadcast Bilingue Traduit par IA Publié !**\n${frSent ? `🇫🇷 Envoyé dans <#${frCh.id}>` : '⚠️ Salon FR non trouvé.'}\n${enSent ? `🇬🇧 Envoyé dans <#${enCh.id}>` : '⚠️ Salon EN non trouvé.'}`
                });
            }

            // --- COMMANDE /proof ---
            else if (commandName === 'proof') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const serviceId = interaction.options.getString('service');
                const starsCount = interaction.options.getInteger('etoiles');
                const reviewText = interaction.options.getString('avis');
                const attachment = interaction.options.getAttachment('capture');

                const imageUrl = attachment ? attachment.url : null;

                const success = await sendBilingualProofEmbed(interaction.guild, interaction.user, serviceId, starsCount, reviewText, imageUrl);

                if (success) {
                    await interaction.editReply({
                        content: '🎉 **Merci pour votre avis !** Votre preuve et votre avis ont été traduits et publiés automatiquement dans les salons proof (FR & EN).'
                    });
                } else {
                    await interaction.editReply({
                        content: '⚠️ Impossible de trouver les salons proof sur ce serveur. Merci de contacter un administrateur.'
                    });
                }
            }

            // --- COMMANDE /deploy proof-rules ---
            else if (commandName === 'deploy' && interaction.options.getSubcommand() === 'proof-rules') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guild = interaction.guild;
                const targetChannel = interaction.options.getChannel('salon') || guild.channels.cache.find(c => c.name.includes('proof')) || interaction.channel;
                const langOpt = interaction.options.getString('langue');
                const lang = langOpt || (targetChannel.name.includes('proofs') || targetChannel.name.includes('en') ? 'en' : 'fr');

                const pinnedMsg = await sendProofRuleBanner(targetChannel, lang);

                if (pinnedMsg) {
                    await interaction.editReply({
                        content: `✅ Les consignes du salon proof (${lang.toUpperCase()}) ont été déployées et épinglées dans <#${targetChannel.id}>.`
                    });
                } else {
                    await interaction.editReply({
                        content: '❌ Impossible de déployer ou d\'épingler les consignes.'
                    });
                }
            }

            // --- COMMANDE /deploy faq ---
            else if (commandName === 'deploy' && interaction.options.getSubcommand() === 'faq') {
                await interaction.deferReply();

                const guild = interaction.guild;
                const targetChannel = interaction.options.getChannel('salon') || guild.channels.cache.find(c => c.name.includes('faq') || c.name.includes('req')) || interaction.channel;
                const langOpt = interaction.options.getString('langue');
                const lang = langOpt || (targetChannel.name.includes('faq') || targetChannel.name.includes('en') ? 'en' : 'fr');

                const faqTitle = lang === 'en' ? '❓ NextGen • Frequently Asked Questions (FAQ)' : '❓ NextGen • Foire Aux Questions (FAQ)';
                const faqDesc = lang === 'en' ? [
                    'Welcome to the **NextGen** FAQ! Find answers to the most common questions below:',
                    '',
                    '### ⚡ **How to use the generator?**',
                    '1. Put `discadia.gg/nextg3n` in your **Discord Custom Status** to automatically get the generator role.',
                    '2. Go to the generator channel (<#1532367088809676975>), then click the button for your desired service. Your credentials will be sent immediately to your **Direct Messages (DM)**.',
                    '',
                    '### 🛡️ **How to unlock server channels?**',
                    'You must complete the verification in <#verify> and choose your language. All channels will unlock automatically.',
                    '',
                    '### 📦 **When do account restocks happen?**',
                    'Restocks are announced in real-time in the `#restocks` channel. Keep an eye out for notifications!',
                    '',
                    '### ⏱️ **Why does the bot ask me to wait?**',
                    'A cooldown timer is set between generations to ensure fair distribution for all members.',
                    '',
                    '### 📩 **How to contact the moderation team?**',
                    'Open a private support ticket by going to the `#tickets` channel.'
                ].join('\n') : [
                    'Bienvenue dans la FAQ du serveur **NextGen** ! Retrouvez ci-dessous les réponses aux questions les plus fréquentes :',
                    '',
                    '### ⚡ **Comment utiliser le générateur ?**',
                    '1. Ajoutez `discadia.gg/nextg3n` dans votre **Statut Personnalisé Discord** pour débloquer automatiquement le rôle.',
                    '2. Rendez-vous dans le salon du générateur (<#1532367071273291817>), puis cliquez sur le bouton du service de votre choix. Vos identifiants vous seront immédiatement envoyés en **Message Privé (DM)**.',
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
                ].join('\n');

                const faqEmbed = new EmbedBuilder()
                    .setTitle(faqTitle)
                    .setDescription(faqDesc)
                    .setColor('#5865F2')
                    .setThumbnail(guild.iconURL() || client.user.displayAvatarURL())
                    .setFooter({ text: lang === 'en' ? 'NextGen FAQ System' : 'NextGen FAQ System', iconURL: client.user.displayAvatarURL() })
                    .setTimestamp();

                await targetChannel.send({ embeds: [faqEmbed] });

                await interaction.editReply({
                    content: `✅ Le panneau FAQ (${lang.toUpperCase()}) a été publié dans <#${targetChannel.id}>.`
                });
            }

            // --- COMMANDE /deploy ticket ---
            else if (commandName === 'deploy' && interaction.options.getSubcommand() === 'ticket') {
                await interaction.deferReply();

                const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
                const langOpt = interaction.options.getString('langue');
                const lang = langOpt || (targetChannel.name.includes('ticket-en') || targetChannel.name.includes('tickets') ? 'en' : 'fr');

                const ticketTitle = lang === 'en' ? '📩 NextGen Support' : '📩 Support NextGen';
                const ticketDesc = lang === 'en' ? [
                    'Need help or have a question?',
                    '',
                    'Click the button below to open a private support ticket with our moderation team.'
                ].join('\n') : [
                    'Besoin d\'aide ou une question ?',
                    '',
                    'Cliquez sur le bouton ci-dessous pour ouvrir un ticket privé avec l\'équipe de modération.'
                ].join('\n');

                const ticketEmbed = new EmbedBuilder()
                    .setTitle(ticketTitle)
                    .setDescription(ticketDesc)
                    .setColor('#5865F2')
                    .setTimestamp();

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_open')
                        .setLabel(lang === 'en' ? '📩 Open a Ticket' : '📩 Ouvrir un Ticket')
                        .setStyle(ButtonStyle.Primary)
                );

                await targetChannel.send({
                    embeds: [ticketEmbed],
                    components: [row]
                });

                await interaction.editReply({
                    content: `✅ Le panneau de tickets (${lang.toUpperCase()}) a été publié dans <#${targetChannel.id}>.`
                });
            }

            // --- COMMANDE /deploy verify ---
            else if (commandName === 'deploy' && interaction.options.getSubcommand() === 'verify') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guild = interaction.guild;
                const targetChannel = interaction.options.getChannel('salon') || guild.channels.cache.find(c => c.name.includes('verify')) || interaction.channel;

                const oauthUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=guilds.join+identify`;

                const verifyEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Vérification du Serveur / Server Verification')
                    .setDescription([
                        '🇫🇷 **FRANÇAIS :**',
                        'Bienvenue sur le serveur ! Pour accéder aux salons et aux générateurs, merci de vous vérifier ci-dessous.',
                        '1. Cliquez sur le bouton **Se Vérifier** ci-dessous.',
                        '2. Acceptez l\'autorisation.',
                        '3. Le salon `🌍・country` s\'affichera pour choisir votre pays !',
                        '',
                        '──────────────────────────',
                        '',
                        '🇬🇧 **ENGLISH :**',
                        'Welcome to the server! Please verify below to access channels and generators.',
                        '1. Click the **Verify** button below.',
                        '2. Accept authorization.',
                        '3. Channel `🌍・country` will appear to select your language!'
                    ].join('\n'))
                    .setColor('#57F287')
                    .setTimestamp()
                    .setFooter({ text: 'NextGen Security System', iconURL: guild.iconURL() });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('🛡️ Se Vérifier / Verify')
                        .setStyle(ButtonStyle.Link)
                        .setURL(oauthUrl)
                );

                await targetChannel.send({
                    embeds: [verifyEmbed],
                    components: [row]
                });

                await interaction.editReply({
                    content: `✅ Panel de vérification bilingue (FR/EN) déployé dans <#${targetChannel.id}>.`
                });
            }

            // --- COMMANDE /deploy generator ---
            else if (commandName === 'deploy' && interaction.options.getSubcommand() === 'generator') {
                await interaction.deferReply();

                const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
                const langOpt = interaction.options.getString('langue');
                const tierOpt = interaction.options.getString('tier');

                const isEnglishChannel = targetChannel.name.includes('en') || targetChannel.name.includes('chat') || targetChannel.name.includes('free-gen') || targetChannel.name.includes('premium-gen') || targetChannel.name.includes('announcement');
                const lang = langOpt || (isEnglishChannel ? 'en' : 'fr');

                const isPremiumChannel = targetChannel.name.includes('premium');
                const tier = tierOpt || (isPremiumChannel ? 'premium' : 'free');

                const panelData = await buildPanelEmbed(interaction.guild, lang, tier);
                const components = await buildServiceRows(interaction.guild, tier);

                const replyPayload = { embeds: [panelData.embed], components: components };
                if (panelData.bannerAttachment) {
                    replyPayload.files = [panelData.bannerAttachment];
                }

                const msg = await targetChannel.send(replyPayload);
                
                // Enregistre l'ID du panel pour l'auto-refresh
                const panelKey = `${lang}_${tier}_${targetChannel.id}`;
                setPanel(interaction.guild.id, panelKey, targetChannel.id, msg.id, tier);

                await interaction.editReply({
                    content: `✅ Panel générateur (${tier.toUpperCase()}) déployé dans <#${targetChannel.id}>.`
                });
            }
            // --- COMMANDE /deploy status ---
            else if (commandName === 'deploy' && interaction.options.getSubcommand() === 'status') {
                await interaction.deferReply();
                const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
                const langOpt = interaction.options.getString('langue');
                const lang = langOpt || 'fr';

                const statusTitle = lang === 'en' ? '🟢 System Status' : '🟢 Statut du Système';
                const statusDesc = lang === 'en' 
                    ? `**NextG3n Bot :** <a:ng_online:1532399539187617792> Online\n\nAll systems are fully operational.` 
                    : `**NextG3n Bot :** <a:ng_online:1532399539187617792> En ligne\n\nTous les systèmes sont opérationnels.`;

                const statusEmbed = new EmbedBuilder()
                    .setTitle(statusTitle)
                    .setDescription(statusDesc)
                    .setColor('#43B581')
                    .setTimestamp()
                    .setFooter({ text: 'NextGen Status', iconURL: interaction.client.user.displayAvatarURL() });

                await targetChannel.send({ embeds: [statusEmbed] });
                await interaction.editReply({ content: `✅ Panel de statut déployé dans <#${targetChannel.id}>.` });
            }
            else if (commandName === 'config' && interaction.options.getSubcommand() === 'logs') {
                const logCh = interaction.options.getChannel('salon');
                setGuildConfig(interaction.guild.id, 'logsChannelId', logCh.id);
                await interaction.reply({ content: `✅ Salon des logs défini sur <#${logCh.id}>`, flags: MessageFlags.Ephemeral });
            }

            else if (commandName === 'config' && interaction.options.getSubcommand() === 'gen') {
                const cooldownInput = interaction.options.getInteger('cooldown');
                const reqFr = interaction.options.getRole('role_requis_fr');
                const reqEn = interaction.options.getRole('role_requis_en');
                const premFr = interaction.options.getRole('role_premium_fr');
                const premEn = interaction.options.getRole('role_premium_en');
                const limitInput = interaction.options.getInteger('limite_journaliere');
                const gifBannerInput = interaction.options.getString('gif_banner');

                if (cooldownInput !== null) setGuildConfig(interaction.guild.id, 'cooldown', cooldownInput);
                if (reqFr !== null) setGuildConfig(interaction.guild.id, 'requiredRoleId_fr', reqFr.id);
                if (reqEn !== null) setGuildConfig(interaction.guild.id, 'requiredRoleId_en', reqEn.id);
                if (premFr !== null) setGuildConfig(interaction.guild.id, 'premiumRoleId_fr', premFr.id);
                if (premEn !== null) setGuildConfig(interaction.guild.id, 'premiumRoleId_en', premEn.id);
                if (limitInput !== null) setGuildConfig(interaction.guild.id, 'dailyLimit', limitInput);
                if (gifBannerInput !== null) setGuildConfig(interaction.guild.id, 'panelGifUrl', gifBannerInput);

                const currentCooldown = getGuildConfig(interaction.guild.id, 'cooldown') ?? 60;
                const currentReqFr = getGuildConfig(interaction.guild.id, 'requiredRoleId_fr');
                const currentReqEn = getGuildConfig(interaction.guild.id, 'requiredRoleId_en');
                const currentPremFr = getGuildConfig(interaction.guild.id, 'premiumRoleId_fr');
                const currentPremEn = getGuildConfig(interaction.guild.id, 'premiumRoleId_en');
                const currentLimit = getGuildConfig(interaction.guild.id, 'dailyLimit') ?? 0;
                const currentGif = getGuildConfig(interaction.guild.id, 'panelGifUrl');

                const settingsEmbed = new EmbedBuilder()
                    .setTitle('⚡ Configuration du Générateur NextGen')
                    .setDescription([
                        'Voici la configuration actuelle du générateur pour votre serveur :',
                        '',
                        `⏱️ **Cooldown :** **${currentCooldown}s**`,
                        `🔑 **Rôle Requis (Free FR) :** ${currentReqFr ? `<@&${currentReqFr}>` : '`Aucun (Ouvert)`'}`,
                        `🔑 **Rôle Requis (Free EN) :** ${currentReqEn ? `<@&${currentReqEn}>` : '`Aucun (Ouvert)`'}`,
                        `👑 **Rôle Premium (FR) :** ${currentPremFr ? `<@&${currentPremFr}>` : '`Aucun`'}`,
                        `👑 **Rôle Premium (EN) :** ${currentPremEn ? `<@&${currentPremEn}>` : '`Aucun`'}`,
                        `📊 **Limite Journalière :** ${currentLimit > 0 ? `**${currentLimit}** / jour` : '`Illimitée`'}`,
                        `🖼️ **Bannière GIF :** ${currentGif ? `[Voir le GIF](${currentGif})` : '`Par Défaut`'}`,
                        '',
                        '*Utilisez les paramètres de la commande `/config gen` ou le dashboard `/settings` pour modifier ces valeurs.*'
                    ].join('\n'))
                    .setColor('#5865F2')
                    .setTimestamp();

                await interaction.reply({
                    embeds: [settingsEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }

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
                let frGwChannel = guild.channels.cache.find(c => c.name === '🎁・giveaway' || c.name.includes('giveaway-fr'));
                let enGwChannel = guild.channels.cache.find(c => c.name === '🎁・giveaways' || c.name.includes('giveaway-en'));

                if (!frGwChannel) frGwChannel = interaction.channel;

                const endTime = Math.floor((Date.now() + durationMs) / 1000);
                const gwId = `gw_${Date.now()}`;

                const gwEmbedFr = new EmbedBuilder()
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
                        .setTitle('🎉 NextGen Giveaway')
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

            else if (commandName === 'combo-cleaner') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const attachment = interaction.options.getAttachment('fichier');
                const groqApiKey = process.env.GROQ_API_KEY;

                try {
                    const response = await fetch(attachment.url);
                    let textContent = await response.text();

                    if (textContent.length > 30000) {
                        return interaction.editReply({ content: '❌ Fichier trop volumineux. Veuillez le diviser (max ~30000 caractères).' });
                    }

                    const prompt = `Je vais te fournir une liste de combos sales. Ta tâche est de les nettoyer pour ne garder QUE le format "email:password" (ou "username:password"). Enlève toutes les informations inutiles comme "Expire : 2437", "cokkie", etc.
Ne rajoute AUCUN texte, aucun bonjour, aucune explication. Donne uniquement la liste nettoyée ligne par ligne.

Combos:
${textContent}`;

                    const cleanedContent = await queryAI(prompt, 4000);

                    if (!cleanedContent) {
                        return interaction.editReply({ content: "❌ Erreur d'exécution IA (Cerebras / Groq)." });
                    }

                    const buffer = Buffer.from(cleanedContent, 'utf-8');
                    const attachmentToSend = new AttachmentBuilder(buffer, { name: 'combos_cleaned.txt' });

                    await interaction.editReply({
                        content: "✅ Voici vos combos nettoyés par l'IA :",
                        files: [attachmentToSend]
                    });

                } catch (err) {
                    console.error('Erreur combo-cleaner :', err);
                    await interaction.editReply({ content: '❌ Une erreur est survenue lors du nettoyage.' });
                }
            }
            else if (commandName === 'give-premgen') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const targetUser = interaction.options.getUser('utilisateur');
                const premiumRoleId = getGuildConfig(interaction.guild.id, 'premiumRoleId');
                
                if (!premiumRoleId) {
                    return interaction.editReply({ content: "❌ Aucun rôle Premium n'est configuré sur ce serveur. Configurez-le via `/config gen` d'abord." });
                }

                try {
                    const member = await interaction.guild.members.fetch(targetUser.id);
                    await member.roles.add(premiumRoleId);
                    await interaction.editReply({ content: `✅ Le rôle Premium Générateur (<@&${premiumRoleId}>) a été ajouté à ${targetUser}.` });
                } catch (error) {
                    console.error(error);
                    await interaction.editReply({ content: `❌ Impossible d'ajouter le rôle. Vérifiez que mes permissions sont correctes et que mon rôle est au-dessus du rôle Premium.` });
                }
            }

            else if (commandName === 'remove-premgen') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const targetUser = interaction.options.getUser('utilisateur');
                const premiumRoleId = getGuildConfig(interaction.guild.id, 'premiumRoleId');
                
                if (!premiumRoleId) {
                    return interaction.editReply({ content: "❌ Aucun rôle Premium n'est configuré sur ce serveur." });
                }

                try {
                    const member = await interaction.guild.members.fetch(targetUser.id);
                    await member.roles.remove(premiumRoleId);
                    await interaction.editReply({ content: `✅ Le rôle Premium Générateur (<@&${premiumRoleId}>) a été retiré à ${targetUser}.` });
                } catch (error) {
                    console.error(error);
                    await interaction.editReply({ content: `❌ Impossible de retirer le rôle. Vérifiez mes permissions.` });
                }
            }

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

                    const addedCount = await addTursoCombos(serviceId, combos);
                    const totalStockCount = await getTursoStockCount(serviceId);

                    if (addedCount === 0) {
                        return interaction.editReply({
                            content: `⚠️ **Aucun nouveau compte importé** : Les **${comboCount}** comptes de votre fichier sont déjà tous présents dans le stock du service **${serviceName}** !`
                        });
                    }

                    const guild = interaction.guild;
                    let frRestockCh = guild.channels.cache.find(c => c.name === '📦・restock' || c.name.includes('restock-fr'));
                    let enRestockCh = guild.channels.cache.find(c => c.name === '📦・restocks' || c.name.includes('restock-en'));

                    if (!frRestockCh) frRestockCh = interaction.channel;

                    const restockEmbedFr = new EmbedBuilder()
                        .setTitle('📦 Restock Effectué')
                        .setDescription([
                            `Un nouveau restock vient d'être effectué !`,
                            '',
                            `🛒 **Service :** **${serviceName}**`,
                            `📊 **Nouveaux comptes importés :** **${addedCount}** *(sur ${comboCount} analysés)*`,
                            `📈 **Stock Total Actuel :** **${totalStockCount}** comptes`,
                            `👤 **Restocké par :** <@${interaction.user.id}>`,
                            '',
                            'Rendez-vous dans le salon générateur (`#gen-free` / `#gen-premium`) pour générer votre compte !'
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
                                `📊 **New accounts imported:** **${addedCount}** *(out of ${comboCount} analyzed)*`,
                                `📈 **Total Current Stock:** **${totalStockCount}** accounts`,
                                `👤 **Restocked by:** <@${interaction.user.id}>`,
                                '',
                                'Head over to the generator channel (`#free-gen` / `#premium-gen`) to generate your account!'
                            ].join('\n'))
                            .setColor('#FEE75C')
                            .setTimestamp();

                        await enRestockCh.send({ embeds: [restockEmbedEn] });
                    }

                    await interaction.editReply({
                        content: `✅ Restock de **${addedCount}** nouveaux comptes uniques pour **${serviceName}** publié dans les salons ! Stock total : **${totalStockCount}**.`
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

            else if (commandName === 'setup' && interaction.options.getSubcommand() === 'channels') {
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

            else if (commandName === 'setup' && interaction.options.getSubcommand() === 'permissions') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                const guild = interaction.guild;
                const updatedChannels = [];

                try {
                    const channels = await guild.channels.fetch();
                    const everyoneRole = guild.roles.everyone;

                    // Update channels
                    for (const [id, ch] of channels) {
                        if (ch && ch.type === ChannelType.GuildText) {
                            const overwrites = getPermissionOverwrites(guild, ch.name, ch.id);
                            await ch.permissionOverwrites.set(overwrites);

                            if (ch.name === '✅・proof' || ch.name === '✅・proofs') {
                                await sendProofRuleBanner(ch, ch.name.includes('proofs') ? 'en' : 'fr');
                            }

                            if (ch.id === '1532367061974519998' || ch.id === '1532367078030446602' || ch.name.includes('invite')) {
                                await sendInviteRulesBanner(ch, ch.id === '1532367078030446602' || ch.name.includes('invites') ? 'en' : 'fr');
                            }

                            const permType = channelPermissionConfigs[ch.name]?.readOnly 
                                ? '🔒 *(Lecture Seule)*' 
                                : (channelPermissionConfigs[ch.name]?.proofRules ? '📸 *(Proofs)*' : (channelPermissionConfigs[ch.name]?.premiumOnly || ch.name.includes('premium') ? '⭐ *(Premium)*' : '💬 *(Public)*'));

                            updatedChannels.push(`- <#${ch.id}> (\`${ch.name}\`) : ${permType}`);
                        }
                    }

                    // Setup role global perms
                    const frRole = guild.roles.cache.find(r => r.name === '🇫🇷 Français');
                    const enRole = guild.roles.cache.find(r => r.name === '🇬🇧 English');
                    const countryChoiceRole = guild.roles.cache.find(r => r.name === 'Country Choice');
                    const notRegRole = guild.roles.cache.find(r => r.name === 'Not Registered');
                    
                    const ownerRoleFr = guild.roles.cache.find(r => r.name.toLowerCase() === 'fondateur');
                    const ownerRoleEn = guild.roles.cache.find(r => r.name.toLowerCase() === 'founder');
                    const adminRoleFr = guild.roles.cache.find(r => r.name.toLowerCase() === 'administrateur');
                    const adminRoleEn = guild.roles.cache.find(r => r.name.toLowerCase() === 'administrator');
                    const modRoleFr = guild.roles.cache.find(r => r.name.toLowerCase() === 'modérateur');
                    const modRoleEn = guild.roles.cache.find(r => r.name.toLowerCase() === 'moderator');

                    const setAdminPerms = async (role) => {
                        if (role) await role.setPermissions([PermissionFlagsBits.Administrator]);
                    };
                    const setModPerms = async (role) => {
                        if (role) await role.setPermissions([
                            PermissionFlagsBits.ManageMessages, 
                            PermissionFlagsBits.KickMembers, 
                            PermissionFlagsBits.BanMembers, 
                            PermissionFlagsBits.MuteMembers, 
                            PermissionFlagsBits.ViewAuditLog, 
                            PermissionFlagsBits.ManageChannels
                        ]);
                    };

                    await setAdminPerms(ownerRoleFr);
                    await setAdminPerms(ownerRoleEn);
                    await setAdminPerms(adminRoleFr);
                    await setAdminPerms(adminRoleEn);
                    await setModPerms(modRoleFr);
                    await setModPerms(modRoleEn);

                    // Supprime les perms inutiles du rôle verified
                    const verifiedRole = guild.roles.cache.get(VERIFIED_ROLE_ID);
                    if (verifiedRole) {
                        await verifiedRole.setPermissions([]);
                    }
                    if (countryChoiceRole) await countryChoiceRole.setPermissions([]);
                    if (notRegRole) await notRegRole.setPermissions([]);

                    const permEmbed = new EmbedBuilder()
                        .setTitle('🛡️ Permissions Mises à Jour')
                        .setDescription(updatedChannels.length > 0 
                            ? `Les permissions ont été ajustées sur les salons suivants :\n\n${updatedChannels.join('\n')}\n\n*Les permissions des rôles Owner, Mod et Verified ont également été corrigées.*`
                            : '⚠️ Aucun salon trouvé mais rôles mis à jour.')
                        .setColor('#5865F2')
                        .setTimestamp();

                    await interaction.editReply({ embeds: [permEmbed] });

                } catch (error) {
                    console.error('Erreur /setup permissions :', error);
                    await interaction.editReply({
                        content: '❌ Erreur lors de la mise à jour.'
                    });
                }
            }

            else if (commandName === 'setup' && interaction.options.getSubcommand() === 'audit') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const guild = interaction.guild;
                const groqApiKey = process.env.GROQ_API_KEY;

                try {
                    const roles = guild.roles.cache.map(r => `${r.name} (ID: ${r.id})`).join(', ');
                    const textChannels = guild.channels.cache
                        .filter(c => c.type === ChannelType.GuildText)
                        .map(c => `${c.name} (ID: ${c.id})`)
                        .join('\n');

                    const reqRole = getGuildConfig(guild.id, 'requiredRoleId');
                    const premRole = getGuildConfig(guild.id, 'premiumRoleId');

                    const summaryText = `Rôles serveur: ${roles}\n\nSalons textuels:\n${textChannels}\n\nRôle requis Free: ${reqRole || 'aucun'}\nRôle requis Premium: ${premRole || 'aucun'}`;

                    if (!groqApiKey) {
                        const localAuditEmbed = new EmbedBuilder()
                            .setTitle('🔍 Audit de Sécurité Anti-Erreur (Local)')
                            .setDescription([
                                '✅ **Vérifications de base effectuées :**',
                                '• Rôles de pays (`🇫🇷 Français`, `🇬🇧 English`) détectés.',
                                `• Rôle Générateur Free : ${reqRole ? `<@&${reqRole}>` : '`Non configuré (ouvert aux membres)`'}`,
                                `• Rôle Générateur Premium : ${premRole ? `<@&${premRole}>` : '`Non configuré (ouvert aux membres VIP)`'}`,
                                '• Permissions de salons configurées avec masquage `@everyone`.',
                                '',
                                '*Pour activer la révision IA avancée via Groq, configurez GROQ_API_KEY dans votre fichier .env ou sur Render.*'
                            ].join('\n'))
                            .setColor('#57F287')
                            .setTimestamp();

                        return interaction.editReply({ embeds: [localAuditEmbed] });
                    }

                    const prompt = `Fais un audit de sécurité complet et anti-erreur pour ce serveur Discord. Analyse cette structure et vérifie que les permissions des générateurs et du système de vérification sont parfaites. Sois concis et donne un avis professionnel avec des recommandations.\n\nStructure:\n${summaryText}`;

                    const auditReport = await queryAI(prompt, 1000);

                    if (!auditReport) {
                        return interaction.editReply({ content: '❌ Erreur d\'appel à l\'IA (Cerebras / Groq) pour l\'audit.' });
                    }

                    const auditEmbed = new EmbedBuilder()
                        .setTitle('🤖 Rapport d\'Audit Anti-Erreur IA (Groq Llama-3.3)')
                        .setDescription(auditReport.slice(0, 4000))
                        .setColor('#FFD700')
                        .setTimestamp()
                        .setFooter({ text: 'NextGen Security Audit', iconURL: interaction.client.user.displayAvatarURL() });

                    await interaction.editReply({ embeds: [auditEmbed] });

                } catch (e) {
                    console.error('Audit Error:', e);
                    await interaction.editReply({ content: '❌ Erreur pendant l\'audit.' });
                }
            }
        } 

        else if (interaction.isRoleSelectMenu()) {
            const { customId, values, guild } = interaction;
            const selectedRoleId = values[0];

            if (customId === 'select_role_requis_fr') {
                setGuildConfig(guild.id, 'requiredRoleId_fr', selectedRoleId || null);
                const roleMention = selectedRoleId ? `<@&${selectedRoleId}>` : '`Aucun`';
                await interaction.reply({ content: `✅ Rôle requis (Free FR) mis à jour sur ${roleMention}.`, flags: MessageFlags.Ephemeral });
            } else if (customId === 'select_role_requis_en') {
                setGuildConfig(guild.id, 'requiredRoleId_en', selectedRoleId || null);
                const roleMention = selectedRoleId ? `<@&${selectedRoleId}>` : '`Aucun`';
                await interaction.reply({ content: `✅ Rôle requis (Free EN) mis à jour sur ${roleMention}.`, flags: MessageFlags.Ephemeral });
            } else if (customId === 'select_role_premium_fr') {
                setGuildConfig(guild.id, 'premiumRoleId_fr', selectedRoleId || null);
                const roleMention = selectedRoleId ? `<@&${selectedRoleId}>` : '`Aucun`';
                await interaction.reply({ content: `✅ Rôle requis (Premium FR) mis à jour sur ${roleMention}.`, flags: MessageFlags.Ephemeral });
            } else if (customId === 'select_role_premium_en') {
                setGuildConfig(guild.id, 'premiumRoleId_en', selectedRoleId || null);
                const roleMention = selectedRoleId ? `<@&${selectedRoleId}>` : '`Aucun`';
                await interaction.reply({ content: `✅ Rôle requis (Premium EN) mis à jour sur ${roleMention}.`, flags: MessageFlags.Ephemeral });
            }
        }

        else if (interaction.isStringSelectMenu()) {
            const { customId, values, guild } = interaction;

            if (customId === 'settings_select_category') {
                const selectedVal = values[0];

                if (selectedVal === 'settings_cat_gen') {
                    const cooldown = getGuildConfig(guild.id, 'cooldown') ?? 60;
                    const reqFr = getGuildConfig(guild.id, 'requiredRoleId_fr');
                    const reqEn = getGuildConfig(guild.id, 'requiredRoleId_en');
                    const premFr = getGuildConfig(guild.id, 'premiumRoleId_fr');
                    const premEn = getGuildConfig(guild.id, 'premiumRoleId_en');
                    const dailyLimit = getGuildConfig(guild.id, 'dailyLimit') ?? 0;
                    const currentGif = getGuildConfig(guild.id, 'panelGifUrl');

                    const genEmbed = new EmbedBuilder()
                        .setTitle('⚡ Configuration du Générateur')
                        .setDescription([
                            'Voici les paramètres actuels du générateur par pays :',
                            '',
                            `⏱️ **Cooldown entre 2 gens :** **${cooldown}s**`,
                            `🔑 **Rôle Requis (Free FR) :** ${reqFr ? `<@&${reqFr}>` : '`Aucun`'}`,
                            `🔑 **Rôle Requis (Free EN) :** ${reqEn ? `<@&${reqEn}>` : '`Aucun`'}`,
                            `👑 **Rôle Premium (FR) :** ${premFr ? `<@&${premFr}>` : '`Aucun`'}`,
                            `👑 **Rôle Premium (EN) :** ${premEn ? `<@&${premEn}>` : '`Aucun`'}`,
                            `📊 **Limite Journalière :** ${dailyLimit > 0 ? `**${dailyLimit}** / jour` : '`Illimitée`'}`,
                            `🖼️ **Bannière GIF :** ${currentGif ? `[Voir le GIF](${currentGif})` : '`Par Défaut`'}`,
                            '',
                            'Utilisez les menus déroulants et boutons ci-dessous pour modifier la configuration !'
                        ].join('\n'))
                        .setColor('#5865F2');

                    const reqRoleFrRow = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId('select_role_requis_fr')
                            .setPlaceholder('🇫🇷 Rôle Requis Free (FR)...')
                            .setMinValues(0).setMaxValues(1)
                    );
                    const reqRoleEnRow = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId('select_role_requis_en')
                            .setPlaceholder('🇬🇧 Rôle Requis Free (EN)...')
                            .setMinValues(0).setMaxValues(1)
                    );
                    const premRoleFrRow = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId('select_role_premium_fr')
                            .setPlaceholder('🇫🇷 Rôle Premium (FR)...')
                            .setMinValues(0).setMaxValues(1)
                    );
                    const premRoleEnRow = new ActionRowBuilder().addComponents(
                        new RoleSelectMenuBuilder()
                            .setCustomId('select_role_premium_en')
                            .setPlaceholder('🇬🇧 Rôle Premium (EN)...')
                            .setMinValues(0).setMaxValues(1)
                    );

                    const btnRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('settings_btn_cooldown').setLabel('⏱️ Cooldown').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('settings_btn_daily').setLabel('📊 Limite Daily').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('settings_btn_gif').setLabel('🖼️ Modifier GIF').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('settings_btn_reset').setLabel('🔄 Réinitialiser').setStyle(ButtonStyle.Danger)
                    );

                    await interaction.reply({
                        embeds: [genEmbed],
                        components: [reqRoleFrRow, reqRoleEnRow, premRoleFrRow, premRoleEnRow, btnRow],
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
                } else if (selectedVal === 'settings_cat_services') {
                    const freeList = [];
                    const premList = [];

                    for (const s of services) {
                        const tier = getServiceTier(guild.id, s.id);
                        if (tier === 'premium') {
                            premList.push(`👑 **${s.label}** \`[${s.id}]\``);
                        } else {
                            freeList.push(`🆓 **${s.label}** \`[${s.id}]\``);
                        }
                    }

                    const servicesEmbed = new EmbedBuilder()
                        .setTitle('🛒 Configuration du Tier des Services (Free / Premium)')
                        .setDescription([
                            'Voici la répartition actuelle des services pour votre serveur :',
                            '',
                            '### 🆓 **Services en Accès Free :**',
                            freeList.length > 0 ? freeList.join('\n') : '`Aucun`',
                            '',
                            '### 👑 **Services en Accès Premium (VIP) :**',
                            premList.length > 0 ? premList.join('\n') : '`Aucun`',
                            '',
                            '👉 *Choisissez un service dans le menu ci-dessous pour modifier son statut en direct !*'
                        ].join('\n'))
                        .setColor('#FEE75C');

                    const serviceSelectRow = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select_service_tier')
                            .setPlaceholder('🛒 Choisir un service à configurer...')
                            .addOptions(services.map(s => ({
                                label: s.label,
                                description: `Statut actuel : ${getServiceTier(guild.id, s.id).toUpperCase()}`,
                                value: s.id,
                                emoji: getServiceTier(guild.id, s.id) === 'premium' ? '👑' : '🆓'
                            })))
                    );

                    await interaction.reply({
                        embeds: [servicesEmbed],
                        components: [serviceSelectRow],
                        flags: MessageFlags.Ephemeral
                    });
                }
            } else if (customId === 'select_service_tier') {
                const serviceId = values[0];
                const sObj = services.find(s => s.id === serviceId);
                const currentTier = getServiceTier(guild.id, serviceId);

                const tierEmbed = new EmbedBuilder()
                    .setTitle(`⚙️ Modification du Service : ${sObj ? sObj.label : serviceId}`)
                    .setDescription([
                        `Statut actuel : **${currentTier.toUpperCase()}** ${currentTier === 'premium' ? '👑' : '🆓'}`,
                        '',
                        'Cliquez sur l\'un des boutons ci-dessous pour modifier le statut :'
                    ].join('\n'))
                    .setColor('#5865F2');

                const btnRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_set_free_${serviceId}`)
                        .setLabel('🆓 Passer en Free')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(currentTier === 'free'),
                    new ButtonBuilder()
                        .setCustomId(`btn_set_prem_${serviceId}`)
                        .setLabel('👑 Passer en Premium')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentTier === 'premium')
                );

                await interaction.reply({
                    embeds: [tierEmbed],
                    components: [btnRow],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // --- GESTIONNAIRE DE BOUTONS ---
        else if (interaction.isButton()) {
            const { customId, guild, user } = interaction;

            // CHOIX DE PAYS / LANGUE (Français / English) -> DUO ROLES (PAYS + MEMBRE)
            if (customId === 'lang_fr' || customId === 'lang_en') {
                const isFr = customId === 'lang_fr';
                const { countryChoiceRole, frRole, enRole, frMemberRole, enMemberRole } = await getOrCreateSetupRoles(guild);
                const member = await guild.members.fetch(user.id).catch(() => null);

                if (member) {
                    if (isFr) {
                        if (frRole) await member.roles.add(frRole.id).catch(() => {});
                        if (frMemberRole) await member.roles.add(frMemberRole.id).catch(() => {});
                        if (enRole) await member.roles.remove(enRole.id).catch(() => {});
                        if (enMemberRole) await member.roles.remove(enMemberRole.id).catch(() => {});
                    } else {
                        if (enRole) await member.roles.add(enRole.id).catch(() => {});
                        if (enMemberRole) await member.roles.add(enMemberRole.id).catch(() => {});
                        if (frRole) await member.roles.remove(frRole.id).catch(() => {});
                        if (frMemberRole) await member.roles.remove(frMemberRole.id).catch(() => {});
                    }
                    // Retrait du rôle Country Choice -> Le salon 🌍・country disparaît automatiquement !
                    if (countryChoiceRole) {
                        await member.roles.remove(countryChoiceRole.id).catch(() => {});
                    }
                }

                return interaction.reply({
                    content: isFr 
                        ? '🇫🇷 **Vous avez sélectionné la France !** Rôles `🇫🇷 Français` et `Membre` attribués. Accès aux salons FR débloqué.' 
                        : '🇬🇧 **You selected English!** Roles `🇬🇧 English` and `Member` assigned. Access to EN channels unlocked.',
                    flags: MessageFlags.Ephemeral
                });
            }

            // BOUTONS DE PREUVE / AVIS
            if (customId === 'btn_channel_proof') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_channel_proof')
                    .setTitle('⭐ Publier un Avis & Preuve');

                const serviceInput = new TextInputBuilder()
                    .setCustomId('service_input')
                    .setLabel('Service généré (ex: Netflix, Roblox...)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: Netflix')
                    .setRequired(true);

                const starsInput = new TextInputBuilder()
                    .setCustomId('stars_input')
                    .setLabel('Note sur 5 (Nombre d\'étoiles : 1 à 5)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: 5')
                    .setRequired(true);

                const reviewInput = new TextInputBuilder()
                    .setCustomId('review_input')
                    .setLabel('Votre avis / commentaire')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Ex: Super compte, fonctionne nickel !')
                    .setRequired(true);

                const imageInput = new TextInputBuilder()
                    .setCustomId('image_input')
                    .setLabel('Lien URL du screenshot (optionnel)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: https://i.goopics.net/xxx.png')
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(serviceInput),
                    new ActionRowBuilder().addComponents(starsInput),
                    new ActionRowBuilder().addComponents(reviewInput),
                    new ActionRowBuilder().addComponents(imageInput)
                );
                return interaction.showModal(modal);
            }
            else if (customId.startsWith('btn_dm_proof_')) {
                const serviceId = customId.replace('btn_dm_proof_', '');
                const modal = new ModalBuilder()
                    .setCustomId(`modal_dm_proof_${serviceId}`)
                    .setTitle('⭐ Publier un Avis & Preuve');

                const starsInput = new TextInputBuilder()
                    .setCustomId('stars_input')
                    .setLabel('Note sur 5 (Nombre d\'étoiles : 1 à 5)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: 5')
                    .setRequired(true);

                const reviewInput = new TextInputBuilder()
                    .setCustomId('review_input')
                    .setLabel('Votre avis / commentaire')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Ex: Compte fonctionnel direct, merci !')
                    .setRequired(true);

                const imageInput = new TextInputBuilder()
                    .setCustomId('image_input')
                    .setLabel('Lien URL du screenshot (optionnel)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: https://i.imgur.com/xxx.png')
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(starsInput),
                    new ActionRowBuilder().addComponents(reviewInput),
                    new ActionRowBuilder().addComponents(imageInput)
                );
                return interaction.showModal(modal);
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
            else if (customId === 'settings_btn_gif') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_settings_gif')
                    .setTitle('🖼️ GIF du Générateur');

                const gifInput = new TextInputBuilder()
                    .setCustomId('gif_input')
                    .setLabel('Lien URL de la bannière GIF/Image')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Ex: https://i.goopics.net/mkvcwm.gif')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(gifInput));
                await interaction.showModal(modal);
            }
            else if (customId.startsWith('btn_set_free_')) {
                const serviceId = customId.replace('btn_set_free_', '');
                const sObj = services.find(s => s.id === serviceId);
                setServiceTier(guild.id, serviceId, 'free');
                await interaction.reply({
                    content: `✅ Le service **${sObj ? sObj.label : serviceId}** est désormais **GRATUIT (Free)** 🆓 !\n*Les panneaux de génération s'actualisent automatiquement en direct d'ici 5 secondes.*`,
                    flags: MessageFlags.Ephemeral
                });
            }
            else if (customId.startsWith('btn_set_prem_')) {
                const serviceId = customId.replace('btn_set_prem_', '');
                const sObj = services.find(s => s.id === serviceId);
                setServiceTier(guild.id, serviceId, 'premium');
                await interaction.reply({
                    content: `👑 Le service **${sObj ? sObj.label : serviceId}** est désormais **PREMIUM (VIP)** 👑 !\n*Les panneaux de génération s'actualisent automatiquement en direct d'ici 5 secondes.*`,
                    flags: MessageFlags.Ephemeral
                });
            }
            else if (customId === 'settings_btn_reset') {
                setGuildConfig(guild.id, 'cooldown', 60);
                setGuildConfig(guild.id, 'requiredRoleId', null);
                setGuildConfig(guild.id, 'premiumRoleId', null);
                setGuildConfig(guild.id, 'dailyLimit', 0);
                setGuildConfig(guild.id, 'panelGifUrl', null);

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

                if (gwData.participants.has(user.id)) {
                    gwData.participants.delete(user.id);
                    await interaction.reply({
                        content: '❌ Participation retirée / Entry removed.',
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    gwData.participants.add(user.id);
                    await interaction.reply({
                        content: '🎉 **Participation enregistrée / Entry registered !** Bonne chance / Good luck !',
                        flags: MessageFlags.Ephemeral
                    });
                }

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

                const member = await guild.members.fetch(user.id).catch(() => null);
                if (member) {
                    await checkMemberStatusRole(member);
                }

                const isEnglishUser = member ? member.roles.cache.some(r => r.name.includes('English') || r.name.includes('Anglais')) : false;

                const defaultReqFr = FREEGEN_ROLE_FR_ID;
                const defaultReqEn = FREEGEN_ROLE_EN_ID;

                const reqRoleIdFr = getGuildConfig(guild.id, 'requiredRoleId_fr') || getGuildConfig(guild.id, 'requiredRoleId') || defaultReqFr;
                const reqRoleIdEn = getGuildConfig(guild.id, 'requiredRoleId_en') || getGuildConfig(guild.id, 'requiredRoleId') || defaultReqEn;
                const premRoleIdFr = getGuildConfig(guild.id, 'premiumRoleId_fr') || getGuildConfig(guild.id, 'premiumRoleId');
                const premRoleIdEn = getGuildConfig(guild.id, 'premiumRoleId_en') || getGuildConfig(guild.id, 'premiumRoleId');

                const reqRoleId = isEnglishUser ? reqRoleIdEn : reqRoleIdFr;
                const premiumRoleId = isEnglishUser ? premRoleIdEn : premRoleIdFr;

                if (reqRoleId && member && !member.roles.cache.has(reqRoleId)) {
                    const faqChannel = guild.channels.cache.find(c => c.name.includes('faq') || c.name.includes('req'));
                    const faqMention = faqChannel ? `<#${faqChannel.id}>` : '`#faq`';

                    if (isEnglishUser) {
                        return interaction.reply({
                            content: [
                                '❌ **Generator Access Denied**',
                                '',
                                'To unlock access to the Free generator, you must put `discadia.gg/nextg3n` in your **Discord Custom Status**!',
                                '',
                                '📖 **Instructions:**',
                                '1. Set `discadia.gg/nextg3n` in your Discord Status.',
                                '2. Wait a few seconds for your role to be automatically assigned.',
                                `3. Check ${faqMention} if you need further help!`,
                                '',
                                '🔗 **Generator Channel:** <#1532367088809676975>'
                            ].join('\n'),
                            flags: MessageFlags.Ephemeral
                        });
                    } else {
                        return interaction.reply({
                            content: [
                                '❌ **Accès au Générateur Refusé**',
                                '',
                                'Pour débloquer l\'accès au générateur Free, vous devez obligatoirement ajouter `discadia.gg/nextg3n` dans votre **Statut Personnalisé Discord** !',
                                '',
                                '📖 **Instructions :**',
                                '1. Ajoutez `discadia.gg/nextg3n` dans votre statut Discord.',
                                '2. Patientez quelques secondes que le rôle vous soit attribué automatiquement.',
                                `3. Consultez le salon ${faqMention} si vous avez des questions !`,
                                '',
                                '🔗 **Salon du Générateur :** <#1532367071273291817>'
                            ].join('\n'),
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }

                const effectiveTier = serviceObj ? getServiceTier(guild.id, serviceObj.id) : 'free';
                if (serviceObj && effectiveTier === 'premium') {
                    if (premiumRoleId && member && !member.roles.cache.has(premiumRoleId)) {
                        return interaction.reply({
                            content: isEnglishUser 
                                ? `👑 **Access Denied**: The **${serviceName}** service is reserved for Premium members. You must hold the VIP role <@&${premiumRoleId}> to generate.`
                                : `👑 **Accès Refusé** : Le service **${serviceName}** est réservé aux membres Premium. Vous devez posséder le rôle VIP <@&${premiumRoleId}> pour générer.`,
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
                            '⭐ *N\'oubliez pas de publier votre preuve et votre avis pour aider la communauté !*'
                        ].join('\n'))
                        .setColor('#5865F2')
                        .setTimestamp();

                    const proofRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`btn_dm_proof_${serviceId}`)
                            .setLabel('⭐ Laisser un Avis & Preuve')
                            .setStyle(ButtonStyle.Success)
                    );

                    await user.send({
                        embeds: [dmEmbed],
                        components: [proofRow]
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


