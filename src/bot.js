const rx = require('rx');
const _ = require('underscore-plus');

const {RTMClient} = require('@slack/rtm-api');
const {WebClient} = require('@slack/web-api');
const TexasHoldem = require('./texas-holdem');
const MessageHelpers = require('./message-helpers');
const PlayerInteraction = require('./player-interaction');

const WeakBot = require('../ai/weak-bot');
const AggroBot = require('../ai/aggro-bot');

class Bot {
  // Public: Creates a new instance of the bot.
  //
  // token - An API token from the bot integration
  constructor(token) {
    this.slackWeb = new WebClient(token);
    this.slackRTM = new RTMClient(token);

    this.gameConfig = { 
      timeout: 60, 
      maxplayers: 25, 
      start_game_timeout: 3, 
      bots: 1,
      smallblind: 1,
      initialstash: 100,
      show_card_images: 1 
    };

    this.gameConfigDescs = {
      timeout: `How long to wait for players to make each move. Set to 0 to wait forever. (default ${this.gameConfig.timeout})`,
      maxplayers: `Maximum players per table. (default ${this.gameConfig.maxplayers})`,
      start_game_timeout: `How many seconds to wait for players to sign up before starting the game. (default ${this.gameConfig.start_game_timeout})`,
      bots: `Set this to 1 to include autobot players for testing (default ${this.gameConfig.bots})`,
      smallblind: `Initial small blind. (default ${this.gameConfig.smallblind})`,
      initialstash: `Starting value of chips for each player. (default ${this.gameConfig.initialstash})`,
      show_card_images: `Display images of cards (0=no, 1=yes). (default ${this.gameConfig.show_card_images})`
    }

    this.isGameRunning = {};
    this.isPolling = {};
  }

  // Public: Brings this bot online and starts handling messages sent to it.
  login() {
    rx.Observable.fromEvent(this.slackRTM, 'ready')
      .subscribe(() => this.onClientOpened());

    this.slackRTM.start()
      .catch(err => {
        console.log("Slack authentication failed. Check that your SLACK_POKER_BOT_TOKEN is valid");
        process.exit(1);
      });
    this.respondToMessages();
  }

  // Private: Listens for messages directed at this bot 
  // and poll players in response.
  //
  // Returns a {Disposable} that will end this subscription
  respondToMessages() {
    let messages = rx.Observable.fromEvent(this.slackRTM, 'message')
      .where(e => e.type === 'message');

    let atMentions = messages.where(e =>
      MessageHelpers.containsUserMention(e.text, this.slackRTM.activeUserId));

    let disp = new rx.CompositeDisposable();

    disp.add(this.handleStartGameMessages(messages, atMentions));
    disp.add(this.handleSetConfigMessages(atMentions));
    disp.add(this.handleGetConfigMessages(atMentions));
    disp.add(this.handleHelpMessages(atMentions));

    return disp;
  }

  // Private: Looks for messages directed at the bot that contain the word
  // "game." When found, start polling players for a game.
  //
  // messages - An {Observable} representing messages posted to a channel
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription
  handleStartGameMessages(messages, atMentions) {
    return atMentions
      .where(e => e.text && e.text.toLowerCase().match(/\bgame\b/))
      .map(e => e.channel)
      .where(channel => {
        if (channel in this.isPolling && this.isPolling[channel]) {
          return false;
        } else if (channel in this.isGameRunning && this.isGameRunning[channel]) {
          this.slackRTM.sendMessage('Another game is in progress, quit that first.', channel);
          return false;
        }
        return true;
      })
      .flatMap(channel => this.pollPlayersForGame(messages, channel))
      .subscribe();
  }


  // Private: Looks for messages directed at the bot that contain the word
  // "config" and have valid parameters. When found, set the parameter.
  //
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription
  handleSetConfigMessages(atMentions) {
    return atMentions
      .where(e => e.text && e.text.toLowerCase().includes('config'))
      .subscribe(e => {

        e.text.replace(/(\w*)=(\d*)/g, (match, key, value) => {
          if (key in this.gameConfig && value) {
            this.gameConfig[key] = value;
            this.slackRTM.sendMessage(`Game config ${key} has been set to ${value}.`, e.channel);
          }
          else {
            let message = `Unknown configuration option ${key}.\n\nValid options are:\n\`\`\``;
            for (let option in this.gameConfig) {
              let desc = this.gameConfigDescs[option];
              message = message + `${option}: ${desc}\n`;
            }
            message = message + '```';
            this.slackRTM.sendMessage(message, e.channel);
          }
        });
      });
  }

  // Private: Looks for messages directed at the bot that contain the word
  // "config" but nothing else.
  //
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription
  handleGetConfigMessages(atMentions) {
    return atMentions
      .where(e => e.text && e.text.toLowerCase().includes('config'))
      .subscribe(e => {
        let message = `Current configuration values\n\`\`\``;
        //TODO: make this get config of current game in progress (if any)
        //rather than new game settings
        for (let option in this.gameConfig) {
          message = message + `${option}: ${this.gameConfig[option]}\n`;
        }
        message = message + '```';
        this.slackRTM.sendMessage(message, e.channel);
      });
  }

  // Private: Looks for messages directed at the bot that contain the word
  // "help". When found, explain how to start new game.
  //
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription
  handleHelpMessages(atMentions) {
    return atMentions
      .where(e => e.text && e.text.toLowerCase().match(/\bhelp\b/))
      .subscribe(e => {
        this.slackRTM.sendMessage("Type `@" + this.botInfo.name + " game` to start a new game of Texas Hold'em", e.channel);
        this.slackRTM.sendMessage("Type `@" + this.botInfo.name + " deal` to deal the next hand", e.channel);
        this.slackRTM.sendMessage("Type `@" + this.botInfo.name + " increase blinds` to bump the blinds", e.channel);
        this.slackRTM.sendMessage("Type `@" + this.botInfo.name + " config` to review settings", e.channel);
        this.slackRTM.sendMessage("Type `@" + this.botInfo.name + " config <key>=<value>` to adjust settings before starting a game", e.channel);
      });
  }

