const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const commands = [
    new SlashCommandBuilder()
        .setName('hello')
        .setDescription('บอทจะทักทายคุณ')
        .toJSON(),
];

// const commands = [
//     {
//         name: 'hello',
//         description: 'Say hello!',
//     },
// ];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        // ลบ Global command ทั้งหมด
        const global = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
        for (const cmd of global) {
            await rest.delete(Routes.applicationCommand(process.env.CLIENT_ID, cmd.id));
            console.log(`✅ ลบ Global command: ${cmd.name}`);
        }

        // หรือ ลบ Guild command ทั้งหมด (เฉพาะ server)
        const guild = await rest.get(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID));
        for (const cmd of guild) {
            await rest.delete(Routes.applicationGuildCommand(process.env.CLIENT_ID, process.env.GUILD_ID, cmd.id));
            console.log(`✅ ลบ Guild command: ${cmd.name}`);
        }

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log("✅ ลบ command เรียบร้อย");
    } catch (err) {
        console.error(err);
    }
})();
