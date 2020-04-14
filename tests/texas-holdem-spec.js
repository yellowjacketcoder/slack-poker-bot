require('babel-register');

var rx = require('rx');
var _ = require('underscore-plus');
var assert = require('chai').assert;

var Card = require('../src/card');
var TexasHoldem = require('../src/texas-holdem');

describe('TexasHoldem', function() {
  var game, slackWeb, slackRTM, messages, channel, scheduler, players, playerDms;

  beforeEach(function() {
    messages = new rx.Subject();
    channel = {
      send: function(message) {
        console.log(message);
        return { updateMessage: function() { } };
      }
    };
    
    scheduler = new rx.HistoricalScheduler();
 
    // mock out slack objects
    slackWeb = { token: 0xDEADBEEF };
    slackRTM = {
      sendMessage: async function(message) { 
        console.log(message);
        return { ts: false} 
      }
    };

    let gameConfig = { 
      timeout: 25, 
      maxplayers: 25, 
      start_game_timeout: 60, 
      bots: 0,
      smallblind: 4,
      initialstash: 400
    };
      
    players = [
      { id: 1, name: 'Phil Ivey' },
      { id: 2, name: 'Doyle Brunson' },
      { id: 3, name: 'Stu Ungar' },
      { id: 4, name: 'Patrik Antonius' },
      { id: 5, name: 'Chip Reese' }
    ];

    game = new TexasHoldem(slackWeb, slackRTM, messages, channel, players, gameConfig, scheduler);
    // TODO: is this required?
    _.extend(game, gameConfig);

    var emptyDm = { send: function(message) { 
      console.log(message);
      }
    };

    playerDms = { 1: emptyDm, 2: emptyDm, 3: emptyDm, 4: emptyDm, 5: emptyDm };

    // We don't want to create any images during tests, so just have this
    // function write to the console.
    game.postBoard = function(round) {
      console.log("Dealing the " + round + ": " + game.board.toString());
      return rx.Observable.return(true);
    };

    // Improves the appearance of player status in the console.
    game.tableFormatter = "\n";
  });
  
  it('should handle consecutive raises correctly', function() {
    //console.log('should handle consecutive raises correctly');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    // A flurry of raises, starting with Patrik.
    messages.onNext({user: 4, text: "Raise"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "raise"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Raise"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "fold"});
    scheduler.advanceBy(5000);

    var playersInHand = game.getPlayersInHand();
    assert(playersInHand.length === 3, `Players in hand is 3. Actual ${playersInHand.length}`);
    assert(game.actingPlayer.name === 'Patrik Antonius', `Acting player is Patrik Antonius. Actual ${game.actingPlayer.name}`);

    messages.onNext({user: 4, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Fold"});
    scheduler.advanceBy(5000);

    // Patrik and Phil are still left in the hand.
    playersInHand = game.getPlayersInHand();
    assert(playersInHand.length === 2, `Players in hand is 2. Actual ${playersInHand.length}`);
    assert(game.actingPlayer.name === 'Patrik Antonius', `Acting player is Patrik Antonius. Actual ${game.actingPlayer.name}`);
    game.quit();
  });

  it('should handle player timeout by folding, or if possible, checking', function() {
    //console.log('should handle player timeout by folding, or if possible, checking');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    // Patrik is UTG and is going to timeout.
    assert(game.actingPlayer.name === 'Patrik Antonius', `Acting player is Patrik Antonius. Actual ${game.actingPlayer.name}`);
    scheduler.advanceBy(30000);

    // Bye bye Patrik.
    var playersInHand = game.getPlayersInHand();
    assert(playersInHand.length === 4, `Players in hand is 4. Actual ${playersInHand.length}`);
    assert(game.actingPlayer.name === 'Chip Reese', `Acting player is Chip Reese. Actual ${game.actingPlayer.name}`);

    // Everyone else calls.
    messages.onNext({user: 5, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "call"});
    scheduler.advanceBy(5000);

    // Option to Stu, who also times out.
    assert(game.actingPlayer.name === 'Stu Ungar', `Acting player is Stu Ungar. Actual ${game.actingPlayer.name}`);
    assert(game.board.length === 0, `Board length is 0. Actual ${game.board.length}`);
    scheduler.advanceBy(30000);

    // But we kindly checked for him since he's in the BB.
    playersInHand = game.getPlayersInHand();
    assert(playersInHand.length === 4, `Players in hand is 4. Actual ${playersInHand.length}`);
    assert(game.actingPlayer.name === 'Doyle Brunson', `Acting player is Doyle Brunson. Actual ${game.actingPlayer.name}`);
    game.quit();
  });

  it('should handle a complex hand correctly', function() {
    //console.log('should handle a complex hand correctly');
    // Start with Phil Ivey (index 0) as dealer.
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    // Doyle is SB, Stu is BB, Patrik is UTG.
    assert(game.actingPlayer.name === 'Patrik Antonius', `Acting player is Patrik Antonius. Actual ${game.actingPlayer.name}`);

    // Call all the way down to Stu.
    messages.onNext({user: 4, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);

    // Stu has the option, and raises.
    assert(game.potManager.getTotalChips() === 40, `Pot total is 40, Actual ${game.potManager.getTotalChips()}`);
    assert(game.actingPlayer.name === 'Stu Ungar', `Acting player is Stu Ungar. Actual ${game.actingPlayer.name}`);
    messages.onNext({user: 3, text: "Raise"});
    scheduler.advanceBy(5000);

    // Everyone folds except Doyle.
    messages.onNext({user: 4, text: "fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);

    var playersInHand = game.getPlayersInHand();
    assert(playersInHand.length === 2, `Players in hand is 2. Actual ${playersInHand.length}`);
    assert(playersInHand[0].name === 'Doyle Brunson', `Player 1 in hand is Doyle Bruson. Actual ${playersInHand[0].name}`);
    assert(playersInHand[1].name === 'Stu Ungar', `Player 2 in hand is Stu Ungar. Actual ${playersInHand[1].name}`);
    assert(game.board.length === 3, `Board length is 3. Actual ${game.board.length}`);
    assert(game.actingPlayer.name === 'Doyle Brunson', `Acting player is Doyle Brunson. Actual ${game.actingPlayer.name}`);

    // Stu tries a continuation bet, which Doyle calls.
    messages.onNext({user: 2, text: "check"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Bet"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "call"});
    scheduler.advanceBy(5000);

    assert(game.actingPlayer.name === 'Doyle Brunson', `Acting player is Doyle Brunson. Actual ${game.actingPlayer.name}`);
    assert(game.board.length === 4, `Board length is 4. Actual ${game.board.length}`);

    // Stu fires another round, but Doyle check-raises him.
    messages.onNext({user: 2, text: "Check"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Bet"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Raise"});
    scheduler.advanceBy(5000);

    assert(game.actingPlayer.name === 'Stu Ungar', `Acting player is Stu Ungar. Actual ${game.actingPlayer.name}`);
    assert(game.board.length === 4, `Board length is 4. Actual ${game.board.length}`);

    // Stu reluctantly calls.
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);

    assert(game.actingPlayer.name === 'Doyle Brunson',  `Acting player is Doyle Brunson. Actual ${game.actingPlayer.name}`);
    assert(game.board.length === 5, `Board length is 5. Actual ${game.board.length}`);

    // Now Doyle leads on the river and Stu calls him down.
    messages.onNext({user: 2, text: "Bet"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);

    // Check that one of the last two players won, although the result is
    // random. Also assert that the hand was ended and the dealer button moved.
    var lastResult = game.potManager.outcomes.pop();
    var winner = lastResult.winners[0];
    assert(winner.id === 2 || winner.id === 3, `Winner is either Player 2 or Payer 3. Actual ${winner.id}`);
    assert(game.board.length === 5, `Board length is 5. Actual ${game.board.length}`);
    assert(game.dealerButton === 1, `Dealer button is 1. Actual ${game.dealerButton}`);
    game.quit();
  });

  it('should handle split pots correctly', function() {
    //console.log('should handle split pots correctly');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Check"});
    scheduler.advanceBy(5000);

    messages.onNext({user: 3, text: "Check"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 4, text: "Check"});
    scheduler.advanceBy(5000);

    messages.onNext({user: 3, text: "Check"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 4, text: "Check"});
    scheduler.advanceBy(5000);

    // Override the game board and player hands to guarantee a split pot.
    game.board = [
      new Card('A', 'Hearts'),
      new Card('8', 'Spades'),
      new Card('8', 'Diamonds'),
      new Card('8', 'Clubs'),
      new Card('8', 'Hearts'),
    ];

    game.playerHands[3] = [
      new Card('2', 'Clubs'),
      new Card('3', 'Hearts')
    ];

    game.playerHands[4] = [
      new Card('2', 'Diamonds'),
      new Card('3', 'Spades')
    ];

    messages.onNext({user: 3, text: "Check"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 4, text: "Check"});
    scheduler.advanceBy(5000);

    var lastResult = game.potManager.outcomes.pop();
    assert(lastResult.isSplitPot, `Pot is split. Actual ${lastResult.isSplitPot}`);
    assert(lastResult.winners.length === 2, `There were 2 winners. Actual ${lastResult.winners.length}`);
    assert(lastResult.handName === 'four of a kind', `Last result is 4 of a kind. Actual ${lastResult.handName}`);
    game.quit();
  });

  it('should assign a winner if everyone folds', function() {
    //console.log('should assign a winner if everyone folds');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Fold"});
    scheduler.advanceBy(5000);

    var lastResult = game.potManager.outcomes.pop();
    assert(lastResult.winners[0].name === 'Stu Ungar', `Last man standing is Stu Unger. Actual ${lastResult.winners[0].name}`);
    assert(!lastResult.isSplitPot, `'Pot is not split. Actual ${lastResult.isSplitPot}`);
    game.quit();
  });

  it('should award the pot to an all-in player if everyone else folds', function() {
    //console.log('should award the pot to an all-in player if everyone else folds');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Raise 200"});
    scheduler.advanceBy(5000);

    messages.onNext({user: 1, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Fold"});
    scheduler.advanceBy(5000);
    
    assert(players[4].chips === 412, `Chip has 412 chips. Actual ${players[4].chips}`);
    game.quit();
  });
  
  it('should end the game when all players have been eliminated', function() {
    //console.log('should end the game when all players have been eliminated');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Raise 400"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);

    // If the game is still running, the last hand was a tie.
    var lastResult = game.potManager.outcomes.pop();
    assert(!game.isRunning || (lastResult && lastResult.isSplitPot), `Game either over or split pot`);
  });

  it('should handle players who are forced all-in by posting blinds', function() {
    //console.log('should handle players who are forced all-in by posting blinds');
    let gameEnded = game.start(playerDms, 0);
    
    // Sad Patrik.
    players[3].chips = 2;
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Fold"});
    scheduler.advanceBy(5000);
    
    let handEnded = game.playHand();
    scheduler.advanceBy(5000);

    messages.onNext({user: 5, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(10000);
    
    assert(game.potManager.outcomes.length === 2, `Two players left. Actual ${game.potManager.outcomes.length}`);
    // Patrik either doubled up (2 * 2 = 4, minus the SB = 3), or lost it all.
    assert(players[3].isAllIn, `Patrick Antonius is all in. Actual ${players[3].isAllIn}`);
    // TODO: something is wrong with this test. It occasionally yields 2 chip for Patrik
    assert(players[3].chips === 4 || players[3].chips === 0, `Patrick either doubled up (2 * 2 = 4), or came out with 0. Actual ${players[3].chips}`);
    game.quit();
  });
  
  it('should handle all-ins correctly', function() {
    //console.log('should handle all-ins correctly');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "raise 20"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Fold"});
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Raise 400"});
    scheduler.advanceBy(5000);

    assert(game.potManager.currentBet === 400, `Current bet is 400. Actual ${game.potManager.currentBet}`);
    assert(game.potManager.getTotalChips() === 432, `Pot total is 432. Actual ${game.potManager.getTotalChips()}`);
    assert(players[3].chips === 0, `Player 4 chips is 0. Actual ${players[3].chips}`);
    assert(players[3].isAllIn, `Player 4 chips is all-in. Actual ${players[3].isAllIn}`);

    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);

    var lastResult = game.potManager.outcomes.pop();
    var winner = lastResult.winners[0];
    assert(winner.id === 1 || winner.id === 4, `Player 1 or Player 4 is winner. Actual ${winner.id}`);
    
    let handEnded = game.playHand();
    scheduler.advanceBy(5000);

    // Check that the losing player was eliminated, or that the pot was split.
    assert(game.board.length === 0, `Board length is 0. Actual ${game.board.length}`);
    assert(game.getPlayersInHand().length === 4 || lastResult.isSplitPot, `Check that the losing player was eliminated, or that the pot was split.`);
    game.quit();
  });

  it('should handle multiple rounds with all-ins', function() {
    //console.log('should handle multiple rounds with all-ins');
    game.start(playerDms, 0);
    
    players[0].chips = 200;
    players[1].chips = 149;
    players[2].chips = 98;
    players[3].chips = 75;
    players[4].chips = 50;
    scheduler.advanceBy(5000);
    
    messages.onNext({user: 4, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Raise 8"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Raise 50"});
    scheduler.advanceBy(5000);
    assert(game.potManager.getTotalChips() === 82, `Pot Manager total bets 82. Actual ${game.potManager.getTotalChips()}`);
    
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.getTotalChips() === 200, `Pot Manager total bets 200. Actual ${game.potManager.getTotalChips()}`);
    assert(game.potManager.pots.length === 2, `Pot Manager has 2 active bets. Actual ${game.potManager.pots.length}`);
    
    messages.onNext({user: 2, text: "Bet 60"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots[0].amount === 200, `Pot 1 amount 200. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 60, `Pot 2 amount 60. Actual ${game.potManager.pots[1].amount}`);
    
    // Stu only has 50 chips left, so this is an all-in.
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots[0].amount === 200, `Pot 1 amount 200. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 116, `Pot 2 amount 116. Actual ${game.potManager.pots[1].amount}`);

    // 60 - 50 = 10 * 2 callers = 20 chips on the side.
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots.length === 3, `Pot Manager has 3 active bets. Actual ${game.potManager.pots.length}`);
    assert(game.potManager.pots[0].amount === 200, `Pot 1 amount 200. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 168, `Pot 2 amount 168. Actual ${game.potManager.pots[1].amount}`);
    assert(game.potManager.pots[2].amount === 8, `Pot 3 amount 8. Actual ${game.potManager.pots[2].amount}`);
    
    messages.onNext({user: 2, text: "Check"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Bet 10"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots.length === 3, `Pot Manager has 3 active bets. Actual ${game.potManager.pots.length}`);
    assert(game.potManager.pots[0].amount === 200, `Pot 1 amount 200. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 168, `Pot 2 amount 168. Actual ${game.potManager.pots[1].amount}`);
    assert(game.potManager.pots[2].amount === 28, `Pot 3 amount 28. Actual ${game.potManager.pots[2].amount}`);
    
    messages.onNext({user: 2, text: "Bet 30"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots.length === 3, `Pot Manager has 3 active bets. Actual ${game.potManager.pots.length}`);
    assert(game.potManager.pots[0].amount === 200, `Pot 1 amount 200. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 168, `Pot 2 amount 168. Actual ${game.potManager.pots[1].amount}`);
    assert(game.potManager.pots[2].amount === 58, `Pot 3 amount 58. Actual ${game.potManager.pots[2].amount}`);
    
    assert(players[0].chips === 80, `Player 1 has 80 chips. Actual ${players[0].chips}`);
    assert(players[1].chips === 3, `Player 2 has 3 chips. Actual ${players[1].chips}`);
    assert(players[2].chips === 0, `Player 3 has 0 chips. Actual ${players[2].chips}`);
    assert(players[3].chips === 75, `Player 4 has 75 chips. Actual ${players[3].chips}`);
    assert(players[4].chips === 0, `Player 5 has 0 chips. Actual ${players[4].chips}`);
    
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    
    // advance to the next hand
    let handEnded = game.playHand();
    scheduler.advanceBy(5000);

    var chipTotalAfter = _.reduce(players, function(total, player) { 
      return total + player.chips; 
    }, 0);
    
    assert(game.isRunning, `Game should still be running. Actual ${game.isRunning}`);
    assert(game.potManager.pots.length === 1, `Pot Manager has 1 active bets. Actual ${game.potManager.pots.length}`);
    assert(game.potManager.pots[0].amount === 12, `Pot 1 amount 12. Actual ${game.potManager.pots[0].amount}`);
    assert(chipTotalAfter === 572, `Chip total after game 572. Actual ${chipTotalAfter}`);
    game.quit();
  });
  
  it('should handle multiple side pots and all-ins over the top (scenario 1)', function() {
    //console.log('should handle multiple side pots and all-ins over the top (scenario 1)');
    game.start(playerDms, 0);
    
    // Lots of short stacks this time around.
    players[0].chips = 200;
    players[1].chips = 149;
    players[2].chips = 98;
    players[3].chips = 75;
    players[4].chips = 50;
    scheduler.advanceBy(5000);
    
    var chipTotalBefore = _.reduce(players, function(total, player) { 
      return total + player.chips; 
    }, 0);

    messages.onNext({user: 4, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Raise 50"});
    scheduler.advanceBy(5000);
    assert(players[4].chips === 0, `Player 5 has 0 chips. Actual ${players[4].chips}`);
    assert(game.potManager.pots[0].amount === 70, `Pot 1 amount 70. Actual ${game.potManager.pots[0].amount}`);
    
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots[0].amount === 208, `Pot 1 amount 208. Actual ${game.potManager.pots[0].amount}`);
    
    // Over the top all-in.
    messages.onNext({user: 4, text: "Raise 75"});
    scheduler.advanceBy(5000);
    assert(players[3].chips === 0, `Player 4 has 0 chips. Actual ${players[3].chips}`);
    assert(game.potManager.pots[0].amount === 275, `Pot 1 amount 275. Actual ${game.potManager.pots[0].amount}`);
    
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Raise 100"});
    scheduler.advanceBy(5000);
    assert(players[2].chips === 0, `Player 3 has 0 chips. Actual ${players[2].chips}`);
    assert(game.potManager.pots[0].amount === 381, `Pot 1 amount 381. Actual ${game.potManager.pots[0].amount}`);
    
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    
    assert(game.potManager.pots.length === 4, `Pot Manager has 4 active bets. Actual ${game.potManager.pots.length}`);
    assert(game.potManager.pots[0].amount === 250, `Pot 1 amount 250. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 100, `Pot 2 amount 100. Actual ${game.potManager.pots[1].amount}`);
    assert(game.potManager.pots[2].amount === 93, `Pot 3 amount 93. Actual ${game.potManager.pots[2].amount}`);
    assert(game.potManager.pots[3].amount === 0, `Pot 4 amount 0. Actual ${game.potManager.pots[3].amount}`);
    
    messages.onNext({user: 2, text: "Bet 50"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);

    // advance to the next hand
    let handEnded = game.playHand();
    scheduler.advanceBy(5000);
 
    var chipTotalAfter = _.reduce(players, function(total, player) {
      return total + player.chips;
    }, 0);
    
    // If the game has ended, blinds won't be posted, causing the chip total to
    // differ slightly.
    assert(!game.isRunning || chipTotalBefore === chipTotalAfter);
    game.quit();
  });
  
  it('should handle default bets and raises', function() {
    //console.log('should handle default bets and raises');
    game.start(playerDms, 0);
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "raise"});
    scheduler.advanceBy(5000);
    assert(game.potManager.currentBet === 16, `Current bet is 16. Actual ${game.potManager.currentBet}`);
    assert(game.potManager.getTotalChips() === 28, `Pot total is 28. Actual ${game.potManager.getTotalChips()}`);

    messages.onNext({user: 5, text: "raise"});
    scheduler.advanceBy(5000);
    assert(game.potManager.currentBet === 32, `Current bet is 8. Actual ${game.potManager.currentBet}`);
    assert(game.potManager.getTotalChips() === 60, `Pot total is 60. Actual ${game.potManager.getTotalChips()}`);

    messages.onNext({user: 1, text: "raise"});
    scheduler.advanceBy(5000);
    assert(game.potManager.currentBet === 64, `Current bet is 16. Actual ${game.potManager.currentBet}`);
    assert(game.potManager.getTotalChips() === 124, `Pot total is 124. Actual ${game.potManager.getTotalChips()}`);

    messages.onNext({user: 2, text: "fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "fold"});
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.currentBet === 64, `Current bet is 64. Actual ${game.potManager.currentBet}`);
    assert(game.potManager.getTotalChips() === 172, `Pot total is 172. Actual ${game.potManager.getTotalChips()}`);

    messages.onNext({user: 5, text: "call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.currentBet === 0, `Current bet is 0. Actual ${game.potManager.currentBet}`);
    assert(game.potManager.getTotalChips() === 204, `Pot total is 204. Actual ${game.potManager.getTotalChips()}`);

    messages.onNext({user: 4, text: "bet"});
    scheduler.advanceBy(5000);
    assert(game.potManager.currentBet === 4, `Current bet is 4. Actual ${game.potManager.currentBet}`);
    assert(game.potManager.getTotalChips() === 208, `Pot total is 208. Actual ${game.potManager.getTotalChips()}`);

    game.quit();
  });

  it('should handle multiple side pots and all-ins over the top (scenario 2)', function() {
    //console.log('should handle multiple side pots and all-ins over the top (scenario 2)');
    game.start(playerDms, 0);
    
    players[1].chips = 149;
    players[2].chips = 73;
    players[3].chips = 75;
    players[4].chips = 50;
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Raise 50"});
    scheduler.advanceBy(5000);
    assert(players[4].chips === 0);
    assert(game.potManager.pots[0].amount === 70, `Pot 1 amount 70. Actual ${game.potManager.pots[0].amount}`);
    
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots[0].amount === 208, `Pot 1 amount 202. Actual ${game.potManager.pots[0].amount}`);

    messages.onNext({user: 4, text: "Raise 75"});
    scheduler.advanceBy(5000);
    assert(players[3].chips === 0);
    assert(game.potManager.pots[0].amount === 275, `Pot 1 amount 275. Actual ${game.potManager.pots[0].amount}`);
    
    messages.onNext({user: 1, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    
    assert(players[2].chips === 6, `Player 3 has 6 chips. Actual ${players[2].chips}`);
    assert(game.potManager.pots.length === 3);
    assert(game.potManager.pots[0].amount === 250, `Pot 1 amount 250. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 100, `Pot 2 amount 100. Actual ${game.potManager.pots[1].amount}`);
    assert(game.potManager.pots[2].amount === 0, `Pot 3 amount 0. Actual ${game.potManager.pots[2].amount}`);

    game.quit();
  });
  
  it("should divide pots based on a player's stake", function() {
    //console.log("should divide pots based on a player's stake");
    game.start(playerDms, 0);

    // Give Chip a small stack for this test.
    players[4].chips = 50;
    scheduler.advanceBy(5000);

    messages.onNext({user: 4, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 5, text: "Raise 50"});
    scheduler.advanceBy(5000);
    assert(players[4].isAllIn, `Player 5 is all in. Actual ${players[4].isAllIn}`);

    messages.onNext({user: 1, text: "Fold"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Call"});
    scheduler.advanceBy(5000);
    assert(players[1].chips === 350, `Player 2 has 350 chips. Actual ${players[1].chips}`);
    assert(game.potManager.pots[0].amount === 108, `Pot 1 amount 108. Actual ${game.potManager.pots[0].amount}`);

    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots[0].amount === 150, `Pot 1 amount 150. Actual ${game.potManager.pots[0].amount}`);

    // Get a side pot going.
    assert(game.actingPlayer.name === 'Doyle Brunson');
    messages.onNext({user: 2, text: "Bet 10"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots[0].amount === 150, `Pot 1 amount 150. Actual ${game.potManager.pots[0].amount}`);
    assert(game.potManager.pots[1].amount === 20, `Pot 2 amount 20. Actual ${game.potManager.pots[1].amount}`);

    messages.onNext({user: 2, text: "Bet 20"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);
    assert(game.potManager.pots[1].amount === 60, `Pot 2 amount 60. Actual ${game.potManager.pots[1].amount}`);

    // Override the game board and player hands to guarantee Chip wins.
    game.board = [
      new Card('A', 'Hearts'),
      new Card('K', 'Hearts'),
      new Card('Q', 'Hearts'),
      new Card('J', 'Hearts'),
      new Card('2', 'Hearts'),
    ];

    game.playerHands[5] = [
      new Card('T', 'Hearts'),
      new Card('9', 'Hearts')
    ];

    game.playerHands[2] = [
      new Card('2', 'Clubs'),
      new Card('3', 'Clubs')
    ];

    game.playerHands[3] = [
      new Card('4', 'Clubs'),
      new Card('5', 'Clubs')
    ];

    messages.onNext({user: 2, text: "Check"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Bet 20"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 2, text: "Raise 80"});
    scheduler.advanceBy(5000);
    messages.onNext({user: 3, text: "Call"});
    scheduler.advanceBy(5000);

    // Chip triples up his initial stack of 50.
    var lastResult = game.potManager.outcomes.pop();
    assert(lastResult.length === 2, `Should be 2 hands played. Actual ${lastResult.length}`);
    assert(!lastResult[0].isSplitPot, `Pot 1 should not be split. Actual ${lastResult[0].isSplitPot}`);
    assert(lastResult[0].winners[0].name === 'Chip Reese', `Hand 1 winner is Chip Reese. Actual ${lastResult[0].winners[0].name}`);
    assert(lastResult[0].winners[0].chips === 150, `Chip Reese should have 150 chips. Actual ${lastResult[0].winners[0].chips}`);
    
    // Doyle and Stu split the remainder (Stu would be 150, but posted SB).
    assert(lastResult[1].isSplitPot, `Hand 2 should be split. Actual ${lastResult[1].isSplitPot}`);
    assert(lastResult[1].winners.length === 2, `Hand 2 should have 2 winners. Actual ${lastResult[1].winners.length}`);
    assert(lastResult[1].winners[1].name === 'Doyle Brunson', `Hand 2 first split winner is Doyle Brunson. Actual ${lastResult[1].winners[1].name}`);
    assert(lastResult[1].winners[0].name === 'Stu Ungar', `Hand 2 second split winner is Stu Ungar. Actual ${lastResult[1].winners[0].name}`);
    assert(players[1].chips === 350, `Player 2 has 350 chips. Actual ${players[1].chips}`);
    assert(players[2].chips === 350, `Player 3 has 350 chips. Actual ${players[2].chips}`);
    
    game.quit();
  });


 

});
