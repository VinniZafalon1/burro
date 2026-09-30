export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const LETTERS = 'BURRO';

export function buildDeck(random = Math.random) {
  const deck = SUITS.flatMap((suit, suitIndex) => RANKS.map((rank, rankIndex) => ({
    id: `${suitIndex}-${rankIndex}`,
    rank,
    suit,
    color: suitIndex === 1 || suitIndex === 2 ? 'red' : 'black',
  })));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function dealHands(players, random = Math.random) {
  if (players.length < 2 || players.length > 6) throw new Error('A partida aceita de 2 a 6 jogadores.');
  const deck = buildDeck(random);
  return Object.fromEntries(players.map((player, index) => [player.id, deck.slice(index * 4, index * 4 + 4)]));
}

export function hasFourOfAKind(hand = []) {
  return hand.length === 4 && hand.every(card => card.rank === hand[0]?.rank);
}

export function createMatch(players, random = Math.random) {
  const match = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    players: players.map(player => ({ ...player, score: player.score || 0 })),
    allPlayers: players.map(player => ({ ...player, score: player.score || 0 })),
    hands: dealHands(players, random),
    choices: {},
    turnIndex: 0,
    reactions: [],
    phase: 'passing',
    round: 1,
    quartetOwner: null,
    winnerId: null,
    penaltyId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
  const completer = match.players.find(player => hasFourOfAKind(match.hands[player.id]));
  if (completer) {
    match.phase = 'reaction';
    match.quartetOwner = completer.id;
  }
  return match;
}

export function submitChoice(match, playerId, cardId) {
  if (match.phase !== 'passing') throw new Error('A rodada não está recebendo jogadas.');
  if (!match.players.some(player => player.id === playerId)) throw new Error('Jogador não pertence à partida.');
  if (match.players[match.turnIndex]?.id !== playerId) throw new Error('Ainda não é a sua vez.');
  if (match.choices[playerId]) throw new Error('Você já escolheu uma carta nesta rodada.');
  const hand = match.hands[playerId] || [];
  if (hand.length !== 4 || !hand.some(card => card.id === cardId)) throw new Error('A carta escolhida não está na sua mão.');
  match.choices[playerId] = cardId;
  if (Object.keys(match.choices).length === match.players.length) rotateCards(match);
  else match.turnIndex = (match.turnIndex + 1) % match.players.length;
  return match;
}

function rotateCards(match) {
  const outgoing = Object.fromEntries(match.players.map(player => [
    player.id,
    match.hands[player.id].find(card => card.id === match.choices[player.id]),
  ]));
  const nextHands = Object.fromEntries(match.players.map(player => [player.id, match.hands[player.id].filter(card => card.id !== match.choices[player.id])]));
  match.players.forEach((player, index) => {
    const nextPlayer = match.players[(index + 1) % match.players.length];
    nextHands[nextPlayer.id].push(outgoing[player.id]);
  });
  match.hands = nextHands;
  match.choices = {};
  match.turnIndex = 0;
  const completer = match.players.find(player => hasFourOfAKind(match.hands[player.id]));
  if (completer) {
    match.phase = 'reaction';
    match.quartetOwner = completer.id;
    match.reactions = [];
  } else {
    match.round += 1;
  }
}

export function registerReaction(match, playerId) {
  if (match.phase !== 'reaction') throw new Error('Não há quarteto aguardando confirmação.');
  if (!match.players.some(player => player.id === playerId)) throw new Error('Jogador não pertence à partida.');
  if (match.reactions.some(reaction => reaction.playerId === playerId)) throw new Error('Sua reação já foi registrada.');
  match.reactions.push({ playerId, at: Date.now() });
  return match;
}

export function finishQuartet(match) {
  if (match.phase !== 'reaction' || !match.quartetOwner) throw new Error('A rodada ainda não pode ser encerrada.');
  const owner = match.quartetOwner;
  const orderedReactions = [...match.reactions].sort((a, b) => a.at - b.at);
  const absent = match.players.filter(player => !match.reactions.some(reaction => reaction.playerId === player.id));
  const penalty = absent.at(-1)?.id || orderedReactions.at(-1)?.playerId || [...match.players].reverse().find(player => player.id !== owner)?.id;
  match.winnerId = owner;
  match.roundWinnerId = owner;
  match.penaltyId = penalty;
  match.penaltyName = match.players.find(player => player.id === penalty)?.name || null;
  if (penalty) {
    const penalized = match.players.find(player => player.id === penalty);
    if (penalized) penalized.score += 1;
    const originalPlayer = match.allPlayers.find(player => player.id === penalty);
    if (originalPlayer) originalPlayer.score = penalized?.score || originalPlayer.score;
  }
  match.players = match.players.filter(player => player.score < LETTERS.length);
  if (match.players.length === 1) {
    match.phase = 'finished';
    match.winnerId = match.players[0].id;
    match.endedAt = new Date().toISOString();
  } else {
    match.phase = 'roundResult';
  }
  return match;
}

export function nextRound(match, random = Math.random) {
  if (match.phase !== 'roundResult') throw new Error('Esta partida não está pronta para a próxima rodada.');
  match.round += 1;
  match.choices = {};
  match.turnIndex = 0;
  match.penaltyName = null;
  match.reactions = [];
  match.phase = 'passing';
  match.quartetOwner = null;
  match.roundWinnerId = null;
  match.winnerId = null;
  match.penaltyId = null;
  return match;
}
