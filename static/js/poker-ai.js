/**
 * Estratégia sem acesso ao PokerGame, baralho real ou cartas de adversários.
 * Recebe somente a própria mão e um retrato das informações públicas.
 */
class PokerAI {
    constructor(evaluateHand, { random = Math.random, samples = 96 } = {}) {
        if (typeof evaluateHand !== 'function') throw new TypeError('Avaliador de mãos obrigatório.');
        if (!Number.isInteger(samples) || samples < 1 || samples > 1000) {
            throw new RangeError('Use entre 1 e 1000 simulações.');
        }
        this.evaluateHand = evaluateHand;
        this.random = random;
        this.samples = samples;
    }

    _preflopStrength(hand) {
        const [high, low] = hand.map(c => c.value).sort((a, b) => b - a);
        if (high === low) return Math.min(0.98, 0.55 + high / 35);
        const suited = hand[0].suit === hand[1].suit;
        const gap = high - low;
        const connectorBonus = gap === 1 ? 0.04 : 0;
        const gapPenalty = Math.max(0, gap - 2) * 0.025;
        const broadwayBonus = low >= 10 ? 0.04 : 0;
        return Math.max(0.05, Math.min(0.95,
            (high + low) / 40 + (suited ? 0.05 : 0) + connectorBonus + broadwayBonus - gapPenalty));
    }

    _compare(a, b) {
        if (a.rankIndex !== b.rankIndex) return a.rankIndex - b.rankIndex;
        for (let i = 0; i < a.significantRanks.length; i++) {
            if (a.significantRanks[i] !== b.significantRanks[i]) {
                return a.significantRanks[i] - b.significantRanks[i];
            }
        }
        return 0;
    }

    _estimateEquity(hand, board, opponentCount) {
        if (opponentCount === 0) return 1;
        const known = new Set([...hand, ...board].map(c => c.rank + c.suit));
        const unknown = [];
        for (const suit of ['H', 'D', 'C', 'S']) {
            '23456789TJQKA'.split('').forEach((rank, i) => {
                if (!known.has(rank + suit)) unknown.push({ suit, rank, value: i + 2 });
            });
        }
        const missingBoard = 5 - board.length;
        const drawCount = missingBoard + opponentCount * 2;
        // No river, a mão do bot é a mesma em todas as simulações.
        const riverHand = board.length === 5 ? this.evaluateHand([...hand, ...board]) : null;
        let equity = 0;
        for (let sample = 0; sample < this.samples; sample++) {
            const deck = [...unknown];
            // Fisher-Yates parcial: amostra sem reposição somente as cartas necessárias.
            for (let i = 0; i < drawCount; i++) {
                const j = i + Math.floor(this.random() * (deck.length - i));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }
            const runout = [...board, ...deck.slice(0, missingBoard)];
            const own = riverHand || this.evaluateHand([...hand, ...runout]);
            let tied = 1;
            let lost = false;
            for (let opponent = 0; opponent < opponentCount; opponent++) {
                const offset = missingBoard + opponent * 2;
                const other = this.evaluateHand([...deck.slice(offset, offset + 2), ...runout]);
                const comparison = this._compare(own, other);
                if (comparison < 0) {
                    lost = true;
                    break;
                }
                if (comparison === 0) tied++;
            }
            if (!lost) equity += 1 / tied;
        }
        return equity / this.samples;
    }

    assess(observation) {
        const { player, players, hand, communityCards, currentBet, dealerId } = observation;
        const opponents = players.filter(p => p.id !== player.id && p.status !== 'folded' && p.status !== 'out');
        const callCost = Math.min(player.chips, Math.max(0, currentBet - player.totalBetInRound));
        // Exclui partes de side pots que o bot não poderá disputar mesmo pagando.
        const contributionCap = player.totalBetInHand + callCost;
        const contestablePot = players.reduce((sum, p) => sum + Math.min(p.totalBetInHand, contributionCap), 0) + callCost;
        const potOdds = callCost > 0 ? callCost / contestablePot : 0;
        if (communityCards.length === 0) {
            const positionBonus = player.id === dealerId ? 0.03 : 0;
            const strength = Math.min(0.99, this._preflopStrength(hand) + positionBonus);
            // Heurística pré-flop, sem alegar uma probabilidade calculada por simulação.
            const equity = Math.pow(0.28 + strength * 0.5, 1 + 0.35 * Math.max(0, opponents.length - 1));
            return { strength, equity, potOdds, callCost };
        }
        const equity = this._estimateEquity(hand, communityCards, opponents.length);
        return { strength: equity, equity, potOdds, callCost };
    }

    decide(observation) {
        const { player, currentBet, minRaise, bigBlindAmount, pot, communityCards } = observation;
        const { strength, equity, potOdds, callCost } = this.assess(observation);
        const passive = { action: callCost > 0 ? 'call' : 'check', amount: 0 };
        // Margem pequena reduz calls marginais causados pelo ruído da simulação.
        if (callCost > 0 && equity < potOdds + 0.03) return { action: 'fold', amount: 0 };
        const preflop = communityCards.length === 0;
        const valueHand = preflop ? strength >= 0.72 : equity >= 0.68;
        if (!player.canRaise || !valueHand || equity < potOdds + 0.12) return passive;
        const maxTotal = player.chips + player.totalBetInRound;
        const minTotal = currentBet === 0 ? Math.max(bigBlindAmount, minRaise) : currentBet + minRaise;
        // Evita transformar uma pequena vantagem em um all-in forçado pelo stack.
        if (maxTotal < minTotal && equity < 0.75) return passive;
        const target = preflop
            ? Math.max(bigBlindAmount * 3, currentBet * 3, minTotal)
            : Math.max(minTotal, currentBet + Math.floor((pot + callCost) * 0.6));
        return { action: currentBet === 0 ? 'bet' : 'raise', amount: Math.min(maxTotal, target) };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PokerAI };
}
