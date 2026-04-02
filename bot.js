const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const express = require('express'); // Cron-job uchun

// Renderda BOT_TOKEN deb yozasiz
const BOT_TOKEN = process.env.BOT_TOKEN; 
const ADMIN_ID = 7312694067; 

const bot = new Telegraf(BOT_TOKEN);
let db;

// CRON-JOB UCHUN WEB SERVER (Bot o'chib qolmasligi uchun)
const app = express();
app.get('/', (req, res) => res.send('Bot is online!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// 1. BAZANI ISHGA TUSHIRISH
async function initDB() {
    db = await open({ filename: './cinema.db', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS movies (code TEXT PRIMARY KEY, file_id TEXT, file_type TEXT, bio TEXT);
        CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, link TEXT, chat_id TEXT);
    `);
}

// 2. OBUNANI TEKSHIRISH
async function checkTelegramSubs(ctx) {
    if (ctx.from.id === Number(ADMIN_ID)) return [];
    const channels = await db.all('SELECT * FROM channels');
    let mustJoin = [];
    for (const ch of channels) {
        if (ch.chat_id.startsWith('-100')) {
            try {
                const member = await ctx.telegram.getChatMember(ch.chat_id, ctx.from.id);
                if (['left', 'kicked', 'restricted'].includes(member.status)) mustJoin.push(ch);
            } catch (e) { console.log(`Xato: ${ch.chat_id}`); }
        }
    }
    return mustJoin;
}

async function getAllUnsubLinks(ctx) {
    const channels = await db.all('SELECT * FROM channels');
    let links = [];
    for (const ch of channels) {
        if (ch.chat_id.startsWith('-100')) {
            try {
                const member = await ctx.telegram.getChatMember(ch.chat_id, ctx.from.id);
                if (['left', 'kicked', 'restricted'].includes(member.status)) links.push(ch);
            } catch (e) {}
        } else { links.push(ch); }
    }
    return links;
}

// 3. ADMIN MENU
const adminMenu = Markup.keyboard([
    ['🎬 Kino qo\'shish', '🎥 Kinolar ro\'yxati'],
    ['🗑 Kinoni o\'chirish', '📢 Kanallar sozlamasi']
]).resize();

bot.start(async (ctx) => {
    if (ctx.from.id === Number(ADMIN_ID)) return ctx.reply("👋 Salom, Admin!", adminMenu);
    const allUnsub = await getAllUnsubLinks(ctx);
    if (allUnsub.length > 0) {
        let buttons = allUnsub.map(ch => [Markup.button.url(ch.chat_id.startsWith('-100') ? "📢 Obuna bo'lish" : "📸 Instagram", ch.link)]);
        buttons.push([Markup.button.callback('✅ Tasdiqlash', 'check_sub')]);
        return ctx.reply("👋 Salom! Botdan foydalanish uchun homiylarga obuna bo'ling:", { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
    ctx.reply("🎬 Kino kodini yuboring:");
});

// 4. ADMIN FUNKSIYALARI
bot.hears('🎬 Kino qo\'shish', (ctx) => {
    if (ctx.from.id === Number(ADMIN_ID)) ctx.reply("📥 Video yuboring va captionga `KOD BIO` yozing.");
});

bot.hears('🗑 Kinoni o\'chirish', (ctx) => {
    if (ctx.from.id === Number(ADMIN_ID)) ctx.reply("🗑 O'chirish: `DEL#KOD` yuboring.");
});

bot.hears('🎥 Kinolar ro\'yxati', async (ctx) => {
    if (ctx.from.id !== Number(ADMIN_ID)) return;
    const movies = await db.all('SELECT code, bio FROM movies LIMIT 50');
    if (movies.length === 0) return ctx.reply("📭 Bazada kinolar yo'q.");
    let msg = "🎥 **Bazdagi kinolar ro'yxati:**\n\n";
    movies.forEach(m => {
        msg += `🔑 Kod: \`${m.code}\` | 📝 ${m.bio.substring(0, 20)}...\n`;
    });
    msg += "\n🗑 O'chirish uchun: `DEL#KOD`";
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.hears('📢 Kanallar sozlamasi', async (ctx) => {
    if (ctx.from.id !== Number(ADMIN_ID)) return;
    const channels = await db.all('SELECT * FROM channels');
    let msg = "📢 **Kanallar:**\n\n";
    channels.forEach(ch => msg += `🆔 ${ch.id} | ${ch.link}\n`);
    ctx.reply(msg, Markup.inlineKeyboard([[Markup.button.callback('➕ Qo\'shish', 'start_add_ch'), Markup.button.callback('🗑 O\'chirish', 'del_channel')]]));
});

// 5. CALLBACKLAR
bot.action('start_add_ch', (ctx) => ctx.reply("🛠 Telegram: `ADD#LINK#-100...` \nInsta: `ADD#LINK#INSTA`"));
bot.action('del_channel', (ctx) => ctx.reply("🗑 O'chirish: `DEL_CH#ID`"));
bot.action('check_sub', async (ctx) => {
    const mustJoin = await checkTelegramSubs(ctx);
    if (mustJoin.length === 0) {
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply("✅ Tasdiqlandi! Kino kodini yuboring.");
    } else {
        const allUnsub = await getAllUnsubLinks(ctx);
        let buttons = allUnsub.map(ch => [Markup.button.url(ch.chat_id.startsWith('-100') ? "📢 Obuna bo'lish" : "📸 Instagram", ch.link)]);
        buttons.push([Markup.button.callback('✅ Tasdiqlash', 'check_sub')]);
        await ctx.editMessageText("❌ Obuna to'liq emas!", Markup.inlineKeyboard(buttons)).catch(() => {});
    }
});

// 6. ASOSIY TEXT
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (ctx.from.id === Number(ADMIN_ID)) {
        if (text.startsWith('ADD#')) {
            const p = text.split('#');
            if (p.length === 3) { await db.run('INSERT INTO channels (link, chat_id) VALUES (?, ?)', [p[1], p[2]]); return ctx.reply("✅ Qo'shildi!"); }
        }
        if (text.startsWith('DEL_CH#')) {
            await db.run('DELETE FROM channels WHERE id = ?', [text.split('#')[1]]);
            return ctx.reply("🗑 Kanal o'chirildi.");
        }
        if (text.startsWith('DEL#')) {
            const res = await db.run('DELETE FROM movies WHERE code = ?', [text.split('#')[1]]);
            return ctx.reply(res.changes > 0 ? "✅ Kino o'chirildi!" : "❌ Topilmadi.");
        }
        if (['🎬 Kino qo\'shish', '🗑 Kinoni o\'chirish', '📢 Kanallar sozlamasi', '🎥 Kinolar ro\'yxati'].includes(text)) return;
    }

    const mustJoin = await checkTelegramSubs(ctx);
    if (mustJoin.length > 0) {
        const allUnsub = await getAllUnsubLinks(ctx);
        let buttons = allUnsub.map(ch => [Markup.button.url(ch.chat_id.startsWith('-100') ? "📢 Obuna bo'lish" : "📸 Instagram", ch.link)]);
        buttons.push([Markup.button.callback('✅ Tasdiqlash', 'check_sub')]);
        return ctx.reply("🛑 Avval homiylarga obuna bo'ling!", Markup.inlineKeyboard(buttons));
    }

    const movie = await db.get('SELECT * FROM movies WHERE code = ?', [text]);
    if (movie) {
        const cap = `🎬 Kod: ${text}\n\n${movie.bio || ""}`;
        movie.file_type === 'video' ? await ctx.replyWithVideo(movie.file_id, { caption: cap }) : await ctx.replyWithDocument(movie.file_id, { caption: cap });
    } else if (!isNaN(text)) ctx.reply("😔 Topilmadi.");
});

// 7. VIDEO QABUL QILISH
bot.on(['video', 'document'], async (ctx) => {
    if (ctx.from.id === Number(ADMIN_ID) && ctx.message.caption) {
        const cap = ctx.message.caption;
        let code = cap.split(' ')[0], bio = cap.substring(code.length).trim();
        const fId = ctx.message.video ? ctx.message.video.file_id : ctx.message.document.file_id;
        const type = ctx.message.video ? 'video' : 'document';
        await db.run('INSERT OR REPLACE INTO movies (code, file_id, file_type, bio) VALUES (?, ?, ?, ?)', [code, fId, type, bio]);
        ctx.reply(`✅ Saqlandi! Kod: ${code}`);
    }
});

initDB().then(() => bot.launch());