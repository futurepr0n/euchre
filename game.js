// Game Constants
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_SYMBOLS = {'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠'};
const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];
const PLAYERS = ['south', 'west', 'north', 'east'];
const TEAM_1 = ['south', 'north']; // Player team
const TEAM_2 = ['west', 'east'];   // CPU team

// WebSocket Connection
let socket = null;
let clientId = null;
let playerName = "Player";
let connectedPlayers = {};
let humanPositions = { south: true }; // Positions occupied by humans (default: south is local player)

// Game State
let gameState = {
    deck: [],
    hands: {south: [], west: [], north: [], east: []},
    turnUpCard: null,
    trumpSuit: null,
    dealerPosition: 3, // Start with east as dealer, south goes first
    currentTrick: [],
    currentPlayer: null,
    trickWinner: null,
    tricksWon: {south: 0, west: 0, north: 0, east: 0},
    teamScores: [0, 0], // [Team1, Team2]
    maker: null,
    gamePhase: 'idle', // idle, bidding1, bidding2, playing, gameover
    bidsMade: 0
};

// DOM Elements
const dealBtn = document.getElementById('deal-btn');
const newGameBtn = document.getElementById('new-game-btn');
const gameInfo = document.getElementById('game-info');
const infoText = document.getElementById('info-text');
const biddingControls = document.getElementById('bidding-controls');
const suitSelection = document.getElementById('suit-selection');
const orderUpBtn = document.getElementById('order-up');
const passBidBtn = document.getElementById('pass-bid');
const passSuitBtn = document.getElementById('pass-suit');
const trumpIndicator = document.getElementById('trump-indicator');
const trumpSuitText = document.getElementById('trump-suit');
const gameLog = document.getElementById('game-log');
const teamScore1 = document.getElementById('team-score-1');
const teamScore2 = document.getElementById('team-score-2');

// WebSocket UI Elements
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('connection-status-text');
const serverUrlInput = document.getElementById('server-url-input');
const playerNameInput = document.getElementById('player-name-input');
const connectedPlayersList = document.getElementById('connected-players-list');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatMessages = document.getElementById('chat-messages');

// Seat buttons
const sitNorthBtn = document.getElementById('sit-north');
const sitEastBtn = document.getElementById('sit-east');
const sitWestBtn = document.getElementById('sit-west');


// WebSocket Connection Functions
function connectToServer() {
    try {
        playerName = playerNameInput.value.trim() || "Player";
        const serverUrl = serverUrlInput.value.trim();
        
        if (!serverUrl) {
            logEvent("Please enter a valid WebSocket server URL");
            return;
        }
        
        // Update UI
        statusIndicator.className = "status-indicator status-connecting";
        statusText.textContent = "Connecting...";
        connectBtn.disabled = true;
        
        // Create WebSocket connection
        socket = new WebSocket(serverUrl);
        
        // Connection event handlers
        socket.onopen = function(event) {
            statusIndicator.className = "status-indicator status-connected";
            statusText.textContent = "Connected to server";
            connectBtn.disabled = true;
            disconnectBtn.disabled = false;
            
            // Send join message with player name
            sendToServer({
                type: "join",
                name: playerName,
                position: "south" // Default position
            });
            
            // Update local UI
            document.querySelector('.player-south .player-name').textContent = `South (${playerName})`;
            logEvent(`Connected to server as ${playerName}`);
        };
        
        socket.onmessage = function(event) {
            handleServerMessage(JSON.parse(event.data));
        };
        
        socket.onclose = function(event) {
            disconnectFromServer(event.wasClean ? "Disconnected" : "Connection lost");
        };
        
        socket.onerror = function(error) {
            console.error("WebSocket error:", error);
            logEvent("Error connecting to server");
            disconnectFromServer("Connection error");
        };
    } catch (error) {
        console.error("Connection error:", error);
        logEvent("Error connecting to server: " + error.message);
        disconnectFromServer("Connection error");
    }
}

function disconnectFromServer(message = "Disconnected") {
    if (socket) {
        socket.close();
        socket = null;
    }
    
    // Update UI
    statusIndicator.className = "status-indicator status-disconnected";
    statusText.textContent = message;
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    
    // Reset player positions except for local player
    humanPositions = { south: true };
    updateSeatButtons();
    
    // Clear connected players list
    connectedPlayersList.innerHTML = "<div>No players connected</div>";
    connectedPlayers = {};
    
    logEvent(message);
}

function sendToServer(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}

function handleServerMessage(message) {
    console.log("Received message:", message);
    
    switch (message.type) {
        case "welcome":
            clientId = message.clientId;
            logEvent(`Connected to server with ID: ${clientId}`);
            break;
            
        case "player_list":
            updatePlayerList(message.players);
            break;
            
        case "player_join":
            logEvent(`${message.name} joined the game`);
            break;
            
        case "player_leave":
            logEvent(`${message.name} left the game`);
            break;
            
        case "position_update":
            updatePlayerPositions(message.positions);
            break;
            
        case "chat":
            addChatMessage(message.sender, message.text);
            break;
            
        case "game_state":
            updateGameState(message.state);
            break;
            
        case "game_action":
            handleGameAction(message);
            break;
    }
}

function updatePlayerList(players) {
    connectedPlayers = players;
    
    if (Object.keys(players).length === 0) {
        connectedPlayersList.innerHTML = "<div>No players connected</div>";
        return;
    }
    
    connectedPlayersList.innerHTML = "";
    for (const id in players) {
        const player = players[id];
        const listItem = document.createElement("div");
        listItem.className = "player-list-item";
        listItem.innerHTML = `
            <span>${player.name}</span>
            <span>${player.position ? `(${player.position})` : "(spectating)"}</span>
        `;
        connectedPlayersList.appendChild(listItem);
    }
    
    // Update seat buttons based on positions
    updateSeatButtons();
}

