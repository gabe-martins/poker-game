/**
 * poker-logic.js
 * Lógica central para um jogo de Poker Texas Hold'em
 * Foco: Gerenciamento do estado do jogo, ações, jogadores (1 humano, 3 IA)
 * Inclui callback de atualização da UI e lógica de avaliação de mãos robusta.
 */

// --- Constantes ---
const SUITS = ["H", "D", "C", "S"]; // Copas, Ouros, Paus, Espadas
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]; // T=10
// Índices correspondem aos valores retornados por _evaluateSingle5CardHand
const HAND_RANKS = [
    "High Card",        // 0
    "One Pair",         // 1
    "Two Pair",         // 2
    "Three of a Kind",  // 3
    "Straight",         // 4
    "Flush",            // 5
    "Full House",       // 6
    "Four of a Kind",   // 7
    "Straight Flush",   // 8
    "Royal Flush"       // 9
];

const STARTING_CHIPS = 1000;
const SMALL_BLIND_AMOUNT = 10;
const BIG_BLIND_AMOUNT = 20; // Também usado como aposta mínima padrão

// --- Classes ---

class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank;
        this.value = this._getRankValue(rank); // Valor numérico (2-14)
    }

    _getRankValue(rank) {
        if ("23456789".includes(rank)) return parseInt(rank);
        if (rank === "T") return 10;
        if (rank === "J") return 11;
        if (rank === "Q") return 12;
        if (rank === "K") return 13;
        if (rank === "A") return 14; // Ás alto por padrão
        return 0;
    }

    // Formato interno/lógico (ex: AH, TD, 2C)
    toString() {
        return `${this.rank}${this.suit}`;
    }
}

class Deck {
    constructor() {
        this.cards = [];
        this.reset();
        this.shuffle();
    }

    reset() {
        this.cards = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.cards.push(new Card(suit, rank));
            }
        }
    }

    shuffle() {
        // Algoritmo Fisher-Yates (Knuth Shuffle)
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    dealCard() {
        return this.cards.pop();
    }

    get cardCount() {
        return this.cards.length;
    }
}

class Player {
    constructor(id, name, isHuman = false, chips = STARTING_CHIPS) {
        this.id = id;
        this.name = name;
        this.isHuman = isHuman;
        this.chips = chips;
        this.hand = []; // Cartas na mão (Card objects)
        this.currentBet = 0; // Aposta na ação atual
        this.totalBetInRound = 0; // Total apostado nesta FASE (preflop, flop, etc.)
        this.totalBetInHand = 0; // Inclui blinds e todas as fases, inclusive após fold.
        this.lastActedBet = null; // Aposta enfrentada na última ação; controla reabertura.
        this.status = 'waiting'; // waiting, active, folded, all-in, out
        this.evaluationResult = null; // Resultado de _evaluateBestHand { rankIndex, hand, description, significantRanks }
        this.hasActedInRound = false; // Flag para controle de fim de rodada
        this.isLastAggressor = false; // Flag para controle de fim de rodada
    }

    resetForNewHand() {
        this.hand = [];
        this.currentBet = 0;
        this.totalBetInRound = 0;
        this.totalBetInHand = 0;
        this.lastActedBet = null;
        this.evaluationResult = null;
        this.hasActedInRound = false;
        this.isLastAggressor = false;
        if (this.chips > 0) {
            this.status = 'waiting';
        } else {
            this.status = 'out';
        }
    }

    addChips(amount) {
        this.chips += amount;
    }

    removeChips(amount) {
        const removed = Math.min(amount, this.chips);
        this.chips -= removed;
        return removed;
    }

    prepareToAction() {
        if (this.chips > 0 && this.status !== 'folded' && this.status !== 'all-in' && this.status !== 'out') {
            this.status = 'active';
        }
    }
}

class PokerGame {
    constructor(playerNames = ["Player 1", "Player 2", "Player 3", "Player 4"], uiUpdateCallback = null) {
        this.players = [];
        this.players.push(new Player(0, playerNames[0] || "Human", true));
        for (let i = 1; i < 4; i++) {
            this.players.push(new Player(i, playerNames[i] || `AI ${i}`, false));
        }

        this.deck = new Deck();
        this.communityCards = [];
        this.pot = 0;
        this.currentBet = 0; // A maior aposta feita na rodada que precisa ser coberta
        this.minRaise = BIG_BLIND_AMOUNT; // O valor ADICIONAL mínimo para um raise
        this.dealerButtonIndex = -1;
        this.currentPlayerIndex = -1;
        this.currentPhase = 'idle'; // idle, preflop, flop, turn, river, showdown, gameOver
        this.log = [];
        this.uiUpdateCallback = uiUpdateCallback;
        this._subPots = [];
        this._actionPending = false;
        this._roundActionCounter = 0;
        this._lastRaiserId = -1; // ID do último a fazer bet/raise
    }

    _logEvent(message) {
        console.log(message);
        this.log.push(message);
        
        if (this.log.length > 200) this.log.shift(); // Limita tamanho do log
    }

    _triggerUIUpdate() {
        if (this.uiUpdateCallback) {
            // Adiciona um pequeno delay para garantir que o DOM possa ser atualizado
            // sem ser interrompido por outra ação imediata (especialmente IA)
            setTimeout(() => {
                try {
                     this.uiUpdateCallback(this.getGameState());
                } catch (e) {
                     console.error("Erro durante o callback de atualização da UI:", e)
                }
            }, 0); // Timeout 0 executa assim que a pilha atual estiver vazia
        }
    }

    // --- Gerenciamento do Jogo ---

