const express = require("express");
const { Client, GatewayIntentBits,Partials ,ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const axios = require("axios");
const dotenv = require("dotenv");
const xml2js = require("xml2js");

dotenv.config();

const app = express();
app.use(express.text({ type: "*/*" }));

const client = new Client({
    intents: [GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel], // ✅ ต้องใส่สำหรับ DM channels

});

const DISCORD_CHANNEL_ID = process.env.CHANNEL_TEST;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const messageMap = new Map();
const activeStreams = new Map(); // 🔹 เก็บ stream ที่ยัง live อยู่

client.once("ready", () => {
    console.log(`Bot Active as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);

client.on('messageCreate', async (message) => {
  // อย่าให้บอทตอบตัวเอง
  console.log(message);
  
  if (message.author.bot) return;

  // ตรวจสอบว่าเป็น DM
  if (message.channel.type === 1 || message.channel.type === 'DM') {
    await message.channel.send(`สวัสดี ${message.author.username}! ขอบคุณที่ DM มาหาฉัน 😄`);
    console.log(`ตอบ DM ให้ ${message.author.tag}`);
  }

  if(message.content = "!btn"){
    const btn = new ButtonBuilder().setCustomId('primary_button')
    .setLabel('Click me!')
    .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(btn);

    await message.channel.send({content: 'ปุ่ม',components: [row]});
  }
});

client.removeAllListeners('interactionCreate'); // ก่อน attach listener ใหม่
client.on('interactionCreate', async (interaction) => {
    console.log(interaction);

    if(interaction.isButton()) {
        if(interaction.customId === 'primary_button') {
            await interaction.reply({ content: `คุณกดปุ่มแล้ว!`, ephemeral: true });
        }
        return;
    }

    
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'hello') {
    await interaction.reply(`👋 สวัสดี ${interaction.user.username}!`);
  }
});



// ------------------------
// YouTube WebSub Endpoint
// ------------------------
app.get("/youtube-websub", (req, res) => {
    const challenge = req.query["hub.challenge"];
    if (challenge) {
        console.log("Webhook verified!");
        res.send(challenge);
    } else {
        res.sendStatus(200);
    }
});

app.post("/youtube-websub", async (req, res) => {
    res.sendStatus(200);

    try {
        const xml = req.body;
        const json = await xml2js.parseStringPromise(xml, { explicitArray: false });
        const entry = json.feed.entry;
        if (!entry) return;

        const items = Array.isArray(entry) ? entry : [entry];
        for (let item of items) {
            const videoId = item["yt:videoId"];
            const title = item["title"];

            const videoRes = await axios.get(
                `https://www.googleapis.com/youtube/v3/videos`,
                {
                    params: {
                        part: "snippet,liveStreamingDetails",
                        id: videoId,
                        key: YOUTUBE_API_KEY,
                    },
                }
            );

            const stream = videoRes.data.items[0];
            const liveDetails = stream?.liveStreamingDetails;
            if (!liveDetails) continue;

            const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);

            // 🟥 ไลฟ์จบแล้ว
            if (liveDetails.actualEndTime) {
                if (messageMap.has(videoId)) {
                    try {
                        const messageId = messageMap.get(videoId);
                        const msg = await channel.messages.fetch(messageId);
                        await msg.delete();
                        console.log(`🗑️ ลบข้อความแจ้งเตือนของ live ${videoId}`);
                    } catch (err) {
                        console.warn(`⚠️ ลบข้อความไม่ได้:`, err.message);
                    }
                    messageMap.delete(videoId);
                }

                // ❌ ยกเลิกแจ้งเตือนซ้ำ
                if (activeStreams.has(videoId)) {
                    clearInterval(activeStreams.get(videoId).interval);
                    activeStreams.delete(videoId);
                    console.log(`🛑 หยุดแจ้งซ้ำ live ${videoId}`);
                }

                continue;
            }

            // 🟩 ไลฟ์ใหม่หรือกำลังจะเริ่ม
            if (liveDetails.scheduledStartTime && !liveDetails.actualEndTime) {
                const url = `https://www.youtube.com/watch?v=${videoId}`;
                const msg = await channel.send({
                    content: `@everyone 🎬 สตรีมกำลังจะมา!\nชื่อ: **${title}**\nเริ่มเวลา: ${new Date(liveDetails.scheduledStartTime).toLocaleString("th-TH")}\n📺 ${url}`,
                    allowedMentions: { parse: ["everyone"] },
                });

                messageMap.set(videoId, msg.id);
                console.log(`📢 แจ้งเตือน live: ${title}`);

                // 🔁 ตั้งแจ้งซ้ำทุก 30 นาที
                const interval = setInterval(async () => {
                    try {
                        const res = await axios.get(`https://www.googleapis.com/youtube/v3/videos`, {
                            params: {
                                part: "liveStreamingDetails",
                                id: videoId,
                                key: YOUTUBE_API_KEY,
                            },
                        });
                        const status = res.data.items[0]?.liveStreamingDetails;
                        if (!status || status.actualEndTime) {
                            console.log(`🛑 ไลฟ์ ${videoId} จบแล้ว หยุดแจ้งซ้ำ`);
                            clearInterval(interval);
                            activeStreams.delete(videoId);
                            return;
                        }

                        await channel.send(`📺 ไลฟ์ **${title}** ยังคงดำเนินอยู่!\n🔗 ${url}`);
                        console.log(`⏰ แจ้งซ้ำ (live ยังไม่จบ): ${title}`);
                    } catch (err) {
                        console.error("Error checking live status:", err.message);
                    }
                }, 30 * 60 * 1000); // ทุก 30 นาที

                activeStreams.set(videoId, { interval });
            }
        }
    } catch (err) {
        console.error("Error parsing WebSub XML:", err.message);
    }
});

// ------------------------
// Subscribe YouTube WebSub
// ------------------------
async function subscribeYouTube() {
    try {
        const callback = `${BASE_URL}/youtube-websub`;
        const topic = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;

        await axios.post("https://pubsubhubbub.appspot.com/subscribe", null, {
            params: {
                "hub.mode": "subscribe",
                "hub.topic": topic,
                "hub.callback": callback,
                "hub.verify": "async",
            },
        });
        console.log("Subscribed to YouTube WebSub!");
    } catch (err) {
        console.error("Error subscribing:", err.message);
    }
}

subscribeYouTube();

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
