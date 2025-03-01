const WebSocket = require('ws');
const http = require('http');

// Create a simple HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Euchre WebSocket Server\n');
});

// Create a WebSocket server
const wss = new WebSocket.Server({ server });

// Game state to manage across clients
const gameState = {
    players: {},
    positions: { south: false, west: false, north: false, east: false },
    gameData: {
        deck: [],
        hands: {south: [], west: [], north: [], east: []},
        turnUpCard: null,
        trumpSuit: null,
        dealerPosition: 3,
        currentTrick: [],
        currentPlayer: null,
        trickWinner: null,
        tricksWon: {south: 0, west: 0, north: 0, east: 0},
        teamScores: [0, 0],
        maker: null,
        gamePhase: 'idle',
        bidsMade: 0
    }
};

// Client counter for unique IDs
let clientIdCounter = 0;

wss.on('connection', (ws) => {
    const clientId = `client_${++clientIdCounter}`;
    console.log(`Client connected: ${clientId}`);
    
    // Store client information
    gameState.players[clientId] = {
        ws: ws,
        name: "Guest",
        position: null
    };
    
    // Send welcome message with client ID
    ws.send(JSON.stringify({
        type: "welcome",
        clientId: clientId
    }));
    
    // Handle messages from clients
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleClientMessage(clientId, data);
        } catch (e) {
            console.error("Error parsing message:", e);
        }
    });
    
    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        
        // If player had a position, free it up
        const playerPosition = gameState.players[clientId].position;
        if (playerPosition) {
            gameState.positions[playerPosition] = false;
        }
        
        // Notify others of the departure
        broadcastToAll({
            type: "player_leave",
            clientId: clientId,
            name: gameState.players[clientId].name
        });
        
        // Remove player from game state
        delete gameState.players[clientId];
        
        // Send updated positions
        broadcastToAll({
            type: "position_update",
            positions: gameState.positions
        });
        
        // Send updated player list
        broadcastPlayerList();
    });
    
    // Send initial game state and player list
    sendGameState(clientId);
    broadcastPlayerList();
});

function handleClientMessage(clientId, message) {
    console.log(`Message from ${clientId}:`, message);
    
    switch (message.type) {
        case "join":
            // Player is joining with a name
            gameState.players[clientId].name = message.name || "Guest";
            
            // Take the requested position if available
            if (message.position && !gameState.positions[message.position]) {
                gameState.players[clientId].position = message.position;
                gameState.positions[message.position] = true;
            }
            
            // Notify all clients about the new player
            broadcastToAll({
                type: "player_join",
                clientId: clientId,
                name: gameState.players[clientId].name,
                position: gameState.players[clientId].position
            });
            
            // Send updated positions and player list
            broadcastToAll({
                type: "position_update",
                positions: gameState.positions
            });
            
            broadcastPlayerList();
            break;
            
        case "take_seat":
            // Player wants to sit at a position
            const position = message.position;
            
            if (position && !gameState.positions[position]) {
                // Release any previous position
                if (gameState.players[clientId].position) {
                    gameState.positions[gameState.players[clientId].position] = false;
                }
                
                // Assign new position
                gameState.players[clientId].position = position;
                gameState.positions[position] = true;
                
                // Notify all clients
                broadcastToAll({
                    type: "position_update",
                    positions: gameState.positions
                });
                
                broadcastPlayerList();
            }
            break;
            
        case "chat":
            // Broadcast chat message to all clients
            broadcastToAll({
                type: "chat",
                clientId: clientId,
                sender: gameState.players[clientId].name,
                text: message.text
            });
            break;
            
        case "game_action":
            // Handle game actions (deal, bid, play card, etc.)
            handleGameAction(clientId, message);
            break;
    }
}