    startNewHand() {
        const playersWithChips = this.players.filter(p => p.chips > 0);
        if (playersWithChips.length < 2) {
            this._logEvent("Não há jogadores suficientes com fichas para continuar.");
            this.currentPhase = 'gameOver';
            this._triggerUIUpdate();
            return;
        }

        this._logEvent("--- Iniciando Nova Mão ---");
        this.deck.reset();
        this.deck.shuffle();
        this.communityCards = [];
        this.pot = 0;
        this.currentBet = 0;
        this.minRaise = BIG_BLIND_AMOUNT;
        this._subPots = [];
        this._actionPending = false;
        this._roundActionCounter = 0;
        this._lastRaiserId = -1;

        this.players.forEach(player => player.resetForNewHand());

        const activePlayersInGame = this.players.filter(p => p.status !== 'out');
        if (activePlayersInGame.length < 2) {
            this._logEvent("Erro inesperado: Menos de 2 jogadores ativos após reset.");
            this.currentPhase = 'gameOver';
            this._triggerUIUpdate();
            return;
        }

        this.dealerButtonIndex = this._getNextPlayerIndex(this.dealerButtonIndex, activePlayersInGame);
        const sbIndex = activePlayersInGame.length === 2
            ? this.dealerButtonIndex
            : this._getNextPlayerIndex(this.dealerButtonIndex, activePlayersInGame);
        const bbIndex = this._getNextPlayerIndex(sbIndex, activePlayersInGame);

        this._postBlind(sbIndex, SMALL_BLIND_AMOUNT, "Small Blind");
        this._postBlind(bbIndex, BIG_BLIND_AMOUNT, "Big Blind");
        this._lastRaiserId = this.players[bbIndex]?.id ?? -1;
        this.players.forEach(p => p.isLastAggressor = (p.id === this._lastRaiserId));

        this.currentBet = BIG_BLIND_AMOUNT;
        this.currentPlayerIndex = this._getNextPlayerIndex(bbIndex, activePlayersInGame);

        this._dealPrivateCards();

        activePlayersInGame.forEach(p => {
            if (p.status !== 'all-in' && p.status !== 'out') p.prepareToAction();
            p.hasActedInRound = false; // Postar blind não consome a vez de agir.
        });

        this.currentPhase = 'preflop';
        this._logEvent(`Fase: Preflop. Dealer é ${this.players[this.dealerButtonIndex]?.name}. ${this.players[sbIndex]?.name} posta SB(${SMALL_BLIND_AMOUNT}). ${this.players[bbIndex]?.name} posta BB(${BIG_BLIND_AMOUNT}).`);

        // Pula jogadores que já estão fora/all-in/folded até encontrar um ativo
        let safety = 0;
        while (this.players[this.currentPlayerIndex]?.status !== 'active' && safety < this.players.length * 2) {
             const currentStatus = this.players[this.currentPlayerIndex]?.status;
             if (currentStatus === 'out' || currentStatus === 'folded' || currentStatus === 'all-in') {
                 const nextIdx = this._getNextPlayerIndex(this.currentPlayerIndex, this._getPlayersInHand());
                 if (nextIdx === this.currentPlayerIndex || nextIdx === -1) {
                      this._logEvent("Não há jogadores ativos para iniciar a aposta, avançando.");
                      this._endBettingRound();
                      return;
                 }
                 this.currentPlayerIndex = nextIdx;
                 this.players[this.currentPlayerIndex].prepareToAction(); // Prepara o próximo encontrado
             } else {
                  // Jogador está 'waiting', prepara para 'active'
                   this.players[this.currentPlayerIndex].prepareToAction();
                  break; // Encontrou um jogador 'waiting' ou 'active'
             }
              safety++;
               if(safety >= this.players.length * 2) {
                   console.error("Loop infinito ao encontrar primeiro jogador pré-flop");
                    this._endBettingRound(); // Tenta terminar a rodada como fallback
                    return;
               }
        }


        this._logEvent(`Vez de: ${this.players[this.currentPlayerIndex]?.name}`);
        this._triggerUIUpdate();
        this._checkAndTriggerAIAction();
    }

    _postBlind(playerIndex, amount, blindType) {
        const player = this.players[playerIndex];
        if (!player || player.status === 'out') return;
        const blindAmount = player.removeChips(amount);
        player.currentBet = blindAmount;
        player.totalBetInRound = blindAmount;
        player.totalBetInHand += blindAmount;
        this.pot += blindAmount;
        this._logEvent(`${player.name} posta ${blindType} de ${blindAmount}`);
        if (player.chips === 0) {
            player.status = 'all-in';
            this._logEvent(`${player.name} está all-in com o blind.`);
        }
    }

    _dealPrivateCards() {
        this._logEvent("Distribuindo cartas...");
        const activePlayers = this.players.filter(p => p.status !== 'out');
        const startIndex = this._getNextPlayerIndex(this.dealerButtonIndex, activePlayers);
        let currentDealIndex = startIndex;
        for (let i = 0; i < 2; i++) {
            for (let j = 0; j < activePlayers.length; j++) {
                 const player = this.players[currentDealIndex];
                 if (player && player.status !== 'out') {
                     const card = this.deck.dealCard();
                     if (card) player.hand.push(card);
                     else { console.error("Baralho vazio!"); return; }
                 }
                 currentDealIndex = this._getNextPlayerIndex(currentDealIndex, activePlayers);
                 if(currentDealIndex === -1) { // Segurança
                      console.error("Erro ao obter próximo jogador na distribuição");
                      return;
                 }
            }
        }
    }

