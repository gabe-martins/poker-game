const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PokerGame, Card } = require('../static/js/poker-logic.js');
const { PokerAI } = require('../static/js/poker-ai.js');

const cards = text => text.split(' ').filter(Boolean).map(c => new Card(c[1], c[0]));
function seeded(seed = 1) {
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function strategy(options = {}) {
    const game = new PokerGame();
    return new PokerAI(hand => game._evaluateBestHand(hand), { random: seeded(), ...options });
}
function observation(hand = 'AS AH', board = '') {
    return {
        hand: cards(hand),
        communityCards: cards(board),
        player: { id: 1, chips: 1000, totalBetInRound: 0, totalBetInHand: 0, canRaise: true },
        players: [
            { id: 0, chips: 980, totalBetInRound: 20, totalBetInHand: 20, status: 'active' },
            { id: 1, chips: 1000, totalBetInRound: 0, totalBetInHand: 0, status: 'active' }
        ],
        dealerId: 0, currentBet: 20, minRaise: 20, bigBlindAmount: 20, pot: 20
    };
}
function browserGame() {
    const timers = [];
    const seededMath = Object.create(Math);
    seededMath.random = seeded();
    const context = vm.createContext({
        Math: seededMath,
        module: { exports: {} },
        console: { log() {}, error() {}, warn() {} },
        setTimeout(fn, delay) { timers.push({ fn, delay }); }
    });
    for (const file of ['poker-ai.js', 'poker-logic.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/js', file), 'utf8'), context);
    }
    const game = new context.module.exports.PokerGame();
    game.currentPhase = 'preflop';
    game.currentPlayerIndex = 1;
    game.players.forEach(p => { p.status = 'active'; });
    game.players[1].hand = cards('AS AH');
    return { game, timers };
}

test('premium pairs raise and weak offsuit hands fold to costly bets', () => {
    const ai = strategy();
    assert.deepEqual(ai.decide(observation('AS AH')), { action: 'raise', amount: 60 });
    const weak = observation('7S 2H');
    weak.currentBet = 300;
    weak.players[0].totalBetInRound = weak.players[0].totalBetInHand = weak.pot = 300;
    assert.equal(ai.decide(weak).action, 'fold');
});

test('suited connected cards score above disconnected offsuit cards', () => {
    const ai = strategy();
    assert.ok(ai.assess(observation('JS TS')).strength > ai.assess(observation('JH 4S')).strength);
    assert.ok(ai.assess(observation('AS KH')).strength > ai.assess(observation('8H 3S')).strength);
    assert.ok(ai.assess(observation('AS AH')).strength > ai.assess(observation('2S 2H')).strength);
});

test('button position gives marginal preflop hands a small bonus', () => {
    const ai = strategy();
    const early = observation('AS QH');
    const button = observation('AS QH');
    button.dealerId = button.player.id;
    assert.ok(ai.assess(button).strength > ai.assess(early).strength);
    assert.equal(ai.decide(early).action, 'call');
    assert.equal(ai.decide(button).action, 'raise');
});

test('more live opponents reduce the preflop estimate; folded players do not', () => {
    const ai = strategy();
    const obs = observation('AS KH');
    const headsUp = ai.assess(obs).equity;
    obs.players.push({ id: 2, status: 'all-in', totalBetInHand: 20 });
    assert.ok(ai.assess(obs).equity < headsUp);
    obs.players[2].status = 'folded';
    assert.equal(ai.assess(obs).equity, headsUp);
});

test('pot odds use the actual partial call and exclude inaccessible side pots', () => {
    const ai = strategy();
    const obs = observation();
    obs.player.chips = 50;
    obs.currentBet = 500;
    obs.pot = 1000;
    obs.players[0].totalBetInHand = 500;
    obs.players.push({ id: 2, status: 'active', totalBetInHand: 500 });
    const result = ai.assess(obs);
    assert.equal(result.callCost, 50);
    assert.equal(result.potOdds, 1 / 3);
});

test('folded contributions remain part of the price of a call', () => {
    const ai = strategy();
    const obs = observation();
    obs.players.push({ id: 2, status: 'folded', totalBetInHand: 20 });
    assert.equal(ai.assess(obs).potOdds, 1 / 3);
});

test('river nuts have full equity and produce a value raise', () => {
    const ai = strategy();
    const obs = observation('AS KS', 'QS JS TS 2D 3C');
    assert.equal(ai.assess(obs).equity, 1);
    assert.equal(ai.decide(obs).action, 'raise');
});

