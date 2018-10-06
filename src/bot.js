const rx = require('rx');
const _ = require('underscore-plus');

const { RTMClient, WebClient } = require('@slack/client');
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

    this.gameConfig = {};
    this.gameConfigParams = ['timeout'];
  }

  // Public: Brings this bot online and starts handling messages sent to it.
  login() {
    rx.Observable.fromEvent(this.slackRTM, 'ready')
      .subscribe(() => this.onClientOpened());

    this.slackRTM.start();
    this.respondToMessages();
  }

  // Private: Listens for messages directed at this bot that contain the word
  // 'deal,' and poll players in response.
  //
  // Returns a {Disposable} that will end this subscription
  respondToMessages() {
    let messages = rx.Observable.fromEvent(this.slackRTM, 'message')
      .where(e => e.type === 'message');

    let atMentions = messages.where(e =>
      MessageHelpers.containsUserMention(e.text, this.slackRTM.activeUserId));

    let disp = new rx.CompositeDisposable();

    disp.add(this.handleDealGameMessages(messages, atMentions));
    disp.add(this.handleConfigMessages(atMentions));
    disp.add(this.handleHelpMessages(atMentions));

    return disp;
  }

  // Private: Looks for messages directed at the bot that contain the word
  // "deal." When found, start polling players for a game.
  //
  // messages - An {Observable} representing messages posted to a channel
  // atMentions - An {Observable} representing messages directed at the bot
  //
  // Returns a {Disposable} that will end this subscription
  handleDealGameMessages(messages, atMentions) {
    return atMentions
      .where(e => e.text && e.text.toLowerCase().match(/\bdeal\b/))
      .map(e => e.channel)
      .where(channel => {
        if (this.isPolling) {
          return false;
        } else if (this.isGameRunning) {
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
  handleConfigMessages(atMentions) {
    return atMentions
      .where(e => e.text && e.text.toLowerCase().includes('config'))
      .subscribe(e => {

        e.text.replace(/(\w*)=(\d*)/g, (match, key, value) => {
          if (this.gameConfigParams.indexOf(key) > -1 && value) {
            this.gameConfig[key] = value;
            this.slackRTM.sendMessage(`Game ${key} has been set to ${value}.`, e.channel);
          }
        });
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
        this.slackRTM.sendMessage("Type `@" + this.botInfo.name + " deal` to start new game of Texas Hold'em", e.channel);
      });
  }

  // Private: Polls players to join the game, and if we have enough, starts an
  // instance.
  //
  // messages - An {Observable} representing messages posted to the channel
  // channel - The channel where the deal message was posted
  //
  // Returns an {Observable} that signals completion of the game 
  pollPlayersForGame(messages, channel) {
    this.isPolling = true;

    return PlayerInteraction.pollPotentialPlayers(messages, this.slackWeb, this.slackRTM, channel)
      .reduce((players, id) => {
        this.slackWeb.users.info({ user: id })
          .then((result) => {
            let user = result.user;
            this.slackRTM.sendMessage(`${user.name} has joined the game.`, channel);
            players.push({ id: user.id, name: user.name });
          })
          .catch(console.error);
        return players;
      }, [])
      .flatMap(players => {
        this.isPolling = false;
        this.addBotPlayers(players);

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
    this.isGameRunning = true;

    let game = new TexasHoldem(this.slackWeb, this.slackRTM, messages, channel, players);
    _.extend(game, this.gameConfig);

    // Listen for messages directed at the bot containing 'quit game.'
    let quitGameDisp = messages.where(e => MessageHelpers.containsUserMention(e.text, this.slackRTM.activeUserId) &&
      e.text.toLowerCase().match(/quit game/))
      .take(1)
      .subscribe(e => {
        // TODO: Should poll players to make sure they all want to quit.
        let player = this.slackRTM.getUserByID(e.user);
        this.slackRTM.sendMessage(`${player.name} has decided to quit the game. The game will end after this hand.`, channel);
        game.quit();
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
        this.isGameRunning = false;
      });
  }

  // Private: Adds AI-based players (primarily for testing purposes).
  //
  // players - The players participating in the game
  addBotPlayers(players) {
    let bot1 = new WeakBot('Phil Hellmuth');
    players.push(bot1);

    let bot2 = new AggroBot('Phil Ivey');
    players.push(bot2);
  }

  // Private: Save which channels and groups this bot is in and log them.
  onClientOpened() {

    this.botInfo = this.slackWeb.users.info({ user: this.slackRTM.activeUserId })
      .then((response) => {
        // Success!
        this.botInfo = response.user
        console.log(`Welcome to Slack. You are ${this.botInfo.name} of team ${this.botInfo.team_id}`);
      })
      .catch((error) => {
        // Error :/
        console.log('Bot info error:');
        console.log(error);
      });


    this.slackWeb.channels.list()
      .then((res) => {
        // `res` contains information about the channels
        //res.channels.forEach(c => console.log(c.name, c.is_member));
        this.channels = _.filter(res.channels, c => c.is_member);
        if (this.channels.length > 0) {
          console.log(`You are in: ${this.channels.map(c => c.name).join(', ')}`);
        } else {
          console.log('You are not in any channels.');
        }
      })
      .catch(console.error);

    this.slackWeb.groups.list()
      .then((res) => {
        // `res` contains information about the channels
        res.groups.forEach(g => console.log(g.name, c.is_archived));
        this.groups = _.filter(res.groups, g => !g.is_archived);
        if (this.groups.length > 0) {
          console.log(`As well as: ${this.groups.map(g => g.name).join(', ')}`);
        }
      })
      .catch(console.error);

    this.slackWeb.im.list()
      .then((res) => {
        this.dms = res.ims;
        if (this.dms.length > 0) {
          console.log(`Your open DM's: ${this.dms.map(dm => dm.id).join(', ')}`);
        }
      })
      .catch(console.error);

  }
}

module.exports = Bot;