    // --- Lógica de Ação do Jogador ---
    handleAction(playerId, action, amount = 0) {
        const player = this.players.find(p => p.id === playerId);
        const currentPlayer = this.players[this.currentPlayerIndex];
        if (this._actionPending || !['preflop', 'flop', 'turn', 'river'].includes(this.currentPhase)) {
            return false;
        }
        if (typeof action !== 'string' ||
            (['bet', 'raise'].includes(action.toLowerCase()) && (!Number.isSafeInteger(amount) || amount <= 0))) {
            this._logEvent("Ação inválida: aposta deve ser um inteiro positivo.");
            return false;
        }

        if (!player || player.id !== currentPlayer?.id) {
            this._logEvent(`Ação inválida: Não é a vez de ${player?.name ?? 'ID desconhecido'}. É a vez de ${currentPlayer?.name ?? 'Ninguém'}.`);
            return false;
        }
        if (player.status !== 'active') {
            this._logEvent(`Ação inválida: ${player.name} não está ativo (status: ${player.status}).`);
            return false;
        }

        let isValidAction = false;
        const amountToCall = this.currentBet - player.totalBetInRound;
        let actionDescription = "";
        let performMove = true;

        // Resetar flag de último agressor antes de processar a nova ação
        // Somente a ação agressiva (bet/raise) definirá a flag
        player.isLastAggressor = false;

        switch (action.toLowerCase()) {
            case 'fold':
                player.status = 'folded';
                actionDescription = `${player.name} desiste (fold).`;
                isValidAction = true;
                break;

            case 'check':
                if (amountToCall > 0) {
                    actionDescription = `Ação inválida: ${player.name} não pode dar check, precisa pagar ${amountToCall}.`;
                    performMove = false;
                } else {
                    actionDescription = `${player.name} passa (check).`;
                    isValidAction = true;
                }
                break;

            case 'call':
                if (amountToCall <= 0) {
                    actionDescription = `${player.name} passa (check) - (Call sem aposta pendente).`;
                    isValidAction = true;
                } else {
                    const callAmount = Math.min(amountToCall, player.chips);
                    player.removeChips(callAmount);
                    player.currentBet = callAmount;
                    player.totalBetInRound += callAmount;
                    player.totalBetInHand += callAmount;
                    this.pot += callAmount;
                    actionDescription = `${player.name} paga (call) ${callAmount}.`;
                    if (player.chips === 0) {
                        player.status = 'all-in';
                        actionDescription += ` e está all-in.`;
                    }
                    isValidAction = true;
                }
                break;

            case 'bet':
                const isEffectivelyCheck = this.currentBet === 0;
                if (!isEffectivelyCheck) {
                    actionDescription = `Ação inválida: ${player.name} não pode apostar (bet), use call ou raise.`;
                    performMove = false;
                } else if (!this.canPlayerRaise(player)) {
                    actionDescription = "Ação inválida: aposta não permitida.";
                    performMove = false;
                } else if (amount <= 0) {
                    actionDescription = `Ação inválida: ${player.name} - valor da aposta deve ser positivo.`;
                    performMove = false;
                } else if (amount < this.minRaise && player.chips > amount) {
                    actionDescription = `Ação inválida: ${player.name} - aposta mínima é ${this.minRaise}.`;
                    performMove = false;
                } else if (amount > player.chips) {
                    actionDescription = `Ação inválida: ${player.name} não tem fichas suficientes para apostar ${amount}.`;
                    performMove = false;
                } else {
                    const betAmount = player.removeChips(amount);
                    player.currentBet = betAmount;
                    player.totalBetInRound = betAmount;
                    player.totalBetInHand += betAmount;
                    this.pot += betAmount;
                    this.currentBet = player.totalBetInRound;
                    this.minRaise = Math.max(this.minRaise, betAmount);
                    this._lastRaiserId = player.id; // <<< Define quem foi o último agressor
                    this.players.forEach(p => p.isLastAggressor = (p.id === player.id)); // <<< Atualiza flag em todos
                    player.isLastAggressor = true; // Garante que o próprio jogador saiba
                    actionDescription = `${player.name} aposta (bet) ${betAmount}.`;
                    if (player.chips === 0) {
                        player.status = 'all-in';
                        actionDescription += ` e está all-in.`;
                    }
                    isValidAction = true;
                }
                break;

            case 'raise':
                const totalAfterRaise = amount;
                const raiseAmount = totalAfterRaise - this.currentBet;
                const amountNeeded = totalAfterRaise - player.totalBetInRound;

                if (this.currentBet === 0) {
                    actionDescription = `Ação inválida: ${player.name} não pode dar raise, use bet.`;
                    performMove = false;
                } else if (!this.canPlayerRaise(player)) {
                    actionDescription = "Ação inválida: aumento não permitido ou ação não reaberta.";
                    performMove = false;
                } else if (raiseAmount <= 0) {
                    actionDescription = `Ação inválida: ${player.name} - o valor do raise (${totalAfterRaise}) deve ser maior que a aposta atual (${player.totalBetInRound}).`;
                    performMove = false;
                  } else if (raiseAmount < this.minRaise && player.chips !== amountNeeded) {
                     actionDescription = `Ação inválida: ${player.name} - aumento mínimo (raise) precisa ser de ${this.minRaise} a mais (totalizando ${this.currentBet + this.minRaise}). Tentou aumentar ${raiseAmount}.`;
                     performMove = false;
                 } else if (amountNeeded > player.chips) {
                    actionDescription = `Ação inválida: ${player.name} não tem fichas suficientes para aumentar para ${totalAfterRaise}. Tem ${player.chips}, precisa ${amountNeeded}.`;
                    performMove = false;
                 } else {
                    player.removeChips(amountNeeded);
                    player.currentBet = amountNeeded;
                    player.totalBetInRound = totalAfterRaise;
                    player.totalBetInHand += amountNeeded;
                    this.pot += amountNeeded;
                    this.currentBet = player.totalBetInRound;
                    if (raiseAmount >= this.minRaise) this.minRaise = raiseAmount;
                    this._lastRaiserId = player.id; // <<< Define quem foi o último agressor
                     this.players.forEach(p => p.isLastAggressor = (p.id === player.id)); // <<< Atualiza flag em todos
                     player.isLastAggressor = true; // Garante que o próprio jogador saiba
                    actionDescription = `${player.name} aumenta (raise) para ${totalAfterRaise}.`;
                    if (player.chips === 0) {
                        player.status = 'all-in';
                        actionDescription += ` e está all-in.`;
                    }
                    isValidAction = true;
                 }
                break;

            default:
                actionDescription = `Ação desconhecida: ${action}`;
                performMove = false;
                break;
        }

        this._logEvent(actionDescription);

        if (isValidAction) {
            player.hasActedInRound = true;
            player.lastActedBet = this.currentBet;
            this._roundActionCounter++;
            if (performMove) {
                 // Adia a chamada para _moveToNextPlayer para garantir que a UI possa atualizar ANTES
                  this._actionPending = true;
                  setTimeout(() => {
                      this._actionPending = false;
                      this._moveToNextPlayer();
                  }, 50);
                 // Atualiza a UI imediatamente para mostrar a ação do jogador atual
                 this._triggerUIUpdate();
            } else {
                 this._triggerUIUpdate(); // Atualiza mesmo se não mover (ex: erro para humano)
            }
            return true;
        } else {
            if (!player.isHuman) {
                this._logEvent(`IA ${player.name} tentou ação inválida. Tentando ação segura...`);
                 const canCheck = (this.currentBet - player.totalBetInRound) <= 0;
                 if (canCheck) setTimeout(() => this.handleAction(playerId, 'check'), 50); // Delay para não sobrecarregar
                 else if (player.chips > 0) setTimeout(() => this.handleAction(playerId, 'call'), 50);
                 else setTimeout(() => this.handleAction(playerId, 'fold'), 50); // Sem fichas, força fold
            } else {
                 this._triggerUIUpdate(); // Atualiza para humano tentar de novo
            }
            return false;
        }
    }


