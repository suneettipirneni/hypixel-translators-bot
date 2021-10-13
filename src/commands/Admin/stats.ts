import { successColor, ids } from "../../config.json"
import Discord from "discord.js"
import { execute, updateProjectStatus } from "../../events/stats"
import { Command, client } from "../../index"
import { generateTip } from "../../lib/util"

const command: Command = {
	name: "stats",
	description: "Updates statistics channels and notifies members of new strings (if applicable).",
	options: [{
		type: "STRING",
		name: "project",
		description: "The project to update statistics for. Defaults to all projects",
		choices: [
			{ name: "Hypixel", value: "hypixel" },
			{ name: "Quickplay", value: "quickplay" },
			{ name: "SkyblockAddons", value: "sba" },
			{ name: "Hypixel Translators Bot", value: "bot" }
		],
		required: false
	}],
	roleWhitelist: [ids.roles.admin],
	async execute(interaction) {
		const projectInput = interaction.options.getString("project", false),
			member = interaction.member as Discord.GuildMember
		await interaction.deferReply()
		if (!projectInput) {
			await execute(true)
				.then(async () => {
					const allEmbed = new Discord.MessageEmbed()
						.setColor(successColor as Discord.HexColorString)
						.setAuthor("Statistics updater")
						.setTitle("All language statistics have been updated!")
						.setDescription(`Check them out at ${interaction.guild!.channels.cache.find(c => c.name === "hypixel-language-status")}, ${interaction.guild!.channels.cache.find(c => c.name === "sba-language-status")}, ${interaction.guild!.channels.cache.find(c => c.name === "bot-language-status")} and ${interaction.guild!.channels.cache.find(c => c.name === "quickplay-language-status")}`)
						.setFooter(generateTip(), member.displayAvatarURL({ format: "png", dynamic: true }))
					await interaction.editReply({ embeds: [allEmbed] })
				})
				.catch(err => { throw err })
		} else {
			switch (projectInput) {
				case "hypixel": {
					await updateProjectStatus("128098")
					break
				}
				case "quickplay": {
					await updateProjectStatus("369653")
					break
				}
				case "sba": {
					await updateProjectStatus("369493")
					break
				}
				case "bot": {
					await updateProjectStatus("436418")
					break
				}
			}
			const projectEmbed = new Discord.MessageEmbed()
				.setColor(successColor as Discord.HexColorString)
				.setAuthor("Statistics updater")
				.setTitle(`The ${projectInput} language statistics have been updated!`)
				.setDescription(`Check it out at ${interaction.guild!.channels.cache.find(c => c.name === `${projectInput}-language-status`)}!`)
				.setFooter(generateTip(), member.displayAvatarURL({ format: "png", dynamic: true }))
			await interaction.editReply({ embeds: [projectEmbed] })
			console.log(`Manually updated the ${projectInput} language statistics.`)
		}
	}
}

export default command