test('royal flush on the board counts ties as fractional equity', () => {
    const ai = strategy();
    const obs = observation('2C 3D', 'AS KS QS JS TS');
    assert.equal(ai.assess(obs).equity, 0.5);
    obs.players.push({ id: 2, status: 'all-in', totalBetInHand: 20 });
    assert.ok(Math.abs(ai.assess(obs).equity - 1 / 3) < 1e-10);
    assert.notEqual(ai.decide(obs).action, 'raise');
});

test('bad river hand folds to an expensive call', () => {
    const ai = strategy();
    const obs = observation('2C 3D', 'AH KD QS 9C 7H');
    obs.currentBet = 500;
    obs.players[0].totalBetInHand = obs.pot = 500;
    assert.ok(ai.assess(obs).equity < 0.2);
    assert.equal(ai.decide(obs).action, 'fold');
});

test('flush draw has more equity than the same ranks with no draw', () => {
    const draw = observation('AH QH', '2H 7H JC');
    const noDraw = observation('AS QD', '2H 7H JC');
    const drawEquity = strategy({ samples: 160 }).assess(draw).equity;
    const noDrawEquity = strategy({ samples: 160 }).assess(noDraw).equity;
    assert.ok(drawEquity > noDrawEquity + 0.08, `${drawEquity} vs ${noDrawEquity}`);
});

test('simulated seven-card hands never reuse known or sampled cards', () => {
    const game = new PokerGame();
    const own = new Set(['AS', 'KS']);
    let evaluations = 0;
    const ai = new PokerAI(hand => {
        const keys = hand.map(c => c.rank + c.suit);
        assert.equal(new Set(keys).size, 7);
        if (keys[0] !== 'AS') {
            assert.ok(!own.has(keys[0]));
            assert.ok(!own.has(keys[1]));
        }
        evaluations++;
        return game._evaluateBestHand(hand);
    }, { random: seeded(), samples: 12 });
    ai.assess(observation('AS KS', '2H 3H 4C'));
    assert.equal(evaluations, 24);
});

test('seeded estimates are repeatable and neither observation nor cards are mutated', () => {
    const obs = observation('AH QH', '2H 7H JC');
    const before = JSON.stringify(obs);
    const freeze = value => {
        if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
    };
    freeze(obs);
    assert.equal(strategy().assess(obs).equity, strategy().assess(obs).equity);
    assert.equal(JSON.stringify(obs), before);
});

test('a free check is never folded, including when raising is closed', () => {
    const ai = strategy();
    const obs = observation('7S 2H');
    obs.currentBet = 0;
    obs.player.canRaise = false;
    assert.deepEqual(ai.decide(obs), { action: 'check', amount: 0 });
});

test('premium hands call rather than raise when betting has not reopened', () => {
    const ai = strategy();
    const obs = observation();
    obs.player.canRaise = false;
    assert.deepEqual(ai.decide(obs), { action: 'call', amount: 0 });
});

test('raises respect the current minimum, previous investment, and available stack', () => {
    const ai = strategy();
    const obs = observation();
    obs.currentBet = 200;
    obs.minRaise = 150;
    obs.pot = obs.players[0].totalBetInHand = 200;
    obs.player.totalBetInRound = obs.player.totalBetInHand = 50;
    obs.player.chips = 400;
    obs.players[1].totalBetInHand = 50;
    const decision = ai.decide(obs);
    assert.deepEqual(decision, { action: 'raise', amount: 450 });
});

test('short stack with strong river cards calls all-in instead of producing an invalid raise', () => {
    const ai = strategy();
    const obs = observation('AS KS', 'QS JS TS 2D 3C');
    obs.player.chips = 10;
    obs.player.canRaise = false;
    assert.deepEqual(ai.decide(obs), { action: 'call', amount: 0 });
});

test('value bets are at least the big blind and never exceed the stack', () => {
    const ai = strategy();
    const obs = observation('AS KS', 'QS JS TS 2D 3C');
    obs.currentBet = 0;
    obs.pot = 100;
    assert.deepEqual(ai.decide(obs), { action: 'bet', amount: 60 });
    obs.player.chips = 10;
    assert.deepEqual(ai.decide(obs), { action: 'bet', amount: 10 });
});

test('sample budget is bounded and configurable', () => {
    for (const samples of [0, -1, 1.5, 1001, Infinity]) {
        assert.throws(() => strategy({ samples }), /simulações/);
    }
    assert.equal(strategy({ samples: 8 }).samples, 8);
});