function updatePlayerPositions(positions) {
    humanPositions = positions;
    
    // Update player name displays
    for (const position in positions) {
        if (positions[position]) {
            const playerName = getPlayerNameByPosition(position);
            document.querySelector(`.player-${position} .player-name`).textContent = 
                `${position.charAt(0).toUpperCase() + position.slice(1)} (${playerName})`;
            document.querySelector(`.player-${position} .player-tag`).textContent = "Human";
        } else {
            document.querySelector(`.player-${position} .player-name`).textContent = 
                position.charAt(0).toUpperCase() + position.slice(1);
            document.querySelector(`.player-${position} .player-tag`).textContent = "CPU";
        }
    }
    
    // Update human-player class for card hover effects
    document.querySelectorAll('.player-area').forEach(area => {
        area.classList.remove('human-player');
    });
    
    for (const position in positions) {
        if (positions[position] && isLocalPosition(position)) {
            document.querySelector(`.player-${position}`).classList.add('human-player');
        }
    }
    
    updateSeatButtons();
}

function getPlayerNameByPosition(position) {
    for (const id in connectedPlayers) {
        if (connectedPlayers[id].position === position) {
            return connectedPlayers[id].name;
        }
    }
    return "Unknown";
}

function isLocalPosition(position) {
    if (!clientId || !connectedPlayers[clientId]) return false;
    return connectedPlayers[clientId].position === position;
}

function updateSeatButtons() {
    // Hide/show sit buttons based on current occupancy
    sitNorthBtn.style.display = humanPositions.north ? 'none' : 'block';
    sitEastBtn.style.display = humanPositions.east ? 'none' : 'block';
    sitWestBtn.style.display = humanPositions.west ? 'none' : 'block';
    
    // Disable sit buttons if not connected or already seated elsewhere
    const isSeatedElsewhere = clientId && connectedPlayers[clientId] && 
                              connectedPlayers[clientId].position && 
                              connectedPlayers[clientId].position !== "south";
    
    sitNorthBtn.disabled = !socket || isSeatedElsewhere;
    sitEastBtn.disabled = !socket || isSeatedElsewhere;
    sitWestBtn.disabled = !socket || isSeatedElsewhere;
}

function takeSeat(position) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "take_seat",
            position: position
        });
    }
}

function addChatMessage(sender, text) {
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    const msgElement = document.createElement("div");
    msgElement.className = "chat-message";
    msgElement.innerHTML = `
        <span class="chat-time">[${time}]</span>
        <span class="chat-sender">${sender}:</span>
        <span class="chat-text">${text}</span>
    `;
    
    chatMessages.appendChild(msgElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChatMessage() {
    const text = chatInput.value.trim();
    if (text && socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "chat",
            text: text
        });
        
        chatInput.value = "";
    }
}

function updateGameState(newState) {
    // Update local game state with server state
    gameState = newState;
    
    // Render the updated game state
    renderGameState();
}

function handleGameAction(action) {
    switch (action.action) {
        case "deal":
            logEvent(`${action.player} dealt a new hand.`);
            break;
            
        case "bid":
            if (action.bid) {
                logEvent(`${action.player} ordered up ${action.suit}.`);
            } else {
                logEvent(`${action.player} passed.`);
            }
            break;
            
        case "play_card":
            logEvent(`${action.player} played ${action.card.rank}${SUIT_SYMBOLS[action.card.suit]}.`);
            break;
            
        case "trick_won":
            logEvent(`${action.player} won the trick.`);
            break;
            
        case "game_over":
            logEvent(`Game over. ${action.winningTeam} wins!`);
            break;
    }
}

// Functions to create the deck and deal cards
function createDeck() {
    gameState.deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            gameState.deck.push({rank, suit});
        });
    });
}

function shuffleDeck() {
    for (let i = gameState.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.deck[i], gameState.deck[j]] = [gameState.deck[j], gameState.deck[i]];
    }
}

function dealCards() {
    // Clear hands
    PLAYERS.forEach(player => {
        gameState.hands[player] = [];
    });
    
    // Deal 5 cards to each player (3-2-3-2 or 2-3-2-3 pattern)
    const dealPattern = [[3, 2], [2, 3], [3, 2], [2, 3]];
    let cardIndex = 0;
    
    for (let pattern = 0; pattern < 2; pattern++) {
        for (let i = 0; i < 4; i++) {
            const playerIndex = (gameState.dealerPosition + 1 + i) % 4;
            const player = PLAYERS[playerIndex];
            const cardsThisRound = dealPattern[i][pattern];
            
            for (let j = 0; j < cardsThisRound; j++) {
                gameState.hands[player].push(gameState.deck[cardIndex]);
                cardIndex++;
            }
        }
    }
    
    // Turn up next card
    gameState.turnUpCard = gameState.deck[cardIndex];
    
    // Sort hands
    sortHands();
}

function sortHands() {
    const rankOrder = {'9': 0, '10': 1, 'J': 2, 'Q': 3, 'K': 4, 'A': 5};
    
    for (const player in gameState.hands) {
        gameState.hands[player].sort((a, b) => {
            if (a.suit !== b.suit) {
                return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
            }
            return rankOrder[a.rank] - rankOrder[b.rank];
        });
    }
}

function startBidding() {
    // Reset game state for a new hand
    gameState.gamePhase = 'bidding1';
    gameState.currentTrick = [];
    gameState.trickWinner = null;
    gameState.trumpSuit = null;
    gameState.maker = null;
    gameState.bidsMade = 0;
    
    PLAYERS.forEach(player => {
        gameState.tricksWon[player] = 0;
    });
    
    // First player after dealer starts bidding
    gameState.currentPlayer = PLAYERS[(gameState.dealerPosition + 1) % 4];
    
    // Notify about bidding start
    logEvent(`Dealer is ${PLAYERS[gameState.dealerPosition]}. Bidding begins.`);
    logEvent(`Turn up card is ${gameState.turnUpCard.rank}${SUIT_SYMBOLS[gameState.turnUpCard.suit]}.`);
    
    // Update UI
    renderGameState();
    
    // If it's the local player's turn, show controls
    if (isPlayerTurn()) {
        showBiddingControls();
    } else if (isHumanTurn()) {
        // Wait for other human player's input via server
        infoText.textContent = `Waiting for ${gameState.currentPlayer} to decide...`;
    } else {
        // CPU turn
        cpuBid();
    }
}

