const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const cron = require("node-cron");
const fs = require("fs");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const CHANNEL = process.env.CHANNEL;
const SLACK_TOKEN = process.env.TOKEN;

// 🔥 FIREBASE DESDE SECRET FILE
const serviceAccount = JSON.parse(
  fs.readFileSync("/etc/secrets/bvb-checks.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ⏰ HORARIOS
const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// 🔹 GENERAR BLOQUES
function generarBloques(data = {}) {
  let blocks = [];

  for (let horario of horarios) {
    let slot = data[horario] || {};

    let text = `⏰ *${horario}*\n`;

    if (!slot.takenBy) {
      text += "_Disponible_";
    } else {
      text += `🟢 Taken by <@${slot.takenBy}>\n`;
      if (slot.doneBy) {
        text += `✅ Done by <@${slot.doneBy}>`;
      }
    }

    let actionBlock = {
      type: "actions",
      elements: [],
    };

    if (!slot.takenBy) {
      actionBlock.elements.push({
        type: "button",
        text: { type: "plain_text", text: "Take" },
        action_id: `take_${horario}`,
      });
    } else if (!slot.doneBy) {
      actionBlock.elements.push({
        type: "button",
        text: { type: "plain_text", text: "Done" },
        action_id: `done_${horario}`,
        style: "primary",
      });
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });

    if (actionBlock.elements.length > 0) {
      blocks.push(actionBlock);
    }

    blocks.push({ type: "divider" });
  }

  return blocks;
}

// 🚀 CRON DIARIO (CON TIMEZONE COLOMBIA)
cron.schedule(
  "0 9 * * *",
  async () => {
    console.log("⏰ Ejecutando cron Colombia:", new Date());

    const hoy = new Date().toISOString().split("T")[0];

    // mensaje principal
    const parent = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: CHANNEL,
        text: "📋 BVB Checks del día",
      },
      {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      }
    );

    const thread_ts = parent.data.ts;

    const ref = db.collection("bvb-checks").doc(hoy);
    const doc = await ref.get();
    let data = doc.exists ? doc.data() : {};

    // mensaje dentro del thread
    await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: CHANNEL,
        thread_ts,
        text: "BVB Checks del día",
        blocks: generarBloques(data),
      },
      {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      }
    );
  },
  {
    timezone: "America/Bogota", // 🔥 CLAVE
  }
);

// ⚡ INTERACCIONES ULTRA RÁPIDAS
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);

  // 🔥 RESPUESTA INMEDIATA
  res.status(200).send();

  try {
    const action = payload.actions[0];
    const user = payload.user.id;
    const horario = action.action_id.replace("take_", "").replace("done_", "");

    const hoy = new Date().toISOString().split("T")[0];
    const ref = db.collection("bvb-checks").doc(hoy);

    const doc = await ref.get();
    let data = doc.exists ? doc.data() : {};

    if (!data[horario]) data[horario] = {};

    if (action.action_id.startsWith("take_")) {
      if (!data[horario].takenBy) {
        data[horario].takenBy = user;
      }
    }

    if (action.action_id.startsWith("done_")) {
      data[horario].doneBy = user;
    }

    await ref.set(data);

    // actualizar mensaje
    await axios.post(
      "https://slack.com/api/chat.update",
      {
        channel: CHANNEL,
        ts: payload.message.ts,
        text: "BVB Checks del día",
        blocks: generarBloques(data),
      },
      {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      }
    );
  } catch (err) {
    console.error("❌ Error:", err);
  }
});

app.listen(10000, () => console.log("🚀 Server running"));