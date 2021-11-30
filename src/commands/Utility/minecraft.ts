import axios from "axios"
import { EmbedFieldData, GuildMember, Message, MessageActionRow, MessageButton, MessageEmbed } from "discord.js"
import { client } from "../../index"
import { colors, ids } from "../../config.json"
import { db, DbUser } from "../../lib/dbclient"
import { fetchSettings, generateTip, getUUID, updateButtonColors } from "../../lib/util"

import type { Command, GetStringFunction } from "../../lib/imports"

//Credits to marzeq for initial implementation
const command: Command = {
	name: "minecraft",
	description: "Looks up a specific Minecraft player's name history or skin",
	options: [{
		type: "SUB_COMMAND",
		name: "history",
		description: "Shows a user's name history. You must provide at least 1 parameter if your MC account is not linked",
		options: [{
			type: "STRING",
			name: "username",
			description: "The IGN/UUID of the user to get name history for. Defaults to your user if your account is linked",
			required: false
		},
		{
			type: "USER",
			name: "user",
			description: "The server member to get the name history for. Only works if the user has verified themselves",
			required: false
		}]
	},
	{
		type: "SUB_COMMAND",
		name: "skin",
		description: "Shows a user's skin. You must provide at least 1 parameter if your MC account is not linked",
		options: [{
			type: "STRING",
			name: "username",
			description: "The IGN/UUID of the user to get the skin for. Defaults to your own skin if your account is linked",
			required: false
		},
		{
			type: "USER",
			name: "user",
			description: "The server member to get the skin for. Only works if the user has verified themselves",
			required: false
		}]
	}],
	cooldown: 30,
	channelWhitelist: [ids.channels.bots, ids.channels.staffBots, ids.channels.botDev],
	allowDM: true,
	async execute(interaction, getString: GetStringFunction) {
		await interaction.deferReply()
		const randomTip = generateTip(getString),
			member = interaction.member as GuildMember | null ?? interaction.user,
			authorDb: DbUser = await client.getUser(interaction.user.id),
			subCommand = interaction.options.getSubcommand(),
			userInput = interaction.options.getUser("user", false),
			usernameInput = interaction.options.getString("username", false)

		let uuid: string | undefined
		if (userInput) {
			const userInputDb = await client.getUser(userInput.id)
			if (userInputDb!.uuid) uuid = userInputDb!.uuid
			else throw "notVerified"
		} else if (usernameInput && usernameInput.length < 32) uuid = await getUUID(usernameInput)
		else uuid = usernameInput ?? authorDb.uuid
		if (!userInput && !usernameInput && !authorDb.uuid) throw "noUser"
		if (!uuid) throw "falseUser"
		const isOwnUser = uuid === authorDb.uuid,
			uuidDb = await db.collection<DbUser>("users").findOne({ uuid })

		switch (subCommand) {
			case "history":
				const nameHistory = await getNameHistory(uuid)
				nameHistory.forEach(e => e.name = e.name.replaceAll("_", "\\_"))
				const username = nameHistory[0].name

				let p = 0
				const pages: NameHistory[][] = []
				while (p < nameHistory.length) pages.push(nameHistory.slice(p, p += 24)) //Max number of fields divisible by 3

				if (pages.length == 1) {
					const nameHistoryEmbed = fetchPage(0, pages)
					await interaction.editReply({ embeds: [nameHistoryEmbed] })
				} else {
					let controlButtons = new MessageActionRow()
						.addComponents(
							new MessageButton()
								.setStyle("SUCCESS")
								.setEmoji("⏮️")
								.setCustomId("first")
								.setLabel(getString("pagination.first", "global")),
							new MessageButton()
								.setStyle("SUCCESS")
								.setEmoji("◀️")
								.setCustomId("previous")
								.setLabel(getString("pagination.previous", "global")),
							new MessageButton()
								.setStyle("SUCCESS")
								.setEmoji("▶️")
								.setCustomId("next")
								.setLabel(getString("pagination.next", "global")),
							new MessageButton()
								.setStyle("SUCCESS")
								.setEmoji("⏭️")
								.setCustomId("last")
								.setLabel(getString("pagination.last", "global"))
						),
						page = 0,
						pageEmbed = fetchPage(page, pages)

					controlButtons = updateButtonColors(controlButtons, page, pages)
					await interaction.editReply({ embeds: [pageEmbed], components: [controlButtons] })
					const msg = await interaction.fetchReply() as Message

					const collector = msg.createMessageComponentCollector<"BUTTON">({ idle: this.cooldown! * 1000 })

					collector.on("collect", async buttonInteraction => {
						const userDb: DbUser = await client.getUser(buttonInteraction.user.id)
						if (interaction.user.id !== buttonInteraction.user.id) return await buttonInteraction.reply({ content: getString("pagination.notYours", { command: `/${this.name}` }, "global", userDb.lang), ephemeral: true })
						else if (buttonInteraction.customId === "first") page = 0
						else if (buttonInteraction.customId === "last") page = pages.length - 1
						else if (buttonInteraction.customId === "previous") {
							page--
							if (page < 0) page = 0
						}
						else if (buttonInteraction.customId === "next") {
							page++
							if (page > pages.length - 1) page = pages.length - 1
						}
						controlButtons = updateButtonColors(controlButtons, page, pages)
						pageEmbed = fetchPage(page, pages)
						await buttonInteraction.update({ embeds: [pageEmbed], components: [controlButtons] })
					})

					collector.on("end", async () => {
						controlButtons.components.forEach(button => button.setDisabled(true))
						await interaction.editReply({ content: getString("pagination.timeOut", { command: `\`/${this.name}\`` }, "global"), embeds: [pageEmbed], components: [controlButtons] })
					})
				}

				function fetchPage(page: number, pages: NameHistory[][]) {
					return new MessageEmbed()
						.setColor(colors.success)
						.setAuthor(getString("moduleName"))
						.setTitle(getString("history.nameHistoryFor", { username }))
						.setDescription(
							nameHistory.length - 1
								? nameHistory.length - 1 == 1
									? getString(isOwnUser ? "history.youChangedName1" : "history.userChangedName1", { username })
									: getString(isOwnUser ? "history.youChangedName" : "history.userChangedName", { username, number: nameHistory.length - 1 })
								: getString(isOwnUser ? "history.youNeverChanged" : "history.userNeverChanged", { username })
						)
						.addFields(constructFields(pages[page]))
						.setFooter(
							pages.length == 1
								? randomTip
								: getString("pagination.page", { number: page + 1, total: pages.length }, "global"),
							member.displayAvatarURL({ format: "png", dynamic: true })
						)
				}

				function constructFields(array: NameHistory[]) {
					const fields: EmbedFieldData[] = []
					array.forEach(name =>
						fields.push({
							name: name.name,
							value: name.changedToAt ? `<t:${Math.round(new Date(name.changedToAt!).getTime() / 1000)}:F>` : getString("history.firstName"),
							inline: true
						})
					)
					return fields
				}

				break
			case "skin":
				const skinEmbed = new MessageEmbed()
					.setColor(colors.success)
					.setAuthor(getString("moduleName"))
					.setTitle(isOwnUser
						? getString("skin.yourSkin")
						: getString("skin.userSkin", { user: (await getPlayer(uuid)).name }))
					.setDescription(uuidDb && !isOwnUser ? getString("skin.isLinked", { user: `<@!${uuidDb.id}>` }) : "")
					.setImage(`https://crafatar.com/renders/body/${uuid}?overlay`)
					.setFooter(randomTip, member.displayAvatarURL({ format: "png", dynamic: true }))
				await interaction.editReply({ embeds: [skinEmbed] })
				break
		}
	}
}

export default command

async function getPlayer(uuid: string) {
	const json = await axios.get<UserProfile & { error?: string }>(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`, fetchSettings).then(res => res.data)
	if (json.error) throw "falseUUID"
	return json
}

async function getNameHistory(uuid: string) {
	const json = await axios.get(`https://api.mojang.com/user/profiles/${uuid}/names`, fetchSettings).then(res => res.data)
	if (json.error) throw "falseUUID"
	return json.reverse() as NameHistory[]
}

/** @see https://wiki.vg/Mojang_API#UUID_to_Name_History */
interface NameHistory {
	name: string
	changedToAt?: number
}

/** @see https://wiki.vg/Mojang_API#UUID_to_Profile_and_Skin.2FCape */
interface UserProfile {
	id: string
	name: string
	legacy?: boolean
	properties: {
		name: string
		value: string
	}[]
}
