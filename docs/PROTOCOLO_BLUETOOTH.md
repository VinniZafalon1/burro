# Protocolo Bluetooth LE

O anfitrião anuncia um serviço GATT personalizado (`8d6c2f10-7a51-4eaf-9e0b-425552524f01`). O serviço tem uma característica gravável para comandos (`8d6c2f11-7a51-4eaf-9e0b-425552524f01`) e uma característica de notificação para estado (`8d6c2f12-7a51-4eaf-9e0b-425552524f01`). Os celulares conectam-se diretamente; não há servidor web nem internet.

Mensagens são objetos JSON UTF-8. Antes de processar, o anfitrião verifica tipo, jogador, partida, turno, carta e tamanho (máximo de 512 bytes).

| Direção | Tipo | Dados principais |
|---|---|---|
| Convidado → anfitrião | `JOIN_REQUEST` | `name` |
| Convidado → anfitrião | `CARD_CHOICE` | `matchId`, `cardId` |
| Convidado → anfitrião | `REACTION` | `matchId` |
| Anfitrião → convidado | `ROOM_STATE` | estado da sala, aceite e identidade atribuída |
| Anfitrião → convidado | `GAME_STATE` | partida, rodada, turno, participantes e contagens |
| Anfitrião → convidado | `JOIN_REJECTED` | motivo da recusa |

O `GAME_STATE` notificado a cada dispositivo inclui somente a mão do jogador destinatário. O anfitrião mantém todas as mãos para aplicar e validar a troca.

## Permissões Android

O manifesto declara `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` e `BLUETOOTH_ADVERTISE` para Android 12 ou posterior; em versões anteriores declara Bluetooth clássico legado e localização fina para descoberta BLE. O app pede as permissões em tempo de execução antes de anunciar ou buscar salas.