// Game Logic Functions
function startDeal() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // In multiplayer mode, send deal request to server
        sendToServer({
            type: "game_action",
            action: "deal"
        });
    } else {
        // In local mode, handle deal directly
        createDeck();
        shuffleDeck();
        dealCards();
        startBidding();
    }
}

function startNewGame() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "game_action",
            action: "new_game"
        });
    } else {
        gameState.teamScores = [0, 0];
        renderTeamScores();
        gameState.gamePhase = 'idle';
        dealBtn.disabled = false;
        updateGameInfo();
    }
}

// Helper functions for multiplayer game
function getLocalPlayerPosition() {
    if (!clientId || !connectedPlayers[clientId]) return 'south'; // Default if not connected
    return connectedPlayers[clientId].position || 'south';
}

function isPlayerTurn() {
    return gameState.currentPlayer === getLocalPlayerPosition();
}

function isHumanTurn() {
    return humanPositions[gameState.currentPlayer] === true;
}

function isSpectator() {
    return !clientId || !connectedPlayers[clientId] || !connectedPlayers[clientId].position;
}

function showBiddingControls() {
    if (gameState.gamePhase === 'bidding1') {
        infoText.textContent = `Do you want to order up ${gameState.turnUpCard.suit}?`;
        biddingControls.style.display = 'block';
        suitSelection.style.display = 'none';
    } else if (gameState.gamePhase === 'bidding2') {
        infoText.textContent = `Select a trump suit (different from ${gameState.turnUpCard.suit})`;
        biddingControls.style.display = 'none';
        suitSelection.style.display = 'block';
    }
}

// Bidding functions
function orderUp() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "game_action",
            action: "bid",
            bid: true,
            suit: gameState.turnUpCard.suit
        });
    } else {
        // Local game logic
        gameState.trumpSuit = gameState.turnUpCard.suit;
        gameState.maker = 'south';
        logEvent(`You order up ${gameState.trumpSuit}.`);
        
        // Dealer picks up the turn card
        const dealer = PLAYERS[gameState.dealerPosition];
        
        if (dealer === 'south') {
            // Let player choose which card to discard
            selectCardToDiscard();
        } else {
            // CPU dealer picks up card
            const cardToReplace = selectCardToReplace(dealer, gameState.turnUpCard);
            gameState.hands[dealer][cardToReplace] = gameState.turnUpCard;
            sortHands();
            renderHands();
            
            startPlay();
        }
    }
}

function passBid() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "game_action",
            action: "bid",
            bid: false
        });
    } else {
        // Local game logic
        logEvent(`You pass.`);
        nextBidder();
    }
}

function selectTrump(suit) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "game_action",
            action: "bid",
            bid: true,
            suit: suit
        });
    } else {
        // Local game logic
        if (suit === gameState.turnUpCard.suit) {
            infoText.textContent = `You cannot select ${suit}. Choose a different suit.`;
            return;
        }
        
        gameState.trumpSuit = suit;
        gameState.maker = 'south';
        logEvent(`You call ${suit}.`);
        
        startPlay();
    }
}

function passSuit() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "game_action",
            action: "bid",
            bid: false
        });
    } else {
        // Local game logic
        logEvent(`You pass.`);
        nextBidder();
    }
}

function nextBidder() {
    gameState.bidsMade++;
    gameState.currentPlayer = PLAYERS[(PLAYERS.indexOf(gameState.currentPlayer) + 1) % 4];
    
    // Check if we've gone all the way around
    if (gameState.bidsMade === 4) {
        if (gameState.gamePhase === 'bidding1') {
            // Move to second round of bidding
            gameState.gamePhase = 'bidding2';
            gameState.bidsMade = 0;
            gameState.currentPlayer = PLAYERS[(gameState.dealerPosition + 1) % 4];
            logEvent("First round of bidding complete. Starting second round.");
            
            // Update UI for second round
            renderGameState();
            
            if (isPlayerTurn()) {
                showBiddingControls();
            } else if (isHumanTurn()) {
                // Wait for other human player's input
            } else {
                // CPU turn
                cpuBid();
            }
        } else if (gameState.gamePhase === 'bidding2') {
            // No one wanted to name trump, re-deal
            logEvent("No one selected trump. Re-dealing.");
            
            // Rotate dealer
            gameState.dealerPosition = (gameState.dealerPosition + 1) % 4;
            
            // Reset to idle to allow dealing again
            gameState.gamePhase = 'idle';
            renderGameState();
            
            // Enable the deal button
            dealBtn.disabled = false;
        }
    } else {
        // Continue bidding with next player
        renderGameState();
        
        if (isPlayerTurn()) {
            showBiddingControls();
        } else if (isHumanTurn()) {
            // Wait for other human player's input
        } else {
            // CPU turn
            cpuBid();
        }
    }
}

function selectCardToDiscard() {
    infoText.textContent = `Select a card from your hand to replace with the ${gameState.turnUpCard.rank}${SUIT_SYMBOLS[gameState.turnUpCard.suit]}.`;
    biddingControls.style.display = 'none';
    
    // Add click events to cards for discarding
    const southHand = document.getElementById('south-hand');
    const cards = southHand.querySelectorAll('.card');
    
    cards.forEach((card, index) => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', function replaceCard() {
            if (socket && socket.readyState === WebSocket.OPEN) {
                sendToServer({
                    type: "game_action",
                    action: "discard",
                    cardIndex: index
                });
            } else {
                // Local game logic
                gameState.hands['south'][index] = gameState.turnUpCard;
                sortHands();
                renderHands();
                
                startPlay();
            }
            
            // Remove the event listeners
            cards.forEach(c => {
                c.style.cursor = '';
                c.removeEventListener('click', replaceCard);
            });
        }, { once: true });
    });
}

