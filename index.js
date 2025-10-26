// ------------------------
// โหลด Module ที่จำเป็น
// ------------------------
const express = require("express");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const dotenv = require("dotenv");
const xml2js = require("xml2js");

dotenv.config();

// ------------------------
// Express Server
// ------------------------
const app = express();
app.use(express.text({ type: "*/*" })); // รับ raw XML จาก YouTube WebSub

// ------------------------
// Discord Bot
// ------------------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const DISCORD_CHANNEL_ID = process.env.CHANNEL_TEST;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const notifiedStreams = new Set(); // เก็บ videoId ที่เคยแจ้งแล้ว
const activeStreams = new Map(); // เก็บ stream ที่กำลังไลฟ์ (เพื่อแจ้งซ้ำ)

client.once("ready", () => {
    console.log(`✅ Bot Active as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);

// ------------------------
// YouTube WebSub Endpoint
// ------------------------

// ✅ สำหรับการ verify subscription ของ YouTube
app.get("/youtube-websub", (req, res) => {
    const challenge = req.query["hub.challenge"];
    if (challenge) {
        console.log("✅ YouTube Webhook verified!");
        res.send(challenge);
    } else {
        res.sendStatus(200);
    }
});

// ✅ รับการแจ้งเตือนจาก YouTube
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

            // ถ้าเคยแจ้งไปแล้ว และยังอยู่ใน activeStreams → ข้าม
            if (notifiedStreams.has(videoId)) continue;

            // ดึงข้อมูลจาก YouTube API
            const videoRes = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
                params: {
                    part: "snippet,liveStreamingDetails",
                    id: videoId,
                    key: YOUTUBE_API_KEY,
                },
            });

            const stream = videoRes.data.items[0];
            if (!stream) continue;

            const liveStatus = stream.snippet.liveBroadcastContent; // live | upcoming | none
            const scheduledTime = stream.liveStreamingDetails?.scheduledStartTime;
            const channelTitle = stream.snippet.channelTitle;
            const thumbnail = stream.snippet.thumbnails?.high?.url || stream.snippet.thumbnails?.default?.url;
            const url = `https://www.youtube.com/watch?v=${videoId}`;

            // ❌ ถ้าสตรีมจบแล้วไม่ต้องแจ้ง
            if (liveStatus === "none") {
                if (activeStreams.has(videoId)) {
                    clearInterval(activeStreams.get(videoId).interval);
                    activeStreams.delete(videoId);
                    console.log(`⏹ Stream ${videoId} ended.`);
                }
                continue;
            }

            // ✅ แจ้งเตือนครั้งแรก
            const discordChannel = await client.channels.fetch(DISCORD_CHANNEL_ID);
            const embed = new EmbedBuilder()
                .setColor(liveStatus === "live" ? 0xff0000 : 0x00ff00)
                .setTitle(title)
                .setURL(url)
                .setAuthor({ name: channelTitle })
                .setThumbnail(thumbnail)
                .setDescription(
                    liveStatus === "live"
                        ? "🔴 **กำลังไลฟ์อยู่ตอนนี้!**"
                        : "⏰ **สตรีมมิ่งกำลังจะเริ่มเร็วๆ นี้!**"
                )
                .addFields(
                    { name: "สถานะ", value: liveStatus, inline: true },
                    scheduledTime
                        ? { name: "เวลาเริ่มต้น", value: new Date(scheduledTime).toLocaleString("th-TH"), inline: true }
                        : { name: "เวลาเริ่มต้น", value: "ไม่ระบุ", inline: true }
                )
                .setFooter({ text: "YouTube Live Notification Bot" })
                .setTimestamp();

            await discordChannel.send({
                content: "@everyone 🎬 พบกับการสตรีมจากช่อง!",
                embeds: [embed],
                allowedMentions: { parse: ["everyone"] },
            });

            console.log(`📢 แจ้งเตือนสตรีมใหม่: ${title} (${videoId})`);
            notifiedStreams.add(videoId);

            // 🔁 ตั้ง Interval เช็กทุก 30 นาที
            const interval = setInterval(async () => {
                try {
                    const checkRes = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
                        params: {
                            part: "snippet",
                            id: videoId,
                            key: YOUTUBE_API_KEY,
                        },
                    });

                    const check = checkRes.data.items[0];
                    const currentStatus = check?.snippet?.liveBroadcastContent;

                    if (currentStatus === "live") {
                        console.log(`🔴 Stream ${videoId} ยังไลฟ์อยู่ → ส่งแจ้งเตือนซ้ำ`);
                        await discordChannel.send({
                            content: `🔁 **${title}** ยังคงไลฟ์อยู่!\n▶️ ${url}`,
                        });
                    } else {
                        console.log(`✅ Stream ${videoId} จบแล้ว → ยกเลิกการแจ้งซ้ำ`);
                        clearInterval(interval);
                        activeStreams.delete(videoId);
                    }
                } catch (err) {
                    console.error("⚠️ Error checking stream:", err.message);
                }
            }, 30 * 60 * 1000); // 30 นาที

            activeStreams.set(videoId, { interval });
        }
    } catch (err) {
        console.error("❌ Error parsing WebSub XML:", err.message);
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
        console.log("✅ Subscribed to YouTube WebSub!");
    } catch (err) {
        console.error("❌ Error subscribing:", err.message);
    }
}

// ------------------------
// Start Server
// ------------------------

if (BASE_URL) {
    setInterval(() => {
        axios
            .get(BASE_URL)
            .then(() => console.log("💓 Self ping to prevent sleep"))
            .catch(() => console.warn("⚠️ Self ping failed"));
    }, 5 * 60 * 1000); // ทุก 5 นาที
}

subscribeYouTube();

app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});