function handleGameAction(clientId, action) {
    const player = gameState.players[clientId];
    const position = player.position;
    
    // Validate that player has a position and it's their turn (for most actions)
    if (!position) {
        return; // Player must have a position to take game actions
    }
    
    switch (action.action) {
        case "deal":
            // Only allow dealing in idle phase
            if (gameState.gameData.gamePhase !== 'idle') return;
            
            // Create and deal a new hand
            createDeck();
            shuffleDeck();
            dealCards();
            startBidding();
            
            // Notify all players
            broadcastToAll({
                type: "game_action",
                action: "deal",
                player: position
            });
            
            break;
            
        case "bid":
            // Validate it's player's turn to bid
            if (gameState.gameData.currentPlayer !== position) return;
            
            if (action.bid) {
                // Player is ordering up or calling a suit
                gameState.gameData.trumpSuit = action.suit;
                gameState.gameData.maker = position;
                
                // If we're in first round, dealer takes the card
                if (gameState.gameData.gamePhase === 'bidding1') {
                    const dealer = PLAYERS[gameState.gameData.dealerPosition];
                    
                    // If client is the dealer, they'll send another message to discard
                    if (dealer !== position) {
                        // Auto-discard for CPU dealer
                        const cardToReplace = selectCardToReplace(dealer);
                        gameState.gameData.hands[dealer][cardToReplace] = gameState.gameData.turnUpCard;
                        sortHands();
                    }
                }
                
                // Notify all players
                broadcastToAll({
                    type: "game_action",
                    action: "bid",
                    player: position,
                    bid: true,
                    suit: action.suit
                });
                
                // Start playing phase if not waiting for dealer discard
                if (gameState.gameData.gamePhase === 'bidding2' || 
                    PLAYERS[gameState.gameData.dealerPosition] !== position) {
                    startPlay();
                }
            } else {
                // Player passes
                broadcastToAll({
                    type: "game_action",
                    action: "bid",
                    player: position,
                    bid: false
                });
                
                nextBidder();
            }
            break;
            
        case "discard":
            // Only dealer can discard during bidding1
            if (gameState.gameData.gamePhase !== 'bidding1' || 
                PLAYERS[gameState.gameData.dealerPosition] !== position) return;
            
            // Replace card in dealer's hand
            gameState.gameData.hands[position][action.cardIndex] = gameState.gameData.turnUpCard;
            sortHands();
            
            // Start playing phase
            startPlay();
            break;
            
        case "play_card":
            // Validate it's player's turn and they're playing a valid card
            if (gameState.gameData.gamePhase !== 'playing' || 
                gameState.gameData.currentPlayer !== position) return;
            
            const card = gameState.gameData.hands[position][action.cardIndex];
            
            // Validate the play follows suit if required
            if (!isValidCardPlay(position, card)) return;
            
            // Add card to trick
            gameState.gameData.currentTrick.push({
                player: position,
                card: card
            });
            
            // Remove card from hand
            gameState.gameData.hands[position].splice(action.cardIndex, 1);
            
            // Notify all players
            broadcastToAll({
                type: "game_action",
                action: "play_card",
                player: position,
                card: card
            });
            
            // Process next player
            nextTrickPlayer();
            break;
            
        case "new_game":
            // Reset scores and game state
            gameState.gameData.teamScores = [0, 0];
            gameState.gameData.gamePhase = 'idle';
            
            // Notify all players
            broadcastToAll({
                type: "game_action",
                action: "new_game"
            });
            
            // Send updated game state
            broadcastGameState();
            break;
    }
}

// Communication helpers
function broadcastToAll(message) {
    for (const clientId in gameState.players) {
        const client = gameState.players[clientId];
        if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(message));
        }
    }
}

function broadcastPlayerList() {
    // Create a sanitized player list (without WebSocket objects)
    const playerList = {};
    for (const clientId in gameState.players) {
        playerList[clientId] = {
            name: gameState.players[clientId].name,
            position: gameState.players[clientId].position
        };
    }
    
    broadcastToAll({
        type: "player_list",
        players: playerList
    });
}

function broadcastGameState() {
    // Create a copy of the game state without sensitive info
    const stateCopy = JSON.parse(JSON.stringify(gameState.gameData));
    
    // Send full state to all players
    broadcastToAll({
        type: "game_state",
        state: stateCopy
    });
}

