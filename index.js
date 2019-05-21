require('dotenv').config()

const path = require('path')
const Discord = require('discord.js')
const client = new Discord.Client()
const { TranslationServiceClient } = require('@google-cloud/translate').v3beta1
const translator = new TranslationServiceClient()
const jsonfile = require('jsonfile')

const configFile = path.join(__dirname, 'config.json')
const config = {}
const users = {}
const locales = {}

function catchError (err) {
  if (config.throwErrors) throw err
  else console.error(err)
}

function log (msg) {
  if (config.verbose) console.log(msg)
}

function writeConfig () {
  jsonfile.writeFile(configFile, config, { spaces: 2 })
    .then(log('Config written.'))
    .catch(catchError)
}

async function discordTranslate (msg) {
  const lc = users[msg.author.id]

  const request = {
    parent: translator.locationPath(process.env.PID, 'global'),
    contents: [msg.cleanContent],
    mimeType: 'text/plain',
    targetLanguageCode: lc
  }
  const [response] = await translator.translateText(request)
  const translation = response.translations
    .map(t => t.translatedText)
    .join('\n')

  msg.channel.send(
    translation,
    {
      embed: {
        author: {
          name: msg.member.displayName,
          icon: msg.author.displayAvatarURL
        },
        color: msg.member.displayColor,
        timestamp: msg.createdAt,
        title: `Original message translated to ${locales[lc]}`,
        url: msg.url
      }
    }
  ).catch(catchError)
}

function translateCommand (msg, args) {
  if (!args.length) {
    const usersList = Object.keys(users)
      .filter(id => msg.guild.members.has(id))
      .map(id => `${msg.guild.members.get(id).displayName}: ${locales[users[id]]}`)
      .join(', ')
    msg.channel.send(
      usersList.length
        ? `Currently active translations are \`${usersList}\`.`
        : 'No active translations.'
    ).catch(catchError)
  } else {
    const members = msg.mentions.members

    if (args[0] === 'clear') {
      Object.keys(users).forEach(id => delete users[id])

      msg.channel.send('Active translations cleared.').catch(catchError)
      return
    }

    if (!members.array().length) {
      msg.channel.send('You need to specify at least one user.').catch(catchError)
      return
    }

    if (args[0] === 'enable') {
      if (locales.hasOwnProperty(args[1])) {
        const lc = args[1]

        members.forEach(member => {
          users[member.id] = lc

          msg.channel.send(`Enabled translation to \`${locales[lc]}\` for \`${member.displayName}\`.`).catch(catchError)
        })
      } else msg.channel.send('You need to specify a valid locale.').catch(catchError)
    } else if (args[0] === 'disable') {
      members.forEach(member => {
        if (users.hasOwnProperty(member.id)) {
          delete users[member.id]

          msg.channel.send(`Disabled translation for \`${member.displayName}\`.`).catch(catchError)
        } else msg.channel.send(`Translation is already disabled for \`${member.displayName}\`.`).catch(catchError)
      })
    } else msg.channel.send(`Invalid argument \`${args[0]}\``).catch(catchError)
  }
}

function prefixCommand (msg, args) {
  if (!args.length) msg.channel.send(`Current prefix is \`${config.prefix}\`.`).catch(catchError)
  else {
    config.prefix = args.join(' ')
    msg.channel.send(`New prefix set to \`${config.prefix}\`.`).catch(catchError)

    writeConfig()
  }
}

function rolesCommand (msg, args) {
  if (!args.length) {
    const roles = config.roles
      .filter(r => msg.guild.roles.has(r))
      .map(r => msg.guild.roles.get(r).name)
      .join(', ')
    msg.channel.send(
      roles.length
        ? `Currently whitelisted roles are \`${roles}\`.`
        : 'No whitelisted roles.'
    ).catch(catchError)
  } else {
    const roles = msg.mentions.roles

    if (!roles.array().length) {
      msg.channel.send('You need to specify at least one role.').catch(catchError)
      return
    }

    let change = false

    if (args[0] === 'add') {
      roles.forEach(role => {
        if (config.roles.indexOf(role.id) === -1) {
          config.roles.push(role.id)
          msg.channel.send(`Role v${role.name}\` added to whitelist.`).catch(catchError)

          change = true
        } else {
          msg.channel.send(`Role \`${role.name}\` already whitelisted.`).catch(catchError)
        }
      })
    } else if (args[0] === 'remove') {
      roles.forEach(role => {
        const index = config.roles.indexOf(role.id)

        if (index !== -1) {
          config.roles.splice(index, 1)
          msg.channel.send(`Role \`${role.name}\` removed from whitelist.`).catch(catchError)

          change = true
        } else {
          msg.channel.send(`Role \`${role.name}\` is not whitelisted.`).catch(catchError)
        }
      })
    } else msg.channel.send(`Invalid argument \`${args[0]}\``).catch(catchError)

    if (change) writeConfig()
  }
}

function localesCommand (msg, args) {
  const localesList = Object.keys(locales)
    .map(lc => `\`${lc}\`: ${locales[lc]}`)
    .join('\n')
  msg.channel.send(localesList)
}

const commands = {
  translate: translateCommand,
  prefix: prefixCommand,
  roles: rolesCommand,
  locales: localesCommand
}

client.on('ready', () => {
  log(`Logged in as ${client.user.tag}.`)
})

client.on('message', msg => {
  if (msg.author.id === client.user.id) return

  if (msg.content.startsWith(config.prefix)) {
    log(`Received command ${msg.cleanContent} from ${msg.author.tag}.`)

    const args = msg.content.substring(config.prefix.length).split(' ')
    const command = args.shift()

    if (commands.hasOwnProperty(command)) commands[command](msg, args)
    else msg.channel.send(`Command \`${command}\` does not exist.`).catch(catchError)

    if (config.delCommands) msg.delete()
  } else if (users.hasOwnProperty(msg.author.id)) discordTranslate(msg).catch(catchError)
})

async function start () {
  await jsonfile.readFile(configFile).then(obj => {
    Object.keys(obj).forEach(key => { config[key] = obj[key] })
    return Promise.resolve()
  })

  const request = {
    parent: translator.locationPath(process.env.PID, 'global'),
    displayLanguageCode: 'en'
  }
  const [response] = await translator.getSupportedLanguages(request)
  response.forEach(language => {
    locales[language.languageCode] = language.displayName
  })

  await client.login(process.env.TOKEN)
}

start().catch(catchError)