function cpuBid() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // In multiplayer, the server handles CPU bidding
        return;
    }
    
    // Local game CPU bidding logic
    setTimeout(() => {
        if (gameState.gamePhase === 'bidding1') {
            // First round bidding - deciding whether to order up the turn card
            const shouldOrderUp = evaluateBid(gameState.currentPlayer, gameState.turnUpCard.suit);
            
            if (shouldOrderUp) {
                logEvent(`${gameState.currentPlayer} orders up ${gameState.turnUpCard.suit}.`);
                gameState.trumpSuit = gameState.turnUpCard.suit;
                gameState.maker = gameState.currentPlayer;
                
                // Replace a card in the dealer's hand
                const dealer = PLAYERS[gameState.dealerPosition];
                const cardToReplace = selectCardToReplace(dealer, gameState.turnUpCard);
                gameState.hands[dealer][cardToReplace] = gameState.turnUpCard;
                sortHands();
                renderHands();
                
                // Start playing
                startPlay();
            } else {
                logEvent(`${gameState.currentPlayer} passes.`);
                nextBidder();
            }
        } else if (gameState.gamePhase === 'bidding2') {
            // Second round bidding - selecting a trump suit different from turn card
            const bestSuit = evaluateBestSuit(gameState.currentPlayer);
            
            if (bestSuit && bestSuit !== gameState.turnUpCard.suit) {
                logEvent(`${gameState.currentPlayer} calls ${bestSuit}.`);
                gameState.trumpSuit = bestSuit;
                gameState.maker = gameState.currentPlayer;
                
                // Start playing
                startPlay();
            } else {
                logEvent(`${gameState.currentPlayer} passes.`);
                nextBidder();
            }
        }
    }, 1500);
}

function evaluateBid(player, suit) {
    // Simple AI bidding logic
    const hand = gameState.hands[player];
    let sameColorSuit, oppositeSuit1, oppositeSuit2;
    
    if (suit === 'hearts') {
        sameColorSuit = 'diamonds';
        oppositeSuit1 = 'clubs';
        oppositeSuit2 = 'spades';
    } else if (suit === 'diamonds') {
        sameColorSuit = 'hearts';
        oppositeSuit1 = 'clubs';
        oppositeSuit2 = 'spades';
    } else if (suit === 'clubs') {
        sameColorSuit = 'spades';
        oppositeSuit1 = 'hearts';
        oppositeSuit2 = 'diamonds';
    } else if (suit === 'spades') {
        sameColorSuit = 'clubs';
        oppositeSuit1 = 'hearts';
        oppositeSuit2 = 'diamonds';
    }
    
    let trumpCount = 0;
    let jackCount = 0;
    let aceCount = 0;
    
    hand.forEach(card => {
        // Count trump cards
        if (card.suit === suit || (card.rank === 'J' && card.suit === sameColorSuit)) {
            trumpCount++;
        }
        
        // Count jacks
        if (card.rank === 'J') {
            jackCount++;
        }
        
        // Count aces
        if (card.rank === 'A') {
            aceCount++;
        }
    });
    
    // Decision logic
    if (trumpCount >= 3 || (trumpCount >= 2 && jackCount >= 1) || (trumpCount >= 2 && aceCount >= 2)) {
        return Math.random() < 0.8; // 80% chance to bid with a good hand
    } else if (trumpCount >= 2) {
        return Math.random() < 0.4; // 40% chance with a decent hand
    } else {
        return Math.random() < 0.1; // 10% chance with a poor hand
    }
}

function evaluateBestSuit(player) {
    const hand = gameState.hands[player];
    const suits = [...SUITS].filter(s => s !== gameState.turnUpCard.suit);
    const suitStrengths = {};
    
    suits.forEach(suit => {
        let strength = 0;
        let sameColorSuit;
        
        if (suit === 'hearts') sameColorSuit = 'diamonds';
        else if (suit === 'diamonds') sameColorSuit = 'hearts';
        else if (suit === 'clubs') sameColorSuit = 'spades';
        else if (suit === 'spades') sameColorSuit = 'clubs';
        
        hand.forEach(card => {
            if (card.suit === suit) {
                if (card.rank === 'A') strength += 4;
                else if (card.rank === 'K') strength += 3;
                else if (card.rank === 'Q') strength += 2;
                else if (card.rank === '10') strength += 1;
                else if (card.rank === 'J') strength += 5; // Right bower
            } else if (card.rank === 'J' && card.suit === sameColorSuit) {
                strength += 4.5; // Left bower
            }
        });
        
        suitStrengths[suit] = strength;
    });
    
    // Find the strongest suit
    let bestSuit = null;
    let maxStrength = 0;
    
    for (const suit in suitStrengths) {
        if (suitStrengths[suit] > maxStrength) {
            maxStrength = suitStrengths[suit];
            bestSuit = suit;
        }
    }
    
    // Only bid if the hand is strong enough
    if (maxStrength >= 6 || (gameState.bidsMade >= 6 && maxStrength >= 4)) {
        return bestSuit;
    } else {
        return null;
    }
}

function selectCardToReplace(player, newCard) {
    const hand = gameState.hands[player];
    
    // Simple logic: replace the lowest non-trump card
    const rankValues = {'9': 0, '10': 1, 'J': 2, 'Q': 3, 'K': 4, 'A': 5};
    let lowestCardIndex = 0;
    let lowestValue = 10;
    
    hand.forEach((card, index) => {
        if (card.suit !== newCard.suit && rankValues[card.rank] < lowestValue) {
            lowestValue = rankValues[card.rank];
            lowestCardIndex = index;
        }
    });
    
    return lowestCardIndex;
}