test('public observation never reads opponent cards, the actual deck, or its order', () => {
    const { game } = browserGame();
    const bot = game.players[1];
    for (const p of game.players.filter(p => p !== bot)) {
        Object.defineProperty(p, 'hand', { get() { throw new Error('hidden cards read'); } });
    }
    Object.defineProperty(game.deck, 'cards', { get() { throw new Error('deck read'); } });
    const obs = game._getAIObservation(bot);
    assert.ok(obs.players.every(p => !('hand' in p)));
    assert.ok(!('deck' in obs));
    assert.equal(obs.hand.length, 2);
    assert.equal(game._performAIAction(bot), true);
});

test('changing hidden cards and deck order cannot change a seeded decision', () => {
    const { game } = browserGame();
    game.communityCards = cards('2H 7H JC');
    game.players[1].hand = cards('AH QH');
    const first = strategy().decide(game._getAIObservation(game.players[1]));
    game.players[0].hand = cards('AS AD');
    game.players[2].hand = cards('KS KD');
    game.deck.cards.reverse();
    const second = strategy().decide(game._getAIObservation(game.players[1]));
    assert.deepEqual(first, second);
});

test('browser script loading integrates the new strategy and prevents duplicate actions', () => {
    const { game, timers } = browserGame();
    game.currentBet = 20;
    game.pot = 20;
    game.players[0].chips = 980;
    game.players[0].totalBetInRound = game.players[0].totalBetInHand = 20;
    assert.equal(game._performAIAction(game.players[1]), true);
    assert.equal(game.players[1].totalBetInRound, 60);
    assert.equal(game._performAIAction(game.players[1]), undefined);
    assert.equal(timers.filter(t => t.delay === 50).length, 1);
    assert.equal(game.pot + game.players.reduce((n, p) => n + p.chips, 0), 4000);
});

test('scheduled bot turn invokes the strategy and stops when the turn is stale', () => {
    const { game, timers } = browserGame();
    game._checkAndTriggerAIAction();
    game.currentPlayerIndex = 2;
    timers.shift().fn();
    assert.equal(game.pot, 0);
    game.currentPlayerIndex = 1;
    game._checkAndTriggerAIAction();
    timers.shift().fn();
    assert.ok(game.pot > 0);
});

test('strategy actions are legal across representative streets and stack sizes', () => {
    const boards = ['', '2H 7H JC', '2H 7H JC TD', '2H 7H JC TD 4S'];
    for (const board of boards) {
        for (const stack of [10, 30, 1000]) {
            const { game } = browserGame();
            const bot = game.players[1];
            bot.hand = cards('AH QH');
            bot.chips = stack;
            bot.totalBetInHand = bot.totalBetInRound = 10;
            game.players[0].totalBetInHand = game.players[0].totalBetInRound = 20;
            game.pot = 30;
            game.currentBet = 20;
            game.communityCards = cards(board);
            game.currentPhase = board ? (game.communityCards.length === 3 ? 'flop' : game.communityCards.length === 4 ? 'turn' : 'river') : 'preflop';
            const before = game.pot + game.players.reduce((n, p) => n + p.chips, 0);
            game._aiStrategy = strategy({ samples: 16 });
            assert.equal(game._performAIAction(bot), true, `${board}, ${stack}`);
            assert.equal(game.pot + game.players.reduce((n, p) => n + p.chips, 0), before);
        }
    }
});

test('complete games with card-aware bots preserve chips and finish their hands', () => {
    for (let seed = 1; seed <= 6; seed++) {
        const { game, timers } = browserGame();
        game.players.forEach(p => { p.isHuman = false; });
        game._aiStrategy = strategy({ random: seeded(seed), samples: 12 });
        game.startNewHand();
        let completedHands = 0;
        let callbacks = 0;
        while (completedHands < 3 && game.currentPhase !== 'gameOver') {
            assert.ok(callbacks++ < 400, 'bots must finish each hand');
            const timer = timers.shift();
            assert.ok(timer, 'there must be a scheduled next action');
            if (timer.delay === 3000 || timer.delay === 5000) {
                assert.equal(game.pot, 0);
                completedHands++;
            }
            timer.fn();
            assert.equal(game.pot + game.players.reduce((n, p) => n + p.chips, 0), 4000);
            assert.ok(game.players.every(p => p.chips >= 0));
            assert.ok(!game.log.some(line => line.includes('Ação inválida')), game.log.join('\n'));
        }
        assert.ok(completedHands > 0);
    }
});
