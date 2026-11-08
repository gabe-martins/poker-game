/**
 * ui-controller.js
 * Gerencia a interface do usuário (DOM) e a interação com poker-logic.js
 * Inclui botões de aposta rápida.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Referências aos Elementos do DOM ---
    const playerAreas = [
        document.getElementById('player-0'), // Human
        document.getElementById('player-1'), // AI 1
        document.getElementById('player-2'), // AI 2
        document.getElementById('player-3')  // AI 3
    ];
    // Mapeia elementos dentro de cada área para fácil acesso
    const uiElements = playerAreas.map((area, index) => {
        if (!area) {
             console.error(`Erro: Elemento player-area com id 'player-${index}' não encontrado no DOM.`);
             return null; // Retorna nulo se a área não for encontrada
        }
        return {
            area: area,
            info: area.querySelector('.player-info'),
            name: area.querySelector('.player-name'),
            chips: area.querySelector('.player-chips'),
            status: area.querySelector('.player-status'),
            cardsDiv: area.querySelector('.player-cards'),
            dealerButton: area.querySelector('.dealer-button')
        };
    }).filter(el => el !== null); // Filtra quaisquer áreas não encontradas

    // Verifica se todos os elementos essenciais foram encontrados
     if (uiElements.length !== 4) {
         console.error("Erro crítico: Nem todas as áreas de jogador foram encontradas. Verifique os IDs no HTML.");
         // Poderia desabilitar o jogo ou mostrar uma mensagem de erro mais proeminente aqui.
         // return; // Descomente para parar a execução se as áreas não forem encontradas
     }

    const communityCardsDiv = document.getElementById('community-cards');
    const potAmountSpan = document.getElementById('pot')?.querySelector('span'); // Adiciona '?' para segurança
    const gameLogDiv = document.getElementById('game-log');

    // Container principal dos controles e controles de ação
    const controlsContainer = document.getElementById('controls-container'); // Container pai
    const actionControlsDiv = document.getElementById('action-controls');
    const btnFold = document.getElementById('btn-fold');
    const btnCheckCall = document.getElementById('btn-check-call');
    const btnBetRaise = document.getElementById('btn-bet-raise');
    const betAmountInput = document.getElementById('bet-amount');
    const minRaiseInfoDiv = document.getElementById('min-raise-info'); // Pode ser removido se não usado

    // <<< NOVAS REFERÊNCIAS para Botões Rápidos >>>
    const quickBetControlsDiv = document.getElementById('quick-bet-controls');
    const btnMinBet = document.getElementById('btn-min-bet');
    const btnHalfPot = document.getElementById('btn-half-pot');
    const btnPotBet = document.getElementById('btn-pot-bet');
    const btnMaxBet = document.getElementById('btn-max-bet');

    // Validações adicionais para elementos essenciais
    if (!communityCardsDiv || !potAmountSpan || !gameLogDiv || !controlsContainer || !actionControlsDiv || !btnFold || !btnCheckCall || !btnBetRaise || !betAmountInput ) { // Removido minRaiseInfoDiv da validação
        console.error("Erro crítico: Um ou mais elementos essenciais da UI (pot, log, controles) não foram encontrados. Verifique os IDs no HTML.");
        return; // Para a execução
    }
    // Validar também botões rápidos
     if (!quickBetControlsDiv || !btnMinBet || !btnHalfPot || !btnPotBet || !btnMaxBet) {
        console.error("Erro crítico: Um ou mais botões de aposta rápida não foram encontrados. Verifique os IDs no HTML.");
        // return; // Descomente se forem absolutamente essenciais
    }


    const CARD_BACK_SRC = 'static/images/cards/card_back.png';
    const IMAGE_DIR = 'static/images/';

    // --- Instância do Jogo ---
    // As constantes BIG_BLIND_AMOUNT etc. vêm de poker-logic.js se ele as expor globalmente,
    // ou precisam ser definidas aqui também se não forem globais.
    // Assumindo que estão disponíveis globalmente ou via instância do jogo se necessário.
    let game; // Declara a variável do jogo
    try {
         game = new PokerGame(
            ["Você", "Optimus", "HAL", "Skynet"],
            updateUI // Passa a função de callback
        );
    } catch (e) {
        console.error("Falha ao criar instância de PokerGame:", e);
        alert("Erro fatal ao inicializar a lógica do jogo. Verifique o console.");
        return;
    }


    // --- Funções Auxiliares ---

   /**
     * Converte a string da carta (formato interno: 'AS', 'TD', 'KH') para o caminho da imagem.
     */
    function getCardImagePath(cardString) {
        if (!cardString || cardString === '?') {
            return CARD_BACK_SRC;
        }
        const rankMap = { 'A': 'ace', 'K': 'king', 'Q': 'queen', 'J': 'jack', 'T': '10', '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2' };
        const suitMap = { 'S': 'spades', 'H': 'hearts', 'D': 'diamonds', 'C': 'clubs' };
        if (typeof cardString !== 'string' || cardString.length !== 2) {
            console.error(`getCardImagePath: Invalid card string format received: ${cardString}`);
            return CARD_BACK_SRC;
        }
        const rankChar = cardString[0];
        const suitChar = cardString[1];
        const rankFilenamePart = rankMap[rankChar];
        const suitFilenamePart = suitMap[suitChar];
        if (!rankFilenamePart || !suitFilenamePart) {
            console.error(`getCardImagePath: Failed to map rank or suit. RankChar: ${rankChar}, SuitChar: ${suitChar} from cardString '${cardString}'`);
            return CARD_BACK_SRC;
        }
        const filename = `${rankFilenamePart}_of_${suitFilenamePart}.png`;
        return `${IMAGE_DIR}/cards/${filename}`;
    }

    /**
     * Atualiza o log do jogo na interface.
     */
    function updateGameLog(logs) {
        if (!gameLogDiv) return;
        gameLogDiv.innerHTML = '';
        logs.forEach(logMsg => {
            const p = document.createElement('p');
            p.textContent = logMsg;
            gameLogDiv.appendChild(p);
        });
        gameLogDiv.scrollTop = gameLogDiv.scrollHeight;
    }

    // --- Função Principal de Atualização da UI ---
    /**
     * Atualiza toda a interface do usuário com base no estado do jogo.
     */
    function updateUI(gameState) {
        if (!gameState) {
            console.error("Estado do jogo inválido recebido para atualização da UI.");
            return;
        }

        // Atualiza Jogadores
        gameState.players.forEach((player, index) => {
            const elements = uiElements[index];
            if (!elements || !elements.name || !elements.chips || !elements.status || !elements.cardsDiv || !elements.dealerButton) {
                 return;
            }
            elements.name.textContent = player.name;
            elements.chips.textContent = `$${player.chips}`;
            elements.status.textContent = '';
            elements.status.className = 'player-status';
            elements.area.classList.remove('is-folded');

            if (player.status === 'out') {
                elements.status.textContent = 'Eliminado';
                 elements.area.classList.add('is-folded');
            } else if (player.status === 'folded') {
                 elements.status.textContent = 'Folded';
                 elements.status.classList.add('folded');
                 elements.area.classList.add('is-folded');
            } else if (player.status === 'all-in') {
                 const totalInvested = player.totalBetInRound; // Assumindo que getGameState retorna isso corretamente
                elements.status.textContent = `All-in${totalInvested > 0 ? ' ($' + totalInvested + ')' : ''}`;
                elements.status.classList.add('all-in');
            } else if (player.totalBetInRound > 0 && gameState.currentPhase !== 'showdown') {
                elements.status.textContent = `Bet: $${player.totalBetInRound}`;
            }
            if (gameState.currentPhase === 'showdown' && player.status !== 'folded' && player.status !== 'out' && player.bestHandDescription) {
                 const currentStatus = elements.status.textContent;
                 elements.status.textContent = (currentStatus ? currentStatus + " - " : "") + player.bestHandDescription;
            }
            const cardsContainer = elements.cardsDiv;
            cardsContainer.innerHTML = '';
            if (player.hand && Array.isArray(player.hand)) {
                player.hand.forEach(cardStr => {
                    const img = document.createElement('img');
                    const imagePath = getCardImagePath(cardStr);
                    img.src = imagePath;
                    img.alt = cardStr === '?' ? 'Card Back' : cardStr;
                    img.onerror = () => {
                        console.error(`Failed to load image: ${imagePath} (for card string: ${cardStr})`);
                        img.alt = `Error loading ${cardStr}`;
                        img.style.border = '2px solid red';
                    };
                    cardsContainer.appendChild(img);
                });
            } else if(player.status !== 'out') {
                 // console.warn(`Player ${index} (${player.name}) hand data is invalid or missing:`, player.hand);
            }
            elements.dealerButton.style.display = player.isDealer ? 'flex' : 'none';
            elements.area.classList.toggle('is-turn', player.isTurn);
        });

        // Atualiza Cartas Comunitárias
        communityCardsDiv.innerHTML = '';
        gameState.communityCards.forEach(cardStr => {
            const img = document.createElement('img');
            const imagePath = getCardImagePath(cardStr);
            img.src = imagePath;
            img.alt = cardStr;
            img.onerror = () => {
                 console.error(`Failed to load community card image: ${imagePath} (for card string: ${cardStr})`);
                 img.alt = `Error loading ${cardStr}`;
                 img.style.border = '2px solid red';
            };
            communityCardsDiv.appendChild(img);
        });

        // Atualiza Pote
        potAmountSpan.textContent = gameState.pot;

        // Atualiza Controles de Ação do Humano
        const humanPlayer = gameState.players.find(p => p.isHuman);
        if (humanPlayer) {
             const isHumanTurn = humanPlayer.isTurn;
             const canHumanAct = isHumanTurn && humanPlayer.status === 'active';

             // Habilita/Desabilita containers principais
             actionControlsDiv.classList.toggle('controls-disabled', !canHumanAct);
             quickBetControlsDiv.classList.toggle('controls-disabled', !canHumanAct);

             if (canHumanAct) {
                 const amountToCall = gameState.currentBet - humanPlayer.totalBetInRound;
                 const canCheck = amountToCall <= 0;
                 const playerChips = humanPlayer.chips; // Pega as fichas atuais

                 // Botão Fold
                 btnFold.disabled = false;

                 // Botão Check/Call
                 btnCheckCall.disabled = false;
                 if (canCheck) {
                     btnCheckCall.textContent = 'Check';
                 } else {
                     const callAmount = Math.min(amountToCall, playerChips);
                     btnCheckCall.textContent = `Call $${callAmount}`;
                     if (callAmount >= playerChips && callAmount > 0) {
                         btnCheckCall.textContent += ' (All-in)';
                     }
                 }

                 // --- Lógica para habilitar/desabilitar Botão Bet/Raise Principal ---
                 let canBetOrRaiseAction = true;
                 let minBetOrRaiseValue = 0; // Será calculado abaixo

                 if (gameState.currentBet === 0) { // Sem aposta aberta: BET
                      btnBetRaise.textContent = 'Bet';
                      // Mínimo para Bet: BB ou o minRaise atual (o que for maior), limitado pelo stack
                      minBetOrRaiseValue = Math.max(BIG_BLIND_AMOUNT, gameState.minRaise); // Precisa de BIG_BLIND_AMOUNT definido ou vindo do game state
                       if(playerChips < minBetOrRaiseValue && playerChips > 0) {
                           minBetOrRaiseValue = playerChips; // Só pode ir all-in
                       }
                       if (playerChips <= 0) { // Não pode apostar se não tem fichas
                            canBetOrRaiseAction = false;
                       }
                 } else { // Precisa dar call, então a ação seria RAISE
                      btnBetRaise.textContent = 'Raise';
                      // Mínimo para Raise: Aposta atual + minRaise adicional, limitado pelo stack
                      minBetOrRaiseValue = gameState.currentBet + gameState.minRaise;
                      if (playerChips < amountToCall + gameState.minRaise) { // Se não pode dar raise mínimo
                           if(playerChips > amountToCall) { // Mas pode dar call e aumentar algo (all-in raise)
                               minBetOrRaiseValue = playerChips + humanPlayer.totalBetInRound; // Raise all-in
                           } else { // Só pode dar call (ou fold)
                               canBetOrRaiseAction = false;
                           }
                      }
                       if (playerChips <= amountToCall) { // Nem pode dar call
                            canBetOrRaiseAction = false;
                       }
                 }

                 canBetOrRaiseAction = canBetOrRaiseAction && humanPlayer.canRaise;
                 btnBetRaise.disabled = !canBetOrRaiseAction;
                 betAmountInput.disabled = !canBetOrRaiseAction;
                 if(canBetOrRaiseAction) {
                    betAmountInput.min = Math.max(0, minBetOrRaiseValue);
                    betAmountInput.placeholder = `Valor (min ${Math.max(0, minBetOrRaiseValue)})`;
                 } else {
                      betAmountInput.min = 0;
                      betAmountInput.placeholder = 'Valor';
                      betAmountInput.value = ''; // Limpa se desabilitado
                 }

                 // --- Habilita/Desabilita botões rápidos ---
                 btnMinBet.disabled = !canBetOrRaiseAction;
                 btnHalfPot.disabled = !canBetOrRaiseAction;
                 btnPotBet.disabled = !canBetOrRaiseAction;
                 // Max (All-in) está sempre habilitado se puder agir e tiver fichas
                 btnMaxBet.disabled = !(playerChips > 0 && (canBetOrRaiseAction || amountToCall >= playerChips));

                 // Se não puder apostar/aumentar, mas puder dar check (ex: BB pré-flop sem raise)
                 if (!canBetOrRaiseAction && canCheck && playerChips > 0) {
                      // Mantém check/call e fold habilitados, mas desabilita apostas
                      // (Isso já está coberto pela lógica acima)
                 } else if (playerChips <=0) {
                       // Se não tem fichas, desabilita tudo exceto talvez check (se aplicável, raro)
                       btnMinBet.disabled = true;
                       btnHalfPot.disabled = true;
                       btnPotBet.disabled = true;
                       btnMaxBet.disabled = true;
                 }


             } else {
                 // Desabilita tudo se não for a vez
                 btnFold.disabled = true;
                 btnCheckCall.disabled = true;
                 btnCheckCall.textContent = 'Check';
                 btnBetRaise.disabled = true;
                 btnBetRaise.textContent = 'Bet';
                 betAmountInput.disabled = true;
                 betAmountInput.value = '';
                 betAmountInput.placeholder = 'Valor';

                 // Garante que botões rápidos estejam desabilitados
                 btnMinBet.disabled = true;
                 btnHalfPot.disabled = true;
                 btnPotBet.disabled = true;
                 btnMaxBet.disabled = true;
             }
        }

        // Atualiza Log
        updateGameLog(gameState.log);

        // Verifica Fim de Jogo
        if (gameState.currentPhase === 'gameOver') {
            actionControlsDiv.classList.add('controls-disabled');
             quickBetControlsDiv.classList.add('controls-disabled'); // Desabilita rápidos também
            if (gameLogDiv) {
                const p = document.createElement('p');
                p.textContent = "--- FIM DE JOGO ---";
                p.style.fontWeight = 'bold';
                p.style.color = 'red';
                gameLogDiv.appendChild(p);
                gameLogDiv.scrollTop = gameLogDiv.scrollHeight;
            }
        }
    }

    // --- Event Listeners para Ações Principais ---

    btnFold.addEventListener('click', () => {
        if (!actionControlsDiv.classList.contains('controls-disabled')) {
            game.performHumanAction('fold');
        }
    });

    btnCheckCall.addEventListener('click', () => {
         if (!actionControlsDiv.classList.contains('controls-disabled')) {
            const humanPlayer = game.players.find(p => p.isHuman);
             if(!humanPlayer) return;
            const amountToCall = game.currentBet - humanPlayer.totalBetInRound;
            if (amountToCall <= 0) {
                game.performHumanAction('check');
            } else {
                game.performHumanAction('call');
            }
        }
    });

    btnBetRaise.addEventListener('click', () => {
        if (!actionControlsDiv.classList.contains('controls-disabled')) {
            const humanPlayer = game.players.find(p => p.isHuman);
             if(!humanPlayer) return;

            let amount = parseInt(betAmountInput.value, 10);
            const minAllowed = parseInt(betAmountInput.min, 10) || 0;

            if (isNaN(amount)) {
                 amount = minAllowed;
                 betAmountInput.value = amount; // Atualiza input se usou fallback
            }

            amount = Math.max(0, amount); // Garante não negativo

            // Validações básicas (lógica principal de validação está no PokerGame)
            if (amount < minAllowed && humanPlayer.chips + humanPlayer.totalBetInRound > amount) { // Se for menor que min E não for all-in
                alert(`O valor mínimo para esta ação é ${minAllowed}.`);
                betAmountInput.value = minAllowed;
                return;
            }
            const maxPossibleBet = humanPlayer.chips + humanPlayer.totalBetInRound;
             if (amount > maxPossibleBet) {
                  alert(`Você só pode apostar no máximo ${maxPossibleBet} (all-in).`);
                  amount = maxPossibleBet;
                  betAmountInput.value = amount;
             }

             const isBetAction = game.currentBet === 0;
             const actionType = isBetAction ? 'bet' : 'raise';
             game.performHumanAction(actionType, amount);
        }
    });


    // --- Funções e Listeners para Aposta Rápida ---

    /**
     * Calcula o valor total da aposta/raise para os botões rápidos.
     */
    function calculateQuickBetAmount(type) {
        const gameState = game.getGameState();
        const humanPlayer = gameState.players.find(p => p.isHuman);

        if (!humanPlayer || humanPlayer.status !== 'active' || !(humanPlayer.isTurn)) {
            return null;
        }

        const playerChips = humanPlayer.chips;
        const currentPot = gameState.pot;
        const currentBetOnTable = gameState.currentBet;
        const playerTotalInRound = humanPlayer.totalBetInRound;
        const amountToCall = Math.max(0, currentBetOnTable - playerTotalInRound);
        const minAdditionalRaiseAmount = gameState.minRaise;
        // A constante BIG_BLIND_AMOUNT deve estar acessível (global ou via gameState se adicionada)
         const effectiveBB = typeof BIG_BLIND_AMOUNT !== 'undefined' ? BIG_BLIND_AMOUNT : 20; // Fallback se não global


        let targetTotalAmount = 0;
        const maxTotalAmount = playerChips + playerTotalInRound;
        let minLegalTotalAmount = 0;
        const isBetPhase = currentBetOnTable === 0;

        if (isBetPhase) {
            minLegalTotalAmount = Math.max(effectiveBB, minAdditionalRaiseAmount);
            minLegalTotalAmount = Math.min(minLegalTotalAmount, maxTotalAmount);
             if (playerChips > 0 && minLegalTotalAmount <= 0) minLegalTotalAmount = Math.min(1, playerChips); // Aposta 1 se possível

        } else {
            minLegalTotalAmount = currentBetOnTable + minAdditionalRaiseAmount;
            minLegalTotalAmount = Math.min(minLegalTotalAmount, maxTotalAmount);
            // Garante que o raise mínimo seja pelo menos o call
            minLegalTotalAmount = Math.max(minLegalTotalAmount, playerTotalInRound + amountToCall);
        }
         minLegalTotalAmount = Math.max(0, minLegalTotalAmount);


        switch (type) {
            case 'min':
                targetTotalAmount = minLegalTotalAmount;
                break;
            case 'max':
                targetTotalAmount = maxTotalAmount;
                break;
            case 'half_pot':
            case 'pot':
                const potAfterCall = currentPot + amountToCall; // Pote + Aposta(s) na mesa + Call do Jogador
                // O cálculo correto do pote considera o que já está lá, mais todas as apostas da rodada atual, incluindo o call do jogador.
                // Vamos simplificar: Pote atual + valor para call
                // Uma forma mais comum de calcular Aposta de Pote é: ValorDoCall + (PoteAtual + ValorDoCall)
                let betSize = 0;
                if(isBetPhase) { // Se for bet
                    betSize = (type === 'pot') ? currentPot : Math.floor(currentPot * 0.5);
                     // Garante que seja pelo menos o mínimo
                    betSize = Math.max(betSize, minLegalTotalAmount);
                    targetTotalAmount = betSize;
                } else { // Se for raise
                    const potSizeForRaiseCalc = potAfterCall; // Pote + Call + Aposta anterior que gerou o call
                    let raiseAmount = (type === 'pot') ? potSizeForRaiseCalc : Math.floor(potSizeForRaiseCalc * 0.5);
                    // Garante que o raise seja pelo menos o mínimo adicional
                     raiseAmount = Math.max(raiseAmount, minAdditionalRaiseAmount);
                     targetTotalAmount = playerTotalInRound + amountToCall + raiseAmount; // Call + Raise
                     // Garante que o total seja pelo menos o raise mínimo legal
                      targetTotalAmount = Math.max(targetTotalAmount, minLegalTotalAmount);
                }

                break;
            default: return null;
        }

        targetTotalAmount = Math.min(targetTotalAmount, maxTotalAmount);

        // Revalida se é menor que o mínimo legal (exceto all-in)
        if (targetTotalAmount < minLegalTotalAmount && targetTotalAmount < maxTotalAmount) {
            targetTotalAmount = minLegalTotalAmount;
        }
        // Revalida se é um raise <= aposta atual (exceto all-in)
        if (!isBetPhase && targetTotalAmount <= currentBetOnTable && targetTotalAmount < maxTotalAmount) {
             targetTotalAmount = minLegalTotalAmount;
        }
         // Revalida se é um bet < BB (exceto all-in)
         if (isBetPhase && targetTotalAmount < Math.min(maxTotalAmount, effectiveBB) && targetTotalAmount < maxTotalAmount ) {
              targetTotalAmount = Math.min(maxTotalAmount, effectiveBB);
         }

        targetTotalAmount = Math.max(0, Math.floor(targetTotalAmount));
        return targetTotalAmount;
    }

    /**
     * Manipulador de evento para botões de aposta rápida.
     */
    function handleQuickBet(type) {
        if (quickBetControlsDiv.classList.contains('controls-disabled')) return;
        const amount = calculateQuickBetAmount(type);
        if (amount === null || isNaN(amount) || amount < 0) {
            console.error("Não foi possível calcular um valor válido para a aposta rápida:", type);
            return;
        }
        const humanPlayer = game.players.find(p => p.isHuman);
        if (type === 'max' && amount <= game.currentBet) {
            game.performHumanAction('call');
            return;
        }
        if (!humanPlayer || !game.canPlayerRaise(humanPlayer)) return;
        const isBetAction = game.currentBet === 0;
        const actionType = isBetAction ? 'bet' : 'raise';
        betAmountInput.value = amount; // Atualiza input para feedback
        game.performHumanAction(actionType, amount);
    }

    // Adiciona os listeners aos botões rápidos
    btnMinBet.addEventListener('click', () => handleQuickBet('min'));
    btnHalfPot.addEventListener('click', () => handleQuickBet('half_pot'));
    btnPotBet.addEventListener('click', () => handleQuickBet('pot'));
    btnMaxBet.addEventListener('click', () => handleQuickBet('max'));

    // --- Iniciar o Jogo ---
    console.log("Iniciando o jogo...");
    if (typeof PokerGame !== 'undefined' && game) { // Verifica se 'game' foi instanciado
         game.startNewHand();
    } else {
         console.error("Erro Crítico: A classe PokerGame não foi encontrada ou falhou ao ser instanciada. Verifique o console.");
         alert("Erro ao carregar a lógica do jogo. Verifique o console.");
    }

});
