"use strict";

const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;


/* =========================================================
   HTTP
========================================================= */

const server = http.createServer((req, res) => {

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("🐍 vs 🐢 online server OK");
});


/* =========================================================
   WebSocket
========================================================= */

const wss = new WebSocket.Server({
  server
});


/* =========================================================
   部屋
========================================================= */

const rooms = new Map();


/* =========================================================
   駒サイズ
========================================================= */

const SIZE = {
  small: 1,
  medium: 2,
  large: 3
};


/* =========================================================
   勝利ライン
========================================================= */

const LINES = [

  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 }
  ],

  [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 }
  ],

  [
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 2, y: 2 }
  ],

  [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 }
  ],

  [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 }
  ],

  [
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 }
  ],

  [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 }
  ],

  [
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 2 }
  ]

];


/* =========================================================
   ID
========================================================= */

let globalPieceId = 0;


/* =========================================================
   駒生成
========================================================= */

function makePiece(animal, size) {

  globalPieceId++;

  return {
    id: globalPieceId,
    animal,
    size: SIZE[size],
    used: false
  };
}


/* =========================================================
   手札生成
========================================================= */

function makeHand(animal) {

  return [
    makePiece(animal, "large"),
    makePiece(animal, "large"),

    makePiece(animal, "medium"),
    makePiece(animal, "medium"),

    makePiece(animal, "small"),
    makePiece(animal, "small")
  ];
}


function createHands() {

  return {
    snake: makeHand("snake"),
    turtle: makeHand("turtle")
  };
}


/* =========================================================
   新しいゲーム状態
========================================================= */

function newGameState() {

  return {

    board: [
      [[], [], []],
      [[], [], []],
      [[], [], []]
    ],

    hands: createHands(),

    firstPlayer: null,

    currentPlayer: null,

    turnNumber: 0,

    heldPiece: null,

    heldFrom: null,

    gameOver: false,

    phase: "waiting",

    winningCells: []

  };
}


/* =========================================================
   部屋コード
========================================================= */

function generateRoomCode() {

  let code;

  do {

    code =
      Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();

  } while (rooms.has(code));

  return code;
}


/* =========================================================
   JSONコピー
========================================================= */

function clone(value) {

  return JSON.parse(
    JSON.stringify(value)
  );
}


/* =========================================================
   送信
========================================================= */

function send(ws, data) {

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {
    ws.send(
      JSON.stringify(data)
    );
  }
}


function broadcast(room, data) {

  for (const player of room.players) {

    send(
      player.ws,
      data
    );
  }
}


/* =========================================================
   座標
========================================================= */

function validPosition(x, y) {

  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x <= 2 &&
    y >= 0 &&
    y <= 2
  );
}


/* =========================================================
   一番上
========================================================= */

function topPiece(state, x, y) {

  const stack =
    state.board[y][x];

  if (
    !stack ||
    stack.length === 0
  ) {
    return null;
  }

  return stack[
    stack.length - 1
  ];
}


/* =========================================================
   勝者判定
========================================================= */

function getWinner(state) {

  for (const line of LINES) {

    const pieces =
      line.map(position =>
        topPiece(
          state,
          position.x,
          position.y
        )
      );

    if (
      pieces[0] &&
      pieces[1] &&
      pieces[2] &&
      pieces[0].animal ===
        pieces[1].animal &&
      pieces[1].animal ===
        pieces[2].animal
    ) {

      return {
        winner: pieces[0].animal,
        cells: line
      };
    }
  }

  return null;
}


/* =========================================================
   手札から駒を探す
========================================================= */

function findHandPiece(
  state,
  animal,
  id
) {

  return state.hands[
    animal
  ].find(
    piece =>
      piece.id === id
  );
}


/* =========================================================
   配置可能か
========================================================= */

function canPlace(
  state,
  piece,
  x,
  y
) {

  if (
    !validPosition(x, y)
  ) {
    return false;
  }

  const stack =
    state.board[y][x];

  if (
    stack.length === 0
  ) {
    return true;
  }

  const top =
    stack[
      stack.length - 1
    ];

  return piece.size > top.size;
}


/* =========================================================
   先攻1手目中央L禁止
========================================================= */

