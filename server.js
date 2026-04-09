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

// 🔧 BLOQUES
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

// 🚀 ENVIAR MENSAJE
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

// ⏰ CRON
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

// 🔥 INTERACCIONES (MEJORA UX + SIN DELAY)
app.post("/slack/interactions", async (req, res) => {
  // ✅ RESPUESTA INMEDIATA A SLACK
  res.status(200).send();

  try {
    const payload = JSON.parse(req.body.payload);

    if (!payload.actions || payload.actions.length === 0) return;

    const action = payload.actions[0];

    const user =
      payload.user?.username ||
      payload.user?.name ||
      payload.user?.id ||
      "unknown";

    const horario = action.value;

    // ⚡ RESPUESTA VISUAL INMEDIATA (UX)
    if (payload.response_url) {
      await axios.post(payload.response_url, {
        replace_original: false,
        text: "⏳ Actualizando...",
      });
    }

    const hoy = new Date().toISOString().split("T")[0];
    const ref = db.collection("bvb-checks").doc(hoy);

    const doc = await ref.get();
    const data = doc.exists ? doc.data() : {};

    if (!data[horario]) {
      data[horario] = {};
    }

    // 🚫 evitar doble take
    if (action.action_id.startsWith("take_")) {
      if (data[horario].takenBy) return;
      data[horario].takenBy = user;
    }

    if (action.action_id.startsWith("done_")) {
      data[horario].doneBy = user;
    }

    await ref.set(data);

    // 🔄 UPDATE MENSAJE
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
  } catch (error) {
    console.error("❌ ERROR SLACK:", error);
  }
});

// 🧪 TEST
app.get("/test", async (req, res) => {
  await enviarMensaje();
  res.send("Mensaje enviado");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server corriendo en ${PORT}`);
});