    // --- Controle de Fluxo do Jogo ---

    _getPlayersInHand(includeFolded = false) {
        return this.players.filter(p =>
            p.status !== 'out' && (includeFolded || p.status !== 'folded')
        );
    }

    _getActingPlayers() {
        return this.players.filter(p => p.status === 'active');
    }

    _getNextPlayerIndex(currentIndex, playerPool) {
        if (!playerPool || playerPool.length === 0) return -1;
        let attempts = 0;
        let nextIndex = currentIndex;
        do {
            nextIndex = (nextIndex + 1) % this.players.length;
            const nextPlayer = this.players[nextIndex];
            if (playerPool.some(p => p.id === nextPlayer.id)) {
                return nextIndex;
            }
            attempts++;
        } while (attempts <= this.players.length);
        console.warn("Não foi possível encontrar o próximo jogador no pool especificado.");
        return -1;
    }

    _moveToNextPlayer() {
        const playersStillInHand = this._getPlayersInHand();
        if (playersStillInHand.length <= 1) {
            this._logEvent("Apenas um jogador (ou nenhum) restante na mão.");
            this._awardPotToWinner(playersStillInHand);
            return;
        }

        const bettingRoundEnded = this._checkBettingRoundEnd();
        if (bettingRoundEnded) {
            this._endBettingRound();
        } else {
            let nextPlayerIndex = this.currentPlayerIndex;
            let nextPlayer = null;
            let safetyCounter = 0;
            do {
                nextPlayerIndex = this._getNextPlayerIndex(nextPlayerIndex, playersStillInHand);
                 if (nextPlayerIndex === -1 || safetyCounter > this.players.length * 2) {
                      console.error("Erro ao encontrar próximo jogador para agir. Forçando fim da rodada.");
                      this._endBettingRound();
                      return;
                 }
                 nextPlayer = this.players[nextPlayerIndex];
                 safetyCounter++;
            } while (nextPlayer.status === 'all-in' || nextPlayer.status === 'folded');

            this.currentPlayerIndex = nextPlayerIndex;
            nextPlayer.prepareToAction();
            this._logEvent(`Vez de: ${nextPlayer.name}`);
            this._triggerUIUpdate();
            this._checkAndTriggerAIAction();
        }
    }

    canPlayerRaise(player) {
        const hasOpponent = this.players.some(p => p.id !== player.id && p.status === 'active' && p.chips > 0);
        const actionReopened = player.lastActedBet === null || player.lastActedBet === 0 ||
            this.currentBet - player.lastActedBet >= this.minRaise;
        return player.status === 'active' && hasOpponent && actionReopened &&
            player.chips + player.totalBetInRound > this.currentBet;
    }

    _checkBettingRoundEnd() {
        const playersInHand = this._getPlayersInHand();
        if (playersInHand.length <= 1) return true;
        const actingPlayers = this._getActingPlayers();
        if (actingPlayers.length === 0) return true;
        if (actingPlayers.length === 1) {
            // O último jogador ainda precisa decidir se paga o all-in ou desiste.
            return actingPlayers[0].totalBetInRound >= this.currentBet;
        }
        return actingPlayers.every(p => p.hasActedInRound && p.totalBetInRound === this.currentBet);
    }


