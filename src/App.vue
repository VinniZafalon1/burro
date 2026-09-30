<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Capacitor } from '@capacitor/core';
import { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';
import { createMatch, submitChoice, registerReaction, finishQuartet, nextRound, LETTERS } from './game/engine.js';

const SERVICE = '8d6c2f10-7a51-4eaf-9e0b-425552524f01';
const COMMAND = '8d6c2f11-7a51-4eaf-9e0b-425552524f01';
const UPDATE = '8d6c2f12-7a51-4eaf-9e0b-425552524f01';
const screen = ref('home');
const myName = ref(localStorage.getItem('burro-name') || '');
const roomCode = ref('');
const myId = ref('');
const online = ref(false);
const isNative = Capacitor.isNativePlatform();
const status = ref(isNative ? 'Bluetooth pronto para conectar' : 'Prévia de interface no navegador');
const players = ref([]);
const match = ref(null);
const game = reactive({ active: false, direction: 1, turn: 0, turnIndex: 0, round: 0, hands: {}, counts: {}, choices: {}, reactions: [], logs: [], winner: '', winnerId: '', penaltyId: '', penaltyName: '', quartetOwner: '', phase: 'waiting', passReady: false });
const history = ref(readHistory());
const historyDetail = ref('');
const bleDevices = ref([]);
const connectedPeer = ref('');
const bleHandles = [];
const bleMode = ref('');
const localDemo = ref(false);
const newPlayerName = ref('');
const selectedCard = ref(null);
const toast = ref('');
let toastTimer;
let reactionTimer;

function readHistory() { try { return JSON.parse(localStorage.getItem('burro-history') || '[]'); } catch { return []; } }
function persistHistory() { localStorage.setItem('burro-history', JSON.stringify(history.value)); }
function explainError(error) { return error?.message || (typeof error === 'string' ? error : JSON.stringify(error)); }
function say(message) { toast.value = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.value = '', 3500); }
function newId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function normalizeName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 18); }
function activePlayer() { return match.value?.players[match.value.turnIndex] || null; }
const currentPlayer = computed(() => activePlayer()?.name || '—');
const handOwner = computed(() => {
  if (!match.value) return null;
  if (localDemo.value && !connectedPeer.value) return activePlayer();
  return match.value.players.find(player => player.id === myId.value) || null;
});
const hand = computed(() => handOwner.value ? (game.hands[handOwner.value.name] || []) : []);
const isMyTurn = computed(() => Boolean(match.value && match.value.phase === 'passing' && activePlayer() && (activePlayer().id === myId.value || (localDemo.value && !connectedPeer.value))));
const winnerText = computed(() => game.winner ? `${game.winner} venceu a partida!` : '');
const pendingPlayers = computed(() => players.value.filter(player => player.pending));
const acceptedPlayers = computed(() => players.value.filter(player => !player.pending && player.connected !== false));
const hasReacted = computed(() => match.value?.reactions.some(item => item.playerId === myId.value));

function applyMatch() {
  const state = match.value;
  if (!state) return;
  players.value = state.players;
  game.active = state.phase !== 'finished'; game.phase = state.phase; game.turnIndex = state.turnIndex || 0;
  game.turn = game.turnIndex; game.round = state.round; game.choices = { ...state.choices };
  game.reactions = state.reactions.map(item => item.playerId); game.quartetOwner = state.quartetOwner || '';
  game.winnerId = state.phase === 'finished' ? state.players[0]?.id || '' : state.winnerId || '';
  game.winner = state.phase === 'finished' ? state.players[0]?.name || '' : '';
  game.penaltyId = state.penaltyId || ''; game.penaltyName = state.penaltyName || ''; game.passReady = state.phase === 'reaction';
  game.hands = Object.fromEntries(state.players.map(player => [player.name, state.hands[player.id] || []]));
  game.counts = Object.fromEntries(state.players.map(player => [player.name, state.hands[player.id]?.length ?? 4]));
  if (screen.value === 'lobby' && state.phase !== 'waiting') screen.value = 'game';
  broadcastState();
}