  // Private: Polls players to join the game, and if we have enough, starts an
  // instance.
  //
  // messages - An {Observable} representing messages posted to the channel
  // channel - The channel where the 'game' message was posted
  //
  // Returns an {Observable} that signals completion of the game 
  pollPlayersForGame(messages, channel) {
    this.isPolling[channel] = true;

    return PlayerInteraction.pollPotentialPlayers(messages, this.slackWeb, this.slackRTM, channel, 
      this.gameConfig.start_game_timeout, this.gameConfig.maxplayers)
      .reduce((players, id) => {
        this.slackWeb.users.info({ user: id })
          .then((result) => {
            let user = result.user;
            this.slackRTM.sendMessage(`@${user.name} has joined the game.`, channel);
            players.push({ id: user.id, name: user.name });
          })
          .catch(console.error);
        return players;
      }, [])
      .flatMap(players => {
        this.isPolling[channel] = false;
        if (this.gameConfig.bots != 0) {
          this.addBotPlayers(players);
        }

        let messagesInChannel = messages.where(e => e.channel === channel);
        return this.startGame(messagesInChannel, channel, players);
      });
  }

  // Private: Starts and manages a new Texas Hold'em game.
  //
  // messages - An {Observable} representing messages posted to the channel
  // channel - The channel where the game will be played
  // players - The players participating in the game
  //
  // Returns an {Observable} that signals completion of the game 
  startGame(messages, channel, players) {
    if (players.length <= 1) {
      this.slackRTM.sendMessage('Not enough players for a game, try again later.', channel);
      return rx.Observable.return(null);
    }

    this.slackRTM.sendMessage(`We've got ${players.length} players, let's start the game.`, channel);
    this.isGameRunning[channel] = true;

    let game = new TexasHoldem(this.slackWeb, this.slackRTM, messages, channel, players, this.gameConfig);
    // TODO: clean this up?
    _.extend(game, this.gameConfig);

    // Listen for messages directed at the bot containing 'quit game.'
    let quitGameDisp = messages.where(e => MessageHelpers.containsUserMention(e.text, this.slackRTM.activeUserId) &&
      e.text.toLowerCase().match(/quit game/))
      .take(1)
      .subscribe(e => {
        this.slackWeb.users.info({ user: e.user })
          .then((result) => {
            let user = result.user;
            this.slackRTM.sendMessage(`${user.name} has decided to quit the game. The game will end after this hand.`, channel);
            game.quit();
          })
          .catch(console.error);
      });

    // Listen for messages directed at the bot containing 'deal'
    let dealHandDisp = messages.where(e => MessageHelpers.containsUserMention(e.text, this.slackRTM.activeUserId) &&
      e.text.toLowerCase().match(/deal/))
      .takeUntil(game.gameEnded)
      .subscribe(e => {
        this.slackWeb.users.info({ user: e.user })
          .then((result) => {
            game.playHand();
          })
          .catch(console.error);
      });

    // Listen for messages directed at the bot containing 'increase blinds'
    let increaseBlindsDisp = messages.where(e => MessageHelpers.containsUserMention(e.text, this.slackRTM.activeUserId) &&
      e.text.toLowerCase().match(/increase blinds/))
      .takeUntil(game.gameEnded)
      .subscribe(e => {
        this.slackWeb.users.info({ user: e.user })
          .then((result) => {
            game.increaseBlinds();
          })
          .catch(console.error);
      });

    let ret = rx.Observable.fromArray(players)
      .flatMap((user) => rx.Observable.return(_.find(this.dms, d => d.user == user.id)))
      .reduce((acc, x) => {
        console.log(x);
        if (x) {
          acc[x.user] = x.id;
        }
        return acc;
      }, {})
      .publishLast();

    ret.connect();

    return ret
      .flatMap(playerDms => rx.Observable.timer(2000)
        .flatMap(() => game.start(playerDms)))
      .do(() => {
        quitGameDisp.dispose();
        dealHandDisp.dispose();
        increaseBlindsDisp.dispose();
        this.isGameRunning[channel] = false;
      });
  }

  // Private: Adds AI-based players (primarily for testing purposes).
  //
  // players - The players participating in the game
  addBotPlayers(players) {
    let bot1 = new WeakBot('PPE');
    players.push(bot1);

    let bot2 = new AggroBot('Aura');
    players.push(bot2);
  }

  // Private: Save which channels and groups this bot is in and log them.
  onClientOpened() {

    this.botInfo = this.slackWeb.users.info({ user: this.slackRTM.activeUserId })
      .then((response) => {
        // Success!
        this.botInfo = response.user
        console.log(`Welcome to Slack. You are ${this.botInfo.name} of team ${this.botInfo.team_name}(${this.botInfo.team_id})`);
      })
      .catch((error) => {
        // Error :/
        console.log('Bot info error:');
        console.log(error);
      });

    this.slackWeb.conversations.list()
      .then((res) => {
        // `res` contains information about the channels
        //res.channels.forEach(c => console.log(c.name, c.is_member));
        this.channels = _.filter(res.channels, c => c.is_member);
        this.dms = _.filter(res.channels, c => c.is_im);
        if (this.channels.length > 0) {
          console.log(`You are in: ${this.channels.map(c => c.name).join(', ')}`);
        } else {
          console.log('You are not in any channels.');
        }
      })
      .catch(console.error);
  }
}

module.exports = Bot;