    _endBettingRound() {
        this._logEvent(`--- Fim da Rodada de Apostas (${this.currentPhase}) ---`);
        this._logEvent(`Pote Total: ${this.pot}`);

        // O total da mão é preservado separadamente para os side pots.
        this.currentBet = 0;
        this.minRaise = BIG_BLIND_AMOUNT;
        this._roundActionCounter = 0;
        this._lastRaiserId = -1;
        this.players.forEach(p => {
            p.currentBet = 0;
            p.totalBetInRound = 0;
            p.lastActedBet = null;
            p.hasActedInRound = false;
            p.isLastAggressor = false;
        });

        const playersToShowdown = this._getPlayersInHand();
        const playersWhoCanBet = playersToShowdown.filter(p => p.status !== 'all-in');

        let nextPhase = '';
        switch (this.currentPhase) {
            case 'preflop': nextPhase = 'flop'; break;
            case 'flop': nextPhase = 'turn'; break;
            case 'turn': nextPhase = 'river'; break;
            case 'river': nextPhase = 'showdown'; break;
            default: nextPhase = 'idle'; break;
        }

        if (nextPhase !== 'showdown' && playersWhoCanBet.length >= 2) {
            this._dealCommunityCards(nextPhase, true);
        } else if (nextPhase !== 'showdown') {
            this._logEvent("Jogadores all-in ou apenas um ativo. Revelando cartas restantes...");
             let currentPhaseForDealing = this.currentPhase;
             while(currentPhaseForDealing !== 'river') {
                  let phaseToDeal = '';
                  if (currentPhaseForDealing === 'preflop') phaseToDeal = 'flop';
                  else if (currentPhaseForDealing === 'flop') phaseToDeal = 'turn';
                  else if (currentPhaseForDealing === 'turn') phaseToDeal = 'river';
                  if (phaseToDeal) {
                       this._dealCommunityCards(phaseToDeal, false); // Apenas distribui
                       currentPhaseForDealing = phaseToDeal;
                       if (this.deck.cardCount === 0 && currentPhaseForDealing !== 'river') break;
                  } else break;
             }
              // Adia o showdown para garantir que a última carta seja exibida
             setTimeout(() => this._showdown(), 100);
        } else {
            this._showdown();
        }
    }

    _dealCommunityCards(phase, startBettingRound = true) {
        const numPlayersInHand = this._getPlayersInHand().length;
        if (numPlayersInHand <= 1 && this.currentPhase !== 'idle') {
            this._logEvent("Apenas um jogador restante, pulando para o final da mão.");
            this._awardPotToWinner(this._getPlayersInHand());
            return;
        }

        if (this.deck.cardCount > 0) {
            this.deck.dealCard(); // Burn card
        } else if (this.communityCards.length < 5) {
             console.error("Baralho vazio antes de queimar carta para ", phase);
             // Continua para showdown mesmo assim
        }

        let cardsToDeal = 0;
        let expectedCommunitySize = 0;
        if (phase === 'flop') { cardsToDeal = 3; expectedCommunitySize = 0; }
        else if (phase === 'turn') { cardsToDeal = 1; expectedCommunitySize = 3; }
        else if (phase === 'river') { cardsToDeal = 1; expectedCommunitySize = 4; }

        if (cardsToDeal === 0 || this.communityCards.length !== expectedCommunitySize) {
            console.error("Tentativa de distribuir cartas comunitárias em fase/estado inválido:", phase, this.communityCards.length);
            if (this.currentPhase !== 'river' && this.currentPhase !== 'showdown') this._showdown();
            return;
        }

        this.currentPhase = phase;
        const dealtCards = [];
        for (let i = 0; i < cardsToDeal; i++) {
            if (this.deck.cardCount > 0) {
                const card = this.deck.dealCard();
                this.communityCards.push(card);
                dealtCards.push(card.toString());
            } else {
                console.error("Baralho vazio durante distribuição para", phase);
                this._logEvent(`Baralho vazio! ${phase} incompleto.`);
                break;
            }
        }
        this._logEvent(`--- ${phase.toUpperCase()} --- Cartas Comunitárias: ${this.communityCards.map(c=>c.toString()).join(', ')}`);

        const playersWhoCanBet = this._getPlayersInHand().filter(p => p.status !== 'all-in');
        if (startBettingRound && playersWhoCanBet.length >= 2) {
            this._logEvent("Iniciando rodada de apostas.");
            // Reseta apostas da rodada anterior e flags de ação para a nova rodada
             this.players.forEach(p => {
                 p.totalBetInRound = 0; // Zera para a nova fase
                 p.hasActedInRound = false;
                 p.isLastAggressor = false;
             });
             this._roundActionCounter = 0;
             this._lastRaiserId = -1;


            let firstToActIndex = -1;
            let potentialIndex = this.dealerButtonIndex;
            let loopGuard = 0;
            do {
                 potentialIndex = this._getNextPlayerIndex(potentialIndex, playersWhoCanBet);
                  if(potentialIndex !== -1) {
                      firstToActIndex = potentialIndex;
                      break;
                  }
                  loopGuard++;
            } while(loopGuard <= this.players.length)

            if (firstToActIndex !== -1) {
                this.currentPlayerIndex = firstToActIndex;
                this.players[firstToActIndex].prepareToAction();
                this._logEvent(`Vez de: ${this.players[firstToActIndex].name}`);
                this._triggerUIUpdate();
                this._checkAndTriggerAIAction();
            } else {
                 console.error("Não foi possível determinar o primeiro a agir após distribuir cartas.");
                 this._showdown();
            }
        } else {
              this._triggerUIUpdate(); // Atualiza para mostrar novas cartas mesmo sem apostas
              // O fluxo continuará de _endBettingRound se startBettingRound for false
        }
    }

