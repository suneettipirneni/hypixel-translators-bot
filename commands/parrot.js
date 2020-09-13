const {  workingColor,  errorColor,  successColor,  neutralColor} = require("../config.json");
const Discord = require("discord.js");

module.exports = {
  name: "parrot",
  description: "Say something in a specific channel.",
  usage: "parrot <message>",
  aliases: ["say", "repeat", "send"],
  allowDM: true,
  execute(strings, message, args) {
    const executedBy = strings.executedBy.replace("%%user%%", message.author.tag)
    const rawSendTo = args[0]
    args.splice(0, 1)
    var toSend = args.join(" ")

    //message.delete();
    var allowed = false
    if (message.author.id == "722738307477536778") { allowed = true }
    if (message.channel.type !== "dm") { if (message.member.roles.cache.has("621071221462663169") || message.member.roles.cache.has("549885657749913621") || message.member.roles.cache.has("241926666400563203")) { allowed = true } }
    if (!allowed) return;

    const embed = new Discord.MessageEmbed()
      .setColor(workingColor)
      .setAuthor(strings.moduleName)
      .setTitle(strings.loading)
      .setFooter(executedBy)
    message.channel.send(embed)
      .then(msg => {
        const sendTo = msg.client.channels.cache.get(rawSendTo)
        sendTo.send(">>> " + toSend)
        const embed = new Discord.MessageEmbed()
          .setColor(successColor)
          .setAuthor(strings.moduleName)
          .setTitle(strings.success.replace("%%channel%%", "<#" + sendTo.id + ">"))
          .setDescription(">>> " + toSend)
          .setFooter(executedBy)
        msg.edit(embed)
      })
  }
};