// Playing phase functions
function startPlay() {
    gameState.gamePhase = 'playing';
    gameState.currentPlayer = PLAYERS[(gameState.dealerPosition + 1) % 4];
    gameState.currentTrick = [];
    
    // Show trump indicator
    trumpIndicator.style.display = 'block';
    trumpSuitText.textContent = `${gameState.trumpSuit} ${SUIT_SYMBOLS[gameState.trumpSuit]}`;
    
    logEvent(`Trump is ${gameState.trumpSuit}. ${gameState.currentPlayer} leads.`);
    
    // Update UI
    renderGameState();
    
    // If it's a CPU's turn to lead, have them play
    if (!isHumanTurn()) {
        cpuPlayCard();
    }
}

function playCard(cardIndex) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        sendToServer({
            type: "game_action",
            action: "play_card",
            cardIndex: cardIndex
        });
    } else {
        // Local game logic
        const player = gameState.currentPlayer;
        const card = gameState.hands[player][cardIndex];
        
        // Validate the card played follows suit if required
        if (!isValidCardPlay(player, card)) {
            infoText.textContent = "You must follow suit if possible!";
            return;
        }
        
        // Add the card to the current trick
        gameState.currentTrick.push({
            player: player,
            card: card
        });
        
        // Remove the card from player's hand
        gameState.hands[player].splice(cardIndex, 1);
        
        logEvent(`${player} played ${card.rank}${SUIT_SYMBOLS[card.suit]}.`);
        
        // Continue play with next player
        nextTrickPlayer();
    }
}

function cpuPlayCard() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // In multiplayer mode, server handles CPU plays
        return;
    }
    
    setTimeout(() => {
        const player = gameState.currentPlayer;
        const cardIndex = selectCardToPlay(player);
        const card = gameState.hands[player][cardIndex];
        
        // Add the card to the current trick
        gameState.currentTrick.push({
            player: player,
            card: card
        });
        
        // Remove the card from player's hand
        gameState.hands[player].splice(cardIndex, 1);
        
        logEvent(`${player} played ${card.rank}${SUIT_SYMBOLS[card.suit]}.`);
        
        // Continue play with next player
        nextTrickPlayer();
    }, 1500);
}

function isValidCardPlay(player, card) {
    // First card of trick can be anything
    if (gameState.currentTrick.length === 0) {
        return true;
    }
    
    // Get the suit led
    const leadCard = gameState.currentTrick[0].card;
    const leadSuit = getEffectiveSuit(leadCard);
    
    // If player has a card of the led suit, they must play it
    const hand = gameState.hands[player];
    const hasSuit = hand.some(c => getEffectiveSuit(c) === leadSuit);
    
    if (hasSuit) {
        // Check if the played card follows suit
        return getEffectiveSuit(card) === leadSuit;
    }
    
    // Player doesn't have the led suit, can play anything
    return true;
}

function getEffectiveSuit(card) {
    // Handle left bower (Jack of the same color as trump)
    if (card.rank === 'J') {
        if (card.suit === gameState.trumpSuit) {
            return gameState.trumpSuit; // Right bower
        }
        
        // Check if it's the left bower
        if ((gameState.trumpSuit === 'hearts' && card.suit === 'diamonds') ||
            (gameState.trumpSuit === 'diamonds' && card.suit === 'hearts') ||
            (gameState.trumpSuit === 'clubs' && card.suit === 'spades') ||
            (gameState.trumpSuit === 'spades' && card.suit === 'clubs')) {
            return gameState.trumpSuit; // Left bower is effectively trump suit
        }
    }
    
    // Normal cards keep their suit
    return card.suit;
}

function selectCardToPlay(player) {
    const hand = gameState.hands[player];
    
    // Logic for leading a trick
    if (gameState.currentTrick.length === 0) {
        return selectLeadCard(player);
    }
    
    // Logic for following a trick
    const leadCard = gameState.currentTrick[0].card;
    const leadSuit = getEffectiveSuit(leadCard);
    
    // Find cards that follow suit
    const followingSuitCards = hand.map((card, index) => ({ card, index }))
        .filter(item => getEffectiveSuit(item.card) === leadSuit);
    
    if (followingSuitCards.length > 0) {
        // Must follow suit - play highest card that can win the trick
        const currentWinningCard = getCurrentWinningCard();
        const winningCards = followingSuitCards.filter(
            item => compareCards(item.card, currentWinningCard) > 0
        );
        
        if (winningCards.length > 0) {
            // Play lowest card that can win
            return winningCards.sort(
                (a, b) => compareCards(a.card, b.card)
            )[0].index;
        } else {
            // Can't win, play lowest card
            return followingSuitCards.sort(
                (a, b) => compareCards(a.card, b.card)
            )[0].index;
        }
    } else {
        // Can't follow suit - try to trump if partner isn't winning
        const currentWinningPlayer = getCurrentWinningPlayer();
        const isPartnerWinning = 
            (player === 'south' && currentWinningPlayer === 'north') ||
            (player === 'north' && currentWinningPlayer === 'south') ||
            (player === 'east' && currentWinningPlayer === 'west') ||
            (player === 'west' && currentWinningPlayer === 'east');
        
        const trumpCards = hand.map((card, index) => ({ card, index }))
            .filter(item => getEffectiveSuit(item.card) === gameState.trumpSuit);
        
        if (trumpCards.length > 0 && !isPartnerWinning) {
            // Play lowest trump
            return trumpCards.sort(
                (a, b) => compareCards(a.card, b.card)
            )[0].index;
        } else {
            // Play lowest card
            return hand.map((card, index) => ({ card, index }))
                .sort((a, b) => compareCards(a.card, b.card))[0].index;
        }
    }
}