function sendGameState(clientId) {
    const client = gameState.players[clientId];
    if (client.ws.readyState === WebSocket.OPEN) {
        // Create a copy of the game state
        const stateCopy = JSON.parse(JSON.stringify(gameState.gameData));
        
        client.ws.send(JSON.stringify({
            type: "game_state",
            state: stateCopy
        }));
    }
}

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Euchre WebSocket server running on port ${PORT}`);
});

// Note: You'll need to implement the game logic functions like
// createDeck, shuffleDeck, dealCards, etc. similar to the client-side
// versions, but adapted for use in the server.

// Game logic constants
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const SUIT_SYMBOLS = {'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠'};
const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];
const PLAYERS = ['south', 'west', 'north', 'east'];
const TEAM_1 = ['south', 'north']; // Player team
const TEAM_2 = ['west', 'east'];   // CPU team

// Game logic functions for the server
function createDeck() {
    gameState.gameData.deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            gameState.gameData.deck.push({rank, suit});
        });
    });
}

function shuffleDeck() {
    for (let i = gameState.gameData.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gameState.gameData.deck[i], gameState.gameData.deck[j]] = 
            [gameState.gameData.deck[j], gameState.gameData.deck[i]];
    }
}

function dealCards() {
    // Clear hands
    PLAYERS.forEach(player => {
        gameState.gameData.hands[player] = [];
    });
    
    // Deal 5 cards to each player (3-2-3-2 or 2-3-2-3 pattern)
    const dealPattern = [[3, 2], [2, 3], [3, 2], [2, 3]];
    let cardIndex = 0;
    
    for (let pattern = 0; pattern < 2; pattern++) {
        for (let i = 0; i < 4; i++) {
            const playerIndex = (gameState.gameData.dealerPosition + 1 + i) % 4;
            const player = PLAYERS[playerIndex];
            const cardsThisRound = dealPattern[i][pattern];
            
            for (let j = 0; j < cardsThisRound; j++) {
                gameState.gameData.hands[player].push(gameState.gameData.deck[cardIndex]);
                cardIndex++;
            }
        }
    }
    
    // Turn up next card
    gameState.gameData.turnUpCard = gameState.gameData.deck[cardIndex];
    
    // Sort hands
    sortHands();
}

function sortHands() {
    const rankOrder = {'9': 0, '10': 1, 'J': 2, 'Q': 3, 'K': 4, 'A': 5};
    
    for (const player in gameState.gameData.hands) {
        gameState.gameData.hands[player].sort((a, b) => {
            if (a.suit !== b.suit) {
                return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
            }
            return rankOrder[a.rank] - rankOrder[b.rank];
        });
    }
}

function startBidding() {
    // Reset game state for bidding
    gameState.gameData.gamePhase = 'bidding1';
    gameState.gameData.currentTrick = [];
    gameState.gameData.trickWinner = null;
    gameState.gameData.trumpSuit = null;
    gameState.gameData.maker = null;
    gameState.gameData.bidsMade = 0;
    
    PLAYERS.forEach(player => {
        gameState.gameData.tricksWon[player] = 0;
    });
    
    // First player after dealer starts bidding
    gameState.gameData.currentPlayer = PLAYERS[(gameState.gameData.dealerPosition + 1) % 4];
    
    // Send updated game state
    broadcastGameState();
    
    // If CPU's turn, handle CPU bid
    handleCpuTurn();
}

function nextBidder() {
    gameState.gameData.bidsMade++;
    const PLAYERS = ['south', 'west', 'north', 'east'];
    gameState.gameData.currentPlayer = PLAYERS[(PLAYERS.indexOf(gameState.gameData.currentPlayer) + 1) % 4];
    
    // Check if we've gone all the way around
    if (gameState.gameData.bidsMade === 4) {
        if (gameState.gameData.gamePhase === 'bidding1') {
            // Move to second round of bidding
            gameState.gameData.gamePhase = 'bidding2';
            gameState.gameData.bidsMade = 0;
            gameState.gameData.currentPlayer = PLAYERS[(gameState.gameData.dealerPosition + 1) % 4];
        } else if (gameState.gameData.gamePhase === 'bidding2') {
            // No one wanted to name trump, re-deal
            gameState.gameData.dealerPosition = (gameState.gameData.dealerPosition + 1) % 4;
            gameState.gameData.gamePhase = 'idle';
        }
    }
    
    // Send updated game state
    broadcastGameState();
    
    // If CPU's turn, handle CPU bid
    handleCpuTurn();
}

function startPlay() {
    const PLAYERS = ['south', 'west', 'north', 'east'];
    gameState.gameData.gamePhase = 'playing';
    gameState.gameData.currentPlayer = PLAYERS[(gameState.gameData.dealerPosition + 1) % 4];
    gameState.gameData.currentTrick = [];
    
    // Send updated game state
    broadcastGameState();
    
    // If CPU's turn, handle CPU play
    handleCpuTurn();
}

function nextTrickPlayer() {
    const PLAYERS = ['south', 'west', 'north', 'east'];
    
    // Check if trick is complete
    if (gameState.gameData.currentTrick.length === 4) {
        // Determine trick winner
        const winningPlayer = determineWinner();
        gameState.gameData.trickWinner = winningPlayer;
        gameState.gameData.tricksWon[winningPlayer]++;
        
        // Notify all players
        broadcastToAll({
            type: "game_action",
            action: "trick_won",
            player: winningPlayer
        });
        
        // Brief delay before moving on
        setTimeout(() => {
            // Check if hand is complete
            if (isHandComplete()) {
                // Score the hand
                scoreHand();
            } else {
                // Start a new trick with winner leading
                gameState.gameData.currentPlayer = winningPlayer;
                gameState.gameData.currentTrick = [];
                gameState.gameData.trickWinner = null;
                
                // Send updated game state
                broadcastGameState();
                
                // If CPU's turn, handle CPU play
                handleCpuTurn();
            }
        }, 3500);
    } else {
        // Move to next player
        gameState.gameData.currentPlayer = PLAYERS[(PLAYERS.indexOf(gameState.gameData.currentPlayer) + 1) % 4];
        
        // Send updated game state
        broadcastGameState();
        
        // If CPU's turn, handle CPU play
        handleCpuTurn();
    }
}

function handleCpuTurn() {
    // Check if current player is a CPU (not a human player)
    if (!isPositionHuman(gameState.gameData.currentPlayer)) {
        setTimeout(() => {
            if (gameState.gameData.gamePhase === 'bidding1' || gameState.gameData.gamePhase === 'bidding2') {
                cpuBid();
            } else if (gameState.gameData.gamePhase === 'playing') {
                cpuPlayCard();
            }
        }, 1500);
    }
}

function isPositionHuman(position) {
    for (const clientId in gameState.players) {
        if (gameState.players[clientId].position === position) {
            return true;
        }
    }
    return false;
}

function cpuBid() {
    const position = gameState.gameData.currentPlayer;
    
    if (gameState.gameData.gamePhase === 'bidding1') {
        // First round bidding logic
        const shouldOrderUp = evaluateBid(position, gameState.gameData.turnUpCard.suit);
        
        if (shouldOrderUp) {
            gameState.gameData.trumpSuit = gameState.gameData.turnUpCard.suit;
            gameState.gameData.maker = position;
            
            // Dealer picks up the turn card
            const dealer = PLAYERS[gameState.gameData.dealerPosition];
            const cardToReplace = selectCardToReplace(dealer);
            gameState.gameData.hands[dealer][cardToReplace] = gameState.gameData.turnUpCard;
            sortHands();
            
            // Notify all players
            broadcastToAll({
                type: "game_action",
                action: "bid",
                player: position,
                bid: true,
                suit: gameState.gameData.turnUpCard.suit
            });
            
            // Start playing
            startPlay();
        } else {
            // Pass
            broadcastToAll({
                type: "game_action",
                action: "bid",
                player: position,
                bid: false
            });
            
            nextBidder();
        }
    } else if (gameState.gameData.gamePhase === 'bidding2') {
        // Second round bidding logic
        const bestSuit = evaluateBestSuit(position);
        
        if (bestSuit && bestSuit !== gameState.gameData.turnUpCard.suit) {
            gameState.gameData.trumpSuit = bestSuit;
            gameState.gameData.maker = position;
            
            // Notify all players
            broadcastToAll({
                type: "game_action",
                action: "bid",
                player: position,
                bid: true,
                suit: bestSuit
            });
            
            // Start playing
            startPlay();
        } else {
            // Pass
            broadcastToAll({
                type: "game_action",
                action: "bid",
                player: position,
                bid: false
            });
            
            nextBidder();
        }
    }
}

function cpuPlayCard() {
    const player = gameState.gameData.currentPlayer;
    const cardIndex = selectCardToPlay(player);
    const card = gameState.gameData.hands[player][cardIndex];
    
    // Add card to trick
    gameState.gameData.currentTrick.push({
        player: player,
        card: card
    });
    
    // Remove card from hand
    gameState.gameData.hands[player].splice(cardIndex, 1);
    
    // Notify all players
    broadcastToAll({
        type: "game_action",
        action: "play_card",
        player: player,
        card: card
    });
    
    // Process next player
    nextTrickPlayer();
}

// Helper functions for CPU AI
function evaluateBid(player, suit) {
    // Simple AI bidding logic
    const hand = gameState.gameData.hands[player];
    let trumpCount = 0;
    let jackCount = 0;
    let aceCount = 0;
    
    let sameColorSuit;
    if (suit === 'hearts') sameColorSuit = 'diamonds';
    else if (suit === 'diamonds') sameColorSuit = 'hearts';
    else if (suit === 'clubs') sameColorSuit = 'spades';
    else if (suit === 'spades') sameColorSuit = 'clubs';
    
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
    const hand = gameState.gameData.hands[player];
    const suits = [...SUITS].filter(s => s !== gameState.gameData.turnUpCard.suit);
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
    if (maxStrength >= 6 || (gameState.gameData.bidsMade >= 6 && maxStrength >= 4)) {
        return bestSuit;
    } else {
        return null;
    }
}

function selectCardToReplace(player) {
    const hand = gameState.gameData.hands[player];
    
    // Simple logic: replace the lowest non-trump card
    const rankValues = {'9': 0, '10': 1, 'J': 2, 'Q': 3, 'K': 4, 'A': 5};
    let lowestCardIndex = 0;
    let lowestValue = 10;
    
    hand.forEach((card, index) => {
        if (card.suit !== gameState.gameData.turnUpCard.suit && rankValues[card.rank] < lowestValue) {
            lowestValue = rankValues[card.rank];
            lowestCardIndex = index;
        }
    });
    
    return lowestCardIndex;
}

function selectCardToPlay(player) {
    const hand = gameState.gameData.hands[player];
    
    // Logic for leading a trick
    if (gameState.gameData.currentTrick.length === 0) {
        return selectLeadCard(player);
    }
    
    // Logic for following a trick
    const leadCard = gameState.gameData.currentTrick[0].card;
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
            .filter(item => getEffectiveSuit(item.card) === gameState.gameData.trumpSuit);
        
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
    const hand = gameState.gameData.hands[player];
    
    // Try to lead trump if we have high trumps
    const trumpCards = hand.map((card, index) => ({ card, index }))
        .filter(item => getEffectiveSuit(item.card) === gameState.gameData.trumpSuit)
        .sort((a, b) => compareCards(b.card, a.card, null)); // Sort highest to lowest
    
    if (trumpCards.length > 0 && 
        (trumpCards[0].card.rank === 'J' || trumpCards[0].card.rank === 'A')) {
        return trumpCards[0].index;
    }
    
    // Try to lead an Ace of non-trump
    const aceCards = hand.map((card, index) => ({ card, index }))
        .filter(item => item.card.rank === 'A' && 
                       getEffectiveSuit(item.card) !== gameState.gameData.trumpSuit);
    
    if (aceCards.length > 0) {
        return aceCards[0].index;
    }
    
    // Lead highest non-trump card
    const nonTrumpCards = hand.map((card, index) => ({ card, index }))
        .filter(item => getEffectiveSuit(item.card) !== gameState.gameData.trumpSuit)
        .sort((a, b) => compareCards(b.card, a.card, null)); // Sort highest to lowest
    
    if (nonTrumpCards.length > 0) {
        return nonTrumpCards[0].index;
    }
    
    // If we only have trump, lead lowest
    return trumpCards[trumpCards.length - 1].index;
}

function getEffectiveSuit(card) {
    // Handle left bower (Jack of same color as trump)
    if (card.rank === 'J') {
        if (card.suit === gameState.gameData.trumpSuit) {
            return gameState.gameData.trumpSuit; // Right bower
        }
        
        // Check if it's the left bower
        if ((gameState.gameData.trumpSuit === 'hearts' && card.suit === 'diamonds') ||
            (gameState.gameData.trumpSuit === 'diamonds' && card.suit === 'hearts') ||
            (gameState.gameData.trumpSuit === 'clubs' && card.suit === 'spades') ||
            (gameState.gameData.trumpSuit === 'spades' && card.suit === 'clubs')) {
            return gameState.gameData.trumpSuit; // Left bower is effectively trump suit
        }
    }
    
    // Normal cards keep their suit
    return card.suit;
}

function getCurrentWinningCard() {
    if (gameState.gameData.currentTrick.length === 0) return null;
    
    let winningPlay = gameState.gameData.currentTrick[0];
    const leadSuit = getEffectiveSuit(winningPlay.card);
    
    for (let i = 1; i < gameState.gameData.currentTrick.length; i++) {
        const play = gameState.gameData.currentTrick[i];
        if (compareCards(play.card, winningPlay.card, leadSuit) > 0) {
            winningPlay = play;
        }
    }
    
    return winningPlay.card;
}

function getCurrentWinningPlayer() {
    if (gameState.gameData.currentTrick.length === 0) return null;
    
    let winningPlay = gameState.gameData.currentTrick[0];
    const leadSuit = getEffectiveSuit(winningPlay.card);
    
    for (let i = 1; i < gameState.gameData.currentTrick.length; i++) {
        const play = gameState.gameData.currentTrick[i];
        if (compareCards(play.card, winningPlay.card, leadSuit) > 0) {
            winningPlay = play;
        }
    }
    
    return winningPlay.player;
}

function compareCards(card1, card2, leadSuit = null) {
    if (!leadSuit && gameState.gameData.currentTrick.length > 0) {
        leadSuit = getEffectiveSuit(gameState.gameData.currentTrick[0].card);
    }
    
    // Get effective suits (accounting for bowers)
    const suit1 = getEffectiveSuit(card1);
    const suit2 = getEffectiveSuit(card2);
    
    // Trump beats non-trump
    if (suit1 === gameState.gameData.trumpSuit && suit2 !== gameState.gameData.trumpSuit) {
        return 1;
    }
    if (suit1 !== gameState.gameData.trumpSuit && suit2 === gameState.gameData.trumpSuit) {
        return -1;
    }
    
    // If both trump, compare by rank with special ordering for bowers
    if (suit1 === gameState.gameData.trumpSuit && suit2 === gameState.gameData.trumpSuit) {
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
    const isRightBower1 = card1.rank === 'J' && card1.suit === gameState.gameData.trumpSuit;
    const isLeftBower1 = card1.rank === 'J' && 
        ((gameState.gameData.trumpSuit === 'hearts' && card1.suit === 'diamonds') ||
         (gameState.gameData.trumpSuit === 'diamonds' && card1.suit === 'hearts') ||
         (gameState.gameData.trumpSuit === 'clubs' && card1.suit === 'spades') ||
         (gameState.gameData.trumpSuit === 'spades' && card1.suit === 'clubs'));
    
    const isRightBower2 = card2.rank === 'J' && card2.suit === gameState.gameData.trumpSuit;
    const isLeftBower2 = card2.rank === 'J' && 
        ((gameState.gameData.trumpSuit === 'hearts' && card2.suit === 'diamonds') ||
         (gameState.gameData.trumpSuit === 'diamonds' && card2.suit === 'hearts') ||
         (gameState.gameData.trumpSuit === 'clubs' && card2.suit === 'spades') ||
         (gameState.gameData.trumpSuit === 'spades' && card2.suit === 'clubs'));
    
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

function isValidCardPlay(player, card) {
    // First card of trick can be anything
    if (gameState.gameData.currentTrick.length === 0) {
        return true;
    }
    
    // Get the suit led
    const leadCard = gameState.gameData.currentTrick[0].card;
    const leadSuit = getEffectiveSuit(leadCard);
    
    // If player has a card of the led suit, they must play it
    const hand = gameState.gameData.hands[player];
    const hasSuit = hand.some(c => getEffectiveSuit(c) === leadSuit);
    
    if (hasSuit) {
        // Check if the played card follows suit
        return getEffectiveSuit(card) === leadSuit;
    }
    
    // Player doesn't have the led suit, can play anything
    return true;
}

function determineWinner() {
    let winningPlay = gameState.gameData.currentTrick[0];
    const leadSuit = getEffectiveSuit(winningPlay.card);
    
    for (let i = 1; i < gameState.gameData.currentTrick.length; i++) {
        const play = gameState.gameData.currentTrick[i];
        if (compareCards(play.card, winningPlay.card, leadSuit) > 0) {
            winningPlay = play;
        }
    }
    
    return winningPlay.player;
}

function isHandComplete() {
    // Check if all cards have been played
    for (const player in gameState.gameData.hands) {
        if (gameState.gameData.hands[player].length > 0) {
            return false;
        }
    }
    return true;
}

function scoreHand() {
    // Count tricks for each team
    const team1Tricks = gameState.gameData.tricksWon.south + gameState.gameData.tricksWon.north;
    const team2Tricks = gameState.gameData.tricksWon.west + gameState.gameData.tricksWon.east;
    
    let team1Score = 0;
    let team2Score = 0;
    
    const makerTeam = TEAM_1.includes(gameState.gameData.maker) ? 1 : 2;
    
    if (makerTeam === 1) {
        if (team1Tricks >= 3) {
            team1Score = team1Tricks === 5 ? 2 : 1;
        } else {
            team2Score = 2; // Euchre
        }
    } else { // makerTeam === 2
        if (team2Tricks >= 3) {
            team2Score = team2Tricks === 5 ? 2 : 1;
        } else {
            team1Score = 2; // Euchre
        }
    }
    
    // Update scores
    gameState.gameData.teamScores[0] += team1Score;
    gameState.gameData.teamScores[1] += team2Score;
    
    // Determine game state
    if (gameState.gameData.teamScores[0] >= 10 || gameState.gameData.teamScores[1] >= 10) {
        gameState.gameData.gamePhase = 'gameover';
        
        // Notify all players
        broadcastToAll({
            type: "game_action",
            action: "game_over",
            winningTeam: gameState.gameData.teamScores[0] >= 10 ? "Team 1" : "Team 2",
            score: [gameState.gameData.teamScores[0], gameState.gameData.teamScores[1]]
        });
    } else {
        // Rotate dealer for next hand
        gameState.gameData.dealerPosition = (gameState.gameData.dealerPosition + 1) % 4;
        gameState.gameData.gamePhase = 'idle';
    }
    
    // Send updated game state
    broadcastGameState();
}