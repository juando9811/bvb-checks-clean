const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cron = require("node-cron");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const CHANNEL = process.env.CHANNEL;
const SLACK_TOKEN = process.env.TOKEN;

// 🧠 MEMORIA
let data = {};
let currentThreadTs = null;

// 🕒 HORARIOS
const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// 🔁 RESET SEGURO
function resetData() {
  data = {};
  horarios.forEach((h) => {
    data[h] = {
      takenBy: null,
      doneBy: null,
    };
  });
}

// 📦 GENERAR BLOQUES (SAFE)
function generarBlocks() {
  return horarios.flatMap((hora) => {
    const item = data[hora] || { takenBy: null, doneBy: null };

    let texto = `⏰ *${hora}*\n`;

    if (item.takenBy) {
      texto += `🟢 Taken by <@${item.takenBy}>\n`;
    } else {
      texto += `_Disponible_\n`;
    }

    if (item.doneBy) {
      texto += `✅ Done by <@${item.doneBy}>\n`;
    }

    let elements = [];

    if (!item.takenBy) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Take" },
        action_id: `take_${hora}`,
      });
    } else if (!item.doneBy) {
      elements.push({
        type: "button",
        text: { type: "plain_text", text: "Done" },
        action_id: `done_${hora}`,
        style: "primary",
      });
    }

    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: texto },
      },
      ...(elements.length
        ? [
            {
              type: "actions",
              elements,
            },
          ]
        : []),
      { type: "divider" },
    ];
  });
}

// 🚀 ENVIAR MENSAJE
async function enviarMensaje() {
  resetData();

  const res = await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      text: "📋 BVB Checks del día",
    },
    {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    }
  );

  currentThreadTs = res.data.ts;

  await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      thread_ts: currentThreadTs,
      text: "Horarios del día",
      blocks: generarBlocks(),
    },
    {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    }
  );

  console.log("✅ Mensaje enviado");
}

// ⏰ CRON COLOMBIA
cron.schedule(
  "0 9 * * *",
  () => {
    console.log("⏰ Ejecutando envío...");
    enviarMensaje();
  },
  {
    timezone: "America/Bogota",
  }
);

// ⚡ INTERACCIONES SIN DELAY + SAFE
app.post("/slack/interactions", (req, res) => {
  res.status(200).send(); // ⚡ responde inmediato

  setImmediate(async () => {
    try {
      const payload = JSON.parse(req.body.payload);
      const action = payload.actions[0];
      const user = payload.user.id;

      let horario = action.action_id
        .replace("take_", "")
        .replace("done_", "");

      // 🔥 FIX CLAVE
      if (!data[horario]) {
        data[horario] = {
          takenBy: null,
          doneBy: null,
        };
      }

      if (action.action_id.startsWith("take_")) {
        if (!data[horario].takenBy) {
          data[horario].takenBy = user;
        }
      }

      if (action.action_id.startsWith("done_")) {
        data[horario].doneBy = user;
      }

      await axios.post(
        "https://slack.com/api/chat.update",
        {
          channel: CHANNEL,
          ts: payload.message.ts,
          text: "📋 BVB Checks del día",
          blocks: generarBlocks(),
        },
        {
          headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
        }
      );
    } catch (err) {
      console.error("❌ ERROR:", err.message);
    }
  });
});

// 🧪 TEST
app.get("/send-now", async (req, res) => {
  await enviarMensaje();
  res.send("ok");
});

// START
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("🚀 Server running"));