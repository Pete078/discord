const express = require("express");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const dotenv = require("dotenv");
const xml2js = require("xml2js");

dotenv.config();

const app = express();
app.use(express.text({ type: "*/*" })); // รับ raw XML จาก WebSub

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const DISCORD_CHANNEL_ID = process.env.CHANNEL_TEST;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Set เก็บ videoId ที่แจ้งแล้ว
const notifiedStreams = new Set();

// ------------------------
// Discord Bot
// ------------------------
client.once("ready", () => {
    console.log(`Bot Active as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);

// ------------------------
// WebSub Endpoint
// ------------------------

// สำหรับ YouTube verify subscription
app.get("/youtube-websub", (req, res) => {
    const challenge = req.query["hub.challenge"];
    if (challenge) {
        console.log("Webhook verified!");
        res.send(challenge);
    } else {
        res.sendStatus(200);
    }
});

// รับ notification จาก YouTube
app.post("/youtube-websub", async (req, res) => {
    res.sendStatus(200);

    try {
        const xml = req.body;
        const json = await xml2js.parseStringPromise(xml, { explicitArray: false });

        const entry = json.feed.entry;
        if (!entry) return;

        // ถ้ามีหลาย entry ให้เลือกเป็น array
        const items = Array.isArray(entry) ? entry : [entry];

        for (let item of items) {
            const videoId = item["yt:videoId"];
            const title = item["title"];
            const published = item["published"];

            if (notifiedStreams.has(videoId)) continue; // ไม่แจ้งซ้ำ
            notifiedStreams.add(videoId);

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
            const scheduledTime = stream.liveStreamingDetails?.scheduledStartTime;

            const url = `https://www.youtube.com/watch?v=${videoId}`;
            const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);

            channel.send({
                content: `@everyone 🎬 สตรีมกำลังจะมา!\n${url}\nเริ่มเผยแพร่: ${new Date(scheduledTime).toLocaleString("th-TH")}`,
                allowedMentions: { parse: ["everyone"] } // ป้องกันการแท็กคนอื่นโดยไม่ได้ตั้งใจ
            });


            // Embed สีสวย
            // const embed = new EmbedBuilder()
            //     .setTitle(title)
            //     .setURL(url)
            //     .setDescription(`🎬 สตรีมกำลังจะมา !`)
            //     .addFields(
            //         { name: "เริ่มเผยแพร่", value: new Date(scheduledTime).toLocaleString("th-TH") }
            //     )
            //     .setColor(0xff0000) // ✅ ใช้เลข hexadecimal
            //     .setTimestamp();

            // channel.send({ content: "@everyone", embeds: [embed] });
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

        await axios.post(
            "https://pubsubhubbub.appspot.com/subscribe",
            null,
            {
                params: {
                    "hub.mode": "subscribe",
                    "hub.topic": topic,
                    "hub.callback": callback,
                    "hub.verify": "async"
                },
            }
        );
        console.log("Subscribed to YouTube WebSub!");
    } catch (err) {
        console.error("Error subscribing:", err.message);
    }
}

// Subscribe ตอน start server
subscribeYouTube();

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
