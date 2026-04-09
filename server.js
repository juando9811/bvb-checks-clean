const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const CHANNEL = process.env.CHANNEL;
const SLACK_TOKEN = process.env.TOKEN;

// 🔥 FIREBASE
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/bvb-checks.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

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

// 🔒 evitar duplicados
let lastRunDate = null;

// 📦 BLOQUES
function generarBlocks(data) {
  return horarios.flatMap((hora) => {
    const item = data[hora] || {};

    let texto = `⏰ *${hora}*\n`;

    if (item.takenBy) {
      texto += `🟢 Taken by <@${item.takenBy}>\n`;
    } else {
      texto += `_Disponible_\n`;
    }

    if (item.doneBy) {
      texto += `✅ Done by <@${item.doneBy}>\n`;
    }

    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: texto,
        },
      },
      {
        type: "actions",
        elements: [
          !item.takenBy
            ? {
                type: "button",
                text: { type: "plain_text", text: "Take" },
                action_id: `take_${hora}`,
                style: "primary",
              }
            : !item.doneBy
            ? {
                type: "button",
                text: { type: "plain_text", text: "Done" },
                action_id: `done_${hora}`,
                style: "danger",
              }
            : {
                type: "plain_text",
                text: "✔ Completado",
              },
        ],
      },
      { type: "divider" },
    ];
  });
}

// 🚀 ENVÍO DIARIO
async function enviarMensajeDiario() {
  const hoy = new Date().toISOString().split("T")[0];

  if (lastRunDate === hoy) {
    console.log("⚠️ Ya enviado hoy");
    return;
  }

  lastRunDate = hoy;

  const ref = db.collection("bvb-checks").doc(hoy);
  const doc = await ref.get();

  if (!doc.exists) {
    const base = {};
    horarios.forEach((h) => (base[h] = {}));
    await ref.set(base);
  }

  const data = (await ref.get()).data();

  const res = await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      text: "📋 BVB Checks del día",
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  const thread_ts = res.data.ts;

  await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      thread_ts,
      text: "📋 BVB Checks del día",
      blocks: generarBlocks(data),
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  console.log("✅ Mensaje enviado");
}

// ⏰ CRON COLOMBIA
cron.schedule(
  "0 9 * * *",
  () => {
    console.log("⏰ Ejecutando envío...");
    enviarMensajeDiario();
  },
  {
    timezone: "America/Bogota",
  }
);

// 🔥 INTERACCIONES
app.post("/slack/interactions", async (req, res) => {
  res.status(200).send(); // ⚡ inmediato

  const payload = JSON.parse(req.body.payload);
  const action = payload.actions[0];
  const user = payload.user.id;

  const hoy = new Date().toISOString().split("T")[0];
  const ref = db.collection("bvb-checks").doc(hoy);
  const doc = await ref.get();
  const data = doc.data();

  const horario = action.action_id.replace("take_", "").replace("done_", "");

  if (action.action_id.startsWith("take_")) {
    if (!data[horario].takenBy) {
      data[horario].takenBy = user;
    }
  }

  if (action.action_id.startsWith("done_")) {
    data[horario].doneBy = user;
  }

  await ref.set(data);

  // 🔥 HISTORIAL EN SLACK (NUEVO)
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      thread_ts: payload.message.thread_ts || payload.message.ts,
      text: `${
        action.action_id.startsWith("take_") ? "🟢 *Taken*" : "✅ *Done*"
      } - *${horario}* por <@${user}>`,
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  // 🔄 ACTUALIZAR MENSAJE
  await axios.post(
    "https://slack.com/api/chat.update",
    {
      channel: CHANNEL,
      ts: payload.message.ts,
      text: "📋 BVB Checks del día",
      blocks: generarBlocks(data),
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
});

// 🧪 TEST
app.get("/send-now", async (req, res) => {
  await enviarMensajeDiario();
  res.send("OK");
});

// 🚀 START
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server corriendo en puerto ${PORT}`);
});