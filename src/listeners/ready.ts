import { client, Command } from "../index"
import stats from "../events/stats"
import inactives from "../events/inactives"
import crowdin from "../events/crowdinverify"
import { listeningStatuses, watchingStatuses, playingStatuses, successColor } from "../config.json"
import Discord from "discord.js"
import { isEqual } from "lodash"
import { db } from "../lib/dbclient"
import { PunishmentLog, restart } from "../lib/util"

client.once("ready", async () => {
	//Sometimes the client is ready before connecting to the db, therefore we need to stop the listener if this is the case to prevent errors
	//In dbclient.ts the event is emitted again if the connection is made after the client is ready
	if (!db) return
	console.log(`Logged in as ${client.user!.tag}!`)
	const guild = client.guilds.cache.get("549503328472530974")!

	//Only update global commands in production
	if (process.env.NODE_ENV === "production") {
		const globalCommands = await client.application!.commands.fetch()
		client.commands.filter(c => !!c.allowDM).forEach(async command => {
			if (!globalCommands) await publishCommand(command)
			else {
				const discordCommand = globalCommands.find(c => c.name === command.name)!
				//Chech if the command is published
				if (!globalCommands.some(cmd => cmd.name === command.name)) await publishCommand(command)
				else if (!commandEquals(discordCommand, command)) {
					await discordCommand.edit(convertToDiscordCommand(command))
					console.log(`Edited command ${command.name} since changes were found\n`, discordCommand, command)
				}
			}
		})
		//Delete commands that have been removed locally
		globalCommands.forEach(async command => {
			if (!client.commands.get(command.name)) {
				await command.delete()
				console.log(`Deleted command ${command.name} as it was deleted locally.`)
			} else if (!client.commands.get(command.name)?.allowDM) {
				await command.delete()
				console.log(`Deleted command ${command.name} globally as it is no longer allowed in DMs`)
			}
		})
	}
	//Set guild commands - these don't need checks since they update instantly
	(await guild.commands.set(constructDiscordCommands())).forEach(async command => await setPermissions(command))

	//Get server boosters and staff for the status
	const boostersStaff: string[] = []
	await guild.members.fetch()
	guild?.roles.premiumSubscriberRole!.members.forEach(member => boostersStaff.push(member.displayName.replaceAll(/\[[^\s]*\] ?/g, "").trim()))
	guild?.roles.cache.get("768435276191891456")! //Discord Staff
		.members.forEach(member => boostersStaff.push(member.displayName.replaceAll(/\[[^\s]*\] ?/g, "").trim()))

	//Change status and run events every minute
	setInterval(async () => {
		const pickedUser = boostersStaff[Math.floor(Math.random() * boostersStaff.length)],
			toPick = Math.ceil(Math.random() * 100) //get percentage
		// const statusType = client.user!.presence.activities[0].type

		if (toPick > 66) {
			//Higher than 66%
			const playingStatus = playingStatuses[Math.floor(Math.random() * playingStatuses.length)].replace("RANDOM_USER", pickedUser)
			client.user!.setActivity({ name: playingStatus, type: "PLAYING" })
		} else if (toPick <= 66 && toPick > 33) {
			//Between 33% and 66% (inclusive)
			const watchStatus = watchingStatuses[Math.floor(Math.random() * watchingStatuses.length)].replace("RANDOM_USER", pickedUser)
			client.user!.setActivity({ name: watchStatus, type: "WATCHING" })
		} else if (toPick <= 33 && toPick > 0) {
			//Between 0% and 33% (inclusive)
			const listenStatus = listeningStatuses[Math.floor(Math.random() * listeningStatuses.length)].replace("RANDOM_USER", pickedUser)
			client.user!.setActivity({ name: listenStatus, type: "LISTENING" })
		} else console.error("Couldn't set the status because the percentage is a weird number: " + toPick)

		await stats(client, false)
		await inactives(client, false)
		await crowdin(client, false)
	}, 60_000)

	//Check for active punishments and start a timeout to conclude them
	const punishmentsColl = db.collection<PunishmentLog>("punishments"),
		punishments = await punishmentsColl.find({ ended: false }).toArray(),
		punishmentsChannel = guild.channels.cache.get("800820574405656587") as Discord.TextChannel
	for (const punishment of punishments) {
		if (!punishment.endTimestamp) continue
		const msLeft = punishment.endTimestamp! - Date.now()
		// The setTimeout function doesn't accept values bigger than the 32-bit signed integer limit, so we need to check for that.
		// Additionally, we restart the bot at least once every 2 days so no punishment will be left unexpired
		if (msLeft > 2 ** 31 - 1) continue
		setTimeout(async () => {
			await punishmentsColl.updateOne({ case: punishment.case }, { $set: { ended: true, endTimestamp: Date.now() } })
			const caseNumber = (await punishmentsColl.estimatedDocumentCount()) + 1
			if (punishment.type === "MUTE") {
				const member = guild.members.cache.get(punishment.id!),
					user = await client.users.fetch(punishment.id)
				const punishmentLog = new Discord.MessageEmbed()
					.setColor(successColor as Discord.HexColorString)
					.setAuthor(`Case ${caseNumber} | Unmute | ${user.tag}`, user.displayAvatarURL({ format: "png", dynamic: true }))
					.addFields([
						{ name: "User", value: user.toString(), inline: true },
						{ name: "Moderator", value: client.user!.toString(), inline: true },
						{ name: "Reason", value: "Ended" }
					])
					.setFooter(`ID: ${user.id}`)
					.setTimestamp(),
					msg = await punishmentsChannel.send({ embeds: [punishmentLog] })
				await punishmentsColl.insertOne({
					case: caseNumber,
					id: user.id,
					type: `UN${punishment.type}`,
					reason: "Ended",
					timestamp: Date.now(),
					moderator: client.user.id,
					logMsg: msg.id,
				} as PunishmentLog)
				if (!member) return console.log(`Couldn't find member with id ${punishment.id} in order to unmute them`)
				else await member.roles.remove("645208834633367562", "Punishment ended") //Muted
				const dmEmbed = new Discord.MessageEmbed()
					.setColor(successColor as Discord.HexColorString)
					.setAuthor("Punishment")
					.setTitle(`Your mute on ${guild.name} has expired.`)
					.setDescription("You will now be able to talk in chats again. If something's wrong, please respond in this DM.")
					.setTimestamp()
				await member.send({ embeds: [dmEmbed] })
					.catch(() => console.log(`Couldn't DM user ${user.tag}, (${member.id}) about their unmute.`))
			} else if (punishment.type === "BAN") {
				const user = await guild.bans.remove(punishment.id!, "Punishment ended")
					.catch(err => console.error(`Couldn't unban user with id ${punishment.id}. Here's the error:\n`, err)),
					userFetched = await client.users.fetch(punishment.id),
					punishmentLog = new Discord.MessageEmbed()
						.setColor(successColor as Discord.HexColorString)
						.setAuthor(`Case ${caseNumber} | Unban | ${userFetched.tag}`, userFetched.displayAvatarURL({ format: "png", dynamic: true }))
						.addFields([
							{ name: "User", value: userFetched.toString(), inline: true },
							{ name: "Moderator", value: client.user!.toString(), inline: true },
							{ name: "Reason", value: "Ended" }
						])
						.setFooter(`ID: ${userFetched.id}`)
						.setTimestamp()
				if (!user) punishmentLog.setDescription("Couldn't unban user from the server.")
				else {
					const dmEmbed = new Discord.MessageEmbed()
						.setColor(successColor as Discord.HexColorString)
						.setAuthor("Punishment")
						.setTitle(`Your ban on ${guild.name} has expired.`)
						.setDescription("You are welcome to join back using the invite in this message.")
						.setTimestamp()
					await user.send({ content: "https://discord.gg/rcT948A", embeds: [dmEmbed] })
						.catch(() => console.log(`Couldn't DM user ${userFetched.tag}, (${user.id}) about their unban.`))
				}
				const msg = await punishmentsChannel.send({ embeds: [punishmentLog] })
				await punishmentsColl.insertOne({
					case: caseNumber,
					id: userFetched.id,
					type: `UN${punishment.type}`,
					reason: "Ended",
					timestamp: Date.now(),
					moderator: client.user.id,
					logMsg: msg.id,
				} as PunishmentLog)
			} else console.error(`For some reason a ${punishment.type} punishment wasn't expired. Case ${punishment.case}`)
		}, msLeft)
	}

	// restart the bot every 2 days
	setInterval(async () => {
		console.log("Bot has been running for 2 days, restarting...");
		(client.channels.cache.get("730042612647723058") as Discord.TextChannel).send("I have been running for 2 days straight, gonna restart...") //bot-development
		await restart()
	}, 172_800_000)
})

