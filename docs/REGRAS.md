# Regras implementadas

O PDF deixa a regra que escolhe o jogador penalizado para o grupo definir. Para que a partida seja executável, o app usa esta regra padrão, que deve ser combinada pelos participantes antes de jogar.

1. A partida aceita de 2 a 6 participantes. O anfitrião aceita ou recusa os pedidos antes de começar.
2. O baralho francês contém 52 cartas, sem coringas. Cada participante recebe quatro cartas.
3. A ordem dos participantes define quem escolhe a carta em cada turno. Cada pessoa escolhe e confirma uma carta da própria mão; o anfitrião valida que é sua vez e que a carta pertence à sua mão.
4. Depois que todos escolherem, as cartas são trocadas ao mesmo tempo para a pessoa seguinte no sentido horário. Cada jogador recebe uma carta do anterior e continua com quatro cartas. As mãos recebidas são mantidas nas rodadas seguintes.
5. Depois de cada troca, o sistema procura quatro cartas do mesmo valor. Quem formou o quarteto vence a rodada.
6. Ao aparecer o quarteto, todos têm cinco segundos para tocar em **Percebi!**. O último a reagir recebe uma letra de BURRO. Quem não reagir até o fim do prazo também pode receber a letra, com desempate pela última posição da mesa.
7. Cada penalidade acrescenta uma letra. Ao completar BURRO, o participante é eliminado. A partida termina quando resta um participante, que é declarado vencedor.

## Limites da implementação atual

- O anfitrião controla o estado autoritativo e entrega a cada convidado somente a própria mão.
- A rodada aguarda a vez indicada; as escolhas são coletadas e aplicadas de uma só vez após todos confirmarem.
- A detecção de quarteto ocorre depois da distribuição inicial e depois de cada troca.
- A janela de reação usa o relógio do anfitrião. O limite de cinco segundos é uma decisão desta implementação, não um valor especificado no PDF.
- Uma desconexão durante a partida é informada, mas o fluxo completo de pausa/reconexão ainda não foi concluído.