function firstMoveCenterLargeForbidden(
  state,
  piece,
  x,
  y
) {

  if (
    x !== 1 ||
    y !== 1
  ) {
    return false;
  }

  if (
    piece.size !== 3
  ) {
    return false;
  }

  if (
    state.turnNumber !== 0
  ) {
    return false;
  }

  return (
    state.currentPlayer ===
    state.firstPlayer
  );
}


/* =========================================================
   手番変更
========================================================= */

function switchTurn(state) {

  state.currentPlayer =
    state.currentPlayer === "snake"
      ? "turtle"
      : "snake";

  state.turnNumber++;

  state.heldPiece = null;
  state.heldFrom = null;
}


/* =========================================================
   勝利
========================================================= */

function finishVictory(
  room,
  winner,
  cells
) {

  const state =
    room.state;

  state.gameOver = true;
  state.phase = "result";
  state.winningCells = cells;

  broadcast(room, {
    type: "victory",

    winner,

    cells,

    state: clone(state)
  });
}


/* =========================================================
   ゲーム開始
========================================================= */

function startGame(
  room,
  firstPlayer
) {

  const state =
    newGameState();

  let actualFirstPlayer;

  if (
    firstPlayer === "random"
  ) {

    actualFirstPlayer =
      Math.random() < 0.5
        ? "snake"
        : "turtle";

  } else {

    actualFirstPlayer =
      firstPlayer;
  }

  state.firstPlayer =
    actualFirstPlayer;

  state.currentPlayer =
    actualFirstPlayer;

  state.turnNumber = 0;

  state.phase = "playing";

room.state = state;

  for (const player of room.players) {

    send(player.ws, {

      type: "game_start",

      player: player.animal,

      room: room.code,

      state: clone(state)

    });
  }

}


/* =========================================================
   駒選択
========================================================= */


/* =========================================================
   駒選択
========================================================= */

function handleSelectHand(
  room,
  player,
  message
) {

  const state =
    room.state;

  if (
    state.gameOver ||
    state.phase !== "playing"
  ) {
    return;
  }

  if (
    state.currentPlayer !==
    player.animal
  ) {
    send(
      player.ws,
      {
        type: "error",
        message: "相手の番です。"
      }
    );

    return;
  }

  if (
    state.heldPiece
  ) {
    return;
  }

  const piece =
    findHandPiece(
      state,
      player.animal,
      message.id
    );

  if (
    !piece ||
    piece.used
  ) {

    send(
      player.ws,
      {
        type: "error",
        message: "その駒は選択できません。"
      }
    );

    return;
  }

  player.selectedHandPieceId =
    piece.id;

  /*
    選択状態そのものは
    相手へ送らない。
  */

  send(
    player.ws,
    {
      type: "state",
      state: clone(state)
    }
  );
}


/* =========================================================
   手札の駒を置く
========================================================= */

function handlePlaceHand(
  room,
  player,
  message
) {

  const state =
    room.state;

  if (
    state.gameOver ||
    state.phase !== "playing"
  ) {
    return;
  }

  if (
    state.currentPlayer !==
    player.animal
  ) {

    send(
      player.ws,
      {
        type: "error",
        message: "相手の番です。"
      }
    );

    return;
  }

  if (
    !validPosition(
      message.x,
      message.y
    )
  ) {
    return;
  }

  const piece =
    findHandPiece(
      state,
      player.animal,
      message.id
    );

  if (
    !piece ||
    piece.used
  ) {

    send(
      player.ws,
      {
        type: "error",
        message: "その駒は使用できません。"
      }
    );

    return;
  }

  /*
    先攻1手目L中央禁止
  */

  if (
    firstMoveCenterLargeForbidden(
      state,
      piece,
      message.x,
      message.y
    )
  ) {

    send(
      player.ws,
      {
        type: "error",
        message:
          "先攻の1手目ではLサイズの駒を中央に置くことはできません。"
      }
    );

    return;
  }

  if (
    !canPlace(
      state,
      piece,
      message.x,
      message.y
    )
  ) {

    send(
      player.ws,
      {
        type: "error",
        message: "そこには置けません。"
      }
    );

    return;
  }

  /*
    配置
  */

  state.board[
    message.y
  ][
    message.x
  ].push(piece);

  piece.used = true;

  player.selectedHandPieceId =
    null;

  /*
    勝利判定
  */

  const result =
    getWinner(state);

  if (result) {

    finishVictory(
      room,
      result.winner,
      result.cells
    );

    return;
  }

  /*
    次のターン
  */

  switchTurn(state);

  broadcast(room, {
    type: "state",
    state: clone(state)
  });
}


