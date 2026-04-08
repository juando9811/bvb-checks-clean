const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");
const cron = require("node-cron");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ===== ENV =====
const SLACK_TOKEN = process.env.TOKEN;
const CHANNEL = process.env.CHANNEL;

// ===== FIREBASE =====
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

// ===== FECHA DINÁMICA =====
function getToday() {
  return new Date().toISOString().split("T")[0];
}

// ===== BLOCKS =====
function generarBlocks(data) {
  const blocks = [];

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*📋 BVB Checks del día*" },
  });

  horarios.forEach((horario) => {
    const slot = data[horario] || {};

    let text = `⏰ *${horario}*\n`;

    if (!slot.takenBy) {
      text += "_Disponible_";
    } else {
      text += `🟢 Taken by <@${slot.takenBy}>`;
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

// ===== CREAR MENSAJE =====
async function sendDailyMessage() {
  const today = getToday();
  const docRef = db.collection("bvb-checks").doc(today);

  const initialData = {};
  horarios.forEach((h) => (initialData[h] = {}));

  await docRef.set(initialData);

  // mensaje principal
  const main = await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      text: `📋 BVB Checks del día (${today})`,
    },
    {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    }
  );

  // mensaje thread (el importante)
  const thread = await axios.post(
    "https://slack.com/api/chat.postMessage",
    {
      channel: CHANNEL,
      thread_ts: main.data.ts,
      text: "Cargando checks...",
      blocks: generarBlocks(initialData),
    },
    {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    }
  );

  await db.collection("config").doc("thread").set({
    main_ts: main.data.ts,
    thread_ts: thread.data.ts,
    date: today,
  });
}

// ===== INTERACCIONES =====
app.post("/slack/interactions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const action = payload.actions[0];
  const user = payload.user.id;

  const horario = action.action_id.replace("take_", "").replace("done_", "");

  const today = getToday();
  const docRef = db.collection("bvb-checks").doc(today);

  const doc = await docRef.get();
  const data = doc.data();

  // lógica
  if (action.action_id.startsWith("take_")) {
    if (!data[horario].takenBy) {
      data[horario].takenBy = user;
      data[horario].takenAt = new Date().toISOString();
    }
  }

  if (action.action_id.startsWith("done_")) {
    data[horario].doneBy = user;
    data[horario].doneAt = new Date().toISOString();
  }

  await docRef.set(data);

  // obtener thread actual
  const config = await db.collection("config").doc("thread").get();
  const { thread_ts } = config.data();

  // actualizar mensaje del thread
  await axios.post(
    "https://slack.com/api/chat.update",
    {
      channel: CHANNEL,
      ts: thread_ts,
      text: "BVB Checks del día",
      blocks: generarBlocks(data),
    },
    {
      headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
    }
  );

  res.sendStatus(200);
});

// ===== ENDPOINT MANUAL =====
app.get("/send", async (req, res) => {
  await sendDailyMessage();
  res.send("Mensaje enviado");
});

// ===== CRON =====
cron.schedule(
  "0 9 * * *",
  async () => {
    console.log("⏰ Enviando mensaje diario...");
    await sendDailyMessage();
  },
  {
    timezone: "America/Bogota",
  }
);

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server corriendo en ${PORT}`);
});