function publicState(forPlayer) {
  const state = match.value;
  if (!state) {
    const player = players.value.find(item => item.id === forPlayer);
    return { type: 'ROOM_STATE', approved: Boolean(player && !player.pending), yourPlayerId: forPlayer || null, players: acceptedPlayers.value.map(publicPlayer), pending: pendingPlayers.value.map(item => item.name) };
  }
  const own = state.players.find(player => player.id === forPlayer);
  return {
    type: 'GAME_STATE', id: state.id, matchId: state.id, yourPlayerId: forPlayer,
    players: state.players.map(publicPlayer), phase: state.phase, turnIndex: state.turnIndex,
    round: state.round, choices: Object.keys(state.choices), reactions: state.reactions.map(item => item.playerId),
    hands: own ? { [own.id]: state.hands[own.id] || [] } : {},
    counts: Object.fromEntries(state.players.map(player => [player.id, state.hands[player.id]?.length ?? 4])),
    quartetOwner: state.quartetOwner, winnerId: state.phase === 'finished' ? state.players[0]?.id : state.winnerId,
    penaltyId: state.penaltyId, penaltyName: state.penaltyName,
    allPlayers: (state.allPlayers || state.players).map(publicPlayer),
    roundWinnerId: state.roundWinnerId || state.winnerId, startedAt: state.startedAt, endedAt: state.endedAt,
  };
}
function publicPlayer(player) { return { id: player.id, name: player.name, score: player.score || 0, host: Boolean(player.host), connected: player.connected !== false }; }
function encodeMessage(message) { return [...new TextEncoder().encode(JSON.stringify(message))]; }
async function notifyPlayer(deviceId, state) {
  const bytes = encodeMessage(state);
  await BluetoothLowEnergy.setGattCharacteristicValue({ service: SERVICE, characteristic: UPDATE, value: bytes });
  await BluetoothLowEnergy.notifyGattCharacteristicChanged({ service: SERVICE, characteristic: UPDATE, value: bytes, deviceId });
}
async function broadcastState() {
  if (!isNative || bleMode.value !== 'peripheral') return;
  for (const player of players.value.filter(item => item.deviceId && !item.pending)) {
    try { await notifyPlayer(player.deviceId, publicState(player.id)); }
    catch (error) { status.value = `Falha ao sincronizar ${player.name}: ${explainError(error)}`; }
  }
}
function showHostState(deviceId) {
  return notifyPlayer(deviceId, publicState(players.value.find(player => player.deviceId === deviceId)?.id));
}
function receiveState(state) {
  if (state.type === 'JOIN_REJECTED') { say(state.reason || 'O anfitrião recusou a entrada.'); return; }
  if (state.type === 'ROOM_STATE') {
    players.value = state.players || [];
    if (state.approved && state.yourPlayerId) { myId.value = state.yourPlayerId; screen.value = 'lobby'; say('O anfitrião aceitou sua entrada.'); }
    status.value = state.approved ? 'Você entrou na sala.' : 'Pedido enviado; aguardando o anfitrião.';
    return;
  }
  if (state.type !== 'GAME_STATE') return;
  myId.value = state.yourPlayerId || myId.value;
  players.value = state.players || players.value;
  match.value = {
    id: state.matchId, players: state.players || [], allPlayers: state.allPlayers || state.players || [], phase: state.phase, turnIndex: state.turnIndex, round: state.round,
    choices: Object.fromEntries((state.choices || []).map(id => [id, true])),
    reactions: (state.reactions || []).map((playerId, index) => ({ playerId, at: index })),
    hands: Object.fromEntries(Object.entries(state.hands || {})), quartetOwner: state.quartetOwner,
    winnerId: state.winnerId, roundWinnerId: state.roundWinnerId, penaltyId: state.penaltyId, penaltyName: state.penaltyName, startedAt: state.startedAt, endedAt: state.endedAt,
  };
  game.active = state.phase !== 'finished'; game.phase = state.phase; game.round = state.round;
  game.turnIndex = state.turnIndex || 0; game.choices = Object.fromEntries((state.choices || []).map(id => [id, true]));
  game.reactions = state.reactions || []; game.quartetOwner = state.quartetOwner || '';
  game.winnerId = state.phase === 'finished' ? state.winnerId || '' : state.roundWinnerId || state.winnerId || '';
  game.penaltyId = state.penaltyId || ''; game.penaltyName = state.penaltyName || '';
  game.winner = state.phase === 'finished' ? (state.players.find(player => player.id === state.winnerId)?.name || '') : '';
  game.passReady = state.phase === 'reaction';
  game.hands = Object.fromEntries(state.players.map(player => [player.name, state.hands?.[player.id] || []]));
  game.counts = Object.fromEntries(state.players.map(player => [player.name, state.counts?.[player.id] ?? 4]));
  if (state.phase !== 'waiting') screen.value = 'game';
  if (state.phase === 'finished') saveFinishedMatch(state);
}

async function ensureBluetooth(mode) {
  if (!isNative) throw new Error('Bluetooth não funciona nesta prévia do navegador. Instale e abra o app Android.');
  if (bleMode.value && bleMode.value !== mode) throw new Error('Feche e reabra o app antes de trocar entre buscar sala e anunciar sala.');
  const permission = await BluetoothLowEnergy.requestPermissions();
  if (permission.bluetooth !== 'granted') throw new Error('Permissão de Bluetooth negada. Ative-a nas configurações do Android.');
  if (!bleMode.value) {
    await BluetoothLowEnergy.initialize({ mode });
    bleMode.value = mode;
    if (mode === 'central') {
      const changed = await BluetoothLowEnergy.addListener('characteristicChanged', event => {
        if (event.service?.toLowerCase() !== SERVICE || event.characteristic?.toLowerCase() !== UPDATE) return;
        try { receiveState(JSON.parse(new TextDecoder().decode(new Uint8Array(event.value)))); }
        catch { say('A sala enviou uma atualização inválida.'); }
      });
      bleHandles.push(changed);
    }
  }
}

async function createRoom() {
  const name = normalizeName(myName.value);
  if (!name) return say('Digite seu nome antes de criar a sala.');
  myName.value = name; localStorage.setItem('burro-name', name);
  myId.value = newId(); localDemo.value = false;
  roomCode.value = `BUR-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  players.value = [{ id: myId.value, name, host: true, score: 0, connected: true }];
  screen.value = 'lobby'; status.value = isNative ? 'Preparando sala Bluetooth…' : 'Sala de demonstração local';
  if (isNative) await startHosting();
}
function addLocalPlayer() {
  const name = normalizeName(newPlayerName.value);
  if (!name) return say('Digite o nome do jogador.');
  if (acceptedPlayers.value.length >= 6) return say('A sala já chegou ao limite de seis jogadores.');
  if (players.value.some(player => player.name.toLowerCase() === name.toLowerCase())) return say('Esse nome já está na sala.');
  players.value.push({ id: newId(), name, score: 0, connected: true, local: true });
  localDemo.value = true; newPlayerName.value = '';
}

async function startHosting() {
  try {
    await ensureBluetooth('peripheral');
    const writeListener = await BluetoothLowEnergy.addListener('gattCharacteristicWriteRequest', event => {
      if (event.characteristic?.toLowerCase() !== COMMAND) return;
      try {
        if (event.value.length > 512) throw new Error('Mensagem Bluetooth excede o tamanho permitido.');
        handleHostCommand(JSON.parse(new TextDecoder().decode(new Uint8Array(event.value))), event.deviceId);
      } catch (error) { say(`Mensagem Bluetooth inválida: ${explainError(error)}`); }
    });
    const connectListener = await BluetoothLowEnergy.addListener('centralConnected', ({ deviceId }) => {
      online.value = true; status.value = 'Celular conectado à sala'; say('Celular conectado.');
      showHostState(deviceId).catch(error => say(`Não foi possível enviar o estado da sala: ${explainError(error)}`));
    });
    const disconnectListener = await BluetoothLowEnergy.addListener('centralDisconnected', ({ deviceId }) => {
      const player = players.value.find(item => item.deviceId === deviceId);
      if (player) { player.connected = false; status.value = `${player.name} desconectou. A partida foi pausada.`; say(status.value); }
      online.value = players.value.some(item => item.deviceId && item.connected);
    });
    bleHandles.push(writeListener, connectListener, disconnectListener);
    await BluetoothLowEnergy.addGattService({ service: SERVICE, characteristics: [
      { uuid: COMMAND, properties: { write: true }, value: [] },
      { uuid: UPDATE, properties: { notify: true }, value: [] },
    ] });
    await BluetoothLowEnergy.startAdvertising({ name: `Burro-${roomCode.value}`, services: [SERVICE], includeName: true });
    online.value = true; status.value = 'Sala anunciada por Bluetooth · sem internet';
    say('Sala visível para celulares próximos.');
  } catch (error) { status.value = 'Não foi possível anunciar a sala'; say(explainError(error)); }
}
function handleHostCommand(command, deviceId) {
  if (command.type === 'JOIN_REQUEST') {
    const name = normalizeName(command.name);
    if (!name) return rejectJoin(deviceId, 'Informe um nome antes de entrar.');
    if (players.value.length >= 6) return rejectJoin(deviceId, 'A sala já tem seis jogadores.');
    if (players.value.some(player => player.name.toLowerCase() === name.toLowerCase())) return rejectJoin(deviceId, 'Esse nome já está na sala.');
    players.value.push({ id: newId(), name, score: 0, deviceId, connected: true, pending: true });
    status.value = `${name} pediu para entrar`;
    showHostState(deviceId).catch(() => {}); say(`${name} pediu para entrar. Aceite na sala.`);
  } else if (command.type === 'CARD_CHOICE') {
    const player = players.value.find(item => item.deviceId === deviceId && !item.pending);
    if (!player || !match.value || command.matchId !== match.value.id) return say('Jogada recusada: jogador ou partida inválidos.');
    try { submitChoice(match.value, player.id, command.cardId); selectedCard.value = null; applyMatch(); }
    catch (error) { say(explainError(error)); }
  } else if (command.type === 'REACTION') {
    const player = players.value.find(item => item.deviceId === deviceId && !item.pending);
    if (!player || !match.value || command.matchId !== match.value.id) return say('Reação recusada: jogador ou partida inválidos.');
    acceptReaction(player.id);
  } else if (command.type === 'RECONNECT') {
    const player = players.value.find(item => item.id === command.playerId && item.name === normalizeName(command.name));
    if (!player) return rejectJoin(deviceId, 'Não encontrei sua vaga nesta partida.');
    player.deviceId = deviceId; player.connected = true; player.pending = false;
    showHostState(deviceId).catch(() => {}); broadcastState();
  }
}
function rejectJoin(deviceId, reason) {
  notifyPlayer(deviceId, { type: 'JOIN_REJECTED', reason }).catch(() => {});
}
async function acceptPlayer(player) {
  player.pending = false; status.value = `${player.name} entrou na sala.`;
  await showHostState(player.deviceId); await broadcastState(); say(status.value);
}
async function declinePlayer(player) {
  await rejectJoin(player.deviceId, 'O anfitrião recusou seu pedido.');
  players.value = players.value.filter(item => item.id !== player.id);
}

async function startScan() {
  try {
    if (!normalizeName(myName.value)) return say('Digite seu nome antes de procurar uma sala.');
    await ensureBluetooth('central'); bleDevices.value = []; status.value = 'Procurando salas próximas…';
    const found = await BluetoothLowEnergy.addListener('deviceScanned', ({ device }) => {
      const services = (device.serviceUuids || []).map(uuid => uuid.toLowerCase());
      if (services.includes(SERVICE) && !bleDevices.value.some(item => item.deviceId === device.deviceId)) bleDevices.value.push(device);
    }); bleHandles.push(found);
    await BluetoothLowEnergy.startScan({ services: [SERVICE], timeout: 15000 });
    setTimeout(() => BluetoothLowEnergy.stopScan().catch(() => {}), 15000);
  } catch (error) { status.value = 'Busca Bluetooth indisponível'; say(explainError(error)); }
}
async function joinRoom(device) {
  try {
    const name = normalizeName(myName.value);
    if (!name) return say('Digite seu nome antes de entrar na sala.');
    await BluetoothLowEnergy.stopScan();
    await BluetoothLowEnergy.connect({ deviceId: device.deviceId });
    connectedPeer.value = device.deviceId;
    await BluetoothLowEnergy.discoverServices({ deviceId: device.deviceId });
    await BluetoothLowEnergy.startCharacteristicNotifications({ deviceId: device.deviceId, service: SERVICE, characteristic: UPDATE });
    online.value = true; status.value = `Conectado a ${device.name || 'sala Burro'}`;
    await writeCommand({ type: 'JOIN_REQUEST', name });
    say('Pedido enviado. Aguarde o anfitrião aceitar.');
  } catch (error) { status.value = 'Não foi possível entrar na sala'; say(explainError(error)); }
}
async function writeCommand(command) {
  if (!connectedPeer.value) throw new Error('Você não está conectado a uma sala.');
  await BluetoothLowEnergy.writeCharacteristic({ deviceId: connectedPeer.value, service: SERVICE, characteristic: COMMAND, value: encodeMessage(command), type: 'withResponse' });
}

function beginGame() {
  if (!players.value.find(player => player.id === myId.value)?.host) return say('Somente o anfitrião pode iniciar a partida.');
  const participants = acceptedPlayers.value;
  if (participants.length < 2) return say('A partida precisa de pelo menos dois jogadores conectados.');
  if (participants.some(player => player.connected === false)) return say('Todos precisam reconectar antes de começar.');
  try {
    match.value = createMatch(participants); myId.value ||= participants[0].id;
    selectedCard.value = null; screen.value = 'game'; applyMatch();
    if (match.value.phase === 'reaction') startReactionWindow();
  } catch (error) { say(explainError(error)); }
}
async function confirmCard() {
  if (!match.value || !isMyTurn.value || !selectedCard.value) return say('Selecione uma carta antes de confirmar.');
  try {
    if (connectedPeer.value && activePlayer()?.id === myId.value) {
      await writeCommand({ type: 'CARD_CHOICE', matchId: match.value.id, cardId: selectedCard.value });
      selectedCard.value = null; return;
    }
    submitChoice(match.value, activePlayer().id, selectedCard.value);
    selectedCard.value = null; applyMatch();
    if (match.value.phase === 'reaction') startReactionWindow();
  } catch (error) { say(explainError(error)); }
}
function acceptReaction(playerId) {
  if (!match.value) return;
  try {
    registerReaction(match.value, playerId); applyMatch();
    if (match.value.reactions.length === match.value.players.length) settleQuartet();
  } catch (error) { say(explainError(error)); }
}
function startReactionWindow() {
  clearTimeout(reactionTimer);
  if (match.value?.phase !== 'reaction') return;
  reactionTimer = setTimeout(() => settleQuartet(), 5000);
}
async function reactToQuartet() {
  if (!match.value || match.value.phase !== 'reaction' || hasReacted.value) return;
  if (connectedPeer.value && myId.value !== match.value.players[0]?.id) {
    await writeCommand({ type: 'REACTION', matchId: match.value.id }); return;
  }
  acceptReaction(myId.value);
}
function settleQuartet() {
  if (!match.value || match.value.phase !== 'reaction') return;
  clearTimeout(reactionTimer);
  try {
    finishQuartet(match.value); applyMatch();
    if (match.value.phase === 'finished') saveFinishedMatch();
    else say(`${match.value.players.find(player => player.id === match.value.penaltyId)?.name || 'Jogador'} recebeu uma letra.`);
  } catch (error) { say(explainError(error)); }
}
function nextMatchRound() {
  if (!match.value) return;
  try { nextRound(match.value); applyMatch(); selectedCard.value = null; }
  catch (error) { say(explainError(error)); }
}
function saveFinishedMatch(state = null) {
  const data = state || match.value;
  if (!data || data.phase !== 'finished') return;
  const id = data.id || data.matchId;
  if (history.value.some(item => item.id === id)) return;
  const championId = data.winnerId || data.players[0]?.id;
  history.value.unshift({
    id, startedAt: data.startedAt, endedAt: data.endedAt || new Date().toISOString(),
    winner: data.allPlayers?.find(player => player.id === championId)?.name || data.players.find(player => player.id === championId)?.name || '—',
    penalty: data.penaltyName || data.players.find(player => player.id === data.penaltyId)?.name || '—',
    players: (data.allPlayers || data.players).map(player => player.name), rounds: data.round, status: 'finalizada',
  });
  history.value = history.value.slice(0, 50); persistHistory();
}
function finishForClient(state) { receiveState(state); }
async function doReact() { try { await reactToQuartet(); } catch (error) { say(explainError(error)); } }
function doPass() { confirmCard(); }
function doSlap() { doReact(); }
function restartRound() {
  if (!players.value.find(player => player.id === myId.value)?.host) return say('Aguarde o anfitrião iniciar outra partida.');
  if (match.value?.phase === 'finished' && match.value.allPlayers?.length >= 2) {
    players.value = match.value.allPlayers.map(player => ({ ...player, score: 0, pending: false }));
    match.value = null; game.phase = 'waiting'; screen.value = 'lobby'; say('Partida encerrada. O anfitrião pode começar uma nova.'); return;
  }
  beginGame();
}
function openHistory() { screen.value = 'history'; }
function clearHistory() {
  if (!globalThis.confirm || confirm('Apagar todo o histórico deste aparelho?')) { history.value = []; persistHistory(); }
}
function removeHistoryItem(id) {
  if (!globalThis.confirm || confirm('Apagar esta partida do histórico?')) {
    history.value = history.value.filter(item => item.id !== id); persistHistory();
  }
}
function toggleHistory(item) { historyDetail.value = historyDetail.value === item.id ? '' : item.id; }
async function goHome() {
  if (match.value && match.value.phase !== 'finished') {
    if (!confirm('Sair agora? Esta partida será registrada como interrompida.')) return;
    history.value.unshift({ id: match.value.id, startedAt: match.value.startedAt, endedAt: new Date().toISOString(), winner: '—', penalty: '—', players: match.value.allPlayers.map(player => player.name), rounds: match.value.round, status: 'interrompida' });
    history.value = history.value.slice(0, 50); persistHistory();
  }
  if (bleMode.value === 'peripheral') await BluetoothLowEnergy.stopAdvertising().catch(() => {});
  if (bleMode.value === 'central' && connectedPeer.value) await BluetoothLowEnergy.disconnect({ deviceId: connectedPeer.value }).catch(() => {});
  screen.value = 'home'; online.value = false;
}
watch(myName, name => localStorage.setItem('burro-name', name));
onBeforeUnmount(() => {
  clearTimeout(reactionTimer); bleHandles.forEach(handle => handle.remove?.());
  if (bleMode.value === 'central') BluetoothLowEnergy.stopScan().catch(() => {});
});
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <button class="brand" @click="goHome"><span class="brand-mark">B</span><span>burro<span class="brand-dot">.</span></span></button>
      <div class="top-actions"><span class="status-pill"><i :class="online ? 'dot-live' : ''"></i>{{ online ? 'Bluetooth ativo' : 'offline' }}</span><button class="icon-btn" aria-label="Histórico" @click="openHistory">◷</button></div>
    </header>

    <section v-if="screen === 'home'" class="home-page">
      <div class="hero-copy"><span class="eyebrow">CARTAS NA MESA. AMIGOS POR PERTO.</span><h1>Quem vai<br/>ser o <em>burro?</em></h1><p>O clássico jogo de cartas para jogar junto, conectado por Bluetooth e sem precisar de internet.</p></div>
      <div class="table-art" aria-hidden="true"><div class="card-back c1">B</div><div class="card-back c2">♠</div><div class="card-back c3">♥</div><div class="table-center"><span>♣</span><b>4 iguais</b><small>um jogo de companhia</small></div><div class="spark s1">✳</div><div class="spark s2">✦</div></div>
      <div class="home-panel"><label for="name">SEU NOME</label><input id="name" v-model="myName" maxlength="18" placeholder="Como te chamam?" @keyup.enter="createRoom"/><button class="primary-btn" @click="createRoom">Criar uma sala <span>↗</span></button><button class="secondary-btn" @click="screen='join'; bleDevices=[]">Entrar em uma sala <span>⌕</span></button><div class="offline-note"><span>✳</span> Funciona sem internet. Só precisa estar por perto.</div><div v-if="!isNative" class="info-card browser-notice">Prévia no navegador: a interface funciona, mas o Bluetooth exige o app Android instalado.</div></div>
      <footer class="home-footer"><span>2—6 JOGADORES</span><span>BLUETOOTH</span><span>GRÁTIS PARA JOGAR</span></footer>
    </section>

    <section v-else-if="screen === 'lobby'" class="content-page">
      <button class="back-link" @click="goHome">← Voltar</button><span class="eyebrow">SALA DE JOGO</span><h1>Chame a<br/><em>companhia.</em></h1><p class="lead">Compartilhe o nome da sala e peça para seus amigos buscarem no app.</p>
      <div class="room-card"><div class="room-head"><div><small>SALA DE {{ players.find(p=>p.host)?.name || myName }}</small><strong>{{ status }}</strong></div><span class="room-code">{{ roomCode || 'BLE' }}</span></div><div class="room-status"><span class="pulse"></span>{{ online ? 'Bluetooth ligado · sem internet' : status }}</div></div>
      <div class="section-row"><h2>Na mesa</h2><span>{{ players.length }} / 6 jogadores</span></div>
      <div class="player-list"><div v-for="(p, i) in players" :key="p.id" class="player-row"><span class="avatar" :class="'avatar-'+i">{{ p.name.slice(0,1).toUpperCase() }}</span><span>{{ p.name }}<small v-if="p.host">Anfitrião</small><small v-else-if="p.pending">Pedido aguardando aceite</small><small v-else-if="p.connected === false">Desconectado</small></span><template v-if="p.pending"><button class="small-btn" @click="acceptPlayer(p)">Aceitar</button><button class="small-btn reject-btn" @click="declinePlayer(p)">Recusar</button></template><b v-else class="connected">{{ p.connected === false ? '!' : '●' }}</b></div><div v-if="players.length===1" class="waiting">Aguardando seus amigos…</div></div>
      <div v-if="!isNative" class="info-card">A sala por Bluetooth precisa do app instalado em um celular Android. Enquanto isso, adicione jogadores locais para conhecer o jogo.</div>
      <div v-if="!isNative" class="add-player"><input v-model="newPlayerName" placeholder="Adicionar jogador local" maxlength="18" @keyup.enter="addLocalPlayer"/><button class="small-btn" @click="addLocalPlayer">Adicionar</button></div>
      <button class="ghost-btn" @click="startHosting" :disabled="!isNative || online">{{ online ? '✓ Sala anunciada por Bluetooth' : 'Anunciar sala por Bluetooth' }}</button>
      <button class="primary-btn" :disabled="acceptedPlayers.length<2 || pendingPlayers.length>0 || !players.find(p=>p.id===myId)?.host" @click="beginGame">Começar partida <span>↗</span></button>
      <p class="hint">{{ !players.find(p=>p.id===myId)?.host ? 'Aguardando o anfitrião iniciar.' : pendingPlayers.length ? 'Aceite ou recuse os pedidos antes de começar.' : acceptedPlayers.length<2 ? 'Adicione ou aceite ao menos mais um jogador.' : 'Entre 2 e 6 jogadores · 4 cartas por pessoa' }}</p>
    </section>

    <section v-else-if="screen === 'join'" class="content-page">
      <button class="back-link" @click="goHome">← Voltar</button><span class="eyebrow">PERTO DE VOCÊ</span><h1>Encontre<br/><em>uma sala.</em></h1><p class="lead">Ative o Bluetooth e procure partidas próximas.</p>
      <div class="join-name"><label>SEU NOME</label><input v-model="myName" maxlength="18" placeholder="Como te chamam?"/></div>
      <button class="primary-btn" @click="startScan">Buscar salas por Bluetooth <span>⌕</span></button>
      <div class="room-list"><button v-for="d in bleDevices" :key="d.deviceId" class="found-room" @click="joinRoom(d)"><span class="avatar">♧</span><span><b>{{ d.name || 'Sala Burro' }}</b><small>Sala próxima · {{ d.rssi }} dBm</small></span><span>→</span></button><div v-if="!bleDevices.length" class="empty-state"><span class="radar">⌕</span><b>Nenhuma sala por enquanto</b><small>Peça ao anfitrião para anunciar a sala pelo app.</small></div></div>
      <p class="hint">{{ status }}</p>
    </section>

    <section v-else-if="screen === 'game'" class="game-page">
      <div class="game-head"><button class="back-link" @click="goHome">← Sair</button><span class="round-badge">RODADA {{ game.round }}</span><button class="icon-btn" @click="openHistory">◷</button></div>
      <div v-if="game.phase==='passing'" class="turn-banner"><span class="eyebrow">{{ isMyTurn ? 'SUA VEZ' : 'VEZ DE' }}</span><h2>{{ isMyTurn ? `Escolha uma carta, ${currentPlayer}.` : `${currentPlayer} está escolhendo…` }}</h2><p>Cada pessoa escolhe uma carta. Quando todos confirmarem, as cartas passam para o próximo jogador.</p></div>
      <div v-else-if="game.phase==='reaction'" class="turn-banner"><span class="eyebrow">QUARTETO ENCONTRADO</span><h2>Quatro iguais!</h2><p>{{ players.find(p=>p.id===game.quartetOwner)?.name }} completou um grupo. Toque em “Percebi” antes dos outros.</p></div>
      <div v-else-if="game.phase==='roundResult'" class="result-banner"><span class="eyebrow">RESULTADO DA RODADA {{ game.round }}</span><h2>{{ players.find(p=>p.id===game.winnerId)?.name }} fez quatro iguais.</h2><p>{{ game.penaltyName || players.find(p=>p.id===game.penaltyId)?.name || 'Um jogador' }} recebeu uma letra de BURRO por reagir por último.</p></div>
      <div v-else class="result-banner"><span class="eyebrow">PARTIDA FINALIZADA</span><h2>{{ winnerText }}</h2><p>A palavra BURRO foi completada. O resultado está salvo no histórico.</p></div>
      <div class="table-zone"><div class="table-top"><span>✳</span><b>{{ players.length }} JOGADORES · TROCA PARA A ESQUERDA</b><span>✳</span></div><div class="seats"><div v-for="(p,i) in players" :key="p.id" class="seat" :class="{'seat-active': p.id===match?.players[game.turnIndex]?.id, 'seat-me':p.id===myId}"><div class="seat-avatar">{{ p.name.slice(0,1).toUpperCase() }}</div><b>{{ p.id===myId?'Você':p.name }}</b><small>{{ 'BURRO'.slice(0,p.score).split('').join(' ') || '— — — — —' }}</small><span class="seat-cards">{{ game.counts[p.name] ?? 4 }} cartas</span></div></div><div class="table-pile"><span v-if="game.phase==='reaction'" class="pile-alert">PERCEBEU?</span><span v-else>✧</span><small>{{ game.phase==='reaction' ? `${game.reactions.length} REAÇÕES` : `${Object.keys(game.choices).length} / ${players.length} ESCOLHERAM` }}</small></div></div>
      <div v-if="game.phase==='passing'" class="hand-area"><div class="hand-title"><h3>{{ localDemo ? `Mão de ${handOwner?.name || '—'}` : 'Sua mão' }}</h3><span>{{ hand.length }} cartas · passa para {{ players[(game.turnIndex+1)%players.length]?.name }}</span></div><div class="cards-row"><button v-for="card in hand" :key="card.id" class="playing-card" :class="[card.color, {chosen:selectedCard===card.id}]" :disabled="!isMyTurn" @click="selectedCard=card.id"><span>{{ card.rank }}<i>{{ card.suit }}</i></span><strong>{{ card.suit }}</strong><span class="card-bottom">{{ card.rank }}<i>{{ card.suit }}</i></span></button><div v-if="!hand.length" class="waiting-cards">A mão é enviada somente ao aparelho deste jogador.</div></div><button class="primary-btn" :disabled="!isMyTurn || !selectedCard" @click="doPass">{{ isMyTurn ? 'Confirmar carta escolhida' : `Aguarde ${currentPlayer}` }} <span>↗</span></button></div>
      <button v-if="game.phase==='reaction'" class="primary-btn slap-btn" :disabled="hasReacted" @click="doSlap">{{ hasReacted ? 'Reação registrada' : '✋ Percebi!' }}</button>
      <button v-if="game.phase==='roundResult'" class="primary-btn" @click="nextMatchRound">Próxima rodada <span>↗</span></button>
      <button v-if="game.phase==='finished' && players.find(p=>p.id===myId)?.host" class="primary-btn" @click="restartRound">Nova partida <span>↗</span></button>
      <div class="rules-tip"><b>Regra</b><span>Escolha uma carta em cada rodada; depois da troca, confirme ao ver quatro do mesmo valor. Quem faz o quarteto vence a rodada. O último a reagir recebe uma letra; quem completar BURRO é eliminado.</span></div>
    </section>

    <section v-else class="content-page history-page"><button class="back-link" @click="goHome">← Voltar</button><span class="eyebrow">LEMBRANÇAS</span><h1>Histórico<br/><em>de partidas.</em></h1><div v-if="history.length" class="history-list"><div v-for="(item,i) in history" :key="item.id || i"><button class="history-row" @click="toggleHistory(item)"><span class="history-no">{{ String(i+1).padStart(2,'0') }}</span><div><b>{{ item.status==='finalizada' ? `${item.winner} venceu` : `Partida ${item.status}` }}</b><small>{{ new Date(item.startedAt).toLocaleString('pt-BR') }} · {{ item.players?.length || 0 }} jogadores</small></div><span class="history-letter">{{ historyDetail===item.id ? '−' : '+' }}</span></button><div v-if="historyDetail===item.id" class="history-detail"><p><b>Participantes:</b> {{ item.players?.join(', ') || '—' }}</p><p><b>Vencedor:</b> {{ item.winner || '—' }} · <b>Penalizado:</b> {{ item.penalty || '—' }}</p><p><b>Rodadas:</b> {{ item.rounds || 0 }} · <b>Estado:</b> {{ item.status }}</p><button class="small-btn reject-btn" @click="removeHistoryItem(item.id)">Apagar esta partida</button></div></div></div><div v-else class="empty-state"><span>◷</span><b>Nenhuma partida ainda</b><small>Suas partidas concluídas aparecem aqui.</small></div><button v-if="history.length" class="ghost-btn" @click="clearHistory">Limpar histórico</button><div class="info-card">O histórico fica salvo somente neste dispositivo. Nenhum dado é enviado para um servidor.</div></section>
    <div v-if="toast" class="toast">{{ toast }}</div>
  </main>
</template>