/* =========================================================
   盤上の駒を持ち上げる
========================================================= */

function handlePickBoard(
  room,
  player,
  message
) {

  const state =
    room.state;

  if (
    state.gameOver ||
    state.phase !== "playing"
  ) {
    return;
  }

  if (
    state.currentPlayer !==
    player.animal
  ) {

    send(
      player.ws,
      {
        type: "error",
        message: "相手の番です。"
      }
    );

    return;
  }

  if (
    state.heldPiece
  ) {
    return;
  }

  if (
    !validPosition(
      message.x,
      message.y
    )
  ) {
    return;
  }

  const stack =
    state.board[
      message.y
    ][
      message.x
    ];

  if (
    !stack ||
    stack.length === 0
  ) {
    return;
  }

  const piece =
    stack[
      stack.length - 1
    ];

  if (
    piece.animal !==
    player.animal
  ) {

    send(
      player.ws,
      {
        type: "error",
        message:
          "自分の駒だけ持ち上げることができます。"
      }
    );

    return;
  }

  /*
    一番上だけ取り出す
  */

  state.heldPiece =
    stack.pop();

  state.heldFrom = {
    x: message.x,
    y: message.y
  };

  /*
    ここが重要。
    下の駒が現れた瞬間に
    相手の3列が完成していないか判定。
  */

  const result =
    getWinner(state);

  if (
    result &&
    result.winner !==
      player.animal
  ) {

    finishVictory(
      room,
      result.winner,
      result.cells
    );

    return;
  }

  /*
    持ち上げ成功。
    まだターンは終了しない。
  */

  broadcast(room, {
    type: "state",
    state: clone(state)
  });
}


/* =========================================================
   持っている駒を置く
========================================================= */

function handlePlaceHeld(
  room,
  player,
  message
) {

  const state =
    room.state;

  if (
    state.gameOver ||
    state.phase !== "playing"
  ) {
    return;
  }

  if (
    state.currentPlayer !==
    player.animal
  ) {
    return;
  }

  if (
    !state.heldPiece ||
    !state.heldFrom
  ) {
    return;
  }

  if (
    !validPosition(
      message.x,
      message.y
    )
  ) {
    return;
  }

  /*
    元のマスには戻せない
  */

  if (
    state.heldFrom.x ===
      message.x &&
    state.heldFrom.y ===
      message.y
  ) {

    send(
      player.ws,
      {
        type: "error",
        message:
          "持ち上げた駒を元のマスに戻すことはできません。"
      }
    );

    return;
  }

  if (
    !canPlace(
      state,
      state.heldPiece,
      message.x,
      message.y
    )
  ) {

    send(
      player.ws,
      {
        type: "error",
        message: "そこには置けません。"
      }
    );

    return;
  }

  /*
    配置
  */

  state.board[
    message.y
  ][
    message.x
  ].push(
    state.heldPiece
  );

  state.heldPiece = null;
  state.heldFrom = null;

  /*
    勝利判定
  */

  const result =
    getWinner(state);

  if (result) {

    finishVictory(
      room,
      result.winner,
      result.cells
    );

    return;
  }

  /*
    ターン終了
  */

  switchTurn(state);

  broadcast(room, {
    type: "state",
    state: clone(state)
  });
}


/* =========================================================
   再戦
========================================================= */

function handleReplay(
  room,
  player
) {

  if (
    !room ||
    room.players.length !== 2
  ) {
    return;
  }

  if (
    !room.state.gameOver
  ) {
    return;
  }

  /*
    作成者だけが
    次の先攻を選択する。
  */

  if (
    !player.isCreator
  ) {
    return;
  }

  room.state =
    newGameState();

  broadcast(room, {
    type: "replay_select",
    creator: true
  });

  for (
    const other of room.players
  ) {

    if (
      !other.isCreator
    ) {

      send(
        other.ws,
        {
          type: "replay_select",
          creator: false
        }
      );
    }
  }
}


/* =========================================================
   メッセージ処理
========================================================= */

