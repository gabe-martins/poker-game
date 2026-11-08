const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../static/js/poker-logic.js'), 'utf8');

function setup(seed = 1) {
    const timers = [];
    const seededMath = Object.create(Math);
    let deckSeed = seed;
    seededMath.random = () => ((deckSeed = (Math.imul(deckSeed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const context = vm.createContext({
        Math: seededMath,
        module: { exports: {} },
        console: { log() {}, error() {}, warn() {} },
        setTimeout(fn, delay) { timers.push({ fn, delay }); }
    });
    vm.runInContext(source, context);
    const { PokerGame, Card } = context.module.exports;
    const game = new PokerGame();
    game._checkAndTriggerAIAction = () => {};
    game.currentPhase = 'preflop';
    game.currentPlayerIndex = 0;
    game.players.forEach(p => { p.status = 'active'; });
    const tick = () => {
        const i = timers.findIndex(t => t.delay === 50 || t.delay === 100);
        if (i < 0) return false;
        timers.splice(i, 1)[0].fn();
        return true;
    };
    return { game, Card, tick, timers };
}

function contribute(game, index, amount, status = 'active') {
    const p = game.players[index];
    p.chips -= amount;
    p.totalBetInRound += amount;
    p.totalBetInHand += amount;
    p.status = status;
    game.pot += amount;
}

function evaluate(player, rank, kickers = []) {
    player.evaluationResult = { rankIndex: rank, significantRanks: kickers, description: 'test hand' };
}

function total(game) {
    return game.pot + game.players.reduce((sum, p) => sum + p.chips, 0);
}

test('raise to 60 facing 20 deducts 60 and makes the next increment 40', () => {
    const { game } = setup();
    contribute(game, 1, 20);
    game.currentBet = 20;
    assert.equal(game.handleAction(0, 'raise', 60), true);
    assert.equal(game.players[0].chips, 940);
    assert.equal(game.players[0].totalBetInRound, 60);
    assert.equal(game.players[0].totalBetInHand, 60);
    assert.equal(game.minRaise, 40);
    assert.equal(game.pot, 80);
    assert.equal(total(game), 4000);
});

test('raise deducts only the difference from an existing blind', () => {
    const { game } = setup();
    contribute(game, 0, 10);
    contribute(game, 1, 20);
    game.currentBet = 20;
    assert.equal(game.handleAction(0, 'raise', 60), true);
    assert.equal(game.players[0].currentBet, 50);
    assert.equal(game.players[0].chips, 940);
    assert.equal(game.players[0].totalBetInHand, 60);
    assert.equal(total(game), 4000);
});

test('rejects raises below the minimum, calls disguised as raises, and excessive amounts', () => {
    for (const amount of [10, 20, 39, 1001, 0, -10, 40.5, NaN, Infinity, '60']) {
        const { game } = setup();
        contribute(game, 1, 20);
        game.currentBet = 20;
        assert.equal(game.handleAction(0, 'raise', amount), false, String(amount));
        assert.equal(game.players[0].chips, 1000);
        assert.equal(game.currentBet, 20);
        assert.equal(game.pot, 20);
    }
});

test('accepts the exact minimum raise', () => {
    const { game } = setup();
    game.currentBet = 20;
    assert.equal(game.handleAction(0, 'raise', 40), true);
    assert.equal(game.minRaise, 20);
});

test('short all-in raise preserves the last full increment', () => {
    const { game } = setup();
    game.currentBet = 100;
    game.minRaise = 100;
    game.players[0].chips = 150;
    assert.equal(game.handleAction(0, 'raise', 150), true);
    assert.equal(game.players[0].status, 'all-in');
    assert.equal(game.players[0].totalBetInHand, 150);
    assert.equal(game.minRaise, 100);
});

test('short all-in does not reopen a raise for someone who already called', () => {
    const { game } = setup();
    game.currentBet = 150;
    game.minRaise = 100;
    game.players[0].lastActedBet = 100;
    assert.equal(game.canPlayerRaise(game.players[0]), false);
    assert.equal(game.handleAction(0, 'raise', 250), false);
    assert.equal(game.handleAction(0, 'call'), true);
});

test('cumulative short all-ins reopen betting after a full increment', () => {
    const { game } = setup();
    game.currentBet = 200;
    game.minRaise = 100;
    game.players[0].lastActedBet = 100;
    assert.equal(game.canPlayerRaise(game.players[0]), true);
    assert.equal(game.handleAction(0, 'raise', 300), true);
});

test('a player who checked may raise a short opening all-in', () => {
    const { game } = setup();
    game.currentBet = 10;
    game.players[0].lastActedBet = 0;
    assert.equal(game.handleAction(0, 'raise', 30), true);
});

test('big blind can raise when no additional call is due', () => {
    const { game } = setup();
    contribute(game, 0, 20);
    game.currentBet = 20;
    assert.equal(game.handleAction(0, 'raise', 40), true);
    assert.equal(game.players[0].chips, 960);
});

test('bet is only legal with no open bet; a short opening all-in preserves the minimum', () => {
    const { game } = setup();
    contribute(game, 0, 20);
    game.currentBet = 20;
    assert.equal(game.handleAction(0, 'bet', 40), false);
    game.currentBet = 0;
    game.players[0].totalBetInRound = 0;
    game.players[0].chips = 10;
    assert.equal(game.handleAction(0, 'bet', 10), true);
    assert.equal(game.minRaise, 20);
});

test('partial call invests only the remaining chips and enters all-in', () => {
    const { game } = setup();
    game.players[0].chips = 15;
    game.currentBet = 100;
    assert.equal(game.handleAction(0, 'call'), true);
    assert.equal(game.players[0].chips, 0);
    assert.equal(game.players[0].totalBetInHand, 15);
    assert.equal(game.players[0].status, 'all-in');
});

test('blinds do not consume the big blind option in an unraised pot', () => {
    const { game, tick } = setup();
    game.startNewHand();
    assert.equal(game.currentPlayerIndex, 3);
    for (const seat of [3, 0, 1]) {
        assert.equal(game.currentPlayerIndex, seat);
        assert.equal(game.handleAction(seat, 'call'), true);
        tick();
    }
    assert.equal(game.currentPhase, 'preflop');
    assert.equal(game.currentPlayerIndex, 2);
    assert.equal(game.handleAction(2, 'check'), true);
    tick();
    assert.equal(game.currentPhase, 'flop');
    assert.equal(game.pot, 80);
    assert.equal(game.players[2].totalBetInHand, 20);
    assert.equal(game.players[2].totalBetInRound, 0);
    assert.equal(total(game), 4000);
});

test('heads-up dealer posts small blind and acts first before the flop', () => {
    const { game } = setup();
    game.players[2].chips = 0;
    game.players[3].chips = 0;
    game.startNewHand();
    assert.equal(game.dealerButtonIndex, 0);
    assert.equal(game.players[0].totalBetInHand, 10);
    assert.equal(game.players[1].totalBetInHand, 20);
    assert.equal(game.currentPlayerIndex, 0);
});

test('last active player must respond to an outstanding all-in', () => {
    const { game, tick } = setup();
    game.players[1].status = 'all-in';
    game.players[2].status = 'folded';
    game.players[3].status = 'out';
    contribute(game, 1, 100, 'all-in');
    game.currentBet = 100;
    assert.equal(game._checkBettingRoundEnd(), false);
    assert.equal(game.canPlayerRaise(game.players[0]), false);
    assert.equal(game.handleAction(0, 'raise', 200), false);
    assert.equal(game.handleAction(0, 'call'), true);
    tick();
    tick();
    assert.equal(game.currentPhase, 'showdown');
    assert.equal(game.communityCards.length, 5);
    assert.equal(total(game), 4000);
});

test('a click while an accepted action is pending cannot invest twice', () => {
    const { game } = setup();
    assert.equal(game.handleAction(0, 'bet', 20), true);
    assert.equal(game.handleAction(0, 'bet', 20), false);
    assert.equal(game.players[0].chips, 980);
    assert.equal(game.pot, 20);
    assert.equal(game.getGameState().players[0].isTurn, false);
});

test('short stack wins only the main pot; another player wins the side pot', () => {
    const { game } = setup();
    [100, 500, 500].forEach((n, i) => contribute(game, i, n, 'all-in'));
    game.players[3].status = 'folded';
    evaluate(game.players[0], 7);
    evaluate(game.players[1], 3);
    evaluate(game.players[2], 1);
    game._distributePot();
    assert.deepEqual([...game._subPots].map(p => p.amount), [300, 800]);
    assert.deepEqual([...game.players].map(p => p.chips), [1200, 1300, 500, 1000]);
    assert.equal(game.pot, 0);
    assert.equal(total(game), 4000);
});

test('multiple side pots include folded contributions but exclude folded winners', () => {
    const { game } = setup();
    [100, 200, 400, 400].forEach((n, i) => contribute(game, i, n, i === 3 ? 'folded' : 'all-in'));
    [7, 3, 1, 9].forEach((rank, i) => evaluate(game.players[i], rank));
    game._distributePot();
    assert.deepEqual([...game._subPots].map(p => p.amount), [400, 300, 400]);
    assert.deepEqual([...game.players].map(p => p.chips), [1300, 1100, 1000, 600]);
    assert.equal(total(game), 4000);
});

test('uncalled excess is refunded even when the contributor loses the contested pot', () => {
    const { game } = setup();
    contribute(game, 0, 100, 'all-in');
    contribute(game, 1, 500, 'active');
    game.players[2].status = game.players[3].status = 'folded';
    evaluate(game.players[0], 7);
    evaluate(game.players[1], 0);
    game._distributePot();
    assert.deepEqual([...game.players].map(p => p.chips), [1100, 900, 1000, 1000]);
    assert.equal(game._subPots[1].refundPlayerId, 1);
    assert.equal(total(game), 4000);
});

test('each pot resolves ties independently; odd chip goes clockwise after dealer', () => {
    const { game } = setup();
    game.dealerButtonIndex = 0;
    [101, 201, 201].forEach((n, i) => contribute(game, i, n, 'all-in'));
    game.players[3].status = 'folded';
    evaluate(game.players[0], 1, [14, 13]);
    evaluate(game.players[1], 1, [14, 13]);
    evaluate(game.players[2], 1, [14, 12]);
    game._distributePot();
    assert.deepEqual([...game.players].map(p => p.chips), [1050, 1151, 799, 1000]);
    assert.equal(total(game), 4000);
});

test('hand contributions survive street resets and reset for a new hand', () => {
    const { game } = setup();
    contribute(game, 0, 20);
    game._dealCommunityCards('flop');
    assert.equal(game.players[0].totalBetInRound, 0);
    assert.equal(game.players[0].totalBetInHand, 20);
    assert.equal(game.handleAction(0, 'bet', 40), true);
    assert.equal(game.players[0].totalBetInHand, 60);
    game.players[0].resetForNewHand();
    assert.equal(game.players[0].totalBetInHand, 0);
    assert.equal(game.players[0].lastActedBet, null);
});

test('showdown evaluates each pot using actual cards', () => {
    const { game, Card } = setup();
    const cards = text => text.split(' ').map(c => new Card(c[1], c[0]));
    game.communityCards = cards('2H 3D 7C 9S KH');
    game.players[0].hand = cards('KS KD');
    game.players[1].hand = cards('AH AD');
    game.players[2].hand = cards('QH QD');
    game.players[3].status = 'folded';
    [100, 500, 500].forEach((n, i) => contribute(game, i, n, 'all-in'));
    game._showdown();
    assert.deepEqual([...game.players].map(p => p.chips), [1200, 1300, 500, 1000]);
    assert.equal(total(game), 4000);
});

test('invalid pot accounting fails before changing balances or discarding chips', () => {
    const { game } = setup();
    contribute(game, 0, 100);
    game.pot++;
    assert.throws(() => game._distributePot(), /contribuições/);
    assert.equal(game.players[0].chips, 900);
    assert.equal(game.pot, 101);
});

test('ineligible or unevaluated pots fail atomically', () => {
    const { game } = setup();
    [100, 200, 200].forEach((n, i) => contribute(game, i, n, 'all-in'));
    game.players[3].status = 'out';
    evaluate(game.players[0], 7);
    evaluate(game.players[1], 1);
    assert.throws(() => game._distributePot(), /avaliar/);
    assert.deepEqual([...game.players].map(p => p.chips), [900, 800, 800, 1000]);
    assert.equal(game.pot, 500);
});

test('fold ending a hand awards the entire pot and preserves chips', () => {
    const { game, tick } = setup();
    contribute(game, 0, 20);
    contribute(game, 1, 100);
    game.currentBet = 100;
    game.players[2].status = game.players[3].status = 'folded';
    assert.equal(game.handleAction(0, 'fold'), true);
    tick();
    assert.equal(game.players[1].chips, 1020);
    assert.equal(game.pot, 0);
    assert.equal(total(game), 4000);
});

test('seeded legal games conserve chips through raises, folds, all-ins and payouts', () => {
    for (let seed = 1; seed <= 30; seed++) {
        const { game, tick } = setup(seed);
        let state = seed;
        const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
        for (let hand = 0; hand < 12; hand++) {
            if (game.players.filter(p => p.chips > 0).length < 2) break;
            game.startNewHand();
            let moves = 0;
            while (game.pot > 0) {
                assert.ok(moves++ < 300, 'hand must finish');
                if (tick()) {
                    assert.equal(total(game), 4000);
                    continue;
                }
                const p = game.players[game.currentPlayerIndex];
                const roll = random();
                let action = game.currentBet > p.totalBetInRound ? 'call' : 'check';
                let amount = 0;
                if (roll < 0.12) action = 'fold';
                else if (roll > 0.6 && game.canPlayerRaise(p)) {
                    action = game.currentBet === 0 ? 'bet' : 'raise';
                    amount = Math.min(p.chips + p.totalBetInRound,
                        roll > 0.9 ? p.chips + p.totalBetInRound : game.currentBet + game.minRaise);
                }
                assert.equal(game.handleAction(p.id, action, amount), true);
                assert.equal(total(game), 4000);
                assert.ok(game.players.every(p => Number.isInteger(p.chips) && p.chips >= 0));
            }
            assert.equal(total(game), 4000);
        }
    }
});
