const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== ENV =====
const SLACK_TOKEN = process.env.TOKEN;
const CHANNEL = process.env.CHANNEL;

// ===== FIREBASE (desde Secret File en Render) =====
const serviceAccount = require("/etc/secrets/bvb-checks.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ===== HORARIOS =====
const horarios = [
  "9:30 - 10:00",
  "12:00 - 12:30",
  "2:30 - 3:00",
  "5:00 - 5:30",
  "7:30 - 8:00",
  "10:00 - 10:30",
  "12:00",
];

// ===== GENERAR BLOQUES =====
function generarBlocks(data) {
  const blocks = [];

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*📋 BVB Checks del día*",
    },
  });

  horarios.forEach((horario) => {
    const slot = data[horario] || {};

    let text = `⏰ *${horario}*\n`;

    if (!slot.takenBy) {
      text += "_Disponible_";
    } else {
      text += `👤 Tomado por <@${slot.takenBy}>`;
      if (slot.doneBy) {
        text += `\n✅ Done by <@${slot.doneBy}>`;
      }
    }

    const actions = [];

    if (!slot.takenBy) {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "Take" },
        action_id: `take_${horario}`,
      });
    } else if (!slot.doneBy) {
      actions.push({
        type: "button",
        text: { type: "plain_text", text: "Done" },
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
  });

  return blocks;
}

// ===== ENVIAR MENSAJE =====
app.get("/send", async (req, res) => {
  const docRef = db.collection("bvb").doc("today");

  const initialData = {};
  horarios.forEach((h) => (initialData[h] = {}));

  await docRef.set(initialData);

  const response = await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      text: "BVB Checks del día",
      blocks: generarBlocks(initialData),
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  // Guardamos el thread_ts
  await db.collection("config").doc("thread").set({
    thread_ts: response.data.ts,
  });

  res.send("Mensaje enviado");
});

// ===== INTERACCIONES =====
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const action = payload.actions[0];
  const user = payload.user.id;

  const horario = action.action_id.replace("take_", "").replace("done_", "");

  const docRef = db.collection("bvb").doc("today");
  const doc = await docRef.get();
  const data = doc.data();

  if (action.action_id.startsWith("take_")) {
    if (!data[horario].takenBy) {
      data[horario].takenBy = user;
    }
  }

  if (action.action_id.startsWith("done_")) {
    data[horario].doneBy = user;
  }

  await docRef.set(data);

  // 🔥 ACTUALIZA EL MENSAJE PRINCIPAL
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

  // 🔥 RESPUESTA EN THREAD
  await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      thread_ts: payload.message.ts,
      text: `<@${user}> actualizó ${horario}`,
    },
    {
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  res.sendStatus(200);
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server corriendo en ${PORT}`);
});