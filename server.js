const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cron = require("node-cron");

const admin = require("firebase-admin");
const serviceAccount = require("/etc/secrets/bvb-checks.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const CHANNEL = process.env.CHANNEL;
const SLACK_TOKEN = process.env.TOKEN;

const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// 🔧 Generar bloques Slack
function generarBlocks(data = {}) {
  const blocks = [];

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "📝 *BVB Checks del día*",
    },
  });

  for (let horario of horarios) {
    const slot = data[horario] || {};

    let text = `⏰ *${horario}*\n`;

    if (!slot.takenBy) {
      text += "_Disponible_";
    } else {
      text += `🟢 Taken by @${slot.takenBy}\n`;
      if (slot.doneBy) {
        text += `✅ Done by @${slot.doneBy}`;
      }
    }

    const actions = [];

    if (!slot.takenBy) {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "Take" },
        style: "primary",
        value: horario,
        action_id: `take_${horario}`,
      });
    }

    if (slot.takenBy && !slot.doneBy) {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "Done" },
        style: "primary",
        value: horario,
        action_id: `done_${horario}`,
      });
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });

    if (actions.length > 0) {
      blocks.push({
        type: "actions",
        elements: actions,
      });
    }
  }

  return blocks;
}

// 🚀 Enviar mensaje inicial
async function enviarMensaje() {
  const hoy = new Date().toISOString().split("T")[0];
  const ref = db.collection("bvb-checks").doc(hoy);

  const doc = await ref.get();
  const data = doc.exists ? doc.data() : {};

  await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      text: "BVB Checks del día",
      blocks: generarBlocks(data),
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ⏰ CRON 9AM Colombia
cron.schedule(
  "0 9 * * *",
  async () => {
    console.log("⏰ Enviando mensaje diario...");
    await enviarMensaje();
  },
  {
    timezone: "America/Bogota",
  }
);

// 🧠 INTERACCIONES SLACK (FIX ERROR 500)
app.post("/slack/interactions", async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);

    if (!payload.actions || payload.actions.length === 0) {
      return res.status(200).send();
    }

    const action = payload.actions[0];
    const user =
      payload.user?.username ||
      payload.user?.name ||
      payload.user?.id ||
      "unknown";

    const horario = action.value;

    const hoy = new Date().toISOString().split("T")[0];
    const ref = db.collection("bvb-checks").doc(hoy);

    const doc = await ref.get();
    const data = doc.exists ? doc.data() : {};

    if (!data[horario]) {
      data[horario] = {};
    }

    // TAKE
    if (action.action_id.startsWith("take_")) {
      if (!data[horario].takenBy) {
        data[horario].takenBy = user;
      }
    }

    // DONE
    if (action.action_id.startsWith("done_")) {
      data[horario].doneBy = user;
    }

    await ref.set(data);

    await axios.post(
      "https://slack.com/api/chat.update",
      {
        channel: CHANNEL,
        ts: payload.message.ts,
        text: "BVB Checks del día",
        blocks: generarBlocks(data),
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.status(200).send(); // 🔥 clave
  } catch (error) {
    console.error("❌ ERROR SLACK:", error);
    return res.status(200).send(); // 🔥 evita error en Slack
  }
});

// 🔥 ENDPOINT TEST (opcional)
app.get("/test", async (req, res) => {
  await enviarMensaje();
  res.send("Mensaje enviado");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server corriendo en ${PORT}`);
});