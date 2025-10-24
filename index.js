const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const DISCORD_CHANNEL_ID = process.env.CHANNEL_TEST;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

async function checkYoutubeLive() {
    console.log('test');
    
    try {
        const searchRes = await axios.get(
            `https://www.googleapis.com/youtube/v3/search`, {
            params: {
                part: "snippet",
                channelId: YOUTUBE_CHANNEL_ID,
                eventType: "upcoming",
                type: "video",
                key: YOUTUBE_API_KEY
            }
        });

        if (searchRes.data.items.length > 0) {
            const videoId = searchRes.data.items[0].id.videoId;

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
            const title = stream.snippet.title;
            const scheduledTime = stream.liveStreamingDetails?.scheduledStartTime;
            const url = `https://www.youtube.com/watch?v=${videoId}`;

            const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
            channel.send(`🔴 @everyone สตรีมเริ่มแล้ว!\n
**ชื่อสตรีม:** ${title}\n
**เริ่มเวลา:** ${new Date(scheduledTime).toLocaleString("th-TH")}\n
**ลิงก์:** ${url}`);
        }
    } catch (err) {
        console.error("Error checking YouTube Live:", err.message);
    }
}

client.once("ready", async () => {
    console.log("Bot Active");

    checkYoutubeLive();
    setInterval(checkYoutubeLive, 60 * 1000); // ตรวจสอบทุก 1 นาที
});

client.login(process.env.DISCORD_TOKEN);