    // --- Showdown e Avaliação de Mãos (VERSÕES CORRIGIDAS/ROBUSTAS) ---

    _showdown() {
        this.currentPhase = 'showdown';
        this._logEvent("--- SHOWDOWN ---");
        const contenders = this._getPlayersInHand();

        if (contenders.length === 0) {
            this._logEvent("Erro: Nenhum jogador no showdown.");
             this._triggerUIUpdate();
             setTimeout(() => this.startNewHand(), 5000);
            return;
        }
        if (contenders.length === 1) {
            this._logEvent(`${contenders[0].name} é o único restante.`);
            this._awardPotToWinner(contenders);
            return;
        }

        this._logEvent("Revelando mãos e avaliando:");
        contenders.forEach(player => {
            player.evaluationResult = this._evaluateBestHand([...player.hand, ...this.communityCards]);
            this._logEvent(`${player.name}: ${player.evaluationResult.description}`);
        });

        this._distributePot();
        this._triggerUIUpdate(); // Atualiza UI para mostrar mãos finais/vencedores

        this._logEvent("Próxima mão em 5 segundos...");
        setTimeout(() => this.startNewHand(), 5000);
    }

     _evaluateBestHand(sevenCards) {
        if (!sevenCards || sevenCards.length < 5) {
            return { rankIndex: -1, hand: null, description: "Invalid Cards", significantRanks: [] };
        }
        // Gera todas as combinações de 5 cartas
        const all5CardCombinations = this._getCombinations(sevenCards, 5);
        let bestHandOverall = { rankIndex: -1, hand: null, description: "None", significantRanks: [] };

        for (const hand5 of all5CardCombinations) {
            // Avalia cada combinação de 5 cartas
            const currentEval = this._evaluateSingle5CardHand(hand5);

            // Compara com a melhor encontrada até agora
            if (currentEval.rankIndex > bestHandOverall.rankIndex) {
                bestHandOverall = currentEval;
            } else if (currentEval.rankIndex === bestHandOverall.rankIndex) {
                 if (this._compareSignificantRanks(currentEval.significantRanks, bestHandOverall.significantRanks) > 0) {
                     bestHandOverall = currentEval;
                 }
            }
        }

        // Retorna os detalhes da melhor mão encontrada
        if (bestHandOverall.hand) {
            bestHandOverall.hand.sort((a, b) => b.value - a.value); // Ordena a mão final por valor
        }
        return bestHandOverall;
    }

     _getCombinations(arr, k) {
        if (k < 0 || k > arr.length) return [];
        if (k === 0) return [[]];
        if (k === arr.length) return [arr];
        if (k === 1) return arr.map(item => [item]);
        const combinations = [];
        const firstElement = arr[0];
        const rest = arr.slice(1);
        const combsWithFirst = this._getCombinations(rest, k - 1);
        combsWithFirst.forEach(comb => combinations.push([firstElement, ...comb]));
        const combsWithoutFirst = this._getCombinations(rest, k);
        combinations.push(...combsWithoutFirst);
        return combinations;
    }

