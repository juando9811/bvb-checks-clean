const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

// =========================
// 🔥 FIREBASE (USANDO JSON)
// =========================
const serviceAccount = require("./bvb-checks-firebase-adminsdk-fbsvc-380dd9c278.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// =========================
// 🔧 CONFIG
// =========================
const SLACK_TOKEN = process.env.TOKEN;
const CHANNEL = process.env.CHANNEL;

// =========================
// 🕒 HORARIOS
// =========================
const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// =========================
// 📅 FECHA HOY
// =========================
function getTodayKey() {
  const today = new Date();
  return today.toISOString().split("T")[0]; // YYYY-MM-DD
}

// =========================
// 📦 CREAR / OBTENER ESTADO
// =========================
async function getOrCreateDay() {
  const key = getTodayKey();
  const ref = db.collection("bvb-checks").doc(key);
  const doc = await ref.get();

  if (!doc.exists) {
    const initial = {};
    horarios.forEach((h) => {
      initial[h] = { takenBy: null, doneBy: null };
    });

    await ref.set(initial);
    return initial;
  }

  return doc.data();
}

// =========================
// 🧱 GENERAR BLOQUES SLACK
// =========================
function generarBlocks(estados) {
  let blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "📋 *BVB Checks del día*",
      },
    },
    { type: "divider" },
  ];

  for (let horario of horarios) {
    const slot = estados[horario];

    let text = `🕒 *${horario}*\n`;

    if (!slot.takenBy) {
      text += "_Disponible_";
    } else {
      text += `🟢 Taken by <@${slot.takenBy}>\n`;
      if (slot.doneBy) {
        text += `✅ Done by <@${slot.doneBy}>`;
      }
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
      accessory: !slot.takenBy
        ? {
            type: "button",
            text: {
              type: "plain_text",
              text: "Take",
            },
            style: "primary",
            action_id: `take_${horario}`,
          }
        : {
            type: "button",
            text: {
              type: "plain_text",
              text: "Done",
            },
            style: "danger",
            action_id: `done_${horario}`,
          },
    });

    blocks.push({ type: "divider" });
  }

  return blocks;
}

// =========================
// 📤 ENVIAR MENSAJE
// =========================
app.get("/send", async (req, res) => {
  try {
    const estados = await getOrCreateDay();

    const response = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: CHANNEL,
        text: "BVB Checks del día",
        blocks: generarBlocks(estados),
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.send("✅ Mensaje enviado");
  } catch (error) {
    console.error(error);
    res.send("❌ Error");
  }
});

// =========================
// 🔘 INTERACCIONES SLACK
// =========================
app.post("/slack/interactions", async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload);
    const action = payload.actions[0];
    const user = payload.user.id;
    const horario = action.action_id.split("_")[1];

    const key = getTodayKey();
    const ref = db.collection("bvb-checks").doc(key);
    const doc = await ref.get();
    const data = doc.data();

    if (action.action_id.startsWith("take_")) {
      if (!data[horario].takenBy) {
        data[horario].takenBy = user;
      }
    }

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

    res.send("");
  } catch (error) {
    console.error(error);
    res.status(500).send("error");
  }
});

// =========================
// 🚀 SERVER
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server corriendo en ${PORT}`);
});