function handleMessage(
  room,
  player,
  message
) {

  if (!message || !message.type) {
    return;
  }

  switch (message.type) {

    case "select_hand":

      handleSelectHand(
        room,
        player,
        message
      );

      break;


    case "place_hand":

      handlePlaceHand(
        room,
        player,
        message
      );

      break;


    case "pick_board":

      handlePickBoard(
        room,
        player,
        message
      );

      break;


    case "place_held":

      handlePlaceHeld(
        room,
        player,
        message
      );

      break;


    case "choose_first":

      if (
        !player.isCreator
      ) {
        return;
      }

      if (
        room.players.length !== 2
      ) {
        return;
      }

      if (
        ![
          "snake",
          "turtle",
          "random"
        ].includes(
          message.firstPlayer
        )
      ) {
        return;
      }

      startGame(
        room,
        message.firstPlayer
      );

      break;


    case "replay":

      handleReplay(
        room,
        player
      );

      break;
  }
}


/* =========================================================
   接続
========================================================= */

wss.on(
  "connection",
  ws => {

    let room = null;
    let player = null;

    ws.on(
      "message",
      raw => {

        let message;

        try {

          message =
            JSON.parse(
              raw.toString()
            );

        } catch {

          return;
        }


        /*
          まだ部屋に入っていない
        */

        if (!room) {

          /* =====================
             部屋作成
          ===================== */

          if (
            message.type ===
            "create"
          ) {

            const code =
              generateRoomCode();

            room = {
              code,

              players: [],

              state:
                newGameState()
            };

            rooms.set(
              code,
              room
            );

            player = {

              ws,

              animal: "snake",

              isCreator: true,

              selectedHandPieceId:
                null
            };

            room.players.push(
              player
            );

            send(
              ws,
              {
                type: "room_created",

                room: code,

                player: "snake"
              }
            );

            send(
              ws,
              {
                type: "waiting",

                message:
                  "友達の参加を待っています。"
              }
            );

            return;
          }


          /* =====================
             部屋参加
          ===================== */

          if (
            message.type ===
            "join"
          ) {

            const code =
              String(
                message.room || ""
              )
              .trim()
              .toUpperCase();

            const targetRoom =
              rooms.get(code);

            if (!targetRoom) {

              send(
                ws,
                {
                  type: "error",
                  message:
                    "その部屋は見つかりません。"
                }
              );

              return;
            }

            if (
              targetRoom.players.length >= 2
            ) {

              send(
                ws,
                {
                  type: "error",
                  message:
                    "この部屋は満員です。"
                }
              );

              return;
            }

            room =
              targetRoom;

            player = {

              ws,

              animal: "turtle",

              isCreator: false,

              selectedHandPieceId:
                null
            };

            room.players.push(
              player
            );

            /*
              両者に部屋準備完了
            */

            for (
              const p of room.players
            ) {

              send(
                p.ws,
                {
                  type: "room_ready",

                  room: room.code,

                  creator:
                    p.isCreator
                }
              );
            }

            /*
              作成者に先攻選択
            */

            for (
              const p of room.players
            ) {

              send(
                p.ws,
                {
                  type:
                    "first_player_select",

                  creator:
                    p.isCreator
                }
              );
            }

            return;
          }

          return;
        }


        /*
          すでに部屋にいる
        */

        handleMessage(
          room,
          player,
          message
        );
      }
    );


    /* =====================================================
       切断
    ===================================================== */

    ws.on(
      "close",
      () => {

        if (!room) {
          return;
        }

        room.players =
          room.players.filter(
            p =>
              p.ws !== ws
          );

        /*
          誰もいなくなった
        */

        if (
          room.players.length === 0
        ) {

          rooms.delete(
            room.code
          );

          return;
        }

        /*
          相手に退出通知
        */

        const remaining =
          room.players[0];

        send(
          remaining.ws,
          {
            type:
              "opponent_left",

            message:
              "相手が退出しました。"
          }
        );

        /*
          MVPでは部屋を破棄。
        */

        rooms.delete(
          room.code
        );
      }
    );
  }
);


/* =========================================================
   起動
========================================================= */

server.listen(
  PORT,
  () => {

    console.log(
      `🐍 vs 🐢 server listening on port ${PORT}`
    );

  }
);