    _evaluateSingle5CardHand(hand5) {
        if (!hand5 || hand5.length !== 5) {
            return { rankIndex: -1, hand: null, description: "Invalid Hand", significantRanks: [] };
        }
        const sortedHand = [...hand5].sort((a, b) => b.value - a.value);
        const ranks = sortedHand.map(c => c.value);
        const suits = sortedHand.map(c => c.suit);
        const isFlush = suits.every(s => s === suits[0]);
        const rankCounts = ranks.reduce((acc, rank) => { acc[rank] = (acc[rank] || 0) + 1; return acc; }, {});
        const counts = Object.values(rankCounts).sort((a, b) => b - a);
        const uniqueRanksSorted = [...new Set(ranks)].sort((a, b) => b - a);
        const isStraight = uniqueRanksSorted.length >= 5 && (
            (uniqueRanksSorted[0] - uniqueRanksSorted[4] === 4) ||
            (uniqueRanksSorted[0] === 14 && uniqueRanksSorted[1] === 5 && uniqueRanksSorted[2] === 4 && uniqueRanksSorted[3] === 3 && uniqueRanksSorted[4] === 2)
        );
        let highCardForStraight = 0;
        if (isStraight) {
            highCardForStraight = (uniqueRanksSorted[0] === 14 && uniqueRanksSorted[1] === 5) ? 5 : uniqueRanksSorted[0];
        }

        let rankIndex = -1;
        let description = "";
        let significantRanks = [];

        if (isStraight && isFlush) {
            if (highCardForStraight === 14) {
                rankIndex = 9; description = "Royal Flush"; significantRanks = [14];
            } else {
                rankIndex = 8; description = `Straight Flush (${this._rankValueToString(highCardForStraight)} high)`; significantRanks = [highCardForStraight];
            }
        } else if (counts[0] === 4) {
            rankIndex = 7;
            const fourRank = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 4));
            const kicker = ranks.find(r => r !== fourRank);
            description = `Four of a Kind (${this._rankValueToString(fourRank)}s)`;
            significantRanks = [fourRank, kicker];
        } else if (counts[0] === 3 && counts[1] === 2) {
            rankIndex = 6;
            const threeRank = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 3));
            const pairRank = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 2));
            description = `Full House (${this._rankValueToString(threeRank)}s over ${this._rankValueToString(pairRank)}s)`;
            significantRanks = [threeRank, pairRank];
        } else if (isFlush) {
            rankIndex = 5; description = `Flush (${this._rankValueToString(ranks[0])} high)`; significantRanks = ranks;
        } else if (isStraight) {
            rankIndex = 4; description = `Straight (${this._rankValueToString(highCardForStraight)} high)`; significantRanks = [highCardForStraight];
        } else if (counts[0] === 3) {
            rankIndex = 3;
            const threeRank = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 3));
            const kickers = ranks.filter(r => r !== threeRank).sort((a, b) => b - a);
            description = `Three of a Kind (${this._rankValueToString(threeRank)}s)`;
            significantRanks = [threeRank, ...kickers];
        } else if (counts[0] === 2 && counts[1] === 2) {
            rankIndex = 2;
            const pairRanks = Object.keys(rankCounts).filter(r => rankCounts[r] === 2).map(r => parseInt(r)).sort((a, b) => b - a);
            const kicker = ranks.find(r => rankCounts[r] === 1);
            description = `Two Pair (${this._rankValueToString(pairRanks[0])}s and ${this._rankValueToString(pairRanks[1])}s)`;
            significantRanks = [pairRanks[0], pairRanks[1], kicker];
        } else if (counts[0] === 2) {
            rankIndex = 1;
            const pairRank = parseInt(Object.keys(rankCounts).find(r => rankCounts[r] === 2));
            const kickers = ranks.filter(r => r !== pairRank).sort((a, b) => b - a);
            description = `One Pair (${this._rankValueToString(pairRank)}s)`;
            significantRanks = [pairRank, ...kickers];
        } else {
            rankIndex = 0; description = `High Card (${this._rankValueToString(ranks[0])})`; significantRanks = ranks;
        }

        return { rankIndex, hand: sortedHand, description, significantRanks };
    }

     _compareSignificantRanks(ranks1, ranks2) {
        if (!ranks1 || !ranks2 || ranks1.length !== ranks2.length) {
            console.error("Erro ao comparar ranks significativos: arrays inválidos ou de tamanhos diferentes.", ranks1, ranks2);
            return 0;
        }
        for (let i = 0; i < ranks1.length; i++) {
            if (ranks1[i] > ranks2[i]) return 1;
            if (ranks1[i] < ranks2[i]) return -1;
        }
        return 0;
     }

     _rankValueToString(value) {
        if (value >= 2 && value <= 9) return String(value);
        const map = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
        return map[value] || '?';
     }

    // --- Distribuição do Pote ---
    _buildSidePots() {
        const levels = [...new Set(this.players.map(p => p.totalBetInHand).filter(n => n > 0))]
            .sort((a, b) => a - b);
        let previous = 0;
        return levels.map(level => {
            const contributors = this.players.filter(p => p.totalBetInHand >= level);
            const pot = {
                amount: (level - previous) * contributors.length,
                eligiblePlayerIds: contributors.filter(p => p.status !== 'folded' && p.status !== 'out').map(p => p.id),
                // Uma camada com só um contribuinte é uma aposta não coberta.
                refundPlayerId: contributors.length === 1 ? contributors[0].id : null
            };
            previous = level;
            return pot;
        });
    }

    _distributePot() {
        const pots = this._buildSidePots();
        if (pots.reduce((sum, pot) => sum + pot.amount, 0) !== this.pot) {
            throw new Error('Pote não corresponde às contribuições da mão.');
        }
        // Calcula todos os pagamentos antes de alterar saldos.
        const payouts = new Map(this.players.map(p => [p.id, 0]));
        for (const pot of pots) {
            if (pot.refundPlayerId !== null) {
                payouts.set(pot.refundPlayerId, payouts.get(pot.refundPlayerId) + pot.amount);
                pot.winnerIds = [];
                continue;
            }
            const eligible = this.players.filter(p => pot.eligiblePlayerIds.includes(p.id));
            if (eligible.length === 0 || eligible.some(p => !p.evaluationResult || p.evaluationResult.rankIndex < 0)) {
                throw new Error('Não foi possível avaliar os jogadores elegíveis ao pote.');
            }
            const compare = (a, b) => a.evaluationResult.rankIndex - b.evaluationResult.rankIndex ||
                this._compareSignificantRanks(a.evaluationResult.significantRanks, b.evaluationResult.significantRanks);
            const best = eligible.reduce((a, b) => compare(a, b) >= 0 ? a : b);
            const winners = eligible.filter(p => compare(p, best) === 0);
            // Fichas indivisíveis vão ao primeiro vencedor à esquerda do dealer.
            const seat = p => (this.players.indexOf(p) - this.dealerButtonIndex - 1 + this.players.length) % this.players.length;
            winners.sort((a, b) => seat(a) - seat(b));
            pot.winnerIds = winners.map(p => p.id);
            const share = Math.floor(pot.amount / winners.length);
            const remainder = pot.amount % winners.length;
            winners.forEach((p, i) => payouts.set(p.id, payouts.get(p.id) + share + (i < remainder ? 1 : 0)));
        }
        this._subPots = pots;
        pots.forEach((pot, index) => {
            if (pot.refundPlayerId !== null) {
                const player = this.players.find(p => p.id === pot.refundPlayerId);
                this._logEvent(`Aposta não coberta: ${pot.amount} devolvidos a ${player.name}.`);
            } else {
                const names = pot.winnerIds.map(id => this.players.find(p => p.id === id).name).join(', ');
                this._logEvent(`${index === 0 ? 'Pote principal' : 'Side pot ' + index}: ${pot.amount} para ${names}.`);
            }
        });
        this.players.forEach(p => {
            const amount = payouts.get(p.id);
            if (amount > 0) {
                p.addChips(amount);
                this._logEvent(`${p.name} recebe ${amount} dos potes/apostas não cobertas.`);
            }
        });
        this.pot = 0;
    }

     _awardPotToWinner(winners) {
         if (winners && winners.length > 0) {
              const winner = winners[0];
              this._logEvent(`${winner.name} ganha o pote de ${this.pot} por desistência dos outros.`);
              winner.addChips(this.pot);
              this.pot = 0;
         } else {
             this._logEvent("Mão terminou sem vencedor claro, pote perdido?");
             this.pot = 0;
         }
          this._triggerUIUpdate();
          this._logEvent("Próxima mão em 3 segundos...");
          setTimeout(() => this.startNewHand(), 3000);
     }

    // --- IA baseada nas cartas e em informações públicas ---
    _checkAndTriggerAIAction() {
        if (this.currentPhase === 'idle' || this.currentPhase === 'showdown' || this.currentPhase === 'gameOver') return;
        const currentPlayer = this.players[this.currentPlayerIndex];
        if (currentPlayer && !currentPlayer.isHuman && currentPlayer.status === 'active') {
            this._logEvent(`IA ${currentPlayer.name} está pensando...`);
            setTimeout(() => {
                 if(this.players[this.currentPlayerIndex]?.id === currentPlayer.id && currentPlayer.status === 'active') {
                    this._performAIAction(currentPlayer);
                 }
            }, 1500 + Math.random() * 1000);
        }
    }

    _getAIObservation(player) {
        const publicPlayer = p => ({
            id: p.id,
            chips: p.chips,
            status: p.status,
            totalBetInRound: p.totalBetInRound,
            totalBetInHand: p.totalBetInHand
        });
        const copyCard = c => ({ rank: c.rank, suit: c.suit, value: c.value });
        return {
            player: { ...publicPlayer(player), canRaise: this.canPlayerRaise(player) },
            players: this.players.map(publicPlayer),
            hand: player.hand.map(copyCard),
            communityCards: this.communityCards.map(copyCard),
            dealerId: this.players[this.dealerButtonIndex]?.id,
            currentBet: this.currentBet,
            minRaise: this.minRaise,
            bigBlindAmount: BIG_BLIND_AMOUNT,
            pot: this.pot
        };
    }

    _performAIAction(player) {
        if (this._actionPending || !['preflop', 'flop', 'turn', 'river'].includes(this.currentPhase) ||
            this.players[this.currentPlayerIndex]?.id !== player.id || player.status !== 'active') return;
        if (!this._aiStrategy) {
            const Strategy = typeof PokerAI !== 'undefined' ? PokerAI : require('./poker-ai.js').PokerAI;
            this._aiStrategy = new Strategy(cards => this._evaluateBestHand(cards));
        }
        const decision = this._aiStrategy.decide(this._getAIObservation(player));
        return this.handleAction(player.id, decision.action, decision.amount);
    }

    // --- Funções de Utilidade / Acesso ---
    getGameState() {
        return {
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isHuman: p.isHuman,
                chips: p.chips,
                hand: (p.isHuman || this.currentPhase === 'showdown' || p.status === 'out')
                    ? p.hand.map(card => card.toString())
                    : (p.hand.length > 0 ? p.hand.map(() => '?') : []),
                currentBet: p.currentBet,
                totalBetInRound: p.totalBetInRound,
                totalBetInHand: p.totalBetInHand,
                canRaise: this.canPlayerRaise(p),
                status: p.status,
                isDealer: this.players[this.dealerButtonIndex]?.id === p.id,
                isTurn: this.players[this.currentPlayerIndex]?.id === p.id && p.status === 'active' && !this._actionPending,
                bestHandDescription: (this.currentPhase === 'showdown' && p.status !== 'folded' && p.status !== 'out' && p.evaluationResult?.description)
                                    ? p.evaluationResult.description
                                    : null
            })),
            communityCards: this.communityCards.map(card => card.toString()),
            pot: this.pot,
            sidePots: (this.pot > 0 ? this._buildSidePots() : this._subPots).map(pot => ({
                ...pot,
                eligiblePlayerIds: [...pot.eligiblePlayerIds],
                winnerIds: [...(pot.winnerIds || [])]
            })),
            currentBet: this.currentBet, // Aposta a ser igualada
            minRaise: this.minRaise,     // Valor ADICIONAL mínimo para raise
            currentPhase: this.currentPhase,
            log: [...this.log].slice(-15),
            // Adicionar bigBlindAmount aqui se necessário para UI
             bigBlindAmount: BIG_BLIND_AMOUNT
        };
    }

    performHumanAction(action, amount = 0) {
        const humanPlayer = this.players.find(p => p.isHuman);
        if (!humanPlayer || this.players[this.currentPlayerIndex]?.id !== humanPlayer.id || humanPlayer.status !== 'active') {
             this._logEvent("Ação humana inválida: Não é sua vez ou você não está ativo.");
             return false;
         }
        return this.handleAction(humanPlayer.id, action, amount);
    }

} // Fim da classe PokerGame

// Disponível também no Node para testes, sem alterar o carregamento no navegador.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PokerGame, Card, Player, Deck };
}