async function publishCommand(command: Command) {
	const cmd = await client.application!.commands.create(convertToDiscordCommand(command))
	await setPermissions(cmd)
	console.log(`Published command ${command.name}!`)
}

async function setPermissions(command: Discord.ApplicationCommand<{ guild: Discord.GuildResolvable }>) {
	const permissions: Discord.ApplicationCommandPermissionData[] = [],
		clientCmd = client.commands.get(command.name)!
	if (clientCmd.dev) permissions.push({
		type: "ROLE",
		id: "768435276191891456", //Discord Staff
		permission: true
	})
	else {
		clientCmd.roleWhitelist?.forEach(id => {
			//Add whitelisted roles
			permissions.push({
				type: "ROLE",
				id,
				permission: true
			})
		})
		clientCmd.roleBlacklist?.forEach(id => {
			//Add blacklisted roles
			permissions.push({
				type: "ROLE",
				id,
				permission: false
			})
		})
	}
	if (permissions.length) await command.permissions.set({ permissions, guild: "549503328472530974" })
}

function constructDiscordCommands() {
	const returnCommands: Discord.ApplicationCommandData[] = []
	let clientCommands = client.commands
	if (process.env.NODE_ENV === "production") clientCommands = clientCommands.filter(cmd => !cmd.allowDM)
	clientCommands.forEach(c => returnCommands.push(convertToDiscordCommand(c)))

	return returnCommands
}

function convertToDiscordCommand(command: Command): Discord.ChatInputApplicationCommandData {
	return {
		name: command.name,
		description: command.description,
		defaultPermission: command.roleWhitelist || command.dev ? false : true,
		options: command.options
	}
}

const commandEquals = (discordCommand: Discord.ApplicationCommand, localCommand: Command) =>
	discordCommand.name === localCommand.name &&
	discordCommand.description === localCommand.description &&
	isEqual(discordCommand.options, localCommand.options?.map(o => transformOption(o)) ?? [])

function transformOption(option: Discord.ApplicationCommandOptionData): Discord.ApplicationCommandOptionData {
	return {
		type: option.type,
		name: option.name,
		description: option.description,
		required:
			option.type === "SUB_COMMAND" || option.type === "SUB_COMMAND_GROUP"
				? option.required
				: option.required ?? false,
		choices:
			option.type === "STRING" || option.type === "NUMBER" || option.type === "INTEGER"
				? option.choices
				: undefined,
		options:
			(option.type === "SUB_COMMAND" || option.type === "SUB_COMMAND_GROUP") && option.options
				? option.options?.map(o => transformOption(o))
				: undefined,
	} as Discord.ApplicationCommandOptionData
}