function selectLeadCard(player) {
    const hand = gameState.hands[player];
    
    // Try to lead trump if we have high trumps
    const trumpCards = hand.map((card, index) => ({ card, index }))
        .filter(item => getEffectiveSuit(item.card) === gameState.trumpSuit)
        .sort((a, b) => compareCards(b.card, a.card)); // Sort highest to lowest
    
    if (trumpCards.length > 0 && 
        (trumpCards[0].card.rank === 'J' || trumpCards[0].card.rank === 'A')) {
        return trumpCards[0].index;
    }
    
    // Try to lead an Ace of non-trump
    const aceCards = hand.map((card, index) => ({ card, index }))
        .filter(item => item.card.rank === 'A' && 
                       getEffectiveSuit(item.card) !== gameState.trumpSuit);
    
    if (aceCards.length > 0) {
        return aceCards[0].index;
    }
    
    // Lead highest non-trump card
    const nonTrumpCards = hand.map((card, index) => ({ card, index }))
        .filter(item => getEffectiveSuit(item.card) !== gameState.trumpSuit)
        .sort((a, b) => compareCards(b.card, a.card)); // Sort highest to lowest
    
    if (nonTrumpCards.length > 0) {
        return nonTrumpCards[0].index;
    }
    
    // If we only have trump, lead lowest
    return trumpCards[trumpCards.length - 1].index;
}

function getCurrentWinningCard() {
    if (gameState.currentTrick.length === 0) return null;
    
    let winningPlay = gameState.currentTrick[0];
    const leadSuit = getEffectiveSuit(winningPlay.card);
    
    for (let i = 1; i < gameState.currentTrick.length; i++) {
        const play = gameState.currentTrick[i];
        if (compareCards(play.card, winningPlay.card, leadSuit) > 0) {
            winningPlay = play;
        }
    }
    
    return winningPlay.card;
}

function getCurrentWinningPlayer() {
    if (gameState.currentTrick.length === 0) return null;
    
    let winningPlay = gameState.currentTrick[0];
    const leadSuit = getEffectiveSuit(winningPlay.card);
    
    for (let i = 1; i < gameState.currentTrick.length; i++) {
        const play = gameState.currentTrick[i];
        if (compareCards(play.card, winningPlay.card, leadSuit) > 0) {
            winningPlay = play;
        }
    }
    
    return winningPlay.player;
}

function compareCards(card1, card2, leadSuit = null) {
    if (!leadSuit && gameState.currentTrick.length > 0) {
        leadSuit = getEffectiveSuit(gameState.currentTrick[0].card);
    }
    
    // Get effective suits (accounting for bowers)
    const suit1 = getEffectiveSuit(card1);
    const suit2 = getEffectiveSuit(card2);
    
    // Trump beats non-trump
    if (suit1 === gameState.trumpSuit && suit2 !== gameState.trumpSuit) {
        return 1;
    }
    if (suit1 !== gameState.trumpSuit && suit2 === gameState.trumpSuit) {
        return -1;
    }
    
    // If both trump, compare by rank with special ordering for bowers
    if (suit1 === gameState.trumpSuit && suit2 === gameState.trumpSuit) {
        return compareTrumpRanks(card1, card2);
    }
    
    // If neither trump, following suit beats non-following
    if (leadSuit) {
        if (suit1 === leadSuit && suit2 !== leadSuit) {
            return 1;
        }
        if (suit1 !== leadSuit && suit2 === leadSuit) {
            return -1;
        }
    }
    
    // Both follow or don't follow suit, compare ranks
    return compareRanks(card1.rank, card2.rank);
}

function compareTrumpRanks(card1, card2) {
    // Special handling for right and left bowers
    const isRightBower1 = card1.rank === 'J' && card1.suit === gameState.trumpSuit;
    const isLeftBower1 = card1.rank === 'J' && 
        ((gameState.trumpSuit === 'hearts' && card1.suit === 'diamonds') ||
         (gameState.trumpSuit === 'diamonds' && card1.suit === 'hearts') ||
         (gameState.trumpSuit === 'clubs' && card1.suit === 'spades') ||
         (gameState.trumpSuit === 'spades' && card1.suit === 'clubs'));
    
    const isRightBower2 = card2.rank === 'J' && card2.suit === gameState.trumpSuit;
    const isLeftBower2 = card2.rank === 'J' && 
        ((gameState.trumpSuit === 'hearts' && card2.suit === 'diamonds') ||
         (gameState.trumpSuit === 'diamonds' && card2.suit === 'hearts') ||
         (gameState.trumpSuit === 'clubs' && card2.suit === 'spades') ||
         (gameState.trumpSuit === 'spades' && card2.suit === 'clubs'));
    
    // Right bower is highest
    if (isRightBower1) return isRightBower2 ? 0 : 1;
    if (isRightBower2) return -1;
    
    // Left bower is second highest
    if (isLeftBower1) return isLeftBower2 ? 0 : 1;
    if (isLeftBower2) return -1;
    
    // Otherwise compare by normal rank
    return compareRanks(card1.rank, card2.rank);
}

function compareRanks(rank1, rank2) {
    const rankValues = {'9': 0, '10': 1, 'J': 2, 'Q': 3, 'K': 4, 'A': 5};
    return rankValues[rank1] - rankValues[rank2];
}

// Event listeners
dealBtn.addEventListener('click', startDeal);
newGameBtn.addEventListener('click', startNewGame);
orderUpBtn.addEventListener('click', orderUp);
passBidBtn.addEventListener('click', passBid);
passSuitBtn.addEventListener('click', passSuit);

// WebSocket event listeners
connectBtn.addEventListener('click', connectToServer);
disconnectBtn.addEventListener('click', () => disconnectFromServer("Disconnected by user"));

sitNorthBtn.addEventListener('click', () => takeSeat('north'));
sitEastBtn.addEventListener('click', () => takeSeat('east'));
sitWestBtn.addEventListener('click', () => takeSeat('west'));

sendChatBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

document.querySelectorAll('.suit-btn').forEach(button => {
    button.addEventListener('click', () => {
        selectTrump(button.dataset.suit);
    });
});

// Initialize game UI
updateSeatButtons();
renderGameState();

// Render functions for game state
function renderGameState() {
    renderHands();
    renderTurnUpCard();
    renderTrickCounts();
    renderTrickArea();
    renderTurnIndicator();
    renderDealerChip();
    renderTeamScores();
    updateGameInfo();
    
    // Disable or enable buttons based on game phase
    dealBtn.disabled = gameState.gamePhase !== 'idle';
}

function renderHands() {
    PLAYERS.forEach(player => {
        const container = document.getElementById(`${player}-hand`);
        container.innerHTML = '';
        
        // Only render cards for local player or spectator view for all human players
        const shouldShowCards = player === getLocalPlayerPosition() || isSpectator();
        
        gameState.hands[player].forEach((card, index) => {
            const cardEl = document.createElement('div');
            cardEl.className = 'card';
            
            if (shouldShowCards) {
                cardEl.textContent = `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
                if (card.suit === 'hearts' || card.suit === 'diamonds') {
                    cardEl.classList.add('red');
                }
                
                // Add click event for playing cards during the playing phase
                if (player === getLocalPlayerPosition()) {
                    cardEl.addEventListener('click', () => {
                        if (gameState.gamePhase === 'playing' && gameState.currentPlayer === player) {
                            playCard(index);
                        }
                    });
                }
            } else {
                cardEl.className = 'card card-back';
            }
            
            container.appendChild(cardEl);
        });
    });
}

function renderTurnUpCard() {
    const trickArea = document.getElementById('trick-area');
    trickArea.innerHTML = '';
    
    if (gameState.turnUpCard && (gameState.gamePhase === 'bidding1' || gameState.gamePhase === 'bidding2')) {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        if (gameState.turnUpCard.suit === 'hearts' || gameState.turnUpCard.suit === 'diamonds') {
            cardEl.classList.add('red');
        }
        cardEl.textContent = `${gameState.turnUpCard.rank}${SUIT_SYMBOLS[gameState.turnUpCard.suit]}`;
        cardEl.style.transform = 'rotate(5deg)';
        trickArea.appendChild(cardEl);
    }
}

function renderTrickArea() {
    const trickArea = document.getElementById('trick-area');
    if (gameState.gamePhase === 'playing' && gameState.currentTrick.length > 0) {
        trickArea.innerHTML = '';
        
        gameState.currentTrick.forEach(play => {
            const cardEl = document.createElement('div');
            cardEl.className = `trick-card trick-${play.player}`;
            if (play.card.suit === 'hearts' || play.card.suit === 'diamonds') {
                cardEl.classList.add('red');
            }
            cardEl.textContent = `${play.card.rank}${SUIT_SYMBOLS[play.card.suit]}`;
            trickArea.appendChild(cardEl);
            
            if (play.player === gameState.trickWinner) {
                cardEl.classList.add('trick-winner');
            }
        });
    }
}

function renderTurnIndicator() {
    // Remove any existing indicators
    document.querySelectorAll('.turn-indicator').forEach(el => el.remove());
    
    if (gameState.currentPlayer && 
        (gameState.gamePhase === 'playing' || 
         gameState.gamePhase === 'bidding1' || 
         gameState.gamePhase === 'bidding2')) {
        const indicator = document.createElement('div');
        indicator.className = 'turn-indicator';
        
        const playerArea = document.querySelector(`.player-${gameState.currentPlayer}`);
        playerArea.appendChild(indicator);
        
        // Position the indicator based on player position
        if (gameState.currentPlayer === 'south') {
            indicator.style.bottom = '5px';
            indicator.style.left = '50%';
            indicator.style.transform = 'translateX(-50%)';
        } else if (gameState.currentPlayer === 'north') {
            indicator.style.top = '5px';
            indicator.style.left = '50%';
            indicator.style.transform = 'translateX(-50%)';
        } else if (gameState.currentPlayer === 'west') {
            indicator.style.left = '5px';
            indicator.style.top = '50%';
            indicator.style.transform = 'translateY(-50%)';
        } else if (gameState.currentPlayer === 'east') {
            indicator.style.right = '5px';
            indicator.style.top = '50%';
            indicator.style.transform = 'translateY(-50%)';
        }
    }
}

function renderDealerChip() {
    // Remove any existing dealer chips
    document.querySelectorAll('.dealer-chip').forEach(el => el.remove());
    
    const dealer = PLAYERS[gameState.dealerPosition];
    const dealerChip = document.createElement('div');
    dealerChip.className = `dealer-chip dealer-${dealer}`;
    
    const playerArea = document.querySelector(`.player-${dealer}`);
    playerArea.appendChild(dealerChip);
}

function renderTrickCounts() {
    PLAYERS.forEach(player => {
        const tricksElement = document.querySelector(`.player-${player} .tricks-count`);
        tricksElement.textContent = gameState.tricksWon[player];
    });
}

function renderTeamScores() {
    teamScore1.textContent = gameState.teamScores[0];
    teamScore2.textContent = gameState.teamScores[1];
}

function updateGameInfo() {
    gameInfo.style.display = 'block';
    
    if (gameState.gamePhase === 'idle') {
        infoText.textContent = 'Welcome to Euchre! Click Deal to start.';
        biddingControls.style.display = 'none';
        suitSelection.style.display = 'none';
    } else if (gameState.gamePhase === 'bidding1') {
        if (isPlayerTurn()) {
            infoText.textContent = `Do you want to order up ${gameState.turnUpCard.suit}?`;
            biddingControls.style.display = 'block';
            suitSelection.style.display = 'none';
        } else {
            infoText.textContent = `${gameState.currentPlayer} is deciding...`;
            biddingControls.style.display = 'none';
            suitSelection.style.display = 'none';
        }
    } else if (gameState.gamePhase === 'bidding2') {
        if (isPlayerTurn()) {
            infoText.textContent = `Select a trump suit (different from ${gameState.turnUpCard.suit})`;
            biddingControls.style.display = 'none';
            suitSelection.style.display = 'block';
        } else {
            infoText.textContent = `${gameState.currentPlayer} is selecting a trump suit...`;
            biddingControls.style.display = 'none';
            suitSelection.style.display = 'none';
        }
    } else if (gameState.gamePhase === 'playing') {
        if (gameState.trumpSuit) {
            trumpIndicator.style.display = 'block';
            trumpSuitText.textContent = `${gameState.trumpSuit} ${SUIT_SYMBOLS[gameState.trumpSuit]}`;
        }
        
        if (isPlayerTurn()) {
            infoText.textContent = 'Your turn. Play a card.';
        } else {
            infoText.textContent = `Waiting for ${gameState.currentPlayer} to play...`;
        }
        
        biddingControls.style.display = 'none';
        suitSelection.style.display = 'none';
    } else if (gameState.gamePhase === 'gameover') {
        infoText.textContent = `Game over! ${gameState.teamScores[0] > gameState.teamScores[1] ? 'Team 1' : 'Team 2'} wins!`;
        biddingControls.style.display = 'none';
        suitSelection.style.display = 'none';
    }
}

function nextTrickPlayer() {
    renderGameState();
    
    // Check if trick is complete
    if (gameState.currentTrick.length === 4) {
        // Determine trick winner
        const winningPlayer = determineWinner();
        gameState.trickWinner = winningPlayer;
        gameState.tricksWon[winningPlayer]++;
        
        logEvent(`${winningPlayer} wins the trick.`);
        renderTrickCounts();
        
        // Show the winning card briefly
        renderTrickArea();
        
        setTimeout(() => {
            // Check if hand is complete
            if (isHandComplete()) {
                // Score the hand
                scoreHand();
            } else {
                // Start a new trick with winner leading
                gameState.currentPlayer = winningPlayer;
                gameState.currentTrick = [];
                gameState.trickWinner = null;
                
                renderGameState();
                
                if (isHumanTurn()) {
                    infoText.textContent = "Your turn to lead.";
                } else {
                    infoText.textContent = `${gameState.currentPlayer} is leading...`;
                    cpuPlayCard();
                }
            }
        }, 2000);
    } else {
        // Move to next player
        gameState.currentPlayer = PLAYERS[(PLAYERS.indexOf(gameState.currentPlayer) + 1) % 4];
        
        if (isHumanTurn()) {
            infoText.textContent = "Your turn. Play a card.";
        } else {
            infoText.textContent = `Waiting for ${gameState.currentPlayer} to play...`;
            cpuPlayCard();
        }
    }
}

function determineWinner() {
    let winningPlay = gameState.currentTrick[0];
    const leadSuit = getEffectiveSuit(winningPlay.card);
    
    for (let i = 1; i < gameState.currentTrick.length; i++) {
        const play = gameState.currentTrick[i];
        if (compareCards(play.card, winningPlay.card, leadSuit) > 0) {
            winningPlay = play;
        }
    }
    
    return winningPlay.player;
}

function isHandComplete() {
    // Check if all players have played all their cards
    return Object.values(gameState.hands).every(hand => hand.length === 0);
}

function scoreHand() {
    // Count tricks for each team
    const team1Tricks = gameState.tricksWon.south + gameState.tricksWon.north;
    const team2Tricks = gameState.tricksWon.west + gameState.tricksWon.east;
    
    let team1Score = 0;
    let team2Score = 0;
    
    const makerTeam = TEAM_1.includes(gameState.maker) ? 1 : 2;
    
    if (makerTeam === 1) {
        if (team1Tricks >= 3) {
            if (team1Tricks === 5) {
                team1Score = 2; // All 5 tricks
                logEvent("Team 1 took all 5 tricks! They score 2 points.");
            } else {
                team1Score = 1; // At least 3 tricks
                logEvent("Team 1 made their bid, scoring 1 point.");
            }
        } else {
            team2Score = 2; // Euchre
            logEvent("Team 1 was euchred! Team 2 scores 2 points.");
        }
    } else { // makerTeam === 2
        if (team2Tricks >= 3) {
            if (team2Tricks === 5) {
                team2Score = 2; // All 5 tricks
                logEvent("Team 2 took all 5 tricks! They score 2 points.");
            } else {
                team2Score = 1; // At least 3 tricks
                logEvent("Team 2 made their bid, scoring 1 point.");
            }
        } else {
            team1Score = 2; // Euchre
            logEvent("Team 2 was euchred! Team 1 scores 2 points.");
        }
    }
    
    // Update scores
    gameState.teamScores[0] += team1Score;
    gameState.teamScores[1] += team2Score;
    
    // Check for game winner
    if (gameState.teamScores[0] >= 10 || gameState.teamScores[1] >= 10) {
        const winner = gameState.teamScores[0] >= 10 ? "Team 1" : "Team 2";
        logEvent(`Game over! ${winner} wins with ${gameState.teamScores[0] >= 10 ? gameState.teamScores[0] : gameState.teamScores[1]} points!`);
        gameState.gamePhase = 'gameover';
    } else {
        // Rotate dealer for next hand
        gameState.dealerPosition = (gameState.dealerPosition + 1) % 4;
        gameState.gamePhase = 'idle';
        dealBtn.disabled = false;
    }
    
    // Update UI
    renderTeamScores();
    updateGameInfo();
}

// Utility Functions
function logEvent(message) {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.textContent = message;
    gameLog.appendChild(logEntry);
    gameLog.scrollTop = gameLog.scrollHeight